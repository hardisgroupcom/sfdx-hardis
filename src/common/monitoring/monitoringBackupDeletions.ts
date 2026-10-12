import c from 'chalk';
import * as path from 'path';
import { MetadataResolver } from '@salesforce/source-deploy-retrieve';
import fs from '../utils/fsUtils.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { MetadataUtils } from '../metadata-utils/index.js';

// A retrieve never deletes a local file: after the retrieves, the backup deletes the files of the
// components that are gone from the org. Only the files that no retrieve of the run wrote are looked
// at, so a file the org just returned can not be deleted, and the org is asked to confirm that each
// component is gone before its files are deleted.

// The org lists one language of a value set translation and not the others, and a retrieve does not
// return the ones it does not list: their files are never deleted (seen on a real org: Metier-fr
// listed, Metier-en_US not listed and readable)
const TYPES_NOT_LISTED_RELIABLY = new Set(['GlobalValueSetTranslation', 'StandardValueSetTranslation']);

// Components per readMetadata call: the limit of the Metadata API
const COMPONENTS_PER_READ = 10;

export interface ResolvedBackupFile {
  type: string;
  name: string;
  parent?: { type: string; name: string } | null;
}

export interface FileOfDeletedComponent {
  file: string;
  type: string;
  name: string;
}

export type PackageXmlContent = Record<string, any> | null | undefined;

// conn.metadata.read: the components the org returns have a fullName
export type ReadMetadata = (type: string, fullNames: string[]) => Promise<any>;

export interface FindFilesOfDeletedComponentsOptions {
  packageDirs: string[];
  retrieved: RetrievedFilesCollector;
  // manifest/package-all-org-items.xml of this backup, as parsePackageXmlFile returns it
  currentManifest: PackageXmlContent;
  // The same file as the previous backup left it, null at the first backup
  previousManifest: PackageXmlContent;
  // Replaceable in tests
  resolve?: (filePath: string) => ResolvedBackupFile | null;
}

export interface ApplyBackupDeletionsOptions extends FindFilesOfDeletedComponentsOptions {
  // Set when the run can not tell what is gone from the org: nothing is deleted
  skipReason?: BackupDeletionsSkipReason | null;
  readMetadata: ReadMetadata;
  commandThis: any;
}

export interface BackupDeletionsSkipReason {
  kind: 'disabled' | 'partialRetrieve' | 'noFileList';
  detail?: string;
}

export interface BackupDeletionsResult {
  deletedFiles: string[];
  // Files kept because the org still returns their component, or could not be asked
  notConfirmedFiles: string[];
  skipped: boolean;
}

// The files and the components written by the retrieves of a backup
export class RetrievedFilesCollector {
  public files = new Set<string>();
  public components = new Set<string>();
  public types = new Set<string>();
  // A retrieve can return a folder for a component made of many files
  public dirs: string[] = [];
  // False when a retrieve did not return its list of files
  public complete = true;

  // result of sf project retrieve start --json
  public add(retrieveResult: any): void {
    const files = retrieveResult?.result?.files;
    if (!Array.isArray(files)) {
      this.complete = false;
      return;
    }
    for (const file of files) {
      // A component that failed has no file: it was not retrieved
      if (!file?.filePath || file.state === 'Failed') {
        continue;
      }
      const filePath = normalizeFilePath(file.filePath);
      this.files.add(filePath);
      if (fs.statSync(filePath, { throwIfNoEntry: false })?.isDirectory()) {
        this.dirs.push(filePath + path.sep);
      }
      if (file.type && file.fullName) {
        this.components.add(componentKey(file.type, file.fullName));
        this.types.add(file.type);
      }
    }
  }

  public hasFile(filePath: string): boolean {
    const normalized = normalizeFilePath(filePath);
    return this.files.has(normalized) || this.dirs.some((dir) => normalized.startsWith(dir));
  }
}

// ChangeType of a file in the report and the notification of the backup: A for a new file, D for a
// deleted one. A modified file keeps the index status of git, as before.
export function backupChangeType(diffFile: { index?: string; working_dir?: string }): string {
  if (diffFile.index === '?') {
    return 'A';
  }
  if (diffFile.working_dir === 'D' || diffFile.index === 'D') {
    return 'D';
  }
  return diffFile.index || '';
}

export function isBackupDeletionsDisabled(config: any): boolean {
  return process.env?.MONITORING_BACKUP_SKIP_DELETIONS === 'true' || config?.monitoringBackupSkipDeletions === true;
}

// A retrieve refused by the org (LIMIT_EXCEEDED: Too many files in retrieve call) comes back with
// exit code 0 and status 0: only its result says that nothing was retrieved
export function retrieveFailureMessage(retrieveResult: any): string | null {
  const result = retrieveResult?.result;
  if (result?.success === false || result?.status === 'Failed') {
    return String(result.errorMessage || result.errorStatusCode || result.status);
  }
  return null;
}

