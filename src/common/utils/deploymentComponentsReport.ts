// What a deployment did, or would do, to each component of its scope: the per-type tables of the Pull
// Request comment and the deployment-components CSV / XLSX report of the job.
//
// smartDeploy resets this registry before starting, records here what package-no-overwrite.xml removed
// from the package.xml and every deploy result, then finalizes the report right before the Pull Request
// comment is posted. Lifetime is the process: the CLI runs one deployment per process.
// This module imports neither deployUtils nor gitProvider, so both can use it without an import cycle.
import c from 'chalk';
import * as path from 'path';
import { CONSTANTS, getReportDirectory } from '../../config/index.js';
import { listMetadataTypes } from '../metadata-utils/metadataList.js';
import { listDeployComponentChanges, listDeployComponentFailures } from './deployResultSummary.js';
import { generateCsvFile } from './filesUtils.js';
import { t } from './i18n.js';
import { uxLog } from './index.js';
import { filterItemsMatchingNoOverwrite, parsePackageXmlFile } from './xmlUtils.js';

export type DeploymentComponentStatus = 'Failed' | 'Created' | 'Updated' | 'Deleted' | 'Not overwritten' | 'Unchanged';

export interface DeploymentComponentRow {
  type: string;
  name: string;
  status: DeploymentComponentStatus;
  // package-no-overwrite.xml file protecting the component, empty when it is not protected
  noOverwriteFile: string;
}

export interface DeploymentComponentsReportState {
  // package-no-overwrite.xml used by the deployment (path relative to the project), null when none applies
  noOverwriteFile: string | null;
  noOverwriteContent: Record<string, string[]> | null;
  // Items of the deployment scope that package-no-overwrite.xml removed because the target org has them
  notOverwritten: Map<string, { type: string; name: string }>;
  // What the deploy results say about each component, by Type:Name
  changes: Map<string, { type: string; name: string; status: DeploymentComponentStatus }>;
  failures: Map<string, { type: string; name: string }>;
  // Deploy results that sent components but named none of them (some Quick Deploy results): the report is then partial
  resultsWithoutDetail: number;
  // Failed components known by neither name nor file: each one is still counted once
  unnamedFailures: number;
}

export interface DeploymentComponentsReportResult {
  componentTypesMarkdown: string;
  noOverwriteMarkdown: string;
  reportFile: string | null;
}

// Order of the report rows: what needs attention first, untouched components last
const STATUS_ORDER: DeploymentComponentStatus[] = ['Failed', 'Created', 'Updated', 'Deleted', 'Not overwritten', 'Unchanged'];

// When several deploy results name the same component, the most significant status wins
const CHANGE_PRECEDENCE: DeploymentComponentStatus[] = ['Deleted', 'Created', 'Updated', 'Unchanged'];

export const DEPLOYMENT_COMPONENTS_REPORT_NAME = 'deployment-components';

let reportState: DeploymentComponentsReportState = buildEmptyState();

export function resetDeploymentComponentsReport(): void {
  reportState = buildEmptyState();
}

export function getDeploymentComponentsReportState(): DeploymentComponentsReportState {
  return reportState;
}

/**
 * Record what package-no-overwrite.xml did to one package.xml of the deployment: notOverwrittenItems are
 * the items it removed because the target org already has them. Called once per package.xml of the plan.
 */
export async function recordNoOverwriteFiltering(
  noOverwriteFile: string,
  notOverwrittenItems: { type: string; member: string }[]
): Promise<void> {
  if (reportState.noOverwriteContent === null) {
    reportState.noOverwriteFile = path.relative(process.cwd(), path.resolve(noOverwriteFile)).replace(/\\/g, '/');
    reportState.noOverwriteContent = await parsePackageXmlFile(noOverwriteFile);
  }
  for (const item of notOverwrittenItems) {
    reportState.notOverwritten.set(componentKey(item.type, item.member), { type: item.type, name: item.member });
  }
  if (notOverwrittenItems.length > 0) {
    uxLog("warning", this, c.yellow('[NoOverwrite] ' + t('noOverwriteComponentsKept', { count: notOverwrittenItems.length, file: reportState.noOverwriteFile })));
    uxLog("log", this, c.grey(notOverwrittenItems.map((item) => `- ${item.type}: ${item.member}`).join('\n')));
  }
}

/**
 * Record the components of one deploy result.
 *
 * failuresOnly is for a real deployment that failed: Salesforce rolled it back, so the components its
 * result lists as created or updated did not change the org, and only the failures are kept.
 */
