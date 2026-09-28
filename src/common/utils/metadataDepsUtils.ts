import path from 'path';
import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import Papa from 'papaparse';
import { getApiVersion, getReportDirectory } from '../../config/index.js';
import fs from './fsUtils.js';
import { createXlsxFromCsvFiles } from './filesUtils.js';
import { t } from './i18n.js';
import { isCI, uxLog, uxLogTable } from './index.js';
import { prompts } from './prompts.js';
import { bulkQueryTooling, soqlQueryTooling } from './apiUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { withOrgApiCache } from '../cache/orgApiCache.js';
import { listMetadataTypes } from '../metadata-utils/metadataList.js';

const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const METADATA_TYPE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const OTHER_TYPE_VALUE = '__other__';
const UNKNOWN_TYPE = 'Unknown';
const TOOLING_ROW_CAP = 2000;
const CUSTOM_OBJECT_SUFFIX_RE = /__(c|mdt|e|b|x|kav|share|history|feed)$/i;
const DEPENDENCY_FIELDS =
  'MetadataComponentId, MetadataComponentName, MetadataComponentType, ' +
  'RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType';

interface LookupConfig {
  selectField: string;
  whereField: string;
}

export interface MetadataDepsFlags {
  type?: string;
  name?: string;
  id?: string;
  componentType?: string;
  sourceFile?: string;
  bulk?: boolean;
  agent?: boolean;
}

export interface MetadataComponentSelection {
  id: string;
  name: string;
  type: string;
  // The Id comes from the org API cache: it is checked again when no dependency is found
  idFromCache?: boolean;
}

export interface MetadataDependencyRow {
  usedById: string;
  usedByName: string;
  usedByType: string;
  targetId: string;
  targetName: string;
  targetType: string;
}

export interface MetadataDepsReport {
  reportDir: string;
  reportFiles: Array<{ type: 'csv' | 'xlsx'; file: string }>;
}

interface MetadataTypeEntry {
  value: string;
  hint: string;
}

const METADATA_TYPE_REGISTRY: MetadataTypeEntry[] = [
  { value: 'ApexClass', hint: 'MyClass' },
  { value: 'ApexTrigger', hint: 'MyTrigger' },
  { value: 'ApexPage', hint: 'MyPage' },
  { value: 'ApexComponent', hint: 'MyComponent' },
  { value: 'AuraDefinitionBundle', hint: 'myAuraBundle' },
  { value: 'LightningComponentBundle', hint: 'myLwc' },
  { value: 'FlexiPage', hint: 'myFlexiPage' },
  { value: 'Flow', hint: 'myFlow' },
  { value: 'CustomObject', hint: 'MyObject__c' },
  { value: 'CustomField', hint: 'MyObject__c.MyField__c' },
  { value: 'StaticResource', hint: 'myResource' },
  { value: 'CustomPermission', hint: 'myPermission' },
];

const LOOKUP_CONFIG: Record<string, LookupConfig> = {
  AuraDefinitionBundle: { selectField: 'DeveloperName', whereField: 'DeveloperName' },
  LightningComponentBundle: { selectField: 'DeveloperName', whereField: 'DeveloperName' },
  FlexiPage: { selectField: 'DeveloperName', whereField: 'DeveloperName' },
  CustomPermission: { selectField: 'DeveloperName', whereField: 'DeveloperName' },
};

export function isSalesforceId(value: string): boolean {
  return SALESFORCE_ID_RE.test(value);
}

export function isMetadataType(value: string): boolean {
  return METADATA_TYPE_RE.test(value);
}

export function soqlString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

export function stripCustomSuffix(value: string): string {
  return value.replace(CUSTOM_OBJECT_SUFFIX_RE, '');
}

// "ns__Obj__c" -> { namespace: "ns", developerName: "Obj" }, "MyType__mdt" -> { developerName: "MyType" }
export function parseCustomObjectName(name: string): { namespace?: string; developerName: string } {
  const withoutSuffix = stripCustomSuffix(name.trim());
  const separator = withoutSuffix.indexOf('__');
  if (separator > 0) {
    return { namespace: withoutSuffix.slice(0, separator), developerName: withoutSuffix.slice(separator + 2) };
  }
  return { developerName: withoutSuffix };
}