// The message sf returns in its --json output, when the failed command wrote one
export function retrieveJsonErrorMessage(error: any): string | null {
  try {
    const parsed = JSON.parse(error?.stdout || '');
    return typeof parsed?.message === 'string' && parsed.message.trim() !== '' ? parsed.message.trim() : null;
  } catch {
    return null;
  }
}

export async function applyBackupDeletions(options: ApplyBackupDeletionsOptions): Promise<BackupDeletionsResult> {
  const { commandThis, skipReason } = options;
  if (skipReason?.kind === 'disabled') {
    uxLog('log', commandThis, c.grey(t('backupDeletionsDisabled')));
    return { deletedFiles: [], notConfirmedFiles: [], skipped: true };
  }
  if (skipReason?.kind === 'partialRetrieve') {
    uxLog('warning', commandThis, c.yellow(t('backupDeletionsSkippedPartialRetrieve', { reason: skipReason.detail || '' })));
    return { deletedFiles: [], notConfirmedFiles: [], skipped: true };
  }
  if (skipReason?.kind === 'noFileList') {
    uxLog('warning', commandThis, c.yellow(t('backupDeletionsSkippedNoFileList')));
    return { deletedFiles: [], notConfirmedFiles: [], skipped: true };
  }
  const found = await findFilesOfDeletedComponents(options);
  if (found.length === 0) {
    uxLog('log', commandThis, c.grey(t('backupNoFileOfDeletedComponents')));
    return { deletedFiles: [], notConfirmedFiles: [], skipped: false };
  }
  const componentsNb = new Set(found.map((item) => componentKey(item.type, item.name))).size;
  uxLog('action', commandThis, c.cyan(t('backupConfirmingDeletedComponents', { count: String(componentsNb) })));
  const gone = await confirmDeletedComponents(found, options.readMetadata);
  const filesToDelete = found.filter((item) => gone.has(componentKey(item.type, item.name))).map((item) => item.file);
  const notConfirmedFiles = found.filter((item) => !gone.has(componentKey(item.type, item.name))).map((item) => item.file);
  if (notConfirmedFiles.length > 0) {
    uxLog(
      'log',
      commandThis,
      c.grey(t('backupDeletionsNotConfirmed', { count: String(notConfirmedFiles.length) }) + '\n' + listForLog(notConfirmedFiles))
    );
  }
  if (filesToDelete.length === 0) {
    uxLog('log', commandThis, c.grey(t('backupNoFileOfDeletedComponents')));
    return { deletedFiles: [], notConfirmedFiles, skipped: false };
  }
  uxLog('action', commandThis, c.cyan(t('backupDeletingFilesOfDeletedComponents', { count: String(filesToDelete.length) })));
  for (const file of filesToDelete) {
    await fs.remove(file);
  }
  await removeEmptyParentDirs(filesToDelete, options.packageDirs);
  // Every deleted file is logged: the job log is where a deletion is checked
  uxLog('log', commandThis, c.grey(listForLog(filesToDelete)));
  return { deletedFiles: filesToDelete, notConfirmedFiles, skipped: false };
}

// A candidate is a file of a package directory that no retrieve of the run wrote. The first rule
// that matches decides, and a file that can not be proven deleted is kept. What comes out is still
// to be confirmed by the org (confirmDeletedComponents).
export async function findFilesOfDeletedComponents(options: FindFilesOfDeletedComponentsOptions): Promise<FileOfDeletedComponent[]> {
  // One resolver for the whole run. It ignores .forceignore: an ignored file is still a component
  const resolver = new MetadataResolver(undefined, undefined, false);
  const resolve = options.resolve ?? ((filePath: string) => MetadataUtils.resolveMetadataFromFile(filePath, resolver));
  const current = indexManifest(options.currentManifest);
  const previous = indexManifest(options.previousManifest);
  const { retrieved } = options;
  const found: FileOfDeletedComponent[] = [];
  for (const packageDir of options.packageDirs) {
    for (const file of await listFiles(packageDir)) {
      if (retrieved.hasFile(file)) {
        continue;
      }
      // 1. Not a metadata file
      const resolved = resolve(file);
      if (!resolved) {
        continue;
      }
      const key = componentKey(resolved.type, resolved.name);
      // 2. The org just returned the component: the file is one the retrieve does not write
      // (ignored by .forceignore, or left out of its list of files)
      if (retrieved.components.has(key)) {
        continue;
      }
      // 3. The component exists in the org: it is skipped by a filter of the backup
      if (current.members.has(key)) {
        continue;
      }
      // 4. A type whose listing misses components that exist
      if (TYPES_NOT_LISTED_RELIABLY.has(resolved.type)) {
        continue;
      }
      // 5. Listed by the previous backup and not by this one: removed since
      if (previous.members.has(key)) {
        found.push({ file, type: resolved.type, name: resolved.name });
        continue;
      }
      // 6. A child of a component that was not retrieved: a deleted custom field can not be told
      // from a standard field, which the org never lists
      if (resolved.parent && !retrieved.components.has(componentKey(resolved.parent.type, resolved.parent.name))) {
        continue;
      }
      // 7. A type that the listing of the org does not return by name
      if (!current.types.has(resolved.type)) {
        continue;
      }
      // 8. A type of which nothing was retrieved (skipped as a whole): the listing alone is not a
      // proof, it misses components that exist (reports of nested folders, translations)
      if (!retrieved.types.has(resolved.type)) {
        continue;
      }
      // 9. A stale file left by an older backup, of a type the org just returned without it
      found.push({ file, type: resolved.type, name: resolved.name });
    }
  }
  return found.sort((a, b) => (a.file > b.file ? 1 : -1));
}

