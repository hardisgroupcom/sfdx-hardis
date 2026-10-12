import c from 'chalk';
import * as path from 'path';
import fs from '../utils/fsUtils.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { MetadataUtils } from '../metadata-utils/index.js';

// A retrieve never deletes a local file: after the retrieves, the backup deletes the files of the
// components that are gone from the org. Only the files that no retrieve of the run wrote are looked
// at, so a file the org just returned can not be deleted.

// The org lists one language of a value set translation and not the others, and a retrieve does not
// return the ones it does not list: their files are never deleted (seen on a real org: Metier-fr
// listed, Metier-en_US not listed and readable)
const TYPES_NOT_LISTED_RELIABLY = new Set(['GlobalValueSetTranslation', 'StandardValueSetTranslation']);

export interface ResolvedBackupFile {
  type: string;
  name: string;
  parent?: { type: string; name: string } | null;
  xml?: string | null;
}

export type PackageXmlContent = Record<string, any> | null | undefined;

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
  commandThis: any;
}

export interface BackupDeletionsSkipReason {
  kind: 'disabled' | 'partialRetrieve';
  detail?: string;
}

export interface BackupDeletionsResult {
  deletedFiles: string[];
  candidates: number;
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
      if (file?.filePath) {
        const filePath = normalizeFilePath(file.filePath);
        this.files.add(filePath);
        if (fs.statSync(filePath, { throwIfNoEntry: false })?.isDirectory()) {
          this.dirs.push(filePath + path.sep);
        }
      }
      if (file?.type && file?.fullName) {
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
    return { deletedFiles: [], candidates: 0, skipped: true };
  }
  if (skipReason?.kind === 'partialRetrieve') {
    uxLog('warning', commandThis, c.yellow(t('backupDeletionsSkippedPartialRetrieve', { reason: skipReason.detail || '' })));
    return { deletedFiles: [], candidates: 0, skipped: true };
  }
  const { filesToDelete, candidates } = await findFilesOfDeletedComponents(options);
  if (filesToDelete.length === 0) {
    uxLog('log', commandThis, c.grey(t('backupNoFileOfDeletedComponents')));
    return { deletedFiles: [], candidates, skipped: false };
  }
  uxLog('action', commandThis, c.cyan(t('backupDeletingFilesOfDeletedComponents', { count: String(filesToDelete.length) })));
  for (const file of filesToDelete) {
    await fs.remove(file);
  }
  await removeEmptyParentDirs(filesToDelete, options.packageDirs);
  // Every deleted file is logged: the job log is where a deletion is checked
  const listed = filesToDelete.map((file) => `- ${path.relative(process.cwd(), file).replace(/\\/g, '/')}`);
  uxLog('log', commandThis, c.grey(listed.join('\n')));
  return { deletedFiles: filesToDelete, candidates, skipped: false };
}

// A candidate is a file of a package directory that no retrieve of the run wrote. The first rule
// that matches decides, and a file that can not be proven deleted is kept.
export async function findFilesOfDeletedComponents(
  options: FindFilesOfDeletedComponentsOptions
): Promise<{ filesToDelete: string[]; candidates: number }> {
  const resolve = options.resolve ?? MetadataUtils.resolveMetadataFromFile;
  const current = indexManifest(options.currentManifest);
  const previous = indexManifest(options.previousManifest);
  const { retrieved } = options;
  const filesToDelete: string[] = [];
  let candidates = 0;
  for (const packageDir of options.packageDirs) {
    for (const file of await listFiles(packageDir)) {
      if (retrieved.hasFile(file)) {
        continue;
      }
      candidates++;
      // 1. Not a metadata file
      const resolved = resolve(file);
      if (!resolved) {
        continue;
      }
      const key = componentKey(resolved.type, resolved.name);
      // 2. The org returned the component without this file (a file removed from a bundle)
      if (retrieved.components.has(key) && resolved.xml && retrieved.hasFile(resolved.xml)) {
        filesToDelete.push(file);
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
        filesToDelete.push(file);
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
      filesToDelete.push(file);
    }
  }
  return { filesToDelete: filesToDelete.sort(), candidates };
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
  let name = String(fullName).trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    // A name with a lone % is not encoded
  }
  return `${type}:${name}`;
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
