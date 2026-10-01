import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { createTempDir, git, uxLog } from './index.js';
import { callSfdxGitDelta } from './gitUtils.js';
import { t } from './i18n.js';
import {
  appendPackageXmlFilesContent,
  parsePackageXmlFile,
  removePackageXmlFilesContent,
  writePackageXmlFile,
} from './xmlUtils.js';
import { getApiVersion } from '../../config/index.js';

export const MANIFEST_PACKAGE_XML = path.join('manifest', 'package.xml');
export const MANIFEST_DESTRUCTIVE_CHANGES_XML = path.join('manifest', 'destructiveChanges.xml');

export interface ManifestDeltaResult {
  // false when sfdx-git-delta could not compute the delta: the manifest files are then untouched
  success: boolean;
  // Flow API names of the delta package.xml
  deltaFlowNames: string[];
  // What sfdx-git-delta answered, for the caller's error message
  gitDeltaResult: any;
}

/**
 * True for the two manifest files sfdx-hardis maintains from the git delta. Accepts the path as
 * git prints it (forward slashes) and as the file system does.
 */
export function isManifestDeltaFile(file: string): boolean {
  const normalized = (file || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === 'manifest/package.xml' || normalized === 'manifest/destructiveChanges.xml';
}

/**
 * A standard profile (Admin, Standard User...) cannot be deleted in any org. Deleting its file from
 * the repository means "stop versioning it", so it is taken out of the destructive delta: left
 * there, it failed every deployment with "cannot delete profile".
 */
export async function keepStandardProfilesOutOfDestructiveChanges(diffDestructivePackageXml: string, fromCommit: string, commandThis: any) {
  if (!fs.existsSync(diffDestructivePackageXml)) {
    return;
  }
  const destructive = await parsePackageXmlFile(diffDestructivePackageXml);
  const profiles: string[] = destructive['Profile'] || [];
  if (profiles.length === 0) {
    return;
  }
  const filesAtBase = (await git().raw(['ls-tree', '-r', '--name-only', fromCommit])).split('\n');
  const standard: string[] = [];
  for (const profile of profiles) {
    const file = filesAtBase.find((f) => f.endsWith(`/profiles/${profile}.profile-meta.xml`));
    if (!file) {
      continue;
    }
    const content = await git().show([`${fromCommit}:${file}`]).catch(() => '');
    if (/<custom>\s*false\s*<\/custom>/.test(content)) {
      standard.push(profile);
    }
  }
  if (standard.length === 0) {
    return;
  }
  const remaining = profiles.filter((profile) => !standard.includes(profile));
  if (remaining.length > 0) {
    destructive['Profile'] = remaining;
  } else {
    delete destructive['Profile'];
  }
  await writePackageXmlFile(diffDestructivePackageXml, destructive);
  uxLog("action", commandThis, c.cyan(t('standardProfilesNotDeleted', { profiles: standard.join(', ') })));
}

/**
 * Merge the git delta between two commits into manifest/package.xml and
 * manifest/destructiveChanges.xml: what was added or modified goes into package.xml, what was
 * deleted goes into destructiveChanges.xml and leaves package.xml.
 *
 * Shared by hardis:work:save (delta of a User Story branch over its target branch) and
 * hardis:project:promotion:create (delta of a promotion branch over the branch it was cut from).
 * The files are only written, never staged nor committed: that is the caller's business.
 *
 * `beforeMerge` runs once sfdx-git-delta has answered and before the manifest files are touched,
 * so a caller can put them back to a known state without losing them when the delta fails.
 */
export async function updateManifestWithGitDelta(
  fromCommit: string,
  toCommit: string,
  commandThis: any,
  options: { beforeMerge?: () => Promise<void> } = {},
): Promise<ManifestDeltaResult> {
  const tmpDir = await createTempDir();
  const gitDeltaResult = await callSfdxGitDelta(fromCommit, toCommit, tmpDir);
  if (gitDeltaResult.status !== 0) {
    return { success: false, deltaFlowNames: [], gitDeltaResult };
  }
  if (options.beforeMerge) {
    await options.beforeMerge();
  }

  // Upgrade local destructivePackage.xml
  if (!fs.existsSync(MANIFEST_DESTRUCTIVE_CHANGES_XML)) {
    // Create default destructiveChanges.xml if not defined
    const blankDestructiveChanges = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>${getApiVersion()}</version>
</Package>
`;
    await fs.writeFile(MANIFEST_DESTRUCTIVE_CHANGES_XML, blankDestructiveChanges);
  }
  const diffDestructivePackageXml = path.join(tmpDir, 'destructiveChanges', 'destructiveChanges.xml');
  await keepStandardProfilesOutOfDestructiveChanges(diffDestructivePackageXml, fromCommit, commandThis);
  const destructivePackageXmlDiffStr = await fs.readFile(diffDestructivePackageXml, 'utf8');
  uxLog(
    "log",
    commandThis,
    c.grey(c.bold(t('deltaDestructiveChangesXmlDiffToBeMerged', { file: c.green(MANIFEST_DESTRUCTIVE_CHANGES_XML) }) + '\n')) +
    c.red(destructivePackageXmlDiffStr)
  );
  await appendPackageXmlFilesContent(
    [MANIFEST_DESTRUCTIVE_CHANGES_XML, diffDestructivePackageXml],
    MANIFEST_DESTRUCTIVE_CHANGES_XML
  );

  // Upgrade local package.xml
  const diffPackageXml = path.join(tmpDir, 'package', 'package.xml');
  const diffPackageXmlContent = await parsePackageXmlFile(diffPackageXml);
  const packageXmlDiffStr = await fs.readFile(diffPackageXml, 'utf8');
  uxLog(
    "log",
    commandThis,
    c.grey(c.bold(t('deltaPackageXmlDiffToBeMerged', { file: c.green(MANIFEST_PACKAGE_XML) }) + '\n')) +
    c.green(packageXmlDiffStr)
  );
  await appendPackageXmlFilesContent([MANIFEST_PACKAGE_XML, diffPackageXml], MANIFEST_PACKAGE_XML);
  await removePackageXmlFilesContent(MANIFEST_PACKAGE_XML, MANIFEST_DESTRUCTIVE_CHANGES_XML, {
    outputXmlFile: MANIFEST_PACKAGE_XML,
  });
  return { success: true, deltaFlowNames: diffPackageXmlContent.Flow || [], gitDeltaResult };
}
