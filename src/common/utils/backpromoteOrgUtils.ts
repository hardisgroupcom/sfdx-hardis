/*
 * Org side of hardis:work:backpromote: what the target org is, the retrieve of the ticked items into
 * the cache, their comparison with the parent branch versions, and the deployments.
 */
import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { execCommand, execSfdxJson, findJsonInString, getGitRepoRoot, uxLog } from './index.js';
import { soqlQuery, soqlQueryTooling } from './apiUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { generateReportPath } from './filesUtils.js';
import { analyzeDeployErrorLogs } from './deployTips.js';
import { getApiVersion, getEnvVar } from '../../config/index.js';
import { writePackageXmlFile } from './xmlUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from './i18n.js';
import {
  BackpromoteTargetOrgRefusal,
  countDifferingLines,
  deriveSandboxName,
  findBackpromoteTargetOrgRefusal,
  isBinaryMetadataFile,
  metadataKeysToPackageContent,
  normalizeRepoPath,
  parseMetadataKey,
  sameFileContent,
  sourcePathTail,
  toMetadataKey,
} from './backpromoteRules.js';
import { fileAtRef } from './backpromoteGitUtils.js';
import { BackpromotePlanComparison, backpromoteCacheRoot } from './backpromotePlanUtils.js';

// ---- Target org ----

export interface BackpromoteTargetOrgInfo {
  alias: string | null;
  username: string;
  instanceUrl: string;
  orgType: 'sandbox' | 'scratch' | 'production';
  orgId: string;
  sandboxName: string;
  tracksSource: boolean;
  refusal: BackpromoteTargetOrgRefusal | null;
  message: string;
}

/**
 * Only developer sandboxes and scratch orgs receive a backpromote. A production org, or the org of a
 * major branch, is deployed by the CI/CD pipeline.
 */
export async function getBackpromoteTargetOrgInfo(options: {
  conn: Connection;
  username: string;
  alias: string | null;
  tracksSource: boolean;
  sandboxNameOverride: string | null;
}): Promise<BackpromoteTargetOrgInfo> {
  const orgResult = await soqlQuery('SELECT Id, IsSandbox, TrialExpirationDate FROM Organization LIMIT 1', options.conn);
  const organization = orgResult?.records?.[0] || {};
  const isSandboxOrg = organization.IsSandbox === true;
  const orgType: BackpromoteTargetOrgInfo['orgType'] = !isSandboxOrg ? 'production' : organization.TrialExpirationDate ? 'scratch' : 'sandbox';
  const instanceUrl = options.conn.instanceUrl || '';
  const orgId = String(organization.Id || options.conn.getAuthInfoFields()?.orgId || '');
  const refusal = findBackpromoteTargetOrgRefusal({ isSandbox: isSandboxOrg, username: options.username, instanceUrl, majorOrgs: await listMajorOrgs() });
  const sandboxName = deriveSandboxName({ instanceUrl, username: options.username, orgId, override: options.sandboxNameOverride });
  let message = t('backpromoteCheckTargetOrgOk', { sandboxName });
  if (refusal?.reason === 'production') {
    message = t('backpromoteTargetOrgIsProduction', { username: options.username });
  } else if (refusal?.reason === 'majorOrg') {
    message = t('backpromoteTargetOrgIsMajorOrg', { username: options.username, branch: refusal.branchName });
  }
  return { alias: options.alias, username: options.username, instanceUrl, orgType, orgId, sandboxName, tracksSource: options.tracksSource, refusal, message };
}

// ---- Comparison ----

async function readPackageDirectories(gitRoot: string): Promise<string[]> {
  try {
    const project = JSON.parse(await fs.readFile(path.join(gitRoot, 'sfdx-project.json'), 'utf8'));
    return (project.packageDirectories || []).map((directory: any) => normalizeRepoPath(String(directory.path || ''))).filter((directory: string) => directory !== '');
  } catch {
    return ['force-app'];
  }
}

/** The pending changes of a source-tracked org, as repository paths (empty when the org is not tracked) */
export async function listOrgPendingChanges(username: string, commandThis: any): Promise<string[]> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const preview = await execSfdxJson(`sf project retrieve preview -o ${username} --json`, commandThis, { fail: false, output: false });
  const entries = [...(preview?.result?.toRetrieve || []), ...(preview?.result?.conflicts || []), ...(preview?.result?.toDelete || [])];
  const files = new Set<string>();
  for (const entry of entries) {
    const file = entry?.projectRelativePath || entry?.path || '';
    if (!file) {
      continue;
    }
    files.add(normalizeRepoPath(path.isAbsolute(file) ? path.relative(gitRoot, file) : file));
  }
  return [...files].sort();
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const files: string[] = [];
  const walk = async (folder: string) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(full);
      }
    }
  };
  await walk(directory);
  return files;
}