export function recordDeployResult(deployResultJson: any, options: { quickDeploy?: boolean; failuresOnly?: boolean } = {}): void {
  const changes = deployResultJson && options.failuresOnly !== true ? listDeployComponentChanges(deployResultJson) : [];
  if (
    changes.length === 0 &&
    options.failuresOnly !== true &&
    (options.quickDeploy === true || Number(deployResultJson?.numberComponentsDeployed || 0) > 0)
  ) {
    reportState.resultsWithoutDetail++;
  }
  for (const change of changes) {
    const component = normalizeComponent(change.type, change.name, change.filePath);
    const key = componentKey(component.type, component.name);
    const existing = reportState.changes.get(key);
    if (!existing || CHANGE_PRECEDENCE.indexOf(change.status) < CHANGE_PRECEDENCE.indexOf(existing.status)) {
      reportState.changes.set(key, { ...component, status: change.status });
    }
  }
  for (const failure of deployResultJson ? listDeployComponentFailures(deployResultJson) : []) {
    const component = normalizeComponent(failure.type, failure.name, failure.filePath);
    const key = component.name ? componentKey(component.type, component.name) : `${component.type}:#${++reportState.unnamedFailures}`;
    reportState.failures.set(key, component);
  }
}

/**
 * Write the deployment components report and build the Markdown of the Pull Request comment.
 * Can be called several times in a run: each call rewrites the same file with what is known so far.
 */
export async function finalizeDeploymentComponentsReport(check: boolean): Promise<DeploymentComponentsReportResult> {
  const rows = buildDeploymentComponentRows(reportState);
  const result: DeploymentComponentsReportResult = {
    componentTypesMarkdown: reportState.resultsWithoutDetail > 0 ? '' : buildComponentTypesMarkdown(rows, check),
    noOverwriteMarkdown: buildNoOverwriteMarkdown(rows, check, reportState),
    reportFile: null,
  };
  // A result naming no component (some Quick Deploy results) makes the list partial: no file that would read as complete
  if (rows.length === 0 || reportState.resultsWithoutDetail > 0) {
    return result;
  }
  const reportFile = path.join(await getReportDirectory(), `${DEPLOYMENT_COMPONENTS_REPORT_NAME}.csv`);
  const csvRows = rows.map((row) => ({ Type: row.type, Name: row.name, Status: row.status, 'No-overwrite': row.noOverwriteFile }));
  const generated = await generateCsvFile(csvRows, reportFile, { fileTitle: 'Deployment components' });
  result.reportFile = generated?.xlsxFile || generated?.csvFile || null;
  uxLog("log", this, c.grey(t('deploymentComponentsReportWritten', { count: rows.length, file: result.reportFile || reportFile })));
  return result;
}

/** Rows of the report: one per component, sorted by status then Type and Name */
export function buildDeploymentComponentRows(state: DeploymentComponentsReportState): DeploymentComponentRow[] {
  const rowsByKey = new Map<string, DeploymentComponentRow>();
  for (const [key, change] of state.changes) {
    rowsByKey.set(key, { type: change.type, name: change.name, status: change.status, noOverwriteFile: '' });
  }
  // A component failing in one deploy result stays failed, whatever another result said
  for (const [key, failure] of state.failures) {
    rowsByKey.set(key, { type: failure.type, name: failure.name, status: 'Failed', noOverwriteFile: '' });
  }
  for (const [key, item] of state.notOverwritten) {
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, { type: item.type, name: item.name, status: 'Not overwritten', noOverwriteFile: '' });
    }
  }
  const rows = [...rowsByKey.values()];
  if (state.noOverwriteContent && state.noOverwriteFile) {
    const protectedRows = filterItemsMatchingNoOverwrite(
      rows.map((row) => ({ type: row.type, member: row.name, row: row })),
      state.noOverwriteContent
    );
    for (const protectedRow of protectedRows) {
      protectedRow.row.noOverwriteFile = path.basename(state.noOverwriteFile);
    }
  }
  for (const row of rows) {
    if (row.status === 'Not overwritten' && state.noOverwriteFile) {
      row.noOverwriteFile = path.basename(state.noOverwriteFile);
    }
  }
  return rows.sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      a.type.localeCompare(b.type, 'en') ||
      a.name.localeCompare(b.name, 'en')
  );
}

