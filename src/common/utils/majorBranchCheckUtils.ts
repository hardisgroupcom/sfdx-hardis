// Major branch deployment check: a scheduled job runs `deploy:smart --check --major-branch-check` on a
// major branch, to know whether the branch can still be deployed to its own org. The branch content
// is already deployed there: the check reads no Pull Request, posts no comment, runs no deployment
// action and always simulates a full deployment.
import { SfError } from '@salesforce/core';
import { t } from './i18n.js';

let majorBranchCheckMode = false;

export function enableMajorBranchCheckMode(): void {
  majorBranchCheckMode = true;
}

export function isMajorBranchCheckMode(): boolean {
  return majorBranchCheckMode;
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
  majorBranchCheckMode = false;
}
