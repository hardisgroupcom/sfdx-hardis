import path from 'path';
import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import Papa from 'papaparse';
import { getReportDirectory } from '../../config/index.js';
import fs from './fsUtils.js';
import { createXlsxFromCsvFiles } from './filesUtils.js';
import { t } from './i18n.js';
import { isCI, uxLog, uxLogTable } from './index.js';
import { prompts } from './prompts.js';
import { bulkQueryTooling, soqlQuery, soqlQueryTooling } from './apiUtils.js';
import { mapInAdaptiveBatches } from './adaptiveBatch.js';
import { WebSocketClient } from '../websocketClient.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { withOrgApiCache } from '../cache/orgApiCache.js';
import { isFolderType, ListedComponent, listMetadataComponentsOrNull } from './metadataListingUtils.js';
import { glob } from 'glob';
import { PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS, getSfdxProjectPackageDirectories } from './projectUtils.js';
import { listMetadataTypes } from '../metadata-utils/metadataList.js';

const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const METADATA_TYPE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const OTHER_TYPE_VALUE = '__other__';
const UNKNOWN_TYPE = 'Unknown';
// Salesforce returns at most this number of MetadataComponentDependency rows to one query
export const TOOLING_ROW_CAP = 2000;
// Characters of an Id prefix split: LIKE is case-sensitive on this object, so all 62 are needed
const ID_PREFIX_CHARACTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
// Salesforce rejects a filter on this type: standard objects stay in the "other types" part
const STANDARD_ENTITY_TYPE = 'StandardEntity';
// Longest prefix split: an Id has 18 characters, a standard object name (its Id here) up to 40
const MAX_ID_PREFIX_LENGTH = 80;
// Parallel queries of a split, smaller after a throttling
const SPLIT_QUERY_BATCH_SIZES = [10, 5, 2, 1] as const;
const CUSTOM_OBJECT_SUFFIX_RE = /__(c|mdt|e|b|x|kav|share|history|feed)$/i;
const DEPENDENCY_FIELDS =
  'MetadataComponentId, MetadataComponentName, MetadataComponentType, ' +
  'RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType';

interface LookupConfig {
  selectField: string;
  whereField: string;
}

// used-by: the components that use the selected one; uses: the components the selected one uses
export type DependencyDirection = 'used-by' | 'uses';

export interface MetadataDepsFlags {
  type?: string;
  name?: string;
  id?: string;
  componentType?: string;
  sourceFile?: string;
  direction?: DependencyDirection;
  skipReport?: boolean;
  agent?: boolean;
}

export interface MetadataComponentSelection {
  id: string;
  name: string;
  type: string;
  // The Id comes from the org API cache: it is checked again when no dependency is found
  idFromCache?: boolean;
}

// A component on the other side of a dependency: one that uses the selected component (used-by),
// or one the selected component uses (uses)
export interface MetadataDependency {
  id: string;
  // Name as Salesforce stores it in the dependency data: a label or a DeveloperName ("Account Layout", "Status")
  name: string;
  type: string;
  // Filled by enrichDependencies: Metadata API name (empty when the type cannot be listed),
  // Setup path of the component, and its source file in the project (empty when absent)
  apiName: string;
  setupPath: string;
  localFile: string;
  // Flow only: the versions of the Flow in the dependency, newest first. The dependency data holds one row per
  // Flow version: they are merged into one row per Flow, whose Id is the active (else newest) version.
  versions?: FlowVersion[];
}

