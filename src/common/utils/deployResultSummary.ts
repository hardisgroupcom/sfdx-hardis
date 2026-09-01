// Build and display a readable summary of a Salesforce deployment result,
// instead of dumping the complete (and often huge) deployment JSON in CI logs.
import c from 'chalk';
import fs from './fsUtils.js';
import * as path from 'path';
import { CONSTANTS, getEnvVar, getReportDirectory } from '../../config/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { formatElapsedMs } from './dateHelper.js';
import { findJsonInString, uxLog } from './index.js';
import { t } from './i18n.js';

export interface DeployResultSummaryOptions {
  check: boolean;
  label?: string;
  delta?: boolean;
  quickDeploy?: boolean;
  orgCoveragePercent?: string | number | null;
  durationMs?: number | null;
  reportFile?: string | null;
}

/**
 * How many components a deployment actually altered in the target org, split by outcome.
 *
 * numberComponentsDeployed counts everything that was sent, whether or not the org already had the
 * exact same version: on a FULL deployment it is the size of package.xml, which says nothing about
 * what really moved. The per-component detail rows do carry that information.
 */
export interface DeployComponentChanges {
  created: number;
  updated: number;
  deleted: number;
  // Components sent to the org that were already identical to what was deployed
  unchanged: number;
  // Number of distinct components the counters above are built from
  total: number;
  // False when the deploy result carried no usable per-component detail (a QuickDeploy result
  // without details, the synthetic destructive-changes-only result): every counter is then 0 and
  // must not be displayed, otherwise "0 changed" would claim a no-op deployment.
  detailed: boolean;
}

/** Metadata API booleans reach us as real booleans through the CLI, but as "true"/"false" through some raw XML clients */
function isTrue(value: any): boolean {
  return value === true || value === 'true';
}

/** Manifests Salesforce reports as if they were deployed components, with no component type */
const MANIFEST_ROW_NAMES = new Set([
  'package.xml',
  'destructiveChanges.xml',
  'destructiveChangesPre.xml',
  'destructiveChangesPost.xml',
]);

/**
 * True for the rows Salesforce adds for the manifests themselves.
 *
 * They are not deployed components, so counting them would put one entry per manifest in
 * `unchanged` and break the "counters add up to numberComponentsDeployed" invariant on every
 * deployment carrying destructive changes.
 */
function isManifestRow(item: any): boolean {
  const fullName = `${item?.fullName || ''}`;
  return MANIFEST_ROW_NAMES.has(fullName) || (fullName.endsWith('.xml') && !item?.componentType);
}

/** The `files[].state` values that describe a component that really reached the org */
const FILE_STATE_FLAGS: Record<string, ComponentChangeFlags> = {
  Created: { created: true, updated: false, deleted: false },
  Changed: { created: false, updated: true, deleted: false },
  Deleted: { created: false, updated: false, deleted: true },
  Unchanged: { created: false, updated: false, deleted: false },
};

const EMPTY_COMPONENT_CHANGES: DeployComponentChanges = {
  created: 0,
  updated: 0,
  deleted: 0,
  unchanged: 0,
  total: 0,
  detailed: false,
};

/** Flags of one component, merged from every detail row mentioning it */
interface ComponentChangeFlags {
  created: boolean;
  updated: boolean;
  deleted: boolean;
}

/**
 * Merge one detail row into the per-component map.
 *
 * Salesforce can return several rows for the same component (a Flow came back three times in a
 * real deployment result, two rows saying "unchanged" and one saying "changed"), so the flags are
 * OR-ed: a component is "changed" as soon as one row says so.
 */
function mergeComponentChangeFlags(
  flagsByComponent: Map<string, ComponentChangeFlags>,
  key: string,
  flags: ComponentChangeFlags
): void {
  const existing = flagsByComponent.get(key);
  if (!existing) {
    flagsByComponent.set(key, { ...flags });
    return;
  }
  existing.created = existing.created || flags.created;
  existing.updated = existing.updated || flags.updated;
  existing.deleted = existing.deleted || flags.deleted;
}

/** Collect the per-component flags from `details.componentSuccesses`, the Metadata API deploy result shape */
function collectFlagsFromComponentSuccesses(componentSuccesses: any[]): Map<string, ComponentChangeFlags> {
  const flagsByComponent = new Map<string, ComponentChangeFlags>();
  for (const item of componentSuccesses) {
    if (isManifestRow(item)) {
      continue;
    }
    const key = `${item?.componentType || ''}:${item?.fullName || ''}`;
    mergeComponentChangeFlags(flagsByComponent, key, {
      created: isTrue(item?.created),
      updated: isTrue(item?.changed),
      deleted: isTrue(item?.deleted),
    });
  }
  return flagsByComponent;
}

/**
 * Collect the per-component flags from `files[]`, the source-tracking deploy result shape.
 *
 * Only the four states describing a component that reached the org are kept. `state: 'Failed'` is
 * the fifth value of the enum, and mapping it through the created/changed/deleted tests would land
 * it in `unchanged`: a deployment where nothing succeeded would then report every failure as an
 * untouched component. Failed rows also often carry no fullName, so they would collapse into a
 * single entry per metadata type.
 */