// Standard objects (Account, Opportunity...) have no "__" in their API name
export function isStandardObjectName(name: string): boolean {
  return !name.trim().includes('__');
}

export function customFieldDeveloperName(fieldApi: string): string {
  const parts = fieldApi.split('__');
  if (parts.length >= 2 && parts.at(-1) === 'c') {
    return parts.at(-2) ?? fieldApi;
  }
  return fieldApi;
}

export function parseCustomFieldName(name: string): { table?: string; developerName: string } {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { developerName: customFieldDeveloperName(trimmed) };
  }
  return {
    table: trimmed.slice(0, dot),
    developerName: customFieldDeveloperName(trimmed.slice(dot + 1)),
  };
}

export function buildLookupSoql(type: string, name: string): string {
  if (type === 'Flow') {
    // Tooling Flow records are versions without DeveloperName: resolve through FlowDefinition
    return `SELECT Id, DeveloperName, ActiveVersionId, LatestVersionId FROM FlowDefinition WHERE DeveloperName = ${soqlString(name)}`;
  }
  if (type === 'CustomObject') {
    const parsed = parseCustomObjectName(name);
    const namespaceClause = parsed.namespace ? ` AND NamespacePrefix = ${soqlString(parsed.namespace)}` : '';
    return `SELECT Id, DeveloperName FROM CustomObject WHERE DeveloperName = ${soqlString(parsed.developerName)}${namespaceClause}`;
  }
  const config = LOOKUP_CONFIG[type];
  if (config) {
    return `SELECT Id, ${config.selectField} FROM ${type} WHERE ${config.whereField} = ${soqlString(name)}`;
  }
  return `SELECT Id, Name FROM ${type} WHERE Name = ${soqlString(name)}`;
}

export function buildCustomFieldLookupSoql(developerName: string, entityKeys: string[]): string {
  const clauses = [`DeveloperName = ${soqlString(developerName)}`];
  if (entityKeys.length > 0) {
    const objectClauses = entityKeys.flatMap((key) => [
      `TableEnumOrId = ${soqlString(key)}`,
      `EntityDefinitionId = ${soqlString(key)}`,
    ]);
    clauses.push(`(${objectClauses.join(' OR ')})`);
  }
  return `SELECT Id, DeveloperName, TableEnumOrId, EntityDefinitionId FROM CustomField WHERE ${clauses.join(' AND ')}`;
}

export function buildUsedBySoql(id: string, type?: string, componentType?: string): string {
  const clauses = [`RefMetadataComponentId = ${soqlString(id)}`];
  if (type && type !== 'StandardEntity' && type !== UNKNOWN_TYPE) {
    clauses.push(`RefMetadataComponentType = ${soqlString(type)}`);
  }
  if (componentType) {
    clauses.push(`MetadataComponentType = ${soqlString(componentType)}`);
  }
  return `SELECT ${DEPENDENCY_FIELDS} FROM MetadataComponentDependency WHERE ${clauses.join(' AND ')}`;
}

export function mapUsedByRows(records: Array<Record<string, unknown>>): MetadataDependencyRow[] {
  const stringValue = (record: Record<string, unknown>, key: string): string => {
    const value = record[key];
    return value == null ? '' : String(value);
  };
  return records.map((record) => ({
    usedById: stringValue(record, 'MetadataComponentId'),
    usedByName: stringValue(record, 'MetadataComponentName'),
    usedByType: stringValue(record, 'MetadataComponentType'),
    targetId: stringValue(record, 'RefMetadataComponentId'),
    targetName: stringValue(record, 'RefMetadataComponentName'),
    targetType: stringValue(record, 'RefMetadataComponentType'),
  }));
}

export function sanitizeFsName(value: string): string {
  const withoutControlCharacters = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 ? '_' : character
  ).join('');
  return (
    withoutControlCharacters
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 100)
      .replace(/^[._]+|[._]+$/g, '') || 'unknown'
  );
}

export async function lookupMetadataComponents(
  connection: Connection,
  type: string,
  name: string
): Promise<MetadataComponentSelection[]> {
  const listed = await lookupListedComponent(connection, type, name);
  if (listed && listed.id) {
    return [{ id: listed.id, name, type, idFromCache: listed.fromCache }];
  }
  // Standard objects are listed without an Id
  if (type === 'CustomObject' && (listed || isStandardObjectName(name))) {
    const standardObjects = await lookupStandardObject(connection, name);
    if (standardObjects.length > 0) {
      return standardObjects;
    }
  }
  // Tooling-only types, and names that are not API names (a custom object without its __c suffix...)
  return await lookupToolingComponents(connection, type, name);
}