export interface FlowVersion {
  id: string;
  versionNumber: number;
  status: string;
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

// Fields prefix of the selected component and of the other component in a MetadataComponentDependency row:
// Ref* is the used component, the unprefixed side the component that uses it
function directionSides(direction: DependencyDirection): { selected: string; other: string } {
  return direction === 'uses'
    ? { selected: 'MetadataComponent', other: 'RefMetadataComponent' }
    : { selected: 'RefMetadataComponent', other: 'MetadataComponent' };
}

// One part of a dependency query split to stay under the row cap, filtered on the other side
export interface DependencyQueryPart {
  // Only this type of component
  type?: string;
  // None of these types (the types not listed yet)
  excludedTypes?: string[];
  // Only the components whose Id starts with this prefix (case-sensitive)
  idPrefix?: string;
  // Only this component: a standard object Id is its name, which a longer prefix does not match
  exactId?: string;
}

export function buildDependenciesSoql(
  id: string,
  type?: string,
  componentType?: string,
  direction: DependencyDirection = 'used-by',
  part: DependencyQueryPart = {}
): string {
  const sides = directionSides(direction);
  const clauses = [`${sides.selected}Id = ${soqlString(id)}`];
  if (type && type !== 'StandardEntity' && type !== UNKNOWN_TYPE) {
    clauses.push(`${sides.selected}Type = ${soqlString(type)}`);
  }
  const otherType = componentType || part.type;
  if (otherType) {
    clauses.push(`${sides.other}Type = ${soqlString(otherType)}`);
  }
  if (part.excludedTypes && part.excludedTypes.length > 0) {
    clauses.push(`${sides.other}Type NOT IN (${part.excludedTypes.map(soqlString).join(', ')})`);
  }
  if (part.idPrefix) {
    clauses.push(`${sides.other}Id LIKE ${soqlString(`${part.idPrefix}%`)}`);
  }
  if (part.exactId) {
    clauses.push(`${sides.other}Id = ${soqlString(part.exactId)}`);
  }
  return `SELECT ${DEPENDENCY_FIELDS} FROM MetadataComponentDependency WHERE ${clauses.join(' AND ')}`;
}

// The smaller queries that together return the rows of a part that reached the row cap:
// - first one per type found, plus one for the types not found (StandardEntity can not be filtered on:
//   standard objects stay in that last part)
// - then one per Id prefix one character longer, plus the prefix itself as an exact Id. One LIKE per
//   query: Salesforce does not apply an OR of many LIKE filters on this object reliably
export function splitDependencyQueryPart(
  part: DependencyQueryPart,
  records: Array<Record<string, unknown>>,
  typeField: string,
  typeFixed: boolean
): DependencyQueryPart[] {
  if (part.exactId) {
    return [];
  }
  if (!typeFixed && !part.type && part.idPrefix === undefined) {
    const excluded = part.excludedTypes || [];
    const types = [...new Set(records.map((record) => String(record[typeField] ?? '')))].filter(
      (type) => type !== '' && type !== STANDARD_ENTITY_TYPE && !excluded.includes(type)
    );
    if (types.length > 0) {
      return [...types.map((type) => ({ type })), { excludedTypes: [...excluded, ...types] }];
    }
  }
  const prefix = part.idPrefix || '';
  if (prefix.length >= MAX_ID_PREFIX_LENGTH) {
    return [];
  }
  const parts: DependencyQueryPart[] = ID_PREFIX_CHARACTERS.map((character) => ({
    ...part,
    idPrefix: `${prefix}${character}`,
  }));
  if (prefix !== '') {
    parts.push({ ...part, idPrefix: undefined, exactId: prefix });
  }
  return parts.map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));
}

type DependencyRecord = Record<string, unknown>;