/** Collapsible table of the components that changed (or failed), counted per metadata type */
export function buildComponentTypesMarkdown(rows: DeploymentComponentRow[], check: boolean): string {
  const failedCount = rows.filter((row) => row.status === 'Failed').length;
  const changeStatuses: DeploymentComponentStatus[] = ['Created', 'Updated', 'Deleted'];
  const changedCount = rows.filter((row) => changeStatuses.includes(row.status)).length;
  if (failedCount === 0 && changedCount === 0) {
    return '';
  }
  const columns: { status: DeploymentComponentStatus; title: string }[] = [
    ...(failedCount > 0 ? [{ status: 'Failed' as DeploymentComponentStatus, title: '❌ Failed' }] : []),
    { status: 'Created', title: '➕ Created' },
    { status: 'Updated', title: '✏️ Updated' },
    { status: 'Deleted', title: '🗑️ Deleted' },
  ];
  const changeVerb = check ? 'would change' : 'changed';
  const summary =
    failedCount > 0
      ? `${countOf(failedCount, 'component')} failed, ${changedCount} ${changeVerb} in the org`
      : `${countOf(changedCount, 'component')} ${changeVerb} in the org`;
  const tableLines = buildCountsPerTypeTable(rows, columns);
  return [
    '<details>',
    `<summary>📋 <b>${summary}</b></summary>`,
    '',
    ...tableLines,
    '',
    `The list of the components is in the \`${DEPLOYMENT_COMPONENTS_REPORT_NAME}.xlsx\` file of the job artifacts.`,
    '',
    '</details>',
  ].join('\n');
}

/** "Protected metadata" section: the package-no-overwrite.xml items kept in the org or created this once */
export function buildNoOverwriteMarkdown(
  rows: DeploymentComponentRow[],
  check: boolean,
  state: Pick<DeploymentComponentsReportState, 'noOverwriteFile' | 'resultsWithoutDetail'>
): string {
  if (!state.noOverwriteFile) {
    return '';
  }
  const notOverwrittenCount = rows.filter((row) => row.status === 'Not overwritten').length;
  // A result naming no component (some Quick Deploy results): what was created this once is unknown
  const showCreatedOnce = state.resultsWithoutDetail === 0;
  const createdOnceCount = showCreatedOnce ? rows.filter((row) => row.status === 'Created' && row.noOverwriteFile !== '').length : 0;
  if (notOverwrittenCount === 0 && createdOnceCount === 0) {
    return '';
  }
  const lines = ['### 🛡️ Protected metadata (package-no-overwrite.xml)', ''];
  if (notOverwrittenCount > 0) {
    lines.push(
      `⚠️ **${countOf(notOverwrittenCount, 'component')} of this Pull Request already ${notOverwrittenCount === 1 ? 'exists' : 'exist'} in the target org and ${check ? 'will not be' : notOverwrittenCount === 1 ? 'was not' : 'were not'} overwritten**, because ${notOverwrittenCount === 1 ? 'it is' : 'they are'} listed in \`${state.noOverwriteFile}\`. The version in the org is kept: such components are maintained manually in the org.`,
      ''
    );
  }
  if (createdOnceCount > 0) {
    lines.push(
      `ℹ️ **${countOf(createdOnceCount, 'protected component')} ${check ? (createdOnceCount === 1 ? 'does' : 'do') : 'did'} not exist in the target org yet and ${check ? 'will be' : (createdOnceCount === 1 ? 'was' : 'were')} created.** Later deployments will not overwrite ${createdOnceCount === 1 ? 'it' : 'them'}.`,
      ''
    );
  }
  const columns: { status: DeploymentComponentStatus; title: string }[] = [
    { status: 'Not overwritten', title: '🛡️ Not overwritten' },
    ...(showCreatedOnce ? [{ status: 'Created' as DeploymentComponentStatus, title: '➕ Created this once' }] : []),
  ];
  const protectedRows = rows.filter((row) => row.noOverwriteFile !== '' && (row.status === 'Not overwritten' || row.status === 'Created'));
  // Collapsed: a project can protect hundreds of components, and the sentences above already say
  // how many. The table is there for whoever wants the split per type.
  const typeCount = new Set(protectedRows.filter((row) => columns.some((column) => column.status === row.status)).map((row) => row.type)).size;
  lines.push(
    '<details>',
    `<summary>🛡️ <b>Protected components per metadata type (${countOf(typeCount, 'type')})</b></summary>`,
    '',
    ...buildCountsPerTypeTable(protectedRows, columns),
    '',
    '</details>',
    ''
  );
  lines.push(`[How package-no-overwrite.xml works](${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-config-overwrite/)`);
  return lines.join('\n');
}

function buildEmptyState(): DeploymentComponentsReportState {
  return {
    noOverwriteFile: null,
    noOverwriteContent: null,
    notOverwritten: new Map(),
    changes: new Map(),
    failures: new Map(),
    resultsWithoutDetail: 0,
    unnamedFailures: 0,
  };
}

function componentKey(type: string, name: string): string {
  return `${type}:${name}`;
}

/**
 * Same Type and Name as in package.xml, read from the metadata registry: the type is spelled like its
 * xmlName, and a failed row that only gives its file path gets the name package.xml would give it
 * (objects/Account/fields/Rate__c.field-meta.xml is CustomField Account.Rate__c, lwc/myCmp/myCmp.js is
 * LightningComponentBundle myCmp).
 */