// The Metadata API lists the components of any type with the Id that MetadataComponentDependency uses,
// under the API name of the source files (Account.Status__c, Folder/MyReport, Account-Account Layout...).
// Returns null when the type cannot be listed or no component has this name.
export async function lookupListedComponent(
  connection: Connection,
  type: string,
  name: string,
  options: { refresh?: boolean } = {}
): Promise<{ id: string; fromCache: boolean } | null> {
  const inFolder = listMetadataTypes().some((metadataType) => metadataType.xmlName === type && metadataType.inFolder);
  const folder = inFolder && name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : undefined;
  // Only names and Ids are cached. null means the type cannot be listed.
  const listComponents = async (): Promise<Array<{ fullName: string; id: string }> | null> => {
    try {
      const listed = await connection.metadata.list([folder ? { type, folder } : { type }], getApiVersion(connection));
      const components: any[] = Array.isArray(listed) ? listed : listed ? [listed] : [];
      return components.map((component) => ({
        fullName: String(component?.fullName ?? ''),
        id: String(component?.id ?? ''),
      }));
    } catch {
      return null;
    }
  };
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const findMatch = (components: Array<{ fullName: string; id: string }> | null) =>
    (components ?? []).find((component) => component.fullName === name || decode(component.fullName) === name);

  // Never cached for Flow: activating another version in Setup changes the Id
  if (type === 'Flow') {
    const match = findMatch(await listComponents());
    return match ? { id: match.id, fromCache: false } : null;
  }
  const cacheKey = `listMetadata:${type}${folder ? `:${folder}` : ''}`;
  let listed = await withOrgApiCache(connection, cacheKey, listComponents, { refresh: options.refresh });
  let match = findMatch(listed.value);
  if (!match && listed.fromCache) {
    // The component may have been deployed after the list was cached
    listed = await withOrgApiCache(connection, cacheKey, listComponents, { refresh: true });
    match = findMatch(listed.value);
  }
  return match ? { id: match.id, fromCache: listed.fromCache } : null;
}

// EntityDefinition of an object API name, cached: object Ids do not change
async function queryEntityDefinitions(
  connection: Connection,
  qualifiedApiName: string
): Promise<Array<{ DurableId: string; QualifiedApiName: string }>> {
  const result = await withOrgApiCache(connection, `entityDefinition:${qualifiedApiName}`, async () => {
    const entityResult = await soqlQueryTooling(
      `SELECT DurableId, QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName = ${soqlString(qualifiedApiName)}`,
      connection
    );
    return (entityResult.records ?? []).map((record: Record<string, unknown>) => ({
      DurableId: String(record.DurableId),
      QualifiedApiName: String(record.QualifiedApiName),
    }));
  });
  return result.value;
}

// Standard objects are not CustomObject records: their DurableId in EntityDefinition is their API name
async function lookupStandardObject(connection: Connection, name: string): Promise<MetadataComponentSelection[]> {
  return (await queryEntityDefinitions(connection, name.trim())).map((record) => ({
    id: record.DurableId,
    name: record.QualifiedApiName,
    type: 'StandardEntity',
  }));
}