// Every row of a dependency query. MetadataComponentDependency returns at most 2,000 rows to a query and
// supports neither queryMore, OFFSET nor range filters on Ids. At the cap, a Bulk API job reads the
// rows, merged with the ones already read (the Bulk API can miss some, Flow rows for example). When the
// Bulk API fails (Developer Edition orgs reject it), the query is split into smaller ones (see
// splitDependencyQueryPart) until each is under the cap.
export async function queryAllDependencyRecords(
  connection: Connection,
  selection: MetadataComponentSelection,
  options: {
    componentType?: string;
    direction: DependencyDirection;
    commandThis: any;
    // Replaceable in tests
    bulkQuery?: (query: string, connection: Connection) => Promise<{ records?: DependencyRecord[] }>;
  }
): Promise<DependencyRecord[]> {
  const other = directionSides(options.direction).other;
  const buildQuery = (part: DependencyQueryPart) =>
    buildDependenciesSoql(selection.id, selection.type, options.componentType, options.direction, part);
  const records: DependencyRecord[] = (await soqlQueryTooling(buildQuery({}), connection)).records ?? [];
  if (records.length < TOOLING_ROW_CAP) {
    return records;
  }
  const unique = (rows: DependencyRecord[]): DependencyRecord[] => {
    const byKey = new Map<string, DependencyRecord>();
    for (const row of rows) {
      byKey.set(`${row[`${other}Id`]}|${row[`${other}Type`]}`, row);
    }
    return [...byKey.values()];
  };
  const bulkQuery = options.bulkQuery || bulkQueryTooling;
  try {
    const bulkRecords = (await bulkQuery(buildQuery({}), connection)).records ?? [];
    const merged = unique([...records, ...bulkRecords]);
    uxLog('log', options.commandThis, c.grey(t('metadataDepsReadWithBulk', { cap: TOOLING_ROW_CAP, rows: merged.length })));
    return merged;
  } catch (error: any) {
    uxLog(
      'log',
      options.commandThis,
      c.grey(t('metadataDepsBulkFallback', { message: error?.message || String(error) }))
    );
  }
  let queryCount = 1;
  const readPart = async (part: DependencyQueryPart, known?: DependencyRecord[]): Promise<DependencyRecord[]> => {
    let rows: DependencyRecord[];
    if (known) {
      rows = known;
    } else {
      queryCount++;
      rows = (await soqlQueryTooling(buildQuery(part), connection)).records ?? [];
    }
    if (rows.length < TOOLING_ROW_CAP) {
      return rows;
    }
    const parts = splitDependencyQueryPart(part, rows, `${other}Type`, !!options.componentType);
    if (parts.length === 0) {
      return rows;
    }
    const partRows = await mapInAdaptiveBatches(parts, (item) => readPart(item), { sizes: SPLIT_QUERY_BATCH_SIZES });
    return partRows.flatMap((item) => item ?? []);
  };
  const merged = unique(await readPart({}, records));
  uxLog(
    'log',
    options.commandThis,
    c.grey(t('metadataDepsReadInParts', { cap: TOOLING_ROW_CAP, count: queryCount, rows: merged.length }))
  );
  return merged;
}