function normalizeComponent(type: string, name: string, filePath: string): { type: string; name: string } {
  const registry = getMetadataRegistryIndex();
  const segments = (filePath || '').replace(/\\/g, '/').split('/').filter((segment) => segment !== '');
  const fileName = (segments[segments.length - 1] || '').replace(/-meta\.xml$/, '');
  const fileSuffix = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.') + 1) : '';
  const metadataType =
    registry.byXmlName.get((type || '').toLowerCase()) ||
    (type ? null : findBundleType(segments, registry) || registry.bySuffix.get(fileSuffix));
  const canonicalType = metadataType?.xmlName || type;
  if (name && name !== filePath) {
    return { type: canonicalType, name: name };
  }
  if (segments.length === 0 || !metadataType) {
    return { type: canonicalType, name: name || filePath || '' };
  }
  return { type: canonicalType, name: nameFromFilePath(segments, fileName, metadataType) };
}

let metadataRegistryIndex: { byXmlName: Map<string, any>; bySuffix: Map<string, any>; byDirectoryName: Map<string, any> } | null = null;

// Built once: the registry holds about 600 types and a FULL deployment can name thousands of components
function getMetadataRegistryIndex(): { byXmlName: Map<string, any>; bySuffix: Map<string, any>; byDirectoryName: Map<string, any> } {
  if (metadataRegistryIndex === null) {
    const byXmlName = new Map<string, any>();
    const bySuffix = new Map<string, any>();
    const byDirectoryName = new Map<string, any>();
    for (const metadataType of listMetadataTypes() as any[]) {
      byXmlName.set(metadataType.xmlName.toLowerCase(), metadataType);
      if (metadataType.suffix && !bySuffix.has(metadataType.suffix)) {
        bySuffix.set(metadataType.suffix, metadataType);
      }
      if (metadataType.directoryName && !metadataType.parentXmlName && !metadataType.inFolder && !byDirectoryName.has(metadataType.directoryName)) {
        byDirectoryName.set(metadataType.directoryName, metadataType);
      }
    }
    metadataRegistryIndex = { byXmlName, bySuffix, byDirectoryName };
  }
  return metadataRegistryIndex;
}

// A bundle file (lwc/myCmp/myCmp.html) has no suffix of its own: its type is the one of the folder above the bundle
function findBundleType(segments: string[], registry: ReturnType<typeof getMetadataRegistryIndex>): any {
  const directoryIndex = segments.length - 3;
  if (directoryIndex < 0) {
    return null;
  }
  const metadataType = registry.byDirectoryName.get(segments[directoryIndex]);
  return metadataType && !metadataType.suffix ? metadataType : null;
}

function nameFromFilePath(segments: string[], fileName: string, metadataType: any): string {
  const baseName = metadataType.suffix && fileName.endsWith(`.${metadataType.suffix}`)
    ? fileName.substring(0, fileName.length - metadataType.suffix.length - 1)
    : fileName;
  // Child type (CustomField, ListView...): objects/<Parent>/<directoryName>/<Name>.<suffix>-meta.xml
  if (metadataType.parentXmlName && segments.length >= 3) {
    return `${segments[segments.length - 3]}.${baseName}`;
  }
  const directoryIndex = segments.lastIndexOf(metadataType.directoryName);
  if (directoryIndex >= 0 && directoryIndex < segments.length - 2) {
    // Folder type (EmailTemplate, Report...): <directoryName>/<Folder>/<Name>.<suffix>-meta.xml
    if (metadataType.inFolder) {
      return [...segments.slice(directoryIndex + 1, segments.length - 1), baseName].join('/');
    }
    // Bundle (LWC, Aura...): every file of the bundle is named after its folder
    return segments[directoryIndex + 1];
  }
  return baseName;
}

function buildCountsPerTypeTable(rows: DeploymentComponentRow[], columns: { status: DeploymentComponentStatus; title: string }[]): string[] {
  const countsByType = new Map<string, Map<DeploymentComponentStatus, number>>();
  for (const row of rows) {
    if (!columns.some((column) => column.status === row.status)) {
      continue;
    }
    const counts = countsByType.get(row.type) || new Map<DeploymentComponentStatus, number>();
    counts.set(row.status, (counts.get(row.status) || 0) + 1);
    countsByType.set(row.type, counts);
  }
  const types = [...countsByType.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  return [
    `| Type | ${columns.map((column) => column.title).join(' | ')} |`,
    `|------|${columns.map(() => '---:').join('|')}|`,
    ...types.map((type) => `| ${type} | ${columns.map((column) => countsByType.get(type)?.get(column.status) || '').join(' | ')} |`),
  ];
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