async function lookupToolingComponents(
  connection: Connection,
  type: string,
  name: string
): Promise<MetadataComponentSelection[]> {
  let query: string;
  let objectApi: string | undefined;
  if (type === 'CustomField') {
    if (!name.trim().endsWith('__c')) {
      // Salesforce dependency data only holds custom fields
      throw new SfError(t('metadataDepsStandardFieldNotTracked', { name }));
    }
    const parsed = parseCustomFieldName(name);
    objectApi = parsed.table;
    const entityKeys: string[] = [];
    if (parsed.table) {
      entityKeys.push(parsed.table);
      const durableId = (await queryEntityDefinitions(connection, parsed.table))[0]?.DurableId;
      if (durableId && !entityKeys.includes(String(durableId))) {
        entityKeys.push(String(durableId));
      }
    }
    query = buildCustomFieldLookupSoql(parsed.developerName, entityKeys);
  } else {
    query = buildLookupSoql(type, name);
  }

  try {
    const result = await soqlQueryTooling(query, connection);
    const records: Array<Record<string, unknown>> = result.records ?? [];
    if (type === 'Flow') {
      // Dependencies point to a Flow version: use the active one, else the latest
      return records
        .map((record) => ({
          id: String(record.ActiveVersionId ?? record.LatestVersionId ?? ''),
          name: String(record.DeveloperName ?? name),
          type,
        }))
        .filter((selection) => selection.id !== '');
    }
    return records.map((record) => {
      const developerName = record.DeveloperName ? String(record.DeveloperName) : '';
      const table =
        objectApi ||
        (record.TableEnumOrId ? String(record.TableEnumOrId) : '') ||
        (record.EntityDefinitionId ? String(record.EntityDefinitionId) : '');
      const resolvedName =
        type === 'CustomField' && developerName
          ? table
            ? `${table}.${developerName}`
            : developerName
          : String(record.Name ?? developerName);
      return { id: String(record.Id ?? ''), name: resolvedName, type };
    });
  } catch (error) {
    // Tooling types without a Name column, or not queryable at all (Report, CustomMetadata...)
    if (/No such column|not supported|INVALID_TYPE|INVALID_FIELD/i.test(String((error as Error).message))) {
      throw new SfError(t('metadataDepsLookupByNameUnsupported', { type }));
    }
    throw error;
  }
}

export async function queryUsedBy(
  connection: Connection,
  selection: MetadataComponentSelection,
  options: { componentType?: string; bulk?: boolean; commandThis: any }
): Promise<MetadataDependencyRow[]> {
  const query = buildUsedBySoql(selection.id, selection.type, options.componentType);
  const records = options.bulk
    ? (await bulkQueryTooling(query, connection)).records ?? []
    : (await soqlQueryTooling(query, connection)).records ?? [];
  if (!options.bulk && records.length >= TOOLING_ROW_CAP) {
    uxLog(
      'warning',
      options.commandThis,
      c.yellow(t('metadataDepsRowCapWarning', { count: TOOLING_ROW_CAP }))
    );
  }
  return mapUsedByRows(records);
}

function validateType(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  if (!isMetadataType(type)) {
    throw new SfError(t('metadataDepsInvalidType'));
  }
  return type;
}

async function promptForSelectionInput(
  commandThis: any,
  initialType?: string,
  initialName?: string
): Promise<{
  type: string;
  name?: string;
  id?: string;
}> {
  let selectedType = initialType;
  if (!selectedType) {
    const typeAnswer = await prompts({
      type: 'select',
      name: 'value',
      message: t('metadataDepsSelectType'),
      description: t('metadataDepsSelectTypeDesc'),
      choices: [
        ...METADATA_TYPE_REGISTRY.map((entry) => ({
          title: entry.value,
          value: entry.value,
          description: entry.hint,
        })),
        {
          title: t('metadataDepsTypeOther'),
          value: OTHER_TYPE_VALUE,
          description: t('metadataDepsTypeOtherDesc'),
        },
      ],
    });
    selectedType = String(typeAnswer.value);
    uxLog('action', commandThis, c.cyan(t('metadataDepsTitle')));
  }

  if (selectedType === OTHER_TYPE_VALUE) {
    const otherAnswer = await prompts([
      {
        type: 'text',
        name: 'type',
        message: t('metadataDepsEnterType'),
        description: t('metadataDepsEnterTypeDesc'),
        validate: (value: string) => isMetadataType(value.trim()) || t('metadataDepsInvalidType'),
      },
      {
        type: 'text',
        name: 'id',
        message: t('metadataDepsEnterId'),
        description: t('metadataDepsEnterIdDesc'),
        validate: (value: string) => isSalesforceId(value.trim()) || t('metadataDepsInvalidId'),
      },
    ]);
    uxLog('action', commandThis, c.cyan(t('metadataDepsTitle')));
    return { type: String(otherAnswer.type).trim(), id: String(otherAnswer.id).trim() };
  }

  const type = selectedType!;
  if (initialName) {
    return { type, name: initialName };
  }
  const hint = METADATA_TYPE_REGISTRY.find((entry) => entry.value === type)?.hint ?? 'ApiName';
  const nameAnswer = await prompts({
    type: 'text',
    name: 'value',
    message: t('metadataDepsEnterName'),
    description: t('metadataDepsEnterNameDesc', { hint }),
    validate: (value: string) => value.trim().length > 0,
  });
  uxLog('action', commandThis, c.cyan(t('metadataDepsTitle')));
  return { type, name: String(nameAnswer.value).trim() };
}