// The listing of the org is not a proof (an incomplete list, a name it writes another way): the org
// is asked for each component, and only the ones it does not return are gone. A component the org
// can not be asked about (a type readMetadata refuses, an error) is not confirmed: its files stay.
export async function confirmDeletedComponents(found: FileOfDeletedComponent[], readMetadata: ReadMetadata): Promise<Set<string>> {
  const namesByType = new Map<string, Set<string>>();
  for (const item of found) {
    namesByType.set(item.type, (namesByType.get(item.type) ?? new Set<string>()).add(item.name));
  }
  const gone = new Set<string>();
  for (const [type, names] of namesByType) {
    const allNames = [...names];
    for (let i = 0; i < allNames.length; i += COMPONENTS_PER_READ) {
      const batch = allNames.slice(i, i + COMPONENTS_PER_READ);
      let answers = await readComponents(type, batch, readMetadata);
      if (answers === null && batch.length > 1) {
        // One component the org can not read fails the whole call: ask one by one
        answers = new Map<string, boolean>();
        for (const name of batch) {
          const single = await readComponents(type, [name], readMetadata);
          if (single !== null) {
            answers.set(name, single.get(name) === true);
          }
        }
      }
      for (const name of batch) {
        if (answers?.get(name) === false) {
          gone.add(componentKey(type, name));
        }
      }
    }
  }
  return gone;
}

// name -> the org returns it. null when the org could not answer.
async function readComponents(type: string, names: string[], readMetadata: ReadMetadata): Promise<Map<string, boolean> | null> {
  // A name is read as the file holds it and decoded: the API takes one or the other
  const asked = [...new Set(names.flatMap((name) => [name, decodeName(name)]))];
  const returned = new Set<string>();
  try {
    for (let i = 0; i < asked.length; i += COMPONENTS_PER_READ) {
      const read = await readMetadata(type, asked.slice(i, i + COMPONENTS_PER_READ));
      for (const item of Array.isArray(read) ? read : [read]) {
        if (item?.fullName) {
          returned.add(decodeName(String(item.fullName)));
        }
      }
    }
  } catch {
    return null;
  }
  return new Map(names.map((name) => [name, returned.has(decodeName(name))]));
}

function indexManifest(manifest: PackageXmlContent): { members: Set<string>; types: Set<string> } {
  const members = new Set<string>();
  const types = new Set<string>();
  for (const type of Object.keys(manifest || {})) {
    const typeMembers = manifest?.[type];
    for (const member of Array.isArray(typeMembers) ? typeMembers : typeMembers ? [typeMembers] : []) {
      members.add(componentKey(type, String(member)));
      types.add(type);
    }
  }
  return { members, types };
}

// Names are encoded in the files and in the manifests (Account-Account %28Marketing%29 Layout):
// compared decoded, whatever each side holds
function componentKey(type: string, fullName: string): string {
  return `${type}:${decodeName(fullName)}`;
}

function decodeName(fullName: string): string {
  const name = String(fullName).trim();
  try {
    return decodeURIComponent(name);
  } catch {
    // A name with a lone % is not encoded
    return name;
  }
}

function normalizeFilePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function listFiles(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

function listForLog(files: string[]): string {
  return files.map((file) => `- ${path.relative(process.cwd(), file).replace(/\\/g, '/')}`).join('\n');
}

// A deleted object leaves its folder and its fields folder behind
async function removeEmptyParentDirs(deletedFiles: string[], packageDirs: string[]): Promise<void> {
  const roots = packageDirs.map((packageDir) => path.resolve(packageDir));
  const dirs = [...new Set(deletedFiles.map((file) => path.dirname(path.resolve(file))))];
  for (let dir of dirs) {
    while (roots.some((root) => dir !== root && dir.startsWith(root + path.sep))) {
      if (!fs.existsSync(dir) || (await fs.readdir(dir)).length > 0) {
        break;
      }
      await fs.rmdir(dir);
      dir = path.dirname(dir);
    }
  }
}
