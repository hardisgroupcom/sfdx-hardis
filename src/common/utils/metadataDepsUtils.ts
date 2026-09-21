import path from 'path';
import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import Papa from 'papaparse';
import { getReportDirectory } from '../../config/index.js';
import fs from './fsUtils.js';
import { createXlsxFromCsvFiles } from './filesUtils.js';
import { t } from './i18n.js';
import { createTempDir, execSfdxJson, isCI, uxLog, uxLogTable } from './index.js';
import { prompts } from './prompts.js';
import { soqlQueryTooling } from './apiUtils.js';
import { WebSocketClient } from '../websocketClient.js';

const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const METADATA_TYPE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const OTHER_TYPE_VALUE = '__other__';
const TOOLING_ROW_CAP = 2000;
const DEPENDENCY_FIELDS =
  'MetadataComponentId, MetadataComponentName, MetadataComponentType, ' +
  'RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType';

interface LookupConfig {
  selectField: string;
  whereField: string;
  transformName?: (raw: string) => string;
}

export interface MetadataDepsFlags {
  type?: string;
  name?: string;
  id?: string;
  componentType?: string;
  bulk?: boolean;
  agent?: boolean;
}

export interface MetadataComponentSelection {
  id: string;
  name: string;
  type: string;
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
  Flow: { selectField: 'DeveloperName', whereField: 'DeveloperName' },
  CustomObject: {
    selectField: 'DeveloperName',
    whereField: 'DeveloperName',
    transformName: stripCustomSuffix,
  },
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
  return value.endsWith('__c') ? value.slice(0, -3) : value;
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
  const config = LOOKUP_CONFIG[type];
  if (config) {
    const normalizedName = config.transformName ? config.transformName(name) : name;
    return `SELECT Id, ${config.selectField} FROM ${type} WHERE ${config.whereField} = ${soqlString(normalizedName)}`;
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
  if (type && type !== 'StandardEntity') {
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
  let query: string;
  let objectApi: string | undefined;
  if (type === 'CustomField') {
    const parsed = parseCustomFieldName(name);
    objectApi = parsed.table;
    const entityKeys: string[] = [];
    if (parsed.table) {
      entityKeys.push(parsed.table);
      const entityResult = await soqlQueryTooling(
        `SELECT DurableId, QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName = ${soqlString(parsed.table)}`,
        connection
      );
      const durableId = entityResult.records?.[0]?.DurableId;
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
    return (result.records ?? []).map((record: Record<string, unknown>) => {
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
    if (String((error as Error).message).includes("No such column 'Name'")) {
      throw new SfError(t('metadataDepsLookupNameColumnMissing', { type }));
    }
    throw error;
  }
}

function commandDoubleQuote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function queryUsedByBulk(
  query: string,
  targetOrg: string,
  commandThis: any
): Promise<Array<Record<string, unknown>>> {
  const tempDir = await createTempDir();
  const queryFile = path.join(tempDir, 'metadata-deps.soql');
  await fs.writeFile(queryFile, query, 'utf8');
  try {
    const result = await execSfdxJson(
      `sf data query --use-tooling-api --bulk --file ${commandDoubleQuote(queryFile)} --target-org ${commandDoubleQuote(targetOrg)}`,
      commandThis,
      { fail: true, output: false, debug: false }
    );
    return result?.result?.records ?? result?.records ?? [];
  } finally {
    await fs.remove(tempDir);
  }
}

export async function queryUsedBy(
  connection: Connection,
  selection: MetadataComponentSelection,
  options: { componentType?: string; bulk?: boolean; targetOrg: string; commandThis: any }
): Promise<MetadataDependencyRow[]> {
  if (selection.type === 'StandardEntity') {
    uxLog('warning', options.commandThis, c.yellow(t('metadataDepsStandardEntityFilterSkipped')));
  }
  const query = buildUsedBySoql(selection.id, selection.type, options.componentType);
  const records = options.bulk
    ? await queryUsedByBulk(query, options.targetOrg, options.commandThis)
    : (await soqlQueryTooling(query, connection)).records ?? [];
  if (!options.bulk && records.length === TOOLING_ROW_CAP) {
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
    if (typeAnswer.value === 'exitNow') {
      return { type: '' };
    }
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
  const componentType = validateType(flags.componentType?.trim());
  flags.componentType = componentType;
  let name = flags.name?.trim();
  let id = flags.id?.trim();

  if (id && !isSalesforceId(id)) {
    throw new SfError(t('metadataDepsInvalidId'));
  }
  if ((flags.agent || isCI) && !id && !(type && name)) {
    throw new SfError(t('metadataDepsAgentRequiresFlags'));
  }
  if (!id && !(type && name)) {
    const prompted = await promptForSelectionInput(commandThis, type, name);
    if (!prompted.type) {
      return null;
    }
    type = prompted.type;
    name = prompted.name;
    id = prompted.id;
  }
  if (id) {
    return { id, name: name || id, type: type || 'Unknown' };
  }

  uxLog('action', commandThis, c.cyan(t('metadataDepsResolvingComponent', { type, name })));
  const matches = await lookupMetadataComponents(connection, type!, name!);
  if (matches.length === 0) {
    uxLog('warning', commandThis, c.yellow(t('metadataDepsNotFound', { type, name })));
    return null;
  }
  if (matches.length === 1) {
    return matches[0];
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
  if (answer.value === 'exitNow') {
    return null;
  }
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
    throw new SfError(t('releaseNotesXlsxGenerationFailed', { message: xlsxFile }));
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
  const selection = await resolveMetadataComponent(connection, flags, commandThis);
  if (!selection) {
    return { outputString: t('metadataDepsCancelled'), cancelled: true };
  }
  uxLog('action', commandThis, c.cyan(t('metadataDepsQueryingUsedBy', { name: selection.name })));
  const rows = await queryUsedBy(connection, selection, {
    componentType: flags.componentType,
    bulk: flags.bulk,
    targetOrg,
    commandThis,
  });
  if (rows.length === 0) {
    uxLog('warning', commandThis, c.yellow(t('metadataDepsEmptyUsedBy')));
  } else {
    const columns = {
      usedById: t('metadataDepsColUsedById'),
      usedByName: t('metadataDepsColUsedByName'),
      usedByType: t('metadataDepsColUsedByType'),
      targetId: t('metadataDepsColTargetId'),
      targetName: t('metadataDepsColTargetName'),
      targetType: t('metadataDepsColTargetType'),
    };
    const tableRows = rows.map((row) => ({
      [columns.usedById]: row.usedById,
      [columns.usedByName]: row.usedByName,
      [columns.usedByType]: row.usedByType,
      [columns.targetId]: row.targetId,
      [columns.targetName]: row.targetName,
      [columns.targetType]: row.targetType,
    }));
    uxLogTable(commandThis, tableRows, Object.values(columns));
  }
  uxLog('action', commandThis, c.cyan(t('metadataDepsWritingReport')));
  const report = await writeMetadataDepsReports(selection, rows, targetOrg, commandThis);
  const outputString = t('metadataDepsGenerated', { name: selection.name, count: rows.length });
  uxLog('success', commandThis, c.green(outputString));
  return {
    outputString,
    component: { ...selection, org: targetOrg },
    usedBy: rows,
    ...report,
  };
}
