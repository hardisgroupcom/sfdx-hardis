// Utilities to delete Flows listed in a destructive manifest.
//
// A metadata deployment can delete a Flow, but only if the org is already in the right state:
//  - a bare "MyFlow" member fails with "insufficient access rights", so every version has to be
//    named individually ("MyFlow-1", "MyFlow-2", ...),
//  - the Flow has to be inactive already: deactivating it in the same deployment does not help, as
//    that deactivation is not visible inside the transaction (NoDataFoundException /
//    UNKNOWN_EXCEPTION), so it takes a manual deactivation or an earlier deployment,
//  - a checkOnly deploy never commits a deactivation, so a deletion depending on one can not be
//    validated, and a quick deploy replays the validated container, so anything left out is dropped.
//
// To avoid that manual preparation, Flow members are stripped from the manifest (identically on
// validation and on the real deploy, to keep the validated container intact) and deleted through the
// Tooling API instead, before or after the constructive deployment according to their source
// manifest. Every step is idempotent, so a pipeline retry converges.
import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { extractRegexMatches, uxLog, uxLogTable } from './index.js';
import { parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';
import { bulkDelete, bulkDeleteTooling, bulkQuery, soqlQuery } from './apiUtils.js';
import { generateCsvFile, generateReportPath } from './filesUtils.js';
import { getEnvVar } from '../../config/index.js';
import { t } from './i18n.js';

// Only Flow versions in these manageable states can be deleted from the org.
const DELETABLE_MANAGEABLE_STATES = ['deprecatedEditable', 'installedEditable', 'unmanaged'];
// Salesforce reports blocking interviews as "Flow Interview - <15 or 18 char Id>" in deletion errors.
// The 18-char alternative comes first so a full Id is captured rather than its 15-char prefix.
const FLOW_INTERVIEW_ID_REGEX = /Flow Interview - ([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})/gm;
// Also matched by the "Flow Interviews block Flow deletion" deploy tip (see deployTipsList.ts).
export const FLOW_INTERVIEW_BLOCK_MARKER = 'Flow Interview - ';
// A delete failing with one of these counts as a success: the record is already gone (idempotency).
const ALREADY_DELETED_MARKERS = [
  'ENTITY_IS_DELETED',
  'NOT_FOUND',
  'entity is deleted',
  'does not exist',
  'already deleted',
  // Real Tooling response for a stale Flow version id: FIELD_INTEGRITY_EXCEPTION "Unable to load specified entity 301..."
  'Unable to load specified entity',
];
// Both the 18-char DurableId and its 15-char form go in the FlowInterview IN clause, so that clause
// grows by ~42 characters per Flow version. Queried in chunks to stay far below the 100 000 character
// SOQL limit, whatever the number of Flows and versions.
const FLOW_INTERVIEW_ID_CHUNK_SIZE = 400;
// Defaults of the bounded retry loop that follows a Flow Interview block (deleteOneFlow, step 5).
const DEFAULT_FLOW_DELETE_MAX_ATTEMPTS = 3;
const DEFAULT_FLOW_DELETE_RETRY_DELAY_MS = 10000;

// FLOW_DELETE_BLOCKED: Flow Interviews prevent the deletion; converges once they resolve (or the flag is set).
// FLOW_DELETE_ERROR: any non-interview failure (access, transport, unexpected exception); needs inspection.
export type FlowDeletionStatus = 'SUCCESS' | 'FLOW_DELETE_BLOCKED' | 'FLOW_DELETE_ERROR' | 'FLOW_DELETE_NOOP';

// One Flow to delete, as read from the destructive manifest.
// requestedVersions is null for a bare member ("MyFlow" - delete the whole Flow), or the explicit
// version numbers for versioned members ("MyFlow-3" - delete version 3 only).
export type PendingFlowDeletion = {
  flowName: string;
  requestedVersions: number[] | null;
};

export type FlowVersionRecord = {
  id: string;
  versionNumber: number;
  status: string;
};

export type FlowInterviewQueryOptions = {
  // When provided, only interviews attached to these exact Flow version Ids are returned.
  // Omitted means every version of each named Flow.
  versionIdsByFlow?: Record<string, string[]>;
  // Defaults to failing closed. Only the purge command opts out, as it has an error-parsing fallback.
  failOnError?: boolean;
};

export type FlowDeletionOutcome = {
  flowName: string;
  status: FlowDeletionStatus;
  wholeFlow: boolean;
  previousActiveVersion: number | null;
  versionsToDelete: number[];
  versionsDeleted: number[];
  interviewCount: number;
  interviewsDeleted: number;
  deleteInterviewsAllowed: boolean;
  message: string;
};

// A Flow member is "bare" when it has no "-<versionNumber>" suffix (Flow API names never contain a hyphen).
const VERSION_SUFFIX_REGEX = /-(\d+)$/;

// ---------------------------------------------------------------------------
// Detection & manifest rewriting
// ---------------------------------------------------------------------------

// Inspect a destructive manifest and return the Flows it asks to delete.
// A wildcard (*) is reported so the caller can refuse it.
export async function detectPendingFlowDeletions(
  destructiveChangesFile: string | undefined
): Promise<{ pendingFlowDeletions: PendingFlowDeletion[]; hasWildcard: boolean }> {
  if (!destructiveChangesFile || !fs.existsSync(destructiveChangesFile)) {
    return { pendingFlowDeletions: [], hasWildcard: false };
  }
  const content = await parsePackageXmlFile(destructiveChangesFile);
  const flowMembers: string[] = content['Flow'] || [];
  const hasWildcard = flowMembers.includes('*');
  // Keep insertion order so logs and reports stay stable across runs.
  const byFlowName = new Map<string, number[] | null>();
  for (const member of flowMembers) {
    if (member === '*') {
      continue;
    }
    const versionMatch = VERSION_SUFFIX_REGEX.exec(member);
    if (!versionMatch) {
      // Bare member wins over versioned ones: deleting the whole Flow covers every version.
      byFlowName.set(member, null);
      continue;
    }
    const flowName = member.slice(0, member.length - versionMatch[0].length);
    const existing = byFlowName.get(flowName);
    if (existing === null) {
      continue; // already marked for full deletion
    }
    byFlowName.set(flowName, [...(existing || []), Number(versionMatch[1])]);
  }
  const pendingFlowDeletions = [...byFlowName.entries()].map(([flowName, requestedVersions]) => ({
    flowName,
    requestedVersions,
  }));
  return { pendingFlowDeletions, hasWildcard };
}

// Merge the Flows found in several destructive manifests (pre + post) into a single deletion list.
export function mergePendingFlowDeletions(...lists: PendingFlowDeletion[][]): PendingFlowDeletion[] {
  const merged = new Map<string, number[] | null>();
  for (const pending of lists.flat()) {
    const existing = merged.get(pending.flowName);
    if (pending.requestedVersions === null || existing === null) {
      merged.set(pending.flowName, null);
      continue;
    }
    merged.set(pending.flowName, [...new Set([...(existing || []), ...pending.requestedVersions])]);
  }
  return [...merged.entries()].map(([flowName, requestedVersions]) => ({ flowName, requestedVersions }));
}

// Rewrite a destructive manifest without its Flow members, into a temp copy (the original is never
// mutated). Returns null when there is nothing to strip.
// A wildcard is rejected: forwarding it to the deployment could target every Flow in the org.
export async function stripFlowsFromDestructiveChanges(
  destructiveChangesFile: string,
  tmpDir: string,
  fileName: string
): Promise<string | null> {
  const content = await parsePackageXmlFile(destructiveChangesFile);
  const flowMembers: string[] = content['Flow'] || [];
  if (flowMembers.includes('*')) {
    throw new SfError(t('flowDeletionWildcardRefused'));
  }
  if (flowMembers.length === 0) {
    return null;
  }
  const strippedFile = path.join(tmpDir, fileName);
  await fs.copy(destructiveChangesFile, strippedFile);
  const strippedContent = await parsePackageXmlFile(strippedFile);
  // Removing the last Flow member: drop the empty type so the manifest stays valid.
  delete strippedContent['Flow'];
  await writePackageXmlFile(strippedFile, strippedContent);
  return strippedFile;
}

// ---------------------------------------------------------------------------
// Org queries (read-only)
// ---------------------------------------------------------------------------

// Build the quoted value list of a SOQL IN clause. A Flow API name can not contain a quote, so the
// escaping is only there to keep the query valid whatever value reaches these helpers.
function toSoqlStringList(values: string[]): string {
  return values.map((value) => `'${String(value).replace(/'/g, "\\'")}'`).join(',');
}

// Query the org (Tooling API) for every deletable version of the given Flows, oldest version first.
// Returns a map of Flow DeveloperName -> versions. Throws if the query can not run, rather than
// starting a deletion sequence on an incomplete version list.
export async function queryFlowVersions(
  flowNames: string[],
  conn: any,
  commandThis: any
): Promise<Record<string, FlowVersionRecord[]>> {
  const versionsByFlow: Record<string, FlowVersionRecord[]> = {};
  if (flowNames.length === 0) {
    return versionsByFlow;
  }
  uxLog('action', commandThis, c.cyan(t('flowDeletionQueryingVersions')));
  const namesInClause = toSoqlStringList(flowNames);
  const query =
    `SELECT Id, VersionNumber, Status, Definition.DeveloperName FROM Flow ` +
    `WHERE ManageableState IN ('${DELETABLE_MANAGEABLE_STATES.join("','")}') ` +
    `AND Definition.DeveloperName IN (${namesInClause}) ` +
    `ORDER BY Definition.DeveloperName, VersionNumber`;
  let records: any[] = [];
  try {
    const queryResult = await conn.tooling.query(query);
    records = queryResult?.records || [];
  } catch (e: any) {
    throw new SfError(t('flowDeletionQueryFailed', { flows: flowNames.join(', '), error: e.message }));
  }
  for (const record of records) {
    const flowName = record?.Definition?.DeveloperName;
    const versionNumber = record?.VersionNumber;
    if (!flowName || versionNumber == null || !record?.Id) {
      continue;
    }
    versionsByFlow[flowName] = versionsByFlow[flowName] || [];
    versionsByFlow[flowName].push({
      id: String(record.Id),
      versionNumber: Number(versionNumber),
      status: String(record.Status || ''),
    });
  }
  for (const flowName of Object.keys(versionsByFlow)) {
    versionsByFlow[flowName].sort((a, b) => a.versionNumber - b.versionNumber);
  }
  return versionsByFlow;
}

// Query the FlowDefinition record of each Flow: its Id (needed to deactivate) and whether it
// currently has an active version.
export async function queryFlowDefinitions(
  flowNames: string[],
  conn: any,
  commandThis: any
): Promise<Record<string, { id: string; hasActiveVersion: boolean }>> {
  const definitionsByFlow: Record<string, { id: string; hasActiveVersion: boolean }> = {};
  if (flowNames.length === 0) {
    return definitionsByFlow;
  }
  const namesInClause = toSoqlStringList(flowNames);
  const query = `SELECT Id, DeveloperName, ActiveVersionId FROM FlowDefinition WHERE DeveloperName IN (${namesInClause})`;
  let records: any[] = [];
  try {
    const queryResult = await conn.tooling.query(query);
    records = queryResult?.records || [];
  } catch (e: any) {
    throw new SfError(t('flowDeletionDeactivationQueryFailed', { flows: flowNames.join(', '), error: e.message }));
  }
  for (const record of records) {
    if (!record?.DeveloperName || !record?.Id) {
      continue;
    }
    definitionsByFlow[record.DeveloperName] = {
      id: String(record.Id),
      hasActiveVersion: Boolean(record.ActiveVersionId),
    };
  }
  uxLog('log', commandThis, c.grey(t('flowDeletionQueriedDefinitions', { count: Object.keys(definitionsByFlow).length })));
  return definitionsByFlow;
}

// Query the Ids of EVERY Flow Interview running on the given Flows, grouped by Flow API name.
// A blocked deletion error only names ~10 interviews but a Flow can be blocked by hundreds, so the
// count has to come from the org. No InterviewStatus filter: any surviving FlowInterview record
// blocks the deletion of its version, whatever its status.
// Path used: FlowInterview.FlowVersionViewId -> FlowVersionView.DurableId -> FlowDefinitionView.ApiName.
// Two Salesforce quirks: FlowVersionView.Id is the placeholder "000000000000000AAA" on every record,
// so only DurableId is usable; and FlowInterview.FlowVersionViewId stores the 15-char form of that
// DurableId, so both forms are matched.
export async function queryFlowInterviewIdsByFlow(
  flowNames: string[],
  conn: any,
  commandThis: any,
  options: FlowInterviewQueryOptions = {}
): Promise<Record<string, string[]>> {
  if (!flowNames || flowNames.length === 0) {
    return {};
  }
  if (!conn) {
    const missingConnectionError = new SfError(
      t('flowInterviewQueryFailed', { error: 'Missing Salesforce connection' })
    );
    if (options.failOnError === false) {
      uxLog('warning', commandThis, c.yellow(missingConnectionError.message));
      return {};
    }
    throw missingConnectionError;
  }
  uxLog('action', commandThis, c.cyan(t('flowInterviewQueryingForFlows', { flows: flowNames.join(', ') })));
  const namesInClause = toSoqlStringList(flowNames);
  const allowedVersionIdsByFlow = new Map<string, Set<string>>();
  for (const [flowName, versionIds] of Object.entries(options.versionIdsByFlow || {})) {
    const normalizedIds = new Set<string>();
    for (const versionId of versionIds) {
      const id = String(versionId || '');
      if (!id) {
        continue;
      }
      normalizedIds.add(id);
      normalizedIds.add(id.substring(0, 15));
    }
    allowedVersionIdsByFlow.set(flowName, normalizedIds);
  }
  // 1) Resolve the DurableId of every version of these Flows, and remember which Flow it belongs to.
  const flowNameByVersionViewId = new Map<string, string>();
  try {
    const versionViewRes = await soqlQuery(
      `SELECT DurableId, FlowDefinitionView.ApiName FROM FlowVersionView WHERE FlowDefinitionView.ApiName IN (${namesInClause})`,
      conn
    );
    for (const record of versionViewRes?.records || []) {
      const durableId = record?.DurableId ? String(record.DurableId) : '';
      const apiName = record?.FlowDefinitionView?.ApiName;
      if (!durableId || !apiName) {
        continue;
      }
      const allowedVersionIds = allowedVersionIdsByFlow.get(apiName);
      if (
        options.versionIdsByFlow &&
        (!allowedVersionIds ||
          (!allowedVersionIds.has(durableId) && !allowedVersionIds.has(durableId.substring(0, 15))))
      ) {
        continue;
      }
      flowNameByVersionViewId.set(durableId, apiName);
      flowNameByVersionViewId.set(durableId.substring(0, 15), apiName);
    }
  } catch (e: any) {
    const queryError = new SfError(t('flowInterviewQueryFailed', { error: e.message }));
    if (options.failOnError === false) {
      uxLog('warning', commandThis, c.yellow(queryError.message));
      return {};
    }
    throw queryError;
  }
  if (flowNameByVersionViewId.size === 0) {
    return {};
  }
  // 2) Find every interview running on those versions and group them back per Flow.
  // The Id list is chunked, so a deletion covering many Flows and versions never builds a SOQL query
  // longer than the org accepts.
  const versionViewIds = [...flowNameByVersionViewId.keys()];
  const interviewIdsByFlow: Record<string, string[]> = {};
  try {
    for (let offset = 0; offset < versionViewIds.length; offset += FLOW_INTERVIEW_ID_CHUNK_SIZE) {
      const idsInClause = toSoqlStringList(versionViewIds.slice(offset, offset + FLOW_INTERVIEW_ID_CHUNK_SIZE));
      const interviewRes = await bulkQuery(
        `SELECT Id, FlowVersionViewId FROM FlowInterview WHERE FlowVersionViewId IN (${idsInClause})`,
        conn
      );
      for (const record of interviewRes?.records || []) {
        const interviewId = record?.Id;
        const flowName = flowNameByVersionViewId.get(String(record?.FlowVersionViewId || ''));
        if (!interviewId || !flowName) {
          continue;
        }
        interviewIdsByFlow[flowName] = interviewIdsByFlow[flowName] || [];
        if (!interviewIdsByFlow[flowName].includes(interviewId)) {
          interviewIdsByFlow[flowName].push(interviewId);
        }
      }
    }
  } catch (e: any) {
    const queryError = new SfError(t('flowInterviewQueryFailed', { error: e.message }));
    if (options.failOnError === false) {
      uxLog('warning', commandThis, c.yellow(queryError.message));
      return {};
    }
    throw queryError;
  }
  return interviewIdsByFlow;
}

// Flat list of every Flow Interview Id running on the given Flows. Used by hardis:org:purge:flow,
// which does not need the per-Flow grouping.
export async function queryFlowInterviewIdsForFlows(
  flowNames: string[],
  conn: any,
  commandThis: any,
  options: FlowInterviewQueryOptions = {}
): Promise<string[]> {
  const byFlow = await queryFlowInterviewIdsByFlow(flowNames, conn, commandThis, options);
  return [...new Set<string>(Object.values(byFlow).flat())];
}

// Merge Flow Interview Id lists that disagree on the Id form: queries return the 18-char Id while
// deletion error messages carry its 15-char prefix, so a plain Set keeps both and deletes the same
// interview twice (the second delete failing with ENTITY_IS_DELETED). The 15-char prefix is
// case-sensitive, so it identifies the record on its own; the 18-char form wins when both are seen.
// Only needed where two sources meet - a single source never mixes the two forms.
export function dedupeFlowInterviewIds(interviewIds: string[]): string[] {
  const idByPrefix = new Map<string, string>();
  for (const rawId of interviewIds) {
    const id = String(rawId || '');
    if (!id) {
      continue;
    }
    const prefix = id.substring(0, 15);
    const known = idByPrefix.get(prefix);
    if (known === undefined || (known.length < 18 && id.length >= 18)) {
      idByPrefix.set(prefix, id);
    }
  }
  return [...idByPrefix.values()];
}

// Extract the unique Flow Interview Ids that a deletion error reports as blocking.
// Salesforce only names a handful of blocking interviews per error (~10), so this list is NOT
// exhaustive - use queryFlowInterviewIdsByFlow to find them all.
export async function extractBlockingFlowInterviewIds(errorText: string): Promise<string[]> {
  const ids = await extractRegexMatches(FLOW_INTERVIEW_ID_REGEX, errorText || '');
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// Org mutations
// ---------------------------------------------------------------------------

// Deactivate a Flow via the Tooling API (FlowDefinition.activeVersionNumber = 0).
// Commits immediately and is NOT rolled back if a later step fails, which is intended: no new Flow
// Interview can start, so the interviews blocking the deletion can only shrink and a retry converges.
export async function deactivateFlowViaToolingApi(
  flowName: string,
  flowDefinitionId: string,
  conn: any,
  commandThis: any
): Promise<void> {
  uxLog('action', commandThis, c.cyan(t('flowDeletionDeactivatingViaApi', { flow: flowName })));
  try {
    await conn.tooling.sobject('FlowDefinition').update({
      Id: flowDefinitionId,
      Metadata: { activeVersionNumber: 0 },
    });
  } catch (e: any) {
    throw new SfError(t('flowDeletionDeactivationFailed', { flow: flowName, error: e.message }));
  }
  uxLog('success', commandThis, c.green(t('flowDeletionDeactivatedFlow', { flow: flowName })));
}

// Delete the given Flow Interviews. This destroys in-flight process state and is irreversible,
// so it is logged at warning level.
export async function deleteBlockingFlowInterviews(
  interviewIds: string[],
  conn: any,
  commandThis: any
): Promise<{ deleted: any[]; errors: any[] }> {
  if (interviewIds.length === 0) {
    return { deleted: [], errors: [] };
  }
  uxLog('warning', commandThis, c.yellow(t('flowInterviewsBlockingDeletion', { count: interviewIds.length })));
  const deleteResults = await bulkDelete('FlowInterview', interviewIds, conn);
  const deleted = deleteResults?.successfulResults || [];
  const errors = deleteResults?.failedResults || [];
  uxLog('warning', commandThis, c.yellow(t('flowInterviewsDeleted', { count: deleted.length })));
  return { deleted, errors };
}

function toolingDeleteErrorMessage(result: any): string {
  if (result?.error) {
    return String(result.error);
  }
  if (Array.isArray(result?.errors)) {
    // Keep the statusCode: it is what identifies an already-deleted record (ENTITY_IS_DELETED).
    return result.errors
      .map((err: any) => [err?.statusCode, err?.message].filter(Boolean).join(': ') || String(err))
      .join('; ');
  }
  if (typeof result?.errors === 'string') {
    return result.errors;
  }
  return JSON.stringify(result ?? {});
}

function isAlreadyDeletedError(message: string): boolean {
  return ALREADY_DELETED_MARKERS.some((marker) => message.toUpperCase().includes(marker.toUpperCase()));
}

// Delete Flow versions via the Tooling API, in a single composite batch sent oldest version first.
// The batch results are mapped back to their version through the record Id, so each version keeps its
// own error attribution.
// A version that is already gone counts as deleted: re-running the deletion must be a no-op. Callers
// verify against the org afterwards, so a systematic "not found" never passes as a deletion.
export async function deleteFlowVersionsViaToolingApi(
  flowName: string,
  versions: FlowVersionRecord[],
  conn: any,
  commandThis: any
): Promise<{ deletedVersions: number[]; blockedByInterviews: boolean; errors: string[] }> {
  const deletedVersions: number[] = [];
  const errors: string[] = [];
  let blockedByInterviews = false;
  if (versions.length === 0) {
    return { deletedVersions, blockedByInterviews, errors };
  }
  const ordered = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
  uxLog(
    'action',
    commandThis,
    c.cyan(
      t('flowDeletionDeletingVersions', {
        count: ordered.length,
        flow: flowName,
        versions: ordered.map((version) => version.versionNumber).join(', '),
      })
    )
  );
  const versionById = new Map(ordered.map((version) => [version.id, version]));
  const deleteRes = await bulkDeleteTooling('Flow', ordered.map((version) => version.id), conn);
  for (const result of deleteRes.results) {
    const recordId = String(result?.Id ?? '');
    const version = versionById.get(recordId);
    const versionNumber = version?.versionNumber ?? null;
    if (result?.success === true) {
      if (versionNumber != null) {
        deletedVersions.push(versionNumber);
      }
      continue;
    }
    const errorMessage = toolingDeleteErrorMessage(result);
    if (isAlreadyDeletedError(errorMessage)) {
      // Already gone: exactly the state we wanted.
      if (versionNumber != null) {
        deletedVersions.push(versionNumber);
      }
      continue;
    }
    if (errorMessage.includes(FLOW_INTERVIEW_BLOCK_MARKER)) {
      blockedByInterviews = true;
    }
    errors.push(t('flowDeletionVersionDeleteFailed', { flow: flowName, version: versionNumber ?? recordId, error: errorMessage }));
  }
  deletedVersions.sort((a, b) => a - b);
  if (deletedVersions.length > 0) {
    uxLog(
      'success',
      commandThis,
      c.green(t('flowDeletionVersionsDeleted', { count: deletedVersions.length, flow: flowName }))
    );
  }
  for (const error of errors) {
    uxLog('error', commandThis, c.red(error));
  }
  return { deletedVersions, blockedByInterviews, errors };
}

// ---------------------------------------------------------------------------
// Phase 1: validation preflight (read-only)
// ---------------------------------------------------------------------------

// Read-only check of what the real deployment will do, run during a checkOnly deployment.
// A Flow absent from the target org is a no-op, not an error: the same delta is replayed along the
// promotion chain and may already have been applied.
export async function runFlowDeletionPreflight(
  pendingFlowDeletions: PendingFlowDeletion[],
  conn: any,
  commandThis: any,
  deleteInterviewsAllowed: boolean
): Promise<FlowDeletionOutcome[]> {
  if (pendingFlowDeletions.length === 0) {
    return [];
  }
  uxLog('action', commandThis, c.cyan(t('flowDeletionPreflight')));
  const flowNames = pendingFlowDeletions.map((pending) => pending.flowName);
  const versionsByFlow = await queryFlowVersions(flowNames, conn, commandThis);
  const selectedVersionsByFlow = Object.fromEntries(
    pendingFlowDeletions.map((pending) => [
      pending.flowName,
      selectVersionsToDelete(versionsByFlow[pending.flowName] || [], pending.requestedVersions),
    ])
  );
  const versionIdsByFlow = Object.fromEntries(
    Object.entries(selectedVersionsByFlow).map(([flowName, versions]) => [
      flowName,
      versions.map((version) => version.id),
    ])
  );
  const interviewIdsByFlow = await queryFlowInterviewIdsByFlow(flowNames, conn, commandThis, {
    versionIdsByFlow,
  });
  const outcomes: FlowDeletionOutcome[] = [];
  for (const pending of pendingFlowDeletions) {
    const versions = selectedVersionsByFlow[pending.flowName] || [];
    const interviewCount = (interviewIdsByFlow[pending.flowName] || []).length;
    const outcome: FlowDeletionOutcome = {
      flowName: pending.flowName,
      status: 'SUCCESS',
      wholeFlow: pending.requestedVersions === null,
      previousActiveVersion: findActiveVersionNumber(versionsByFlow[pending.flowName] || []),
      versionsToDelete: versions.map((version) => version.versionNumber),
      versionsDeleted: [],
      interviewCount,
      interviewsDeleted: 0,
      deleteInterviewsAllowed,
      message: '',
    };
    if (versions.length === 0) {
      outcome.status = 'FLOW_DELETE_NOOP';
      outcome.message = t('flowDeletionFlowAbsent', { flow: pending.flowName });
      uxLog('warning', commandThis, c.yellow(outcome.message));
      outcomes.push(outcome);
      continue;
    }
    if (interviewCount > 0 && !deleteInterviewsAllowed) {
      outcome.status = 'FLOW_DELETE_BLOCKED';
      outcome.message = t('flowDeletionBlockedByInterviews', {
        flow: pending.flowName,
        count: interviewCount,
        configKey: 'flowDeleteInterviews: true',
        envVar: 'FLOW_DELETE_INTERVIEWS=true',
      });
    } else {
      outcome.message = t('flowDeletionPlanned', {
        flow: pending.flowName,
        count: versions.length,
        activeVersion:
          outcome.previousActiveVersion == null ? t('flowDeletionAlreadyInactive') : String(outcome.previousActiveVersion),
        interviews: interviewCount,
      });
      uxLog('log', commandThis, c.grey(outcome.message));
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Phase 2: real deployment mutation step
// ---------------------------------------------------------------------------

// Tuning of the retry loop that follows a Flow Interview block.
export type FlowDeletionRetrySettings = {
  maxAttempts: number;
  retryDelayMs: number;
};

// Read one numeric setting from the env var (priority) then the .sfdx-hardis.yml property.
// An unusable value falls back to the default instead of being passed on: Number('abc') is NaN and
// Number('0') is 0, and both would make the retry loop run zero delete attempts, then report
// "versions remaining" without a single attempt having been made.
function resolveNumericSetting(
  envVarName: string,
  configKey: string,
  configValue: any,
  defaultValue: number,
  minimum: number,
  commandThis: any
): number {
  const envValue = getEnvVar(envVarName);
  const [rawValue, settingName] =
    envValue != null && String(envValue).trim() !== '' ? [envValue, envVarName] : [configValue, configKey];
  if (rawValue == null || String(rawValue).trim() === '') {
    return defaultValue;
  }
  // Booleans are rejected explicitly: Number(true) is 1, so a "flowDeleteMaxAttempts: true" typo would
  // silently pass as one attempt.
  const value = typeof rawValue === 'boolean' ? NaN : Number(rawValue);
  if (!Number.isInteger(value) || value < minimum) {
    uxLog(
      'warning',
      commandThis,
      c.yellow(
        t('flowDeletionInvalidSetting', {
          setting: settingName,
          value: String(rawValue),
          minimum,
          default: defaultValue,
        })
      )
    );
    return defaultValue;
  }
  return value;
}

// Resolve the retry settings from the env vars and the .sfdx-hardis.yml config, once per run.
export function resolveFlowDeletionRetrySettings(commandThis: any, config: any = {}): FlowDeletionRetrySettings {
  return {
    maxAttempts: resolveNumericSetting(
      'FLOW_DELETE_MAX_ATTEMPTS',
      'flowDeleteMaxAttempts',
      config?.flowDeleteMaxAttempts,
      DEFAULT_FLOW_DELETE_MAX_ATTEMPTS,
      1,
      commandThis
    ),
    retryDelayMs: resolveNumericSetting(
      'FLOW_DELETE_RETRY_DELAY_MS',
      'flowDeleteRetryDelayMs',
      config?.flowDeleteRetryDelayMs,
      DEFAULT_FLOW_DELETE_RETRY_DELAY_MS,
      0,
      commandThis
    ),
  };
}

// Delete the Flows via the Tooling API, before or after the metadata deployment according to the
// source destructive manifest. Flows are processed independently, so one blocked Flow never prevents
// the deletion of the others.
export async function runFlowDeletionStep(
  pendingFlowDeletions: PendingFlowDeletion[],
  conn: any,
  commandThis: any,
  deleteInterviewsAllowed: boolean,
  phase: 'pre' | 'post' = 'post',
  retrySettings?: FlowDeletionRetrySettings
): Promise<FlowDeletionOutcome[]> {
  if (pendingFlowDeletions.length === 0) {
    return [];
  }
  // Resolved after the early return, so an empty deletion list never warns about a setting it ignores.
  const settings = retrySettings ?? resolveFlowDeletionRetrySettings(commandThis);
  const flowNames = pendingFlowDeletions.map((pending) => pending.flowName);
  uxLog(
    'action',
    commandThis,
    c.cyan(t(phase === 'pre' ? 'flowDeletionPreStep' : 'flowDeletionPostStep', { flows: flowNames.join(', ') }))
  );
  // Enumerate against the target org, never reusing a validation-time list: version counts differ
  // between the orgs of the promotion chain.
  const versionsByFlow = await queryFlowVersions(flowNames, conn, commandThis);
  const definitionsByFlow = await queryFlowDefinitions(flowNames, conn, commandThis);
  const outcomes: FlowDeletionOutcome[] = [];
  for (const pending of pendingFlowDeletions) {
    const allVersions = versionsByFlow[pending.flowName] || [];
    try {
      outcomes.push(
        await deleteOneFlow(
          pending,
          allVersions,
          definitionsByFlow[pending.flowName],
          conn,
          commandThis,
          deleteInterviewsAllowed,
          settings
        )
      );
    } catch (e: any) {
      // Unexpected failure (missing definition, transport error mid-run...): not an interview block,
      // so it must not report as one. A transport error can also hide work that DID complete
      // server-side, so the counts of this outcome are what the run saw, not necessarily the org state.
      const versions = selectVersionsToDelete(allVersions, pending.requestedVersions);
      const message = `FLOW_DELETE_ERROR: ${e?.message || String(e)}`;
      const outcome: FlowDeletionOutcome = {
        flowName: pending.flowName,
        status: 'FLOW_DELETE_ERROR',
        wholeFlow: pending.requestedVersions === null,
        previousActiveVersion: findActiveVersionNumber(allVersions),
        versionsToDelete: versions.map((version) => version.versionNumber),
        versionsDeleted: [],
        interviewCount: 0,
        interviewsDeleted: 0,
        deleteInterviewsAllowed,
        message,
      };
      uxLog('error', commandThis, c.red(message));
      outcomes.push(outcome);
    }
  }
  return outcomes;
}

async function deleteOneFlow(
  pending: PendingFlowDeletion,
  allVersions: FlowVersionRecord[],
  definition: { id: string; hasActiveVersion: boolean } | undefined,
  conn: any,
  commandThis: any,
  deleteInterviewsAllowed: boolean,
  retrySettings: FlowDeletionRetrySettings
): Promise<FlowDeletionOutcome> {
  const versions = selectVersionsToDelete(allVersions, pending.requestedVersions);
  const outcome: FlowDeletionOutcome = {
    flowName: pending.flowName,
    status: 'SUCCESS',
    wholeFlow: pending.requestedVersions === null,
    previousActiveVersion: findActiveVersionNumber(allVersions),
    versionsToDelete: versions.map((version) => version.versionNumber),
    versionsDeleted: [],
    interviewCount: 0,
    interviewsDeleted: 0,
    deleteInterviewsAllowed,
    message: '',
  };

  // Step 1: existence check. Nothing to delete means a previous run already did the work.
  if (versions.length === 0) {
    outcome.status = 'FLOW_DELETE_NOOP';
    outcome.message = t('flowDeletionFlowAbsent', { flow: pending.flowName });
    uxLog('warning', commandThis, c.yellow(outcome.message));
    return outcome;
  }

  // Step 2: deactivate. A versioned member only deactivates the Flow when the named version is the
  // active one, so deleting an obsolete version never takes a live Flow offline. A whole-Flow
  // deletion trusts FlowDefinition.ActiveVersionId rather than the version list, from which the
  // manageable-state filter could have hidden the active version.
  const deactivationNeeded =
    pending.requestedVersions === null
      ? definition?.hasActiveVersion === true || outcome.previousActiveVersion != null
      : outcome.previousActiveVersion != null && outcome.versionsToDelete.includes(outcome.previousActiveVersion);
  if (!deactivationNeeded) {
    uxLog('log', commandThis, c.grey(t('flowDeletionNoDeactivationNeeded', { flow: pending.flowName })));
  } else if (!definition?.id) {
    throw new SfError(t('flowDeletionDefinitionNotFound', { flow: pending.flowName }));
  } else {
    if (outcome.previousActiveVersion != null) {
      // Logged so an operator can reactivate manually if needed: never auto-applied.
      uxLog(
        'log',
        commandThis,
        c.grey(t('flowDeletionPreviousActiveVersion', { flow: pending.flowName, version: outcome.previousActiveVersion }))
      );
    }
    await deactivateFlowViaToolingApi(pending.flowName, definition.id, conn, commandThis);
  }

  // Step 3: Flow Interview gate, on live data (interviews can appear or resolve since validation).
  const versionIdsByFlow = { [pending.flowName]: versions.map((version) => version.id) };
  const interviewIds =
    (
      await queryFlowInterviewIdsByFlow([pending.flowName], conn, commandThis, {
        versionIdsByFlow,
      })
    )[pending.flowName] || [];
  // A set, so the retry loop below counts each interview once, not once per round.
  const handledInterviewIds = new Set<string>(interviewIds);
  outcome.interviewCount = handledInterviewIds.size;
  if (interviewIds.length > 0 && !deleteInterviewsAllowed) {
    outcome.status = 'FLOW_DELETE_BLOCKED';
    outcome.message = t('flowDeletionBlockedAfterDeactivation', {
      flow: pending.flowName,
      count: interviewIds.length,
      configKey: 'flowDeleteInterviews: true',
      envVar: 'FLOW_DELETE_INTERVIEWS=true',
    });
    uxLog('error', commandThis, c.red(outcome.message));
    return outcome;
  }

  // Step 4: Flow Interview deletion, only when explicitly authorized.
  if (interviewIds.length > 0) {
    const { deleted } = await deleteBlockingFlowInterviews(interviewIds, conn, commandThis);
    outcome.interviewsDeleted = deleted.length;
  } else {
    uxLog('log', commandThis, c.grey(t('flowDeletionNoInterviews', { flow: pending.flowName })));
  }

  // Step 5: version deletion, with a bounded retry for the race where an interview still running at
  // deactivation time pauses mid-sequence.
  const maxAttempts = deleteInterviewsAllowed ? retrySettings.maxAttempts : 1;
  const retryDelayMs = retrySettings.retryDelayMs;
  let remaining = versions;
  let lastErrors: string[] = [];
  let blockedByInterviews = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const deleteRes = await deleteFlowVersionsViaToolingApi(pending.flowName, remaining, conn, commandThis);
    outcome.versionsDeleted = [...new Set([...outcome.versionsDeleted, ...deleteRes.deletedVersions])].sort((a, b) => a - b);
    lastErrors = deleteRes.errors;
    blockedByInterviews = deleteRes.blockedByInterviews;
    remaining = remaining.filter((version) => !outcome.versionsDeleted.includes(version.versionNumber));
    if (remaining.length === 0) {
      break;
    }
    if (!blockedByInterviews || attempt === maxAttempts) {
      break;
    }
    uxLog(
      'warning',
      commandThis,
      c.yellow(t('flowDeletionRetryAfterInterviews', { flow: pending.flowName, attempt: attempt + 1, max: maxAttempts }))
    );
    const liveInterviewIds =
      (
        await queryFlowInterviewIdsByFlow([pending.flowName], conn, commandThis, {
          versionIdsByFlow: {
            [pending.flowName]: remaining.map((version) => version.id),
          },
        })
      )[pending.flowName] || [];
    if (liveInterviewIds.length === 0) {
      // The blocking interviews resolved on their own: retry the version deletion directly.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    liveInterviewIds.forEach((interviewId) => handledInterviewIds.add(interviewId));
    outcome.interviewCount = handledInterviewIds.size;
    const { deleted } = await deleteBlockingFlowInterviews(liveInterviewIds, conn, commandThis);
    outcome.interviewsDeleted += deleted.length;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  if (remaining.length > 0) {
    // Interview block: the Flow stays deactivated, so a pipeline retry converges once the remaining
    // interviews resolve (or once the deletion flag is set). Any other failure is an error: deleting
    // interviews would not help and the operator must inspect it.
    outcome.status = blockedByInterviews ? 'FLOW_DELETE_BLOCKED' : 'FLOW_DELETE_ERROR';
    outcome.message =
      lastErrors.length > 0
        ? lastErrors.join('\n')
        : t('flowDeletionVersionsRemaining', { flow: pending.flowName, count: remaining.length });
    uxLog('error', commandThis, c.red(outcome.message));
    return outcome;
  }

  // Verification: the versions the manifest asked for must really be gone in the org. A delete that
  // answers "not found" counts as already deleted, so without this query a wrong endpoint or API
  // version would report SUCCESS for every version without deleting anything. A whole-Flow deletion
  // must leave nothing behind at all, a versioned member only has to leave its own versions behind.
  // Leftovers here are not an interview block: the deletion loop above already returned in that case.
  const orgVersionsAfterDeletion =
    (await queryFlowVersions([pending.flowName], conn, commandThis))[pending.flowName] || [];
  const leftOver =
    pending.requestedVersions === null
      ? orgVersionsAfterDeletion
      : orgVersionsAfterDeletion.filter((version) => outcome.versionsToDelete.includes(version.versionNumber));
  if (leftOver.length > 0) {
    outcome.status = 'FLOW_DELETE_ERROR';
    outcome.message = t('flowDeletionVersionsRemaining', { flow: pending.flowName, count: leftOver.length });
    uxLog('error', commandThis, c.red(outcome.message));
    return outcome;
  }
  outcome.message = t('flowDeletionSucceeded', { flow: pending.flowName, count: outcome.versionsDeleted.length });
  uxLog('success', commandThis, c.green(outcome.message));
  return outcome;
}

// Restrict the org versions to the ones the manifest asked for (all of them for a bare member).
function selectVersionsToDelete(
  orgVersions: FlowVersionRecord[],
  requestedVersions: number[] | null
): FlowVersionRecord[] {
  if (requestedVersions === null) {
    return orgVersions;
  }
  return orgVersions.filter((version) => requestedVersions.includes(version.versionNumber));
}

function findActiveVersionNumber(orgVersions: FlowVersionRecord[]): number | null {
  const active = orgVersions.find((version) => version.status === 'Active');
  return active ? active.versionNumber : null;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<FlowDeletionStatus, string> = {
  SUCCESS: '✅',
  FLOW_DELETE_BLOCKED: '❌',
  FLOW_DELETE_ERROR: '💥',
  FLOW_DELETE_NOOP: '➖',
};

// Worst status wins, so a single failed Flow fails the whole run. An error outranks an interview
// block: the block has a documented remediation, the error needs inspection.
export function worstFlowDeletionStatus(outcomes: FlowDeletionOutcome[]): FlowDeletionStatus {
  if (outcomes.some((outcome) => outcome.status === 'FLOW_DELETE_ERROR')) {
    return 'FLOW_DELETE_ERROR';
  }
  if (outcomes.some((outcome) => outcome.status === 'FLOW_DELETE_BLOCKED')) {
    return 'FLOW_DELETE_BLOCKED';
  }
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome.status === 'FLOW_DELETE_NOOP')) {
    return 'FLOW_DELETE_NOOP';
  }
  return 'SUCCESS';
}

// Statuses that must fail the command.
export function isFailedFlowDeletionStatus(status: FlowDeletionStatus): boolean {
  return status === 'FLOW_DELETE_BLOCKED' || status === 'FLOW_DELETE_ERROR';
}

function formatVersionList(flowName: string, versions: number[]): string {
  return versions.map((version) => `${flowName}-${version}`).join(', ');
}

// Columns of the Flow deletion report, declared once so the console table, the CSV and the Pull
// Request comment always show the same columns in the same order.
// "header" / "value" feed the console table and the CSV, kept in plain English so scripts reading the
// CSV keep working. The Pull Request comment translates the header and uses "markdownValue" when set.
type FlowDeletionColumn = {
  header: string;
  markdownHeaderKey: string;
  markdownAlign: string;
  value: (outcome: FlowDeletionOutcome) => string | number;
  markdownValue?: (outcome: FlowDeletionOutcome) => string;
};

const FLOW_DELETION_COLUMNS: FlowDeletionColumn[] = [
  {
    header: 'Flow',
    markdownHeaderKey: 'flowDeletionMarkdownFlow',
    markdownAlign: '---',
    value: (outcome) => outcome.flowName,
    markdownValue: (outcome) => `\`${outcome.flowName}\``,
  },
  {
    header: 'Status',
    markdownHeaderKey: 'flowDeletionMarkdownStatus',
    markdownAlign: ':-:',
    value: (outcome) => outcome.status,
    markdownValue: (outcome) => STATUS_ICON[outcome.status],
  },
  {
    header: 'Scope',
    markdownHeaderKey: 'flowDeletionMarkdownScope',
    markdownAlign: '---',
    value: (outcome) => (outcome.wholeFlow ? 'Whole Flow' : 'Selected versions'),
    markdownValue: (outcome) =>
      outcome.wholeFlow ? t('flowDeletionMarkdownWholeFlow') : t('flowDeletionMarkdownSelectedVersions'),
  },
  {
    header: 'Active Version',
    markdownHeaderKey: 'flowDeletionMarkdownActiveVersion',
    markdownAlign: ':-:',
    value: (outcome) => (outcome.previousActiveVersion == null ? '' : String(outcome.previousActiveVersion)),
    // Spelled out in the Pull Request comment: an empty cell would leave a reviewer guessing.
    markdownValue: (outcome) =>
      outcome.previousActiveVersion == null ? t('flowDeletionAlreadyInactive') : String(outcome.previousActiveVersion),
  },
  {
    header: 'Versions Targeted',
    markdownHeaderKey: 'flowDeletionMarkdownVersions',
    markdownAlign: '---',
    // Console table and CSV name each version as the manifest does ("MyFlow-3"), so the CSV can be
    // read back as a member list. The Pull Request comment keeps numbers only, to stay readable.
    value: (outcome) => formatVersionList(outcome.flowName, outcome.versionsToDelete),
    markdownValue: (outcome) => outcome.versionsToDelete.join(', '),
  },
  {
    header: 'Versions Deleted',
    markdownHeaderKey: 'flowDeletionMarkdownVersionsDeleted',
    markdownAlign: '---',
    value: (outcome) => formatVersionList(outcome.flowName, outcome.versionsDeleted),
    markdownValue: (outcome) => outcome.versionsDeleted.join(', '),
  },
  {
    header: 'Interviews Blocking',
    markdownHeaderKey: 'flowDeletionMarkdownInterviewsBlocking',
    markdownAlign: ':-:',
    value: (outcome) => outcome.interviewCount,
  },
  {
    header: 'Interviews Deleted',
    markdownHeaderKey: 'flowDeletionMarkdownInterviewsDeleted',
    markdownAlign: ':-:',
    value: (outcome) => outcome.interviewsDeleted,
  },
];

// An empty Markdown cell reads as a rendering glitch, so nothing to show becomes a dash.
function flowDeletionMarkdownCell(column: FlowDeletionColumn, outcome: FlowDeletionOutcome): string {
  const value = column.markdownValue ? column.markdownValue(outcome) : String(column.value(outcome));
  return value === '' ? '-' : value;
}

// Console table + CSV report of what the Flow deletion did (or plans to do).
// The console table shows the current phase only, the CSV every outcome of the run: the report path
// is deterministic, so a post-destructive phase would otherwise overwrite the pre-destructive one.
export async function writeFlowDeletionReport(
  outcomes: FlowDeletionOutcome[],
  commandThis: any,
  allOutcomes: FlowDeletionOutcome[] = outcomes
): Promise<any> {
  if (outcomes.length === 0) {
    return {};
  }
  const toRows = (outcomeList: FlowDeletionOutcome[]) =>
    outcomeList.map((outcome) =>
      Object.fromEntries(FLOW_DELETION_COLUMNS.map((column) => [column.header, column.value(outcome)]))
    );
  uxLog('action', commandThis, c.cyan(t('flowDeletionSummary')));
  uxLogTable(commandThis, toRows(outcomes));
  const reportPath = await generateReportPath('flow-deletion', '');
  return await generateCsvFile(toRows(allOutcomes), reportPath, { fileTitle: t('flowDeletionReportTitle') });
}

// Markdown block appended to the Pull Request comment: which Flows are deleted, and how many Flow
// Interviews that destroys.
export function buildFlowDeletionMarkdown(outcomes: FlowDeletionOutcome[]): string {
  if (outcomes.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push(`## ${t('flowDeletionMarkdownTitle')}`);
  lines.push('');
  lines.push(`| ${FLOW_DELETION_COLUMNS.map((column) => t(column.markdownHeaderKey)).join(' | ')} |`);
  lines.push(`| ${FLOW_DELETION_COLUMNS.map((column) => column.markdownAlign).join(' | ')} |`);
  for (const outcome of outcomes) {
    lines.push(`| ${FLOW_DELETION_COLUMNS.map((column) => flowDeletionMarkdownCell(column, outcome)).join(' | ')} |`);
  }
  lines.push('');
  lines.push(t('flowDeletionMarkdownFooter'));
  // Interviews the deletion still has to destroy: irreversible, so it gets its own warning line
  // instead of hiding in a table cell.
  const interviewsPendingDeletion = outcomes
    .filter((outcome) => outcome.deleteInterviewsAllowed)
    .reduce((total, outcome) => total + Math.max(0, outcome.interviewCount - outcome.interviewsDeleted), 0);
  if (interviewsPendingDeletion > 0) {
    lines.push('');
    lines.push(`⚠️ ${t('flowDeletionMarkdownInterviewsWarning', { count: interviewsPendingDeletion })}`);
  }
  const failed = outcomes.filter((outcome) => isFailedFlowDeletionStatus(outcome.status));
  for (const outcome of failed) {
    lines.push('');
    lines.push(`> ${outcome.message}`);
  }
  return lines.join('\n');
}
