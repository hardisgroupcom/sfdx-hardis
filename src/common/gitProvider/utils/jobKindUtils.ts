import { CiRunKind, CommonCiRun } from '../gitProviderRoot.js';

export type JobKind = 'deployment' | 'validation' | 'codeQuality' | 'other';

// A finished run as a provider lists it, before anything says what it does
export interface CiRunCandidate extends Omit<CommonCiRun, 'kind'> {
  // push: the run of a branch after a merge. pullRequest: the run of a Pull Request
  trigger: 'push' | 'pullRequest';
}

/**
 * What a CI job does, told from its name. The names are the ones of the CI files sfdx-hardis
 * installs, and what a project usually renames them to:
 *
 * - GitHub:    Simulate Deployment (sfdx-hardis), Mega-Linter, Process Deployment (sfdx-hardis)
 * - GitLab:    check_deploy_to_target_branch_org, check_quality, deploy_to_org
 * - Azure:     DeploymentCheck, MegaLinter, Deployment
 * - Bitbucket: Simulate SFDX deployment, Run MegaLinter, Deploy to major org
 *
 * Code quality is tested first: "check_quality" must not be read as a deployment check. A
 * validation is a deployment that is only simulated, so it is tested before "deploy".
 *
 * The VS Code extension has the same function (src/utils/pipeline/jobKindUtils.ts): keep both in sync.
 */
export function classifyJobKind(name: string | undefined | null): JobKind {
  const text = String(name || '').toLowerCase();
  if (/mega[\s_-]?linter|quality|\blint/.test(text)) {
    return 'codeQuality';
  }
  if (/simulat|check[\s_-]?deploy|deploy(ment)?[\s_-]?check|validat/.test(text)) {
    return 'validation';
  }
  if (/deploy/.test(text)) {
    return 'deployment';
  }
  return 'other';
}

/**
 * The deployments and the deployment checks among the finished runs of a repository.
 *
 * - A push run named as a deployment is a deployment.
 * - A project can rename its jobs: the push runs nothing else explains (not a code quality job,
 *   not a check) are returned as unnamed deployments. keepNamedDeployments then drops them for
 *   every branch that has a run named as a deployment.
 * - A Pull Request run named as a deployment check is a validation. There is no fallback there: a
 *   Pull Request also runs linters and tests, and counting them would bend the success rate.
 */
export function selectCiRuns(candidates: CiRunCandidate[], kinds: CiRunKind[]): CommonCiRun[] {
  const selected: CommonCiRun[] = [];
  const toRun = (candidate: CiRunCandidate, kind: CiRunKind): CommonCiRun => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { trigger, ...run } = candidate;
    return { ...run, kind };
  };
  if (kinds.includes('deployment')) {
    for (const candidate of candidates.filter((pushCandidate) => pushCandidate.trigger === 'push')) {
      const kind = classifyJobKind(candidate.name);
      if (kind === 'deployment') {
        selected.push(toRun(candidate, 'deployment'));
      } else if (kind === 'other') {
        selected.push({ ...toRun(candidate, 'deployment'), unnamed: true });
      }
    }
  }
  if (kinds.includes('validation')) {
    for (const candidate of candidates) {
      if (candidate.trigger === 'pullRequest' && classifyJobKind(candidate.name) === 'validation') {
        selected.push(toRun(candidate, 'validation'));
      }
    }
  }
  return selected;
}

/**
 * Drops the unnamed deployments of the branches that have a run named as a deployment. It must see
 * every run known for a branch, not the runs of one reading: a single day can hold a build job
 * whose deployment job is still running.
 */
export function keepNamedDeployments(runs: CommonCiRun[]): CommonCiRun[] {
  const branchesWithNamedDeployment = new Set(runs.filter((run) => run.kind === 'deployment' && !run.unnamed).map((run) => run.branch));
  return runs.filter((run) => !(run.kind === 'deployment' && run.unnamed && branchesWithNamedDeployment.has(run.branch)));
}