function collectFlagsFromFiles(files: any[]): Map<string, ComponentChangeFlags> {
  const flagsByComponent = new Map<string, ComponentChangeFlags>();
  for (const item of files) {
    const flags = FILE_STATE_FLAGS[`${item?.state || ''}`];
    if (!flags) {
      continue;
    }
    const key = `${item?.type || ''}:${item?.fullName || item?.filePath || ''}`;
    mergeComponentChangeFlags(flagsByComponent, key, flags);
  }
  return flagsByComponent;
}

/**
 * Count how many components a deploy result created, updated, deleted, or left untouched.
 *
 * Deduplicated on componentType + fullName so the counters add up to numberComponentsDeployed:
 * on a real deployment result, 38 detail rows collapsed to exactly the 34 components Salesforce
 * reported as deployed, once the package.xml row and the duplicates were removed.
 */
export function countDeployComponentChanges(deployResultJson: any): DeployComponentChanges {
  const componentSuccesses = deployResultJson?.details?.componentSuccesses;
  const files = deployResultJson?.files;
  let flagsByComponent = new Map<string, ComponentChangeFlags>();
  if (Array.isArray(componentSuccesses)) {
    flagsByComponent = collectFlagsFromComponentSuccesses(componentSuccesses);
  }
  // Also when componentSuccesses held nothing usable (only manifest rows): files[] may still
  // describe the components, and an empty map would report "no detail" while the data is there
  if (flagsByComponent.size === 0 && Array.isArray(files)) {
    flagsByComponent = collectFlagsFromFiles(files);
  }
  if (flagsByComponent.size === 0) {
    return { ...EMPTY_COMPONENT_CHANGES };
  }
  const changes: DeployComponentChanges = { ...EMPTY_COMPONENT_CHANGES, detailed: true };
  for (const flags of flagsByComponent.values()) {
    // A created component is often flagged both created and changed: the most specific wins, so
    // each component is counted exactly once and the counters sum to the number of components.
    if (flags.deleted) {
      changes.deleted++;
    } else if (flags.created) {
      changes.created++;
    } else if (flags.updated) {
      changes.updated++;
    } else {
      changes.unchanged++;
    }
    changes.total++;
  }
  return changes;
}

/** True when the user asked to keep the complete deployment JSON in the console logs */
export function isFullDeployJsonLogRequested(): boolean {
  return getEnvVar('NO_TRUNCATE_LOGS') === 'true';
}

/**
 * Build the lines of a concise, human-readable deployment summary.
 *
 * Values are read from the deployment result JSON itself (not from the accumulated DeploymentMetrics),
 * so the same function can be used for a successful deployment and for a failed one, and so that each
 * split deployment displays its own figures.
 */
export function buildDeployResultSummaryLines(resultJson: any, options: DeployResultSummaryOptions): string[] {
  const result = resultJson?.result;
  if (!result) {
    return [t('deployResultSummaryNoResult')];
  }
  const lines: string[] = [];

  // Title: fallback on the deployment id when no package label is provided by the caller
  const label = options.label || result.id || 'package.xml';
  lines.push(options.check ? t('deployResultSummaryTitleCheck', { label }) : t('deployResultSummaryTitleDeploy', { label }));

  // Status: keep raw Salesforce values (Succeeded, Failed, SucceededPartial...)
  const status = result.status || (result.success === true ? 'Succeeded' : 'Failed');
  lines.push(t('deployResultSummaryStatus', { status }));

  // Deployment Id
  if (result.id) {
    lines.push(t('deployResultSummaryDeploymentId', { deploymentId: result.id }));
  }

  // Deployment mode
  const modeParts: string[] = [options.delta === true ? 'DELTA' : 'FULL'];
  if (options.quickDeploy === true) {
    modeParts.push('Quick Deploy');
  }
  lines.push(t('deployResultSummaryMode', { mode: modeParts.join(' + ') }));

  // Components
  lines.push(
    t('deployResultSummaryComponents', {
      deployed: Number(result.numberComponentsDeployed || 0),
      failed: Number(result.numberComponentErrors || 0),
      total: Number(result.numberComponentsTotal || 0),
    })
  );

  // Real impact on the org: on a FULL deployment the line above only says how big package.xml is.
  // Skipped on a failure: componentSuccesses lists what got deployed before the error, which
  // rollbackOnError then reverted, so reporting it would describe changes the org never kept.
  const changes = result.success === true ? countDeployComponentChanges(result) : { ...EMPTY_COMPONENT_CHANGES };
  if (changes.detailed) {
    // A validation deployed nothing: its detail rows say what a real deployment would do
    const changesKey = options.check === true ? 'deployResultSummaryChangesCheck' : 'deployResultSummaryChanges';
    lines.push(
      t(changesKey, {
        created: changes.created,
        updated: changes.updated,
        deleted: changes.deleted,
        unchanged: changes.unchanged,
      })
    );
  }

  // Apex tests
  const testsTotal = Number(result.numberTestsTotal || 0);
  const testsCompleted = Number(result.numberTestsCompleted || 0);
  if (testsTotal > 0 || testsCompleted > 0) {
    lines.push(
      t('deployResultSummaryTests', {
        completed: testsCompleted,
        failed: Number(result.numberTestErrors || 0),
        total: testsTotal,
      })
    );
  } else {
    lines.push(t('deployResultSummaryNoTests'));
  }

  // Org-wide Apex code coverage
  if (options.orgCoveragePercent !== null && options.orgCoveragePercent !== undefined && options.orgCoveragePercent !== '') {
    lines.push(t('deployResultSummaryCoverage', { coverage: options.orgCoveragePercent }));
  }

  // Duration: prefer the dates returned by the Metadata API, fallback to the measured duration
  const durationMs = getDeployDurationMs(result, options.durationMs);
  if (durationMs !== null) {
    lines.push(t('deployResultSummaryDuration', { duration: formatElapsedMs(durationMs) }));
  }

  // Where to find the complete JSON, and how to get it back in the console
  if (options.reportFile) {
    lines.push(t('deployResultSummaryFullJson', { reportFile: options.reportFile }));
    // Old pipelines may not publish the hardis-report folder: point to the doc explaining how to add the step
    lines.push(t('deployResultSummaryArtifactsDocHint', { url: `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-publish-artifacts/` }));
  }
  if (!isFullDeployJsonLogRequested()) {
    lines.push(t('deployResultSummaryFullJsonHint'));
  }

  return lines;
}

