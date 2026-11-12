// Major branch deployment check: a scheduled job runs `deploy:smart --check --major-branch-check` on a
// major branch, to know whether the branch can still be deployed to its own org. The branch content
// is already deployed there: the check reads no Pull Request, posts no comment, runs no deployment
// action and always simulates a full deployment.
import { SfError } from '@salesforce/core';
import { t } from './i18n.js';

// Kept on globalThis, not in a module variable: a plugin posts its Pull Request comment through the
// sfdx-hardis/plugin-api of its own copy of sfdx-hardis (in its node_modules), whose module variables
// are not the ones of the running sfdx-hardis. During a major branch check the plugins still get their
// events, but their comment is skipped like the sfdx-hardis ones: there is no Pull Request to comment
declare global {
  // eslint-disable-next-line no-var
  var sfdxHardisMajorBranchCheckMode: boolean | undefined;
}

export function enableMajorBranchCheckMode(): void {
  globalThis.sfdxHardisMajorBranchCheckMode = true;
}

export function isMajorBranchCheckMode(): boolean {
  return globalThis.sfdxHardisMajorBranchCheckMode === true;
}

/**
 * The check compares a major branch with its org: on any other branch there is no org to compare
 * with, and the job would deploy the branch to the default org of the CLI.
 * The branchName of a major org comes from its config file name, where every `/` is written `__`
 * (release/uat -> .sfdx-hardis.release__uat.yml).
 */
export function assertMajorBranchCheckAllowed(currentBranch: string | null | undefined, majorOrgs: { branchName?: string }[]): void {
  const branch = currentBranch || '';
  const configBranch = branch.replace(/\//g, '__');
  if (!branch || !(majorOrgs || []).some((majorOrg) => majorOrg.branchName === branch || majorOrg.branchName === configBranch)) {
    throw new SfError(t('majorBranchCheckNotMajorBranch', { branch: branch || '?' }));
  }
}

/** For tests only: a process running several commands must not carry the mode from one to the next */
export function resetMajorBranchCheckMode(): void {
  globalThis.sfdxHardisMajorBranchCheckMode = false;
}
