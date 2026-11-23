import c from 'chalk';
import fs from '../utils/fsUtils.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { parsePackageXmlFile, writePackageXmlFile } from '../utils/xmlUtils.js';
import { CONSTANTS } from '../../config/index.js';

// The org refuses a retrieve of more than 10000 files. The backup then retries without the types
// that matter least in a backup. It is a workaround: the warning it sends asks to fix the filters.
export const BACKUP_TRUNCATED_ITEMS_FILE = 'manifest/package-backup-truncated-items.xml';
export const BACKUP_TRUNCATION_DOC_URL = `${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-config-home/#too-many-files-to-retrieve`;

export interface BackupTruncationStep {
  types: string[];
  typePrefixes: string[];
}

// Each step also drops the types of the steps before it. ExperienceBundle comes last: an Experience
// Cloud site matters in a backup, it is dropped only when everything else was not enough.
export const BACKUP_TRUNCATION_STEPS: BackupTruncationStep[] = [
  {
    types: [
      'Report',
      'ReportFolder',
      'Dashboard',
      'DashboardFolder',
      'Document',
      'DocumentFolder',
      'EmailTemplate',
      'EmailFolder',
      'EmailTemplateFolder',
      'ContentAsset',
      'StaticResource',
      'Translations',
      'CustomObjectTranslation',
      'CustomFieldTranslation',
      'StandardValueSetTranslation',
      'GlobalValueSetTranslation',
    ],
    typePrefixes: ['Wave'],
  },
  {
    types: ['ExperienceBundle'],
    typePrefixes: [],
  },
];

export type PackageXmlContent = Record<string, string[]>;

export interface RetrieveWithTruncationOptions {
  manifestFile: string;
  // Throws the error of the retrieve when the org refuses it. lastAttempt is false while a retrieve
  // refused for too many files will be tried again with fewer types.
  retrieve: (manifestFile: string, lastAttempt: boolean) => Promise<void>;
  commandThis: any;
}

export interface RetrieveWithTruncationResult {
  dropped: PackageXmlContent;
}

export async function retrieveWithTruncation(options: RetrieveWithTruncationOptions): Promise<RetrieveWithTruncationResult> {
  const { manifestFile, retrieve, commandThis } = options;
  const attempts = listTruncationAttempts(await parsePackageXmlFile(manifestFile));
  let lastError: any;
  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const { kept, dropped } = attempts[attemptIndex];
    if (attemptIndex > 0) {
      uxLog('warning', commandThis, c.yellow(t('backupRetrieveTooManyFilesRetrying', { types: describeDroppedTypes(dropped) })));
      await writePackageXmlFile(manifestFile, kept);
    }
    try {
      await retrieve(manifestFile, attemptIndex === attempts.length - 1);
      return { dropped };
    } catch (e: any) {
      if (!isRetrieveFileLimitError(e)) {
        throw e;
      }
      lastError = e;
    }
  }
  uxLog('error', commandThis, c.red(t('backupTruncationNoTypeLeftToDrop')));
  throw lastError;
}

// The manifest as it is, then one attempt per step that drops more types than the one before:
// a step that drops nothing new would send the same refused retrieve again
export function listTruncationAttempts(packageXml: PackageXmlContent): { kept: PackageXmlContent; dropped: PackageXmlContent }[] {
  const attempts = [{ kept: packageXml, dropped: {} as PackageXmlContent }];
  for (let stepIndex = 0; stepIndex < BACKUP_TRUNCATION_STEPS.length; stepIndex++) {
    const attempt = splitManifestForTruncation(packageXml, stepIndex);
    const previousDroppedTypes = Object.keys(attempts[attempts.length - 1].dropped).length;
    if (Object.keys(attempt.dropped).length > previousDroppedTypes) {
      attempts.push(attempt);
    }
  }
  return attempts;
}

export function splitManifestForTruncation(
  packageXml: PackageXmlContent,
  stepIndex: number
): { kept: PackageXmlContent; dropped: PackageXmlContent } {
  const steps = BACKUP_TRUNCATION_STEPS.slice(0, stepIndex + 1);
  const kept: PackageXmlContent = {};
  const dropped: PackageXmlContent = {};
  for (const [type, members] of Object.entries(packageXml)) {
    if (!members || members.length === 0) {
      continue;
    }
    const isDropped = steps.some(
      (step) => step.types.includes(type) || step.typePrefixes.some((prefix) => type.startsWith(prefix))
    );
    if (isDropped) {
      dropped[type] = members;
    } else {
      kept[type] = members;
    }
  }
  return { kept, dropped };
}

export function describeDroppedTypes(dropped: PackageXmlContent): string {
  return Object.keys(dropped)
    .sort()
    .map((type) => `${type} (${dropped[type].length})`)
    .join(', ');
}

// "LIMIT_EXCEEDED: Too many files in retrieve call, limit is: 10000", or the status code alone when
// the retrieve result has no message. REQUEST_LIMIT_EXCEEDED (the API calls of the day) is another
// limit, that a retrieve with fewer types would not get under.
export function isRetrieveFileLimitError(error: any): boolean {
  const message = String(error?.message || error || '');
  return /(?<![A-Z_])LIMIT_EXCEEDED|Too many files in retrieve call/.test(message);
}

export function countDroppedItems(dropped: PackageXmlContent): number {
  return Object.values(dropped).reduce((total, members) => total + members.length, 0);
}

// Written after a truncated retrieve, so the dropped items can be copied into package-skip-items.xml
export async function writeTruncatedItemsManifest(dropped: PackageXmlContent): Promise<void> {
  await removeTruncatedItemsManifest();
  await writePackageXmlFile(BACKUP_TRUNCATED_ITEMS_FILE, dropped);
}

// A backup that needs no truncation must not leave the file of an older one
export async function removeTruncatedItemsManifest(): Promise<void> {
  if (fs.existsSync(BACKUP_TRUNCATED_ITEMS_FILE)) {
    await fs.remove(BACKUP_TRUNCATED_ITEMS_FILE);
  }
}