/**
 * True when the per-component detail covered every component of the deployment.
 *
 * A deployment plan can hold several package.xml files, and only some of their results may carry
 * detail rows (a QuickDeploy without details among regular deployments). The counters would then
 * describe a subset while the deployed total describes everything, and a reader adding up the
 * split would not land on the total. Reporting nothing beats reporting a partial picture.
 */
export function isComponentChangeDetailComplete(
  metrics:
    | { componentsChangeDetail?: boolean; componentsChangeTotal?: number; componentsDeployed?: number }
    | null
    | undefined
): boolean {
  return (
    metrics?.componentsChangeDetail === true &&
    (metrics?.componentsChangeTotal ?? 0) === (metrics?.componentsDeployed ?? 0)
  );
}

/** Display the deployment summary, then the complete JSON if NO_TRUNCATE_LOGS=true */
export function logDeployResultSummary(commandThis: any, resultJson: any, options: DeployResultSummaryOptions): void {
  const lines = buildDeployResultSummaryLines(resultJson, options);
  uxLog('action', commandThis, c.cyan(lines[0]));
  for (const line of lines.slice(1)) {
    uxLog('log', commandThis, c.grey(`  ${line}`));
  }
  if (isFullDeployJsonLogRequested() && resultJson) {
    uxLog('other', commandThis, c.grey(JSON.stringify(resultJson)));
  }
}

/**
 * Write the complete deployment result JSON in the report directory, so it remains available
 * as a CI job artifact even if it is not displayed in the console anymore.
 * Returns the file path, or null if there was nothing to write.
 */
export async function writeDeployResultReportFile(resultJson: any, label: string): Promise<string | null> {
  if (!resultJson) {
    return null;
  }
  try {
    const reportDir = await getReportDirectory();
    const safeLabel = (label || 'deployment').replace(/[^a-zA-Z0-9._-]/g, '-');
    const reportFile = path.join(reportDir, `deploy-result-${safeLabel}.json`);
    await fs.writeFile(reportFile, JSON.stringify(resultJson, null, 2), 'utf8');
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(reportFile, t('deployResultJsonReportTitle'), 'report');
    }
    return reportFile;
  } catch (e: any) {
    uxLog('warning', this, c.yellow(t('warningUnableToWriteDeployResultReportFile', { message: e.message })));
    return null;
  }
}

/**
 * Command error output can embed a complete deployment JSON: keep only the error message when we find one,
 * so error logs stay readable. Returns the input unchanged when no JSON deployment result is found.
 */
export function summarizeDeployErrorMessage(rawErrorMessage: string): string {
  if (!rawErrorMessage || isFullDeployJsonLogRequested()) {
    return rawErrorMessage;
  }
  const jsonResult = findJsonInString(rawErrorMessage);
  const message = jsonResult?.result?.errorMessage || jsonResult?.message || null;
  if (message) {
    const statusCode = jsonResult?.result?.errorStatusCode || jsonResult?.name || null;
    return statusCode ? `${statusCode}: ${message}` : message;
  }
  return rawErrorMessage;
}

/** Extract the deployment duration, from the Metadata API dates when available */
function getDeployDurationMs(result: any, fallbackDurationMs?: number | null): number | null {
  const startDate = result?.startDate ? new Date(result.startDate).getTime() : NaN;
  const completedDate = result?.completedDate ? new Date(result.completedDate).getTime() : NaN;
  if (!isNaN(startDate) && !isNaN(completedDate) && completedDate >= startDate) {
    return completedDate - startDate;
  }
  if (fallbackDurationMs !== null && fallbackDurationMs !== undefined && fallbackDurationMs >= 0) {
    return fallbackDurationMs;
  }
  return null;
}