// The other component of each row, whatever the direction
export function mapDependencies(
  records: Array<Record<string, unknown>>,
  direction: DependencyDirection = 'used-by'
): MetadataDependency[] {
  const other = directionSides(direction).other;
  const stringValue = (record: Record<string, unknown>, key: string): string => {
    const value = record[key];
    return value == null ? '' : String(value);
  };
  return records.map((record) => ({
    id: stringValue(record, `${other}Id`),
    name: stringValue(record, `${other}Name`),
    type: stringValue(record, `${other}Type`),
    apiName: '',
    setupPath: '',
    localFile: '',
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
  const folder = isFolderType(type) && name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : undefined;
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const findMatch = (components: ListedComponent[] | null) =>
    (components ?? []).find((component) => component.fullName === name || decode(component.fullName) === name);

  let listed = await listMetadataComponentsOrNull(connection, type, folder, { refresh: options.refresh });
  let match = findMatch(listed.value);
  if (!match && listed.fromCache && listed.value !== null) {
    // The component may have been deployed after the list was cached
    listed = await listMetadataComponentsOrNull(connection, type, folder, { refresh: true });
    match = findMatch(listed.value);
  }
  return match ? { id: match.id, fromCache: listed.fromCache } : null;
}

// Setup page of a component: Flow Builder for a Flow, the list page for the bundles without a detail page,
// and /<Id> for the others, which Salesforce redirects to the Setup detail page of the component
export function buildSetupPath(type: string, id: string): string {
  if (type === 'Flow') {
    return `/builder_platform_interaction/flowBuilder.app?flowId=${id}`;
  }
  if (type === 'LightningComponentBundle') {
    return '/lightning/setup/LightningComponentBundles/home';
  }
  if (type === 'AuraDefinitionBundle') {
    return '/lightning/setup/LightningComponents/home';
  }
  // A standard object is identified by its API name (Account), not by a record Id
  if (type === 'StandardEntity') {
    return id ? `/lightning/setup/ObjectManager/${id}/Details/view` : '';
  }
  // Only a real Salesforce Id opens a Setup page (some dependency rows carry a name, like "User")
  return isSalesforceId(id) ? `/${id}` : '';
}

// Main file of a bundle (LWC, Aura), the one a user expects to open
const BUNDLE_MAIN_FILE_EXTENSIONS = ['.js', '.cmp', '.app', '.evt', '.intf'];

function pickBundleMainFile(bundleName: string, files: string[]): string {
  return (
    BUNDLE_MAIN_FILE_EXTENSIONS.map((extension) =>
      files.find((file) => path.basename(file) === `${bundleName}${extension}`)
    ).find(Boolean) ?? [...files].sort()[0]
  );
}

// Local source file of each API name of a type, relative to the project root:
// - a file named after the whole API name (ApexClass, Flow, Layout, CustomMetadata record...)
// - an object child (CustomField Account.Total__c is objects/Account/fields/Total__c.field-meta.xml)
// - a bundle without file suffix (LWC, Aura): its folder, then its main file
// One glob per package directory and per kind of lookup, whatever the number of names.
export async function findLocalFiles(type: string, apiNames: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const names = [...new Set(apiNames.filter((name) => name !== ''))];
  if (names.length === 0) {
    return found;
  }
  const metadataType = listMetadataTypes().find((entry) => entry.xmlName === type);
  const packageDirectories = await getSfdxProjectPackageDirectories();
  const byFullName = await MetadataUtils.findMetaFilesFromTypeAndNames(type, names, packageDirectories);
  for (const [name, file] of byFullName) {
    if (file) {
      found.set(name, file);
    }
  }
  const missing = names.filter((name) => !found.has(name));
  if (missing.length === 0 || !metadataType?.directoryName) {
    return found;
  }
  const directoryName = metadataType.directoryName;
  for (const packageDirectory of packageDirectories) {
    const pending = missing.filter((name) => !found.has(name));
    if (pending.length === 0) {
      break;
    }
    const toProjectPath = (file: string) => path.join(packageDirectory.path, file).replace(/\\/g, '/');
    if (metadataType.suffix && pending.some((name) => name.includes('.'))) {
      const childFiles = await glob(`**/${directoryName}/*.${metadataType.suffix}-meta.xml`, {
        cwd: packageDirectory.fullPath,
        ignore: PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS,
      });
      for (const file of childFiles) {
        const parts = file.replace(/\\/g, '/').split('/');
        const parentName = parts[parts.length - 3];
        const childName = path.basename(file).slice(0, -`.${metadataType.suffix}-meta.xml`.length);
        const apiName = `${parentName}.${childName}`;
        if (pending.includes(apiName) && !found.has(apiName)) {
          found.set(apiName, toProjectPath(file));
        }
      }
    } else if (!metadataType.suffix) {
      const bundleFiles = await glob(`**/${directoryName}/*/*`, {
        cwd: packageDirectory.fullPath,
        ignore: PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS,
      });
      const filesByBundle = new Map<string, string[]>();
      for (const file of bundleFiles) {
        const bundleName = path.basename(path.dirname(file));
        if (pending.includes(bundleName)) {
          filesByBundle.set(bundleName, [...(filesByBundle.get(bundleName) ?? []), file]);
        }
      }
      for (const [bundleName, files] of filesByBundle) {
        found.set(bundleName, toProjectPath(pickBundleMainFile(bundleName, files)));
      }
    }
  }
  return found;
}

// Adds to each dependency what a UI needs to act on it: its Metadata API name (the dependency data holds a
// label or a DeveloperName, such as "Account Layout" or "Status"), its Setup page and its local source file.
// The types are listed in parallel, one cached listing per type. A component missing from a cached listing
// (created since) makes its type listed again. Types that cannot be listed (CronTrigger...) keep an empty
// API name. A standard object (StandardEntity, on the used side) is named by its Id, its API name.
export async function enrichDependencies(
  connection: Connection,
  dependencies: MetadataDependency[]
): Promise<MetadataDependency[]> {
  const id15 = (id: string) => id.slice(0, 15);
  const types = [...new Set(dependencies.map((dependency) => dependency.type))];
  await Promise.all(
    types.map(async (type) => {
      const typeRows = dependencies.filter((dependency) => dependency.type === type);
      if (type === 'StandardEntity') {
        for (const row of typeRows) {
          row.apiName = row.id;
          row.setupPath = buildSetupPath(type, row.id);
        }
        await addLocalFiles('CustomObject', typeRows);
        return;
      }
      if (isFolderType(type)) {
        // listMetadata needs a folder for these types: their Folder/Name API names come from SOQL instead
        const names = await queryFolderedNames(connection, type, typeRows.map((row) => row.id));
        for (const row of typeRows) {
          row.apiName = names.get(id15(row.id)) ?? '';
          row.setupPath = buildSetupPath(type, row.id);
        }
        await addLocalFiles(type, typeRows);
        return;
      }
      const nameByIdOf = (listed: ListedComponent[] | null) =>
        new Map((listed ?? []).filter((component) => component.id).map((c) => [id15(c.id), c.fullName]));
      let listed = await listMetadataComponentsOrNull(connection, type);
      let nameById = nameByIdOf(listed.value);
      if (listed.fromCache && typeRows.some((row) => !nameById.has(id15(row.id)))) {
        listed = await listMetadataComponentsOrNull(connection, type, undefined, { refresh: true });
        nameById = nameByIdOf(listed.value);
      }
      for (const row of typeRows) {
        row.apiName = nameById.get(id15(row.id)) ?? '';
        row.setupPath = buildSetupPath(type, row.id);
      }
      if (type === 'Flow') {
        // The listing only knows the active or newest version of each Flow: every version is resolved
        const versions = await queryFlowVersions(
          connection,
          typeRows.map((row) => row.id)
        );
        for (const row of typeRows) {
          const version = versions.get(id15(row.id));
          if (version) {
            row.apiName = version.developerName;
            row.versions = [{ id: row.id, versionNumber: version.versionNumber, status: version.status }];
          }
        }
      }
      await addLocalFiles(type, typeRows);
    })
  );
  return mergeFlowVersions(dependencies);
}

async function addLocalFiles(type: string, rows: MetadataDependency[]): Promise<void> {
  try {
    const localFiles = await findLocalFiles(
      type,
      rows.map((row) => row.apiName)
    );
    for (const row of rows) {
      row.localFile = (row.apiName && localFiles.get(row.apiName)) || '';
    }
  } catch {
    // No sfdx project here: no local files
  }
}

// sObject and folder field of each folder type: its API name is <folder DeveloperName>/<DeveloperName>
const FOLDERED_OBJECTS: Record<string, { object: string; folderField: string }> = {
  Report: { object: 'Report', folderField: 'OwnerId' },
  Dashboard: { object: 'Dashboard', folderField: 'FolderId' },
  EmailTemplate: { object: 'EmailTemplate', folderField: 'FolderId' },
  Document: { object: 'Document', folderField: 'FolderId' },
};

// Folder/Name API names of Report, Dashboard, EmailTemplate and Document Ids, 200 Ids per SOQL query.
// A component whose folder is the org (Id starting with 00D) is in unfiled$public. One in a personal
// folder (a user Id) keeps an empty API name: it cannot be retrieved.
export async function queryFolderedNames(
  connection: Connection,
  type: string,
  ids: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const config = FOLDERED_OBJECTS[type];
  const uniqueIds = [...new Set(ids.filter((id) => isSalesforceId(id)))];
  if (!config || uniqueIds.length === 0) {
    return names;
  }
  try {
    const components: Array<{ id: string; developerName: string; folderId: string }> = [];
    for (let index = 0; index < uniqueIds.length; index += 200) {
      const chunk = uniqueIds.slice(index, index + 200);
      const result = await soqlQuery(
        `SELECT Id, DeveloperName, ${config.folderField} FROM ${config.object} WHERE Id IN (${chunk.map(soqlString).join(', ')})`,
        connection
      );
      for (const record of result.records ?? []) {
        components.push({
          id: String(record.Id),
          developerName: String(record.DeveloperName ?? ''),
          folderId: String(record[config.folderField] ?? ''),
        });
      }
    }
    const folderIds = [...new Set(components.map((component) => component.folderId).filter((id) => id.startsWith('00l')))];
    const folderNames = new Map<string, string>();
    for (let index = 0; index < folderIds.length; index += 200) {
      const chunk = folderIds.slice(index, index + 200);
      const result = await soqlQuery(
        `SELECT Id, DeveloperName FROM Folder WHERE Id IN (${chunk.map(soqlString).join(', ')})`,
        connection
      );
      for (const record of result.records ?? []) {
        folderNames.set(String(record.Id).slice(0, 15), String(record.DeveloperName ?? ''));
      }
    }
    for (const component of components) {
      const folder = component.folderId.startsWith('00D')
        ? 'unfiled$public'
        : folderNames.get(component.folderId.slice(0, 15)) ?? '';
      if (folder && component.developerName) {
        names.set(component.id.slice(0, 15), `${folder}/${component.developerName}`);
      }
    }
  } catch {
    // Names stay unresolved: the rows keep their label, and can still be opened in Setup
  }
  return names;
}

// Version number, status and Flow API name of Flow version Ids, 200 Ids per Tooling query
async function queryFlowVersions(
  connection: Connection,
  ids: string[]
): Promise<Map<string, { developerName: string; versionNumber: number; status: string }>> {
  const versions = new Map<string, { developerName: string; versionNumber: number; status: string }>();
  const uniqueIds = [...new Set(ids.filter((id) => id !== ''))];
  for (let index = 0; index < uniqueIds.length; index += 200) {
    const chunk = uniqueIds.slice(index, index + 200);
    try {
      const result = await soqlQueryTooling(
        `SELECT Id, Definition.DeveloperName, VersionNumber, Status FROM Flow WHERE Id IN (${chunk.map(soqlString).join(', ')})`,
        connection
      );
      for (const record of result.records ?? []) {
        versions.set(String(record.Id).slice(0, 15), {
          developerName: String(record.Definition?.DeveloperName ?? ''),
          versionNumber: Number(record.VersionNumber ?? 0),
          status: String(record.Status ?? ''),
        });
      }
    } catch {
      // Versions stay unresolved: their rows keep their own Id and label
    }
  }
  return versions;
}

// One row per Flow instead of one row per Flow version. The kept row is the active version, else the
// newest one, so its Id, Setup page and drill-down point at the version a user expects.
export function mergeFlowVersions(dependencies: MetadataDependency[]): MetadataDependency[] {
  const merged: MetadataDependency[] = [];
  const flowRowByName = new Map<string, MetadataDependency>();
  for (const row of dependencies) {
    if (row.type !== 'Flow' || !row.apiName || !row.versions) {
      merged.push(row);
      continue;
    }
    const existing = flowRowByName.get(row.apiName);
    if (!existing) {
      flowRowByName.set(row.apiName, row);
      merged.push(row);
      continue;
    }
    const versions = [...(existing.versions ?? []), ...row.versions];
    const rowVersion = row.versions[0];
    // The version the row keeps so far, not the first one merged
    const existingVersion = (existing.versions ?? []).find((version) => version.id === existing.id);
    const rowWins =
      rowVersion.status === 'Active' ||
      (existingVersion?.status !== 'Active' && rowVersion.versionNumber > (existingVersion?.versionNumber ?? 0));
    if (rowWins) {
      existing.id = row.id;
      existing.name = row.name;
      existing.setupPath = row.setupPath;
    }
    existing.versions = versions;
  }
  for (const row of flowRowByName.values()) {
    // Newest first, the kept version first when it is not the newest (an active older version)
    row.versions = [...(row.versions ?? [])].sort((a, b) => b.versionNumber - a.versionNumber);
    const kept = row.versions.findIndex((version) => version.id === row.id);
    if (kept > 0) {
      row.versions.unshift(...row.versions.splice(kept, 1));
    }
  }
  return merged;
}

// "4 (Active); 3; 2; 1" for the reports
export function formatFlowVersions(versions?: FlowVersion[]): string {
  return (versions ?? [])
    .map((version) => (version.status === 'Active' ? `${version.versionNumber} (Active)` : String(version.versionNumber)))
    .join('; ');
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

// Dependencies of the selected component in one direction. selectedType is the type of the selected
// component as the dependency data knows it, for a selection made by Id only.
export async function queryDependencies(
  connection: Connection,
  selection: MetadataComponentSelection,
  options: { componentType?: string; direction: DependencyDirection; commandThis: any }
): Promise<{ dependencies: MetadataDependency[]; selectedType: string }> {
  const records = await queryAllDependencyRecords(connection, selection, options);
  const selectedType = records.length > 0 ? String(records[0][`${directionSides(options.direction).selected}Type`] ?? '') : '';
  return { dependencies: mapDependencies(records, options.direction), selectedType };
}

// Title shown after each prompt: it says which direction is read
function selectionTitle(flags: MetadataDepsFlags): string {
  return t(flags.direction === 'uses' ? 'metadataDepsTitleUses' : 'metadataDepsTitle');
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
  title: string,
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
    uxLog('action', commandThis, c.cyan(title));
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
    uxLog('action', commandThis, c.cyan(title));
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
  uxLog('action', commandThis, c.cyan(title));
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
    const prompted = await promptForSelectionInput(commandThis, selectionTitle(flags), type, name);
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
  uxLog('action', commandThis, c.cyan(selectionTitle(flags)));
  return matches.find((match) => match.id === answer.value) ?? null;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function writeMetadataDepsReports(
  selection: MetadataComponentSelection,
  dependencies: MetadataDependency[],
  targetOrg: string,
  direction: DependencyDirection,
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
  const stem = `${sanitizeFsName(selection.name)}-${direction}-${timestamp}`;
  const dependenciesCsv = path.join(reportDir, `${stem}.csv`);
  const summaryCsv = path.join(reportDir, `${stem}-summary.csv`);
  const xlsxBase = path.join(reportDir, `${stem}.csv`);
  const xlsxFile = path.join(reportDir, 'xls', `${stem}.xlsx`);
  const fields = ['id', 'apiName', 'name', 'type', 'versions'];
  const uses = direction === 'uses';
  const summary = [
    { Field: 'Component', Value: selection.name },
    { Field: 'Type', Value: selection.type },
    { Field: 'Id', Value: selection.id },
    { Field: 'Org', Value: targetOrg },
    { Field: 'Direction', Value: uses ? 'Uses' : 'Used by' },
    { Field: uses ? 'Uses (count)' : 'Used by (count)', Value: String(dependencies.length) },
    { Field: 'Generated at', Value: new Date().toISOString() },
  ];

  await fs.writeFile(
    dependenciesCsv,
    Papa.unparse({
      fields,
      data: dependencies.map((row) =>
        fields.map((field) =>
          field === 'versions' ? formatFlowVersions(row.versions) : row[field as keyof MetadataDependency]
        )
      ),
    }),
    'utf8'
  );
  await fs.writeFile(summaryCsv, Papa.unparse(summary), 'utf8');
  WebSocketClient.sendReportFileMessage(
    dependenciesCsv,
    t(uses ? 'metadataDepsReportUsesCsv' : 'metadataDepsReportCsv'),
    'report'
  );
  await createXlsxFromCsvFiles([summaryCsv, dependenciesCsv], xlsxBase, {
    xlsFileTitle: t(uses ? 'metadataDepsReportUsesXlsx' : 'metadataDepsReportXlsx'),
    worksheetNames: {
      [summaryCsv]: 'Summary',
      [dependenciesCsv]: uses ? 'Uses' : 'Used by',
    },
    forceTextColumns: ['id', 'Id', 'Value'],
  });
  await fs.remove(summaryCsv);
  if (!(await fs.pathExists(xlsxFile))) {
    // createXlsxFromCsvFiles logs the cause as a warning instead of throwing
    throw new SfError(t('metadataDepsXlsxGenerationFailed', { file: xlsxFile }));
  }
  uxLog('log', commandThis, c.grey(dependenciesCsv));
  uxLog('log', commandThis, c.grey(xlsxFile));
  return {
    reportDir,
    reportFiles: [
      { type: 'csv', file: dependenciesCsv },
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
  const direction: DependencyDirection = flags.direction === 'uses' ? 'uses' : 'used-by';
  const uses = direction === 'uses';
  uxLog(
    'action',
    commandThis,
    c.cyan(t(uses ? 'metadataDepsQueryingUses' : 'metadataDepsQueryingUsedBy', { name: selection.name, org: targetOrg }))
  );
  const queryOptions = { componentType, direction, commandThis };
  let queried = await queryDependencies(connection, selection, queryOptions);
  if (queried.dependencies.length === 0 && selection.idFromCache && !uses) {
    // A cached Id can belong to a component deleted then created again with the same name. Only checked
    // in used-by mode: many components use nothing, so an empty uses result is not a sign of a stale Id
    const fresh = await lookupListedComponent(connection, selection.type, selection.name, { refresh: true });
    if (fresh?.id && fresh.id !== selection.id) {
      selection.id = fresh.id;
      queried = await queryDependencies(connection, selection, queryOptions);
    }
  }
  const dependencies = await enrichDependencies(connection, queried.dependencies);
  if (selection.type === UNKNOWN_TYPE && queried.selectedType) {
    selection.type = queried.selectedType;
  }
  if (dependencies.length === 0) {
    uxLog('warning', commandThis, c.yellow(t(uses ? 'metadataDepsEmptyUses' : 'metadataDepsEmptyUsedBy')));
  } else if (!flags.skipReport) {
    // Readable columns only, kept expanded in VS Code: the Ids are in the CSV and Excel reports
    uxLog(
      'action',
      commandThis,
      c.cyan(
        t(uses ? 'metadataDepsUsesTable' : 'metadataDepsUsedByTable', { name: selection.name, count: dependencies.length })
      ),
      { alwaysVisible: true }
    );
    const columns = [t('docMdColType'), t('docMdColName')];
    const tableRows = [...dependencies]
      .map((row) => ({ type: row.type, displayName: row.apiName || row.name }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.displayName.localeCompare(b.displayName))
      .map((row) => ({ [columns[0]]: row.type, [columns[1]]: row.displayName }));
    // No uxLogTableWithReport: the CSV written below holds every row and is sent to VS Code.
    // The table comes first, so a report failure never hides the result.
    uxLogTable(commandThis, tableRows, columns);
  }
  let report: MetadataDepsReport | Record<string, never> = {};
  if (!flags.skipReport) {
    uxLog('action', commandThis, c.cyan(t(uses ? 'metadataDepsWritingUsesReport' : 'metadataDepsWritingReport')));
    report = await writeMetadataDepsReports(selection, dependencies, targetOrg, direction, commandThis);
  }
  const counts = { name: selection.name, count: dependencies.length };
  const outputString = flags.skipReport
    ? t(uses ? 'metadataDepsFoundUses' : 'metadataDepsFound', counts)
    : t(uses ? 'metadataDepsGeneratedUses' : 'metadataDepsGenerated', counts);
  uxLog('success', commandThis, c.green(outputString));
  return {
    outputString,
    direction,
    selected: { id: selection.id, name: selection.name, type: selection.type, org: targetOrg },
    dependencies,
    ...report,
  };
}