export async function resolveMetadataComponent(
  connection: Connection,
  flags: MetadataDepsFlags,
  commandThis: any
): Promise<MetadataComponentSelection | null> {
  let type = validateType(flags.type?.trim());
  let name = flags.name?.trim();
  let id = flags.id?.trim();

  const sourceFile = flags.sourceFile?.trim();
  if (sourceFile) {
    if (!fs.existsSync(sourceFile)) {
      throw new SfError(t('metadataDepsSourceFileMissing', { file: sourceFile }));
    }
    const resolved = MetadataUtils.resolveMetadataFromFile(sourceFile);
    if (!resolved) {
      throw new SfError(t('metadataDepsSourceFileNotMetadata', { file: sourceFile }));
    }
    type = resolved.type;
    name = resolved.name;
    uxLog('action', commandThis, c.cyan(t('metadataDepsSourceFileResolved', { file: sourceFile, type, name })));
  }

  if (id && !isSalesforceId(id)) {
    throw new SfError(t('metadataDepsInvalidId'));
  }
  if ((flags.agent || isCI) && !id && !(type && name)) {
    throw new SfError(t('metadataDepsAgentRequiresFlags'));
  }
  if (!id && !(type && name)) {
    const prompted = await promptForSelectionInput(commandThis, type, name);
    type = prompted.type;
    name = prompted.name;
    id = prompted.id;
  }
  if (id) {
    // Without --type, used-by rows are not filtered on RefMetadataComponentType
    return { id, name: name || id, type: type || UNKNOWN_TYPE };
  }

  uxLog('action', commandThis, c.cyan(t('metadataDepsResolvingComponent', { type, name })));
  const matches = await lookupMetadataComponents(connection, type!, name!);
  if (matches.length === 0) {
    throw new SfError(t('metadataDepsNotFound', { type, name }));
  }
  if (matches.length === 1) {
    // Keep the API name the user gave (Account.Status__c) rather than the Tooling DeveloperName (Account.Status)
    return { ...matches[0], name: name! };
  }
  if (flags.agent || isCI) {
    throw new SfError(t('metadataDepsMultipleMatchesAgent'));
  }
  const answer = await prompts({
    type: 'select',
    name: 'value',
    message: t('metadataDepsPickComponent'),
    description: t('metadataDepsPickComponentDesc', { count: matches.length }),
    choices: matches.map((match) => ({
      title: match.name,
      value: match.id,
      description: match.id,
    })),
  });
  uxLog('action', commandThis, c.cyan(t('metadataDepsTitle')));
  return matches.find((match) => match.id === answer.value) ?? null;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function writeMetadataDepsReports(
  selection: MetadataComponentSelection,
  rows: MetadataDependencyRow[],
  targetOrg: string,
  commandThis: any
): Promise<MetadataDepsReport> {
  const reportRoot = await getReportDirectory();
  const reportDir = path.join(
    reportRoot,
    'metadata-deps',
    `${sanitizeFsName(selection.name)}-${sanitizeFsName(selection.type)}`
  );
  await fs.ensureDir(reportDir);
  const timestamp = formatTimestamp(new Date());
  const stem = `${sanitizeFsName(selection.name)}-used-by-${timestamp}`;
  const usedByCsv = path.join(reportDir, `${stem}.csv`);
  const summaryCsv = path.join(reportDir, `${stem}-summary.csv`);
  const xlsxBase = path.join(reportDir, `${stem}.csv`);
  const xlsxFile = path.join(reportDir, 'xls', `${stem}.xlsx`);
  const fields = ['usedById', 'usedByName', 'usedByType', 'targetId', 'targetName', 'targetType'];
  const summary = [
    { Field: 'Component', Value: selection.name },
    { Field: 'Type', Value: selection.type },
    { Field: 'Id', Value: selection.id },
    { Field: 'Org', Value: targetOrg },
    { Field: 'Used by (count)', Value: String(rows.length) },
    { Field: 'Generated at', Value: new Date().toISOString() },
  ];

  await fs.writeFile(
    usedByCsv,
    Papa.unparse({
      fields,
      data: rows.map((row) => fields.map((field) => row[field as keyof MetadataDependencyRow])),
    }),
    'utf8'
  );
  await fs.writeFile(summaryCsv, Papa.unparse(summary), 'utf8');
  WebSocketClient.sendReportFileMessage(usedByCsv, t('metadataDepsReportCsv'), 'report');
  await createXlsxFromCsvFiles([summaryCsv, usedByCsv], xlsxBase, {
    xlsFileTitle: t('metadataDepsReportXlsx'),
    worksheetNames: {
      [summaryCsv]: 'Summary',
      [usedByCsv]: 'Used by',
    },
    forceTextColumns: ['usedById', 'targetId', 'Id', 'Value'],
  });
  await fs.remove(summaryCsv);
  if (!(await fs.pathExists(xlsxFile))) {
    // createXlsxFromCsvFiles logs the cause as a warning instead of throwing
    throw new SfError(t('metadataDepsXlsxGenerationFailed', { file: xlsxFile }));
  }
  uxLog('log', commandThis, c.grey(usedByCsv));
  uxLog('log', commandThis, c.grey(xlsxFile));
  return {
    reportDir,
    reportFiles: [
      { type: 'csv', file: usedByCsv },
      { type: 'xlsx', file: xlsxFile },
    ],
  };
}

export async function runMetadataDeps(
  connection: Connection,
  targetOrg: string,
  flags: MetadataDepsFlags,
  commandThis: any
): Promise<any> {
  const componentType = validateType(flags.componentType?.trim());
  const selection = await resolveMetadataComponent(connection, flags, commandThis);
  if (!selection) {
    return { outputString: t('metadataDepsCancelled'), cancelled: true };
  }
  uxLog('action', commandThis, c.cyan(t('metadataDepsQueryingUsedBy', { name: selection.name, org: targetOrg })));
  const queryOptions = { componentType, bulk: flags.bulk, commandThis };
  let rows = await queryUsedBy(connection, selection, queryOptions);
  if (rows.length === 0 && selection.idFromCache) {
    // A cached Id can belong to a component deleted then created again with the same name
    const fresh = await lookupListedComponent(connection, selection.type, selection.name, { refresh: true });
    if (fresh?.id && fresh.id !== selection.id) {
      selection.id = fresh.id;
      rows = await queryUsedBy(connection, selection, queryOptions);
    }
  }
  if (selection.type === UNKNOWN_TYPE && rows.length > 0) {
    selection.type = rows[0].targetType || UNKNOWN_TYPE;
  }
  if (rows.length === 0) {
    uxLog('warning', commandThis, c.yellow(t('metadataDepsEmptyUsedBy')));
  } else {
    // Readable columns only, kept expanded in VS Code: the Ids and the target are in the CSV and Excel reports
    uxLog('action', commandThis, c.cyan(t('metadataDepsUsedByTable', { name: selection.name, count: rows.length })), {
      alwaysVisible: true,
    });
    const columns = [t('docMdColType'), t('docMdColName')];
    const tableRows = [...rows]
      .sort((a, b) => a.usedByType.localeCompare(b.usedByType) || a.usedByName.localeCompare(b.usedByName))
      .map((row) => ({ [columns[0]]: row.usedByType, [columns[1]]: row.usedByName }));
    // No uxLogTableWithReport: the used-by CSV written below holds every row and is sent to VS Code.
    // The table comes first, so a report failure never hides the result.
    uxLogTable(commandThis, tableRows, columns);
  }
  uxLog('action', commandThis, c.cyan(t('metadataDepsWritingReport')));
  const report = await writeMetadataDepsReports(selection, rows, targetOrg, commandThis);
  const outputString = t('metadataDepsGenerated', { name: selection.name, count: rows.length });
  uxLog('success', commandThis, c.green(outputString));
  return {
    outputString,
    component: { id: selection.id, name: selection.name, type: selection.type, org: targetOrg },
    usedBy: rows,
    ...report,
  };
}