/** Folder and name of a source path without its last extension: staticresources/E2E_S2.resource -> staticresources/E2E_S2 */
function pathStem(tail: string): string {
  const value = normalizeRepoPath(tail);
  const slash = value.lastIndexOf('/');
  const folder = slash >= 0 ? value.substring(0, slash + 1) : '';
  const name = slash >= 0 ? value.substring(slash + 1) : value;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${folder}${name.substring(0, dot)}` : `${folder}${name}`;
}

export interface BackpromoteRetrieveResult {
  /** Absolute folder holding the org versions (source format) */
  orgDir: string;
  /** Retrieved absolute file by source path tail (classes/A.cls) */
  filesByTail: Map<string, string>;
  /**
   * Retrieved absolute file by folder and name without the extension. The source format names the
   * content file of a StaticResource after its contentType (E2E_S2.resource retrieved from the org
   * comes back as E2E_S2.txt), so the tail of the repository file finds nothing and the item
   * would be reported as absent from the org and overwritten without a question. Only kept when one
   * file of the folder has that name, so an LWC bundle (card.js, card.html) is never matched by it.
   */
  filesByStem: Map<string, string>;
}

// ---- Retrieve cache ----

/**
 * The types the cache may serve. A type stays out when a validator cannot prove its content did not
 * change: a container whose changes are tracked under its child types (CustomLabels holds
 * CustomLabel rows, Workflow holds WorkflowRule rows...), a type whose retrieved content depends on
 * the rest of the manifest (Profile, PermissionSet, translations only hold the entries of the
 * components retrieved with them), a folder based type the Metadata API lists by folder, a standard
 * item the listing leaves out (standard fields, StandardValueSet). Everything else is retrieved,
 * every time: a cache miss costs seconds, a wrong cache hit overwrites a sandbox change.
 */
const CACHEABLE_TYPES = new Set([
  'ApexClass',
  'ApexComponent',
  'ApexPage',
  'ApexTrigger',
  'AuraDefinitionBundle',
  'CompactLayout',
  'ContentAsset',
  'CustomApplication',
  'CustomMetadata',
  'CustomPermission',
  'CustomTab',
  'FlexiPage',
  'Flow',
  'GlobalValueSet',
  'Layout',
  'LightningComponentBundle',
  'LightningMessageChannel',
  'ListView',
  'NamedCredential',
  'QuickAction',
  'RecordType',
  'RemoteSiteSetting',
  'StaticResource',
  'ValidationRule',
  'WebLink',
]);

/**
 * A custom field is cacheable, a standard one is not: the Metadata API listing leaves standard
 * fields out, and their SourceMember rows are not reliable either
 */
function isCacheableKey(key: string): boolean {
  const parsed = parseMetadataKey(key);
  if (!parsed) {
    return false;
  }
  if (parsed.type === 'CustomField') {
    return /__c$/i.test(parsed.name) && !parsed.name.includes('__mdt.');
  }
  return CACHEABLE_TYPES.has(parsed.type);
}

/** Validation calls run at a time: the org is not a git provider, no adaptive ladder here */
const VALIDATION_BATCH_SIZE = 5;

/** Names per SourceMember query, and encoded characters of names: the query goes out as a GET URL */
const SOURCE_MEMBER_CHUNK_SIZE = 200;
const SOURCE_MEMBER_CHUNK_URL_LENGTH = 6000;

/** The item as tracking saw it when it was never modified since the tracking began */
const NO_SOURCE_MEMBER = 'none';

interface BackpromoteRetrieveCacheItem {
  /**
   * What the org said about the item when it was cached: `<RevisionCounter>:<LastModifiedDate>` or
   * `none` from SourceMember in a source-tracked org, the lastModifiedDate of the Metadata API
   * listing otherwise. Null for an item the listing did not know.
   */
  validator: string | null;
  /** The retrieve brought nothing back: served as absent from the org while the validator holds */
  missing?: true;
  /** Cached files, relative to the cache force-app folder */
  files: string[];
  cachedAt: string;
}

interface BackpromoteRetrieveCacheIndex {
  version: 1;
  items: Record<string, BackpromoteRetrieveCacheItem>;
}

export interface BackpromoteSourceMemberRow {
  MemberName: string;
  RevisionCounter: number | string | null;
  LastModifiedDate: string | null;
  IsNameObsolete?: boolean;
}

/** The org and CLI calls of the retrieve, replaced by fakes in the unit tests */
export interface BackpromoteRetrieveRunners {
  /** SourceMember rows of the given names of a type (Tooling API, source-tracked orgs) */
  readSourceMembers: (type: string, names: string[]) => Promise<BackpromoteSourceMemberRow[]>;
  /** lastModifiedDate by fullName of a type (Metadata API), null when the type cannot be listed */
  listMetadataDates: (type: string) => Promise<Record<string, string> | null>;
  /** JSON result of `sf project retrieve start`, run with cwd set to the blank project */
  retrieve: (command: string, cwd: string, commandThis: any) => Promise<any>;
  /** Creates <runDir>/sfdx-hardis-blank-project and returns its path */
  createBlankProject: (runDir: string) => Promise<string>;
}

/** The .forceignore of the standard `sf project generate` template */
const RETRIEVE_PROJECT_FORCEIGNORE = `# List files or directories below to ignore them when running force:source:push, force:source:pull, and force:source:status
# More information: https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_exclude_source.htm
#

package.xml

# LWC configuration files
**/jsconfig.json
**/.eslintrc.json

# LWC Jest
**/__tests__/**

node_modules/
`;

/**
 * Creates <runDir>/sfdx-hardis-blank-project with the two files `sf project retrieve start` reads:
 * the sfdx-project.json and the .forceignore of the standard template. Written directly rather than
 * with `sf project generate`, which starts a Salesforce CLI process of its own (10 seconds or more on
 * Windows) on every retrieve that the cache cannot serve. The source API version is the one of the
 * retrieve manifest.
 */
export async function createRetrieveProject(runDir: string, apiVersion: string = getApiVersion()): Promise<string> {
  const projectDir = path.join(runDir, 'sfdx-hardis-blank-project');
  await fs.ensureDir(path.join(projectDir, 'force-app'));
  const project = {
    packageDirectories: [{ path: 'force-app', default: true }],
    name: 'sfdx-hardis-blank-project',
    namespace: '',
    sfdcLoginUrl: 'https://login.salesforce.com',
    sourceApiVersion: apiVersion,
  };
  await fs.writeFile(path.join(projectDir, 'sfdx-project.json'), JSON.stringify(project, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(projectDir, '.forceignore'), RETRIEVE_PROJECT_FORCEIGNORE, 'utf8');
  return projectDir;
}

function soqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function connectionRetrieveRunners(conn: Connection | undefined): BackpromoteRetrieveRunners {
  return {
    readSourceMembers: async (type, names) => {
      if (!conn) {
        throw new SfError('No connection to read SourceMember');
      }
      const soql =
        'SELECT MemberType, MemberName, RevisionCounter, LastModifiedDate, IsNameObsolete FROM SourceMember' +
        ` WHERE MemberType = ${soqlString(type)} AND MemberName IN (${names.map(soqlString).join(', ')})`;
      return (await soqlQueryTooling(soql, conn))?.records || [];
    },
    listMetadataDates: async (type) => {
      if (!conn) {
        throw new SfError('No connection to list metadata');
      }
      const listed = await conn.metadata.list([{ type }], getApiVersion(conn));
      const components: any[] = Array.isArray(listed) ? listed : listed ? [listed] : [];
      const dates: Record<string, string> = {};
      for (const component of components) {
        const fullName = String(component?.fullName || '');
        const lastModifiedDate = component?.lastModifiedDate;
        if (fullName === '' || typeof lastModifiedDate !== 'string' || lastModifiedDate === '') {
          return null;
        }
        dates[fullName] = lastModifiedDate;
      }
      return dates;
    },
    retrieve: (command, cwd, commandThis) => execSfdxJson(command, commandThis, { fail: false, output: false, cwd }),
    createBlankProject: (runDir) => createRetrieveProject(runDir),
  };
}

/** Chunks of at most SOURCE_MEMBER_CHUNK_SIZE names and SOURCE_MEMBER_CHUNK_URL_LENGTH encoded characters */
function chunkNames(names: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const name of names) {
    const encoded = encodeURIComponent(soqlString(name)).length + 3;
    if (current.length > 0 && (current.length >= SOURCE_MEMBER_CHUNK_SIZE || length + encoded > SOURCE_MEMBER_CHUNK_URL_LENGTH)) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(name);
    length += encoded;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

async function inBatches<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = [];
  for (let start = 0; start < tasks.length; start += size) {
    results.push(...(await Promise.all(tasks.slice(start, start + size).map((task) => task()))));
  }
  return results;
}

/**
 * Current validator of every wanted key. A key absent from the map cannot be validated (a type the
 * cache does not serve, a failed call, a name the listing does not return) and is retrieved; a
 * string is compared with the cached one.
 */
async function readCurrentValidators(options: {
  wanted: string[];
  tracksSource: boolean;
  runners: BackpromoteRetrieveRunners;
}): Promise<Map<string, string | null>> {
  const namesByType = new Map<string, string[]>();
  for (const key of options.wanted) {
    const parsed = parseMetadataKey(key);
    if (parsed && isCacheableKey(key)) {
      namesByType.set(parsed.type, [...(namesByType.get(parsed.type) || []), parsed.name]);
    }
  }
  const validators = new Map<string, string | null>();
  if (options.tracksSource) {
    // One query per type and chunk of names; a type whose query fails is left out (retrieved)
    const tasks: (() => Promise<void>)[] = [];
    const failedTypes = new Set<string>();
    const rowsByType = new Map<string, Map<string, string>>();
    for (const [type, names] of namesByType) {
      rowsByType.set(type, new Map());
      for (const chunk of chunkNames(names)) {
        tasks.push(async () => {
          try {
            for (const row of await options.runners.readSourceMembers(type, chunk)) {
              rowsByType.get(type)!.set(String(row.MemberName), `${row.RevisionCounter}:${row.LastModifiedDate}`);
            }
          } catch {
            failedTypes.add(type);
          }
        });
      }
    }
    await inBatches(tasks, VALIDATION_BATCH_SIZE);
    for (const [type, names] of namesByType) {
      if (failedTypes.has(type)) {
        continue;
      }
      for (const name of names) {
        // No row: never modified since the tracking began, a stable fact until a row appears
        validators.set(toMetadataKey(type, name), rowsByType.get(type)!.get(name) || NO_SOURCE_MEMBER);
      }
    }
    return validators;
  }
  const types = [...namesByType.keys()];
  const listings = await inBatches(
    types.map((type) => async () => {
      try {
        return await options.runners.listMetadataDates(type);
      } catch {
        return null;
      }
    }),
    VALIDATION_BATCH_SIZE
  );
  types.forEach((type, position) => {
    const dates = listings[position];
    if (!dates) {
      return;
    }
    for (const name of namesByType.get(type) || []) {
      // A name the listing does not return proves nothing (the listing is not complete for every
      // type): the item is left out of the validators, so it is retrieved
      if (Object.prototype.hasOwnProperty.call(dates, name)) {
        validators.set(toMetadataKey(type, name), dates[name]);
      }
    }
  });
  return validators;
}

async function readRetrieveCacheIndex(indexFile: string): Promise<BackpromoteRetrieveCacheIndex> {
  try {
    const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
    if (index?.version === 1 && index.items && typeof index.items === 'object') {
      return index;
    }
  } catch {
    // No cache yet, or an unreadable one: the retrieve rebuilds it
  }
  return { version: 1, items: {} };
}

/** Written next to the index then moved over it, so a run killed halfway never leaves half a file */
async function writeRetrieveCacheIndex(indexFile: string, index: BackpromoteRetrieveCacheIndex): Promise<void> {
  const temp = `${indexFile}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.ensureDir(path.dirname(indexFile));
  await fs.writeFile(temp, JSON.stringify(index, null, 2), 'utf8');
  await fs.move(temp, indexFile, { overwrite: true });
}

interface BackpromoteRetrieveCacheLookup {
  indexFile: string;
  cacheDir: string;
  index: BackpromoteRetrieveCacheIndex;
  tracksSource: boolean;
  /** Current validator of each wanted key that can be validated */
  validators: Map<string, string | null>;
  /** Wanted keys served from the cache (files, or a recorded absence) */
  fresh: string[];
  /** Wanted keys cached as absent from the org under the tracking value they still have */
  missing: string[];
  /** Wanted keys that need the retrieve */
  stale: string[];
}

/**
 * Sort the wanted keys between fresh (cached under the validator the org gives now, files still
 * there), missing (unknown to the listing) and stale (everything else, including what cannot be
 * validated). The validators are read before the retrieve on purpose: a change made in the org
 * between the two gets a value the cache does not hold, so the next run retrieves again.
 */
async function lookupRetrieveCache(options: {
  cacheDir: string;
  wanted: string[];
  tracksSource: boolean;
  runners: BackpromoteRetrieveRunners;
}): Promise<BackpromoteRetrieveCacheLookup> {
  const indexFile = path.join(options.cacheDir, 'index.json');
  const index = await readRetrieveCacheIndex(indexFile);
  const validators = await readCurrentValidators({ wanted: options.wanted, tracksSource: options.tracksSource, runners: options.runners });
  const lookup: BackpromoteRetrieveCacheLookup = { indexFile, cacheDir: options.cacheDir, index, tracksSource: options.tracksSource, validators, fresh: [], missing: [], stale: [] };
  for (const key of options.wanted) {
    if (!validators.has(key)) {
      lookup.stale.push(key);
      continue;
    }
    const current = validators.get(key);
    const cached = index.items[key];
    if (cached?.missing === true && cached.validator === current && current !== null) {
      // Absent from the org at the last retrieve, and its tracking row did not change since
      lookup.missing.push(key);
      continue;
    }
    const filesStillThere = cached?.files?.every((file) => fs.existsSync(path.join(options.cacheDir, 'force-app', file))) === true;
    if (cached && cached.validator === current && filesStillThere) {
      lookup.fresh.push(key);
    } else {
      lookup.stale.push(key);
    }
  }
  return lookup;
}

/** The retrieved files of each wanted key, relative to the force-app of the blank project */
function groupRetrievedFilesByKey(retrieved: any, blankProject: string, orgDir: string): Map<string, string[]> {
  const filesByKey = new Map<string, string[]>();
  for (const entry of Array.isArray(retrieved?.result?.files) ? retrieved.result.files : []) {
    const filePath = String(entry?.filePath || '');
    if (filePath === '' || !entry?.type || !entry?.fullName) {
      continue;
    }
    const absolute = path.isAbsolute(filePath) ? filePath : path.join(blankProject, filePath);
    const relative = normalizeRepoPath(path.relative(orgDir, absolute));
    if (relative.startsWith('../') || relative === '' || !fs.existsSync(absolute)) {
      continue;
    }
    const key = toMetadataKey(String(entry.type), String(entry.fullName));
    const files = filesByKey.get(key) || [];
    if (!files.includes(relative)) {
      files.push(relative);
    }
    filesByKey.set(key, files);
  }
  return filesByKey;
}

/**
 * Record what the retrieve brought back under the validators read before it. In a source-tracked
 * org, a key the retrieve did not bring back is recorded missing: SourceMember has no verdict on
 * existence, and the absence holds while the validator does. With the Metadata API, a key listed
 * but not retrieved is forgotten so the next run retrieves it again, the safe direction. Keys that
 * cannot be validated are never written.
 */
async function updateRetrieveCacheAfterRetrieve(lookup: BackpromoteRetrieveCacheLookup, retrieved: any, blankProject: string, orgDir: string): Promise<void> {
  const filesByKey = groupRetrievedFilesByKey(retrieved, blankProject, orgDir);
  const cachedAt = new Date().toISOString();
  for (const [key, validator] of lookup.validators) {
    const files = filesByKey.get(key) || [];
    if (files.length === 0) {
      // Only source tracking can vouch for an absence: a new row appears when the item is created
      if (lookup.tracksSource && validator !== null) {
        lookup.index.items[key] = { validator, missing: true, files: [], cachedAt };
      } else {
        delete lookup.index.items[key];
      }
      continue;
    }
    if (validator === null) {
      delete lookup.index.items[key];
      continue;
    }
    for (const file of files) {
      await fs.copy(path.join(orgDir, file), path.join(lookup.cacheDir, 'force-app', file), { overwrite: true });
    }
    lookup.index.items[key] = { validator, files, cachedAt };
  }
  await writeRetrieveCacheIndex(lookup.indexFile, lookup.index);
}

/** Serve the run from the cache: the fresh files are copied into the run and the missing items recorded */
async function serveRunFromRetrieveCache(lookup: BackpromoteRetrieveCacheLookup, orgDir: string): Promise<void> {
  for (const key of lookup.fresh) {
    for (const file of lookup.index.items[key].files) {
      await fs.copy(path.join(lookup.cacheDir, 'force-app', file), path.join(orgDir, file), { overwrite: true });
    }
  }
  const cachedAt = new Date().toISOString();
  for (const key of lookup.missing) {
    lookup.index.items[key] = { validator: null, missing: true, files: [], cachedAt };
  }
  await writeRetrieveCacheIndex(lookup.indexFile, lookup.index);
}

/**
 * Retrieve the ticked items from the sandbox into the run cache, once per run: a second call for the
 * same run id finds the folder and reads it again. The retrieve never touches the project sources:
 * `sf project retrieve start --output-dir` refuses a folder outside the project (and drops what
 * .forceignore excludes), so the items are retrieved in source format into a blank sfdx project
 * created in the temporary folder. A retrieve that fails stops the run: with no sandbox version to
 * compare, every file would look absent from the org and be deployed over it without a question.
 *
 * Across runs, the files of each org are kept in a cache validated with what the org says about
 * each item: its SourceMember row in a source-tracked org, its Metadata API lastModifiedDate
 * otherwise. When every wanted item is unchanged since its retrieve, the run costs a few API calls
 * instead of a retrieve. Without a connection the cache is not used; `force` bypasses it like it
 * bypasses the run marker.
 */
export async function retrieveItemsForComparison(options: {
  username: string;
  keys: string[];
  orgId: string;
  runId: string;
  commandThis: any;
  force?: boolean;
  /** Validates the cache against the org; without it the cache is neither read nor written */
  conn?: Connection;
  /** True for a source-tracked org: the cache is validated with SourceMember */
  tracksSource?: boolean;
  /** Unit tests only: fake calls and a throwaway cache location */
  runners?: Partial<BackpromoteRetrieveRunners>;
  cacheRoot?: string;
}): Promise<BackpromoteRetrieveResult> {
  const runners: BackpromoteRetrieveRunners = { ...connectionRetrieveRunners(options.conn), ...(options.runners || {}) };
  const tracksSource = options.tracksSource === true;
  const canValidate = options.conn != null || (tracksSource ? options.runners?.readSourceMembers != null : options.runners?.listMetadataDates != null);
  const cacheRoot = options.cacheRoot || backpromoteCacheRoot();
  const runDir = path.join(cacheRoot, 'retrieve', options.orgId || 'org', options.runId);
  const blankProject = path.join(runDir, 'sfdx-hardis-blank-project');
  const orgDir = path.join(blankProject, 'force-app');
  const doneMarker = path.join(runDir, 'retrieved.json');
  const wanted = [...options.keys].sort();
  let reuse = false;
  if (!options.force && fs.existsSync(doneMarker)) {
    try {
      // Unticking an item in the panel must not cost a new retrieve: a superset is as good
      const done = JSON.parse(await fs.readFile(doneMarker, 'utf8'));
      reuse = Array.isArray(done?.keys) && wanted.every((key) => done.keys.includes(key));
    } catch {
      reuse = false;
    }
  }
  if (!reuse && wanted.length > 0) {
    await fs.remove(blankProject);
    await fs.remove(doneMarker);
    await fs.ensureDir(runDir);
    let lookup: BackpromoteRetrieveCacheLookup | null = null;
    // SFDX_HARDIS_BACKPROMOTE_RETRIEVE_CACHE=false retrieves every time, as force does
    const cacheDisabled = String(getEnvVar('SFDX_HARDIS_BACKPROMOTE_RETRIEVE_CACHE') || '').toLowerCase() === 'false';
    if (!options.force && !cacheDisabled && canValidate) {
      try {
        const cacheDir = path.join(cacheRoot, 'retrieve-cache', options.orgId || 'org');
        lookup = await lookupRetrieveCache({ cacheDir, wanted, tracksSource, runners });
      } catch (e) {
        // An unusable cache only costs the retrieve it would have saved
        uxLog('other', options.commandThis, c.grey(`[backpromote] retrieve cache lookup failed: ${(e as Error).message}`));
        lookup = null;
      }
    }
    if (lookup && lookup.stale.length === 0) {
      // Nothing to retrieve: no need for the sfdx project either, the comparison only reads force-app
      await fs.ensureDir(orgDir);
      try {
        await serveRunFromRetrieveCache(lookup, orgDir);
      } catch (e) {
        await fs.remove(blankProject);
        uxLog('other', options.commandThis, c.grey(`[backpromote] retrieve cache copy failed: ${(e as Error).message}`));
        lookup = null;
      }
      if (lookup && lookup.fresh.length > 0) {
        uxLog('log', options.commandThis, c.grey(t('backpromoteRetrieveCacheReused', { count: lookup.fresh.length })));
      }
    }
    if (!lookup || lookup.stale.length > 0) {
      await runners.createBlankProject(runDir);
      const manifest = path.join(runDir, 'retrieve-package.xml');
      await writePackageXmlFile(manifest, metadataKeysToPackageContent(wanted));
      const retrieveCommand = `sf project retrieve start --manifest "${manifest}" -o ${options.username} --wait ${getEnvVar('SFDX_RETRIEVE_WAIT_MINUTES') || '60'} --json`;
      const retrieved = await runners.retrieve(retrieveCommand, blankProject, options.commandThis);
      const retrievedFiles = (await listFilesRecursively(orgDir)).filter((file) => path.basename(file) !== 'package.xml');
      if (retrieved?.status !== 0 && retrievedFiles.length === 0) {
        throw new SfError(t('backpromoteRetrieveFailed', { message: retrieved?.message || retrieved?.name || JSON.stringify(retrieved || {}).substring(0, 500) }));
      }
      if (retrieved?.status !== 0) {
        uxLog('warning', options.commandThis, c.yellow(t('backpromoteRetrieveWarning', { message: retrieved?.message || '' })));
      }
      if (lookup && retrieved?.status === 0) {
        try {
          await updateRetrieveCacheAfterRetrieve(lookup, retrieved, blankProject, orgDir);
        } catch (e) {
          uxLog('other', options.commandThis, c.grey(`[backpromote] retrieve cache update failed: ${(e as Error).message}`));
        }
      }
    }
    await fs.writeFile(doneMarker, JSON.stringify({ keys: wanted, date: new Date().toISOString() }), 'utf8');
  }
  const filesByTail = new Map<string, string>();
  const stemCandidates = new Map<string, string[]>();
  for (const file of await listFilesRecursively(orgDir)) {
    const relative = normalizeRepoPath(path.relative(orgDir, file));
    if (relative === 'package.xml') {
      continue;
    }
    const tail = sourcePathTail(relative);
    filesByTail.set(tail, file);
    if (tail.endsWith('-meta.xml')) {
      continue;
    }
    const stem = pathStem(tail);
    stemCandidates.set(stem, [...(stemCandidates.get(stem) || []), file]);
  }
  const filesByStem = new Map<string, string>();
  for (const [stem, candidates] of stemCandidates) {
    if (candidates.length === 1) {
      filesByStem.set(stem, candidates[0]);
    }
  }
  return { orgDir, filesByTail, filesByStem };
}

/**
 * Compare the files of the ticked items with the sandbox: the org version (retrieved), the parent
 * head version and, when the sandbox already received a backpromote, the version at the start of
 * the window are copied in the cache so that the VS Code merge editor and the coding agent can read
 * them. Files with no difference, or absent from the sandbox, need no decision.
 */
export async function compareItemsWithOrg(options: {
  itemFiles: Map<string, string[]>;
  pullRequestsOfFile: (file: string) => number[];
  retrieve: BackpromoteRetrieveResult;
  parentRef: string;
  baseRef: string | null;
  pendingInOrg: Set<string>;
  orgId: string;
  runId: string;
  excludedItems: Set<string>;
}): Promise<BackpromotePlanComparison[]> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const packageDirectories = await readPackageDirectories(gitRoot);
  const runDir = path.join(backpromoteCacheRoot(), 'retrieve', options.orgId || 'org', options.runId);
  const comparison: BackpromotePlanComparison[] = [];
  for (const [item, files] of options.itemFiles) {
    if (options.excludedItems.has(item)) {
      continue;
    }
    for (const file of files) {
      const entry: BackpromotePlanComparison = {
        file,
        item,
        status: 'notCompared',
        versions: { base: null, sandbox: null, parentHead: null },
        diffLines: 0,
        pullRequests: options.pullRequestsOfFile(file),
        decision: null,
        prepared: false,
        markersRemaining: 0,
        conflictPending: false,
        threeWay: false,
      };
      comparison.push(entry);
      if (isBinaryMetadataFile(file)) {
        continue;
      }
      const tail = sourcePathTail(file, packageDirectories);
      const orgFile = options.retrieve.filesByTail.get(tail) || options.retrieve.filesByStem.get(pathStem(tail)) || null;
      const parentContent = fileAtRef(options.parentRef, file);
      if (parentContent === null) {
        continue;
      }
      const gitCopy = path.join(runDir, 'git', tail);
      await fs.ensureDir(path.dirname(gitCopy));
      await fs.writeFile(gitCopy, parentContent, 'utf8');
      entry.versions.parentHead = gitCopy;
      if (!orgFile) {
        entry.status = 'missingInOrg';
        continue;
      }
      entry.versions.sandbox = orgFile;
      const orgContent = await fs.readFile(orgFile, 'utf8');
      if (sameFileContent(orgContent, parentContent)) {
        entry.status = 'same';
        continue;
      }
      entry.status = options.pendingInOrg.has(file) ? 'pendingInOrg' : 'different';
      entry.diffLines = countDifferingLines(orgContent, parentContent);
      const baseContent = options.baseRef ? fileAtRef(options.baseRef, file) : null;
      if (baseContent !== null) {
        const baseCopy = path.join(runDir, 'base', tail);
        await fs.ensureDir(path.dirname(baseCopy));
        await fs.writeFile(baseCopy, baseContent, 'utf8');
        entry.versions.base = baseCopy;
        entry.threeWay = true;
      }
    }
  }
  return comparison.sort((a, b) => a.item.localeCompare(b.item) || a.file.localeCompare(b.file));
}

// ---- Deployments ----

export interface BackpromoteDeployOutcome {
  success: boolean;
  reportPath: string | null;
  /** The components the org refused, read from the --json output of the deployment */
  errors: BackpromoteDeployError[];
}

export interface BackpromoteDeployError {
  /** Type:Name of the component, empty for an error that names no component (code coverage...) */
  key: string;
  type: string;
  name: string;
  file: string | null;
  line: number | null;
  problem: string;
  /** The sfdx-hardis deployment tip matching the error, as in the CI/CD deployment comments */
  tip: { label: string; message: string; docUrl: string | null } | null;
  /** The answer of the AI deployment assistant, when it is configured */
  aiTip: string | null;
}

/**
 * The components a failed `sf project deploy start --json` refused: result.details.componentFailures
 * (one object instead of an array when there is a single failure), errors only, not warnings.
 */
export function parseDeployComponentFailures(output: string): BackpromoteDeployError[] {
  const json: any = findJsonInString(output || '');
  const details = json?.result?.details || json?.data?.details || null;
  const failures = details?.componentFailures ? [].concat(details.componentFailures) : [];
  const errors: BackpromoteDeployError[] = [];
  for (const failure of failures as any[]) {
    if (!failure || failure.success === true || failure.success === 'true' || (failure.problemType && failure.problemType !== 'Error')) {
      continue;
    }
    const type = String(failure.componentType || '');
    const name = String(failure.fullName || '');
    const line = Number(failure.lineNumber);
    errors.push({
      key: type ? `${type}:${name}` : name,
      type,
      name,
      file: failure.fileName ? normalizeRepoPath(String(failure.fileName)) : null,
      line: Number.isFinite(line) && line > 0 ? line : null,
      problem: String(failure.problem || '').trim(),
      tip: null,
      aiTip: null,
    });
  }
  return errors;
}

/**
 * The refused components with the tips analyzeDeployErrorLogs found for them (the same tips as the
 * deployment comments of smart deploy), plus the errors that name no component (code coverage, an
 * unknown error). The internal "could not parse" fallback is dropped when components were read.
 */
export function attachDeployTips(errors: BackpromoteDeployError[], errorsAndTips: any[]): BackpromoteDeployError[] {
  const tipOf = (entry: any) =>
    entry?.tip
      ? { label: String(entry.tip.label || ''), message: stripAnsiText(String(entry.tip.message || entry.tip.messageConsole || '')).trim(), docUrl: entry.tip.docUrl ? String(entry.tip.docUrl) : null }
      : null;
  const aiOf = (entry: any) => (entry?.tipFromAi?.promptResponse ? String(entry.tipFromAi.promptResponse).trim() : null);
  const used = new Set<any>();
  const withTips = errors.map((error) => {
    const entry = (errorsAndTips || []).find(
      (candidate) => !used.has(candidate) && candidate?.error?.fullName === error.name && (candidate?.error?.componentType || '') === error.type && String(candidate?.error?.problem || '').trim() === error.problem,
    );
    if (!entry) {
      return error;
    }
    used.add(entry);
    return { ...error, tip: tipOf(entry), aiTip: aiOf(entry) };
  });
  for (const entry of errorsAndTips || []) {
    if (used.has(entry) || entry?.error?.fullName) {
      continue;
    }
    if (errors.length > 0 && entry?.tip?.label === 'SfdxHardisInternalError') {
      continue;
    }
    const problem = stripAnsiText(String(entry?.error?.message || '')).trim();
    if (!problem) {
      continue;
    }
    withTips.push({ key: '', type: '', name: '', file: null, line: null, problem, tip: tipOf(entry), aiTip: aiOf(entry) });
  }
  return withTips;
}

function stripAnsiText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

async function runDeploy(command: string, label: string, commandThis: any, debugMode: boolean): Promise<{ success: boolean; output: string; errorsAndTips: any[] }> {
  try {
    const result = await execCommand(command, commandThis, { fail: true, output: true, debug: debugMode });
    return { success: true, output: result.stdout || '', errorsAndTips: [] };
  } catch (e) {
    const output = ((e as any).stdout || '') + ((e as any).stderr || '');
    const { errLog, errorsAndTips } = await analyzeDeployErrorLogs(output, true, { label });
    uxLog('error', commandThis, c.red(t('backpromoteDeployFailed')));
    uxLog('error', commandThis, c.red('\n' + errLog));
    return { success: false, output, errorsAndTips: errorsAndTips || [] };
  }
}

async function writeDeployReport(options: { success: boolean; output: string; username: string; itemCount: number; packageXml: string; destructiveXml: string | null; commandThis: any }): Promise<string> {
  const reportPath = await generateReportPath('backpromote-deploy', '', { withDate: true, withBranchName: true, fileExtension: 'log' });
  const content = [
    'Backpromote Deployment Report',
    `Date: ${new Date().toISOString()}`,
    `Target org: ${options.username}`,
    `Status: ${options.success ? 'SUCCESS' : 'FAILED'}`,
    `Items: ${options.itemCount}`,
    'Test level: NoTestRun',
    `Package XML: ${options.packageXml}`,
    options.destructiveXml ? `Destructive changes: ${options.destructiveXml}` : '',
    '',
    '--- Deployment output ---',
    options.output,
  ].filter(Boolean).join('\n');
  await fs.writeFile(reportPath, content, 'utf-8');
  uxLog('log', options.commandThis, c.grey(t('backpromoteDeployReportSaved', { reportPath })));
  WebSocketClient.sendReportFileMessage(reportPath, t('backpromoteDeployReportLabel'), 'report');
  return reportPath;
}

/**
 * Deploy the ticked items from the checkout (the backpromote branch), NoTestRun: Apex test classes
 * travel like any other metadata and never run in a sandbox. A source-tracked org gets
 * --ignore-conflicts: the comparison step already asked about the files that differ.
 */
export async function deployBackpromotePackage(options: {
  keys: string[];
  username: string;
  workDir: string;
  commandThis: any;
  debugMode: boolean;
}): Promise<BackpromoteDeployOutcome> {
  if (options.keys.length === 0) {
    return { success: true, reportPath: null, errors: [] };
  }
  const packageXml = path.join(options.workDir, 'package', 'package.xml');
  await writePackageXmlFile(packageXml, metadataKeysToPackageContent(options.keys));
  uxLog('action', options.commandThis, c.cyan(t('backpromoteDeploying', { count: options.keys.length })));
  const command =
    'sf project deploy start' +
    ` --manifest "${packageXml}"` +
    ' --ignore-warnings --ignore-conflicts --test-level NoTestRun' +
    ` -o ${options.username}` +
    ` --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}` +
    ' --json';
  const result = await runDeploy(command, 'backpromote', options.commandThis, options.debugMode);
  const reportPath = await writeDeployReport({ ...result, username: options.username, itemCount: options.keys.length, packageXml, destructiveXml: null, commandThis: options.commandThis });
  if (result.success) {
    uxLog('action', options.commandThis, c.green(t('backpromoteDeploySuccess', { count: options.keys.length })));
  }
  return { success: result.success, reportPath, errors: result.success ? [] : attachDeployTips(parseDeployComponentFailures(result.output), result.errorsAndTips) };
}

/** Delete the ticked deletions in their own deployment, after the metadata went in */
export async function deployBackpromoteDeletions(options: {
  keys: string[];
  username: string;
  workDir: string;
  commandThis: any;
  debugMode: boolean;
}): Promise<BackpromoteDeployOutcome> {
  if (options.keys.length === 0) {
    return { success: true, reportPath: null, errors: [] };
  }
  const packageXml = path.join(options.workDir, 'destructive', 'package.xml');
  const destructiveXml = path.join(options.workDir, 'destructive', 'destructiveChanges.xml');
  await writePackageXmlFile(packageXml, {});
  await writePackageXmlFile(destructiveXml, metadataKeysToPackageContent(options.keys));
  uxLog('action', options.commandThis, c.cyan(t('backpromoteDeleting', { count: options.keys.length })));
  const command =
    'sf project deploy start' +
    ` --manifest "${packageXml}"` +
    ` --post-destructive-changes "${destructiveXml}"` +
    ' --ignore-warnings --ignore-conflicts --test-level NoTestRun' +
    ` -o ${options.username}` +
    ` --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}` +
    ' --json';
  const result = await runDeploy(command, 'backpromote-destructive', options.commandThis, options.debugMode);
  const reportPath = await writeDeployReport({ ...result, username: options.username, itemCount: options.keys.length, packageXml, destructiveXml, commandThis: options.commandThis });
  if (result.success) {
    uxLog('action', options.commandThis, c.green(t('backpromoteDeleteSuccess', { count: options.keys.length })));
  }
  return { success: result.success, reportPath, errors: result.success ? [] : attachDeployTips(parseDeployComponentFailures(result.output), result.errorsAndTips) };
}
