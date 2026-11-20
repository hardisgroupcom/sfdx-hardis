import { Connection, SfError } from '@salesforce/core';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import c from 'chalk';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { crudReadMetadatas, CrudMetadataOutcome, CrudReadOptions } from '../metadata-utils/crudMetadataApi.js';

// A file-based retrieve returns a Profile with only the permissions related to the other components
// of the same request: the backup reads the Profiles again with the CRUD Metadata API, which returns
// them whole. Same type list as the Auto mode of the VS Code Metadata Retriever.
export const BACKUP_CRUD_READ_TYPE = 'Profile';

// Profiles per readMetadata call. The API allows 10, but the time is per Profile: smaller calls sent
// side by side finish sooner (35 Profiles: 22 seconds by 10, 11 seconds by 5).
export const BACKUP_PROFILES_PER_CALL = 5;

// Profiles named in the errors of a failed read: the others are counted
const MAX_PROFILES_IN_ERROR = 20;

export interface ReadBackupProfilesOptions {
  conn: Connection;
  profileNames: string[];
  outputDir: string;
  packageDirs: string[];
  commandThis: any;
  debug?: boolean;
  // Replaceable in tests
  read?: (options: CrudReadOptions) => Promise<CrudMetadataOutcome>;
}

// Profile members of a retrieved package.xml, as parsePackageXmlFile returns it
export function collectProfileNames(packageXml: Record<string, any> | null | undefined): string[] {
  const members = packageXml?.[BACKUP_CRUD_READ_TYPE];
  const names = (Array.isArray(members) ? members : members ? [members] : [])
    .map((member: any) => String(member).trim())
    .filter(Boolean);
  return [...new Set<string>(names)];
}

// Read the Profiles whole, without the entries that grant nothing, and write them over the files of
// the file-based retrieve. A Profile that can not be read fails the backup: a file that is whole one
// day and truncated the next would be reported as an org change.
export async function readBackupProfiles(
  options: ReadBackupProfilesOptions
): Promise<{ read: number; inactiveEntriesRemoved: number }> {
  const { conn, commandThis } = options;
  const profileNames = await resolveProfileNames(conn, options.profileNames);
  if (profileNames.length === 0) {
    return { read: 0, inactiveEntriesRemoved: 0 };
  }
  uxLog('action', commandThis, c.cyan(t('backupReadingCompleteProfiles', { count: String(profileNames.length) })));
  const componentSet = new ComponentSet(
    profileNames.map((fullName) => ({ fullName, type: BACKUP_CRUD_READ_TYPE }))
  );
  const outcome = await (options.read ?? crudReadMetadatas)({
    conn,
    componentSet,
    outputDir: options.outputDir,
    packageDirs: options.packageDirs,
    chunkSizeOverride: BACKUP_PROFILES_PER_CALL,
    commandThis,
    debug: options.debug,
    activeOnly: true,
  });
  if (outcome.failures.length > 0) {
    throw new SfError(buildProfilesReadError(outcome));
  }
  const inactiveEntriesRemoved = outcome.successes.reduce((sum, success) => sum + (success.inactiveEntriesRemoved || 0), 0);
  uxLog(
    'log',
    commandThis,
    c.grey(t('backupCompleteProfilesRead', { count: String(outcome.successes.length), removed: String(inactiveEntriesRemoved) }))
  );
  return { read: outcome.successes.length, inactiveEntriesRemoved };
}

// A manifest written by hand can hold a wildcard: the Profiles are then listed from the org
async function resolveProfileNames(conn: Connection, profileNames: string[]): Promise<string[]> {
  if (!profileNames.some((name) => name.includes('*'))) {
    return profileNames;
  }
  const listed = await conn.metadata.list([{ type: BACKUP_CRUD_READ_TYPE }]);
  const names = (Array.isArray(listed) ? listed : listed ? [listed] : [])
    .map((item: any) => item?.fullName)
    .filter(Boolean);
  return [...new Set<string>(names)].sort();
}

function buildProfilesReadError(outcome: CrudMetadataOutcome): string {
  const failedNames = outcome.failures.map((failure) => failure.fullName);
  const named = failedNames.slice(0, MAX_PROFILES_IN_ERROR).join(', ');
  const more = failedNames.length > MAX_PROFILES_IN_ERROR ? `, ... (+${failedNames.length - MAX_PROFILES_IN_ERROR})` : '';
  return t('backupProfilesReadFailed', {
    count: String(failedNames.length),
    profiles: named + more,
    error: outcome.failures[0].error || '',
  });
}
