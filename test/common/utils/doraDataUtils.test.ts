import { expect } from 'chai';
import os from 'os';
import path from 'path';
// Load the provider index first so the gitProviderRoot / provider module cycle is
// resolved in the same order as in production (see gitProviderRoot.test.ts)
import '../../../src/common/gitProvider/index.js';
import fs from '../../../src/common/utils/fsUtils.js';
import { CiRunFilters, CommonCiRun } from '../../../src/common/gitProvider/gitProviderRoot.js';
import { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { GitlabProvider } from '../../../src/common/gitProvider/gitlab.js';
import { DoraSource, buildDoraPeriod, collectDoraBranchInputs, resolveDoraSource } from '../../../src/common/utils/doraDataUtils.js';

const NOW = new Date('2026-09-30T12:00:00Z');

const run = (id: string, kind: CommonCiRun['kind'], finishedAt: string, overrides: Partial<CommonCiRun> = {}): CommonCiRun => ({
  id,
  name: kind === 'deployment' ? 'deploy_to_org' : 'check_deploy_to_target_branch_org',
  kind,
  branch: kind === 'deployment' ? 'uat' : '',
  status: 'succeeded',
  queuedAt: finishedAt,
  startedAt: finishedAt,
  finishedAt,
  commitSha: '',
  triggeredBy: 'Romain',
  webUrl: '',
  ...overrides,
});

const pullRequest = (id: number, targetBranch: string, mergedDate: string | undefined, sourceBranch = `feature/${id}`): CommonPullRequestInfo => ({
  idNumber: id,
  idStr: String(id),
  targetBranch,
  sourceBranch,
  title: `Story ${id}`,
  description: '',
  authorName: 'Mariia',
  webUrl: '',
  createdDate: '2026-09-01T12:00:00Z',
  mergedDate,
  customBehaviors: {},
  providerInfo: null,
});

// A provider answering from fixed lists, and recording what it was asked
function fakeSource(runs: CommonCiRun[], pullRequests: CommonPullRequestInfo[] | null) {
  const calls: { runs: CiRunFilters[]; pullRequests: any[] } = { runs: [], pullRequests: [] };
  const gitProvider: any = {
    getLabel: () => 'fake',
    listCiRuns: async (filters: CiRunFilters) => {
      calls.runs.push(filters);
      return runs.filter((candidate) => Date.parse(candidate.queuedAt) >= filters.minDate.getTime());
    },
    listPullRequests: async (filters: any) => {
      calls.pullRequests.push(filters);
      if (pullRequests == null) {
        return null;
      }
      return pullRequests.filter(
        (candidate) => candidate.targetBranch === filters.targetBranch && (filters.status !== 'open' || !candidate.mergedDate),
      );
    },
  };
  const source: DoraSource = {
    gitProvider,
    repository: 'https://git.example.com/acme/sfdx-project.git',
    branches: [
      { name: 'uat', level: 50, isProduction: false },
      { name: 'main', level: 100, isProduction: true },
    ],
  };
  return { source, calls };
}

describe('doraDataUtils', () => {
  let cacheDir = '';

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dora-cache-'));
  });

  afterEach(async () => {
    await fs.remove(cacheDir);
  });

  it('builds the period and the one before it', () => {
    const period = buildDoraPeriod(30, true, NOW);
    expect(period.from.toISOString()).to.equal('2026-08-31T12:00:00.000Z');
    expect(period.previousFrom?.toISOString()).to.equal('2026-08-01T12:00:00.000Z');
    expect(buildDoraPeriod(30, false, NOW).previousFrom).to.equal(null);
  });

  it('gives each branch its deployments, its Pull Requests and the deployment checks of its Pull Requests', async () => {
    const { source } = fakeSource(
      [
        run('1', 'deployment', '2026-09-10T12:00:00Z'),
        run('2', 'deployment', '2026-09-11T12:00:00Z', { branch: 'main' }),
        // The provider names the target branch, the Pull Request, or only the branch it comes from
        run('3', 'validation', '2026-09-09T12:00:00Z', { branch: 'uat' }),
        run('4', 'validation', '2026-09-09T13:00:00Z', { pullRequestId: '12' }),
        run('5', 'validation', '2026-09-09T14:00:00Z', { pullRequestId: '', sourceBranch: 'uat' }),
        // Nothing ties this one to a branch
        run('6', 'validation', '2026-09-09T15:00:00Z', { pullRequestId: '', sourceBranch: 'feature/unknown' }),
      ],
      [pullRequest(11, 'uat', '2026-09-10T11:00:00Z'), pullRequest(12, 'uat', undefined), pullRequest(13, 'main', '2026-09-11T11:00:00Z', 'uat'), pullRequest(14, 'uat', '2026-06-01T12:00:00Z')],
    );
    const inputs = await collectDoraBranchInputs(source, buildDoraPeriod(30, false, NOW), { refresh: false, cacheDir, now: NOW });

    const uat = inputs.find((input) => input.name === 'uat')!;
    const main = inputs.find((input) => input.name === 'main')!;
    expect(uat.deploymentRuns.map((candidate) => candidate.id)).to.deep.equal(['1']);
    expect(uat.validationRuns.map((candidate) => candidate.id)).to.deep.equal(['3', '4']);
    // Merged before the period: not a Pull Request of the report
    expect(uat.mergedPullRequests.map((candidate) => candidate.idStr)).to.deep.equal(['11']);
    expect(uat.openPullRequests.map((candidate) => candidate.idStr)).to.deep.equal(['12']);
    expect(main.deploymentRuns.map((candidate) => candidate.id)).to.deep.equal(['2']);
    expect(main.validationRuns.map((candidate) => candidate.id)).to.deep.equal(['5']);
  });

  it('asks the provider only for the runs newer than the last reading', async () => {
    const runs = [run('1', 'deployment', '2026-09-10T12:00:00Z'), run('2', 'deployment', '2026-09-20T12:00:00Z', { status: 'failed' })];
    const { source, calls } = fakeSource(runs, []);
    const period = buildDoraPeriod(30, false, NOW);
    await collectDoraBranchInputs(source, period, { refresh: false, cacheDir, now: new Date('2026-09-21T12:00:00Z') });

    // The failed job was run again since: the provider now lists it as succeeded
    runs[1] = run('2', 'deployment', '2026-09-20T12:00:00Z');
    runs.push(run('3', 'deployment', '2026-09-29T12:00:00Z'));
    // Any run older than the overlap must come from the cache
    runs[0] = run('1', 'deployment', '2026-09-10T12:00:00Z', { status: 'canceled' });
    const inputs = await collectDoraBranchInputs(source, period, { refresh: false, cacheDir, now: NOW });

    expect(calls.runs[0].minDate.toISOString()).to.equal(period.from.toISOString());
    // Two days before the last reading: what was running then has finished since
    expect(calls.runs[1].minDate.toISOString()).to.equal('2026-09-19T12:00:00.000Z');
    const uat = inputs.find((input) => input.name === 'uat')!;
    expect(uat.deploymentRuns.map((candidate) => [candidate.id, candidate.status]).sort()).to.deep.equal([
      ['1', 'succeeded'],
      ['2', 'succeeded'],
      ['3', 'succeeded'],
    ]);
  });

  it('reads everything again on refresh, for a longer period, or for a branch the cache does not know', async () => {
    const { source, calls } = fakeSource([run('1', 'deployment', '2026-09-10T12:00:00Z')], []);
    const period = buildDoraPeriod(30, false, NOW);
    await collectDoraBranchInputs(source, period, { refresh: false, cacheDir, now: NOW });
    await collectDoraBranchInputs(source, period, { refresh: true, cacheDir, now: NOW });
    const longer = buildDoraPeriod(30, true, NOW);
    await collectDoraBranchInputs(source, longer, { refresh: false, cacheDir, now: NOW });
    const withPreprod = { ...source, branches: [...source.branches, { name: 'preprod', level: 90, isProduction: false }] };
    await collectDoraBranchInputs(withPreprod, period, { refresh: false, cacheDir, now: NOW });

    expect(calls.runs.map((filters) => filters.minDate.toISOString())).to.deep.equal([
      period.from.toISOString(),
      period.from.toISOString(),
      longer.previousFrom!.toISOString(),
      period.from.toISOString(),
    ]);
    expect(calls.runs[3].branches).to.deep.equal(['uat', 'main', 'preprod']);
  });

  it('fails when the Pull Requests cannot be listed, or when the token cannot read the CI jobs', async () => {
    const period = buildDoraPeriod(30, false, NOW);
    const unreadablePullRequests = fakeSource([], null);
    let error: any = null;
    try {
      await collectDoraBranchInputs(unreadablePullRequests.source, period, { refresh: false, cacheDir, now: NOW });
    } catch (e) {
      error = e;
    }
    expect(error?.message).to.contain('uat');

    const forbidden = fakeSource([], []);
    forbidden.source.gitProvider.listCiRuns = async () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    };
    error = null;
    try {
      await collectDoraBranchInputs(forbidden.source, period, { refresh: false, cacheDir, now: NOW });
    } catch (e) {
      error = e;
    }
    expect(error?.message).to.contain('403').and.to.contain('SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN');
  });

  describe('resolveDoraSource in a monitoring repository', () => {
    const ENV_KEYS = ['GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN', 'PAT', 'CI_SFDX_HARDIS_GITLAB_TOKEN', 'ACCESS_TOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'SYSTEM_ACCESSTOKEN', 'AZURE_DEVOPS_EXT_PAT', 'CI_SFDX_HARDIS_BITBUCKET_TOKEN', 'SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN'];
    let savedEnv: Record<string, string | undefined> = {};
    let previousCwd = '';
    let folder = '';

    beforeEach(async () => {
      savedEnv = {};
      for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      previousCwd = process.cwd();
      folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dora-monitoring-'));
      process.chdir(folder);
    });

    afterEach(async () => {
      process.chdir(previousCwd);
      await fs.remove(folder);
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
    });

    it('reads the deployment repository with the token of the monitoring repository when it is on the same provider', async () => {
      await fs.writeFile('.sfdx-hardis.yml', 'deploymentRepository: https://github.com/acme/sfdx-project.git\ndeploymentBranch: uat\n', 'utf8');
      process.env.GITHUB_TOKEN = 'monitoring-token';
      const source = await resolveDoraSource(null);
      expect(source.gitProvider).to.be.instanceOf(GithubProvider);
      expect(source.repository).to.equal('https://github.com/acme/sfdx-project.git');
      expect(source.branches.map((branch) => branch.name)).to.deep.equal(['uat']);
    });

    it('uses SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN for a deployment repository on another provider', async () => {
      await fs.writeFile('.sfdx-hardis.yml', 'deploymentRepository: https://gitlab.com/acme/sfdx-project.git\ndeploymentBranch: main\n', 'utf8');
      process.env.GITHUB_TOKEN = 'monitoring-token';
      let error: any = null;
      try {
        await resolveDoraSource(null);
      } catch (e) {
        error = e;
      }
      expect(error?.message).to.contain('SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN');

      process.env.SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN = 'deployment-token';
      const source = await resolveDoraSource(null);
      expect(source.gitProvider).to.be.instanceOf(GitlabProvider);
      expect(source.branches).to.deep.equal([{ name: 'main', level: 0, isProduction: true }]);
    });

    it('asks for deploymentBranch when it is missing, unless --branches names the branch', async () => {
      await fs.writeFile('.sfdx-hardis.yml', 'deploymentRepository: https://github.com/acme/sfdx-project.git\n', 'utf8');
      process.env.GITHUB_TOKEN = 'monitoring-token';
      let error: any = null;
      try {
        await resolveDoraSource(null);
      } catch (e) {
        error = e;
      }
      expect(error?.message).to.contain('deploymentBranch');
      const source = await resolveDoraSource('integration, uat');
      expect(source.branches.map((branch) => branch.name)).to.deep.equal(['integration', 'uat']);
    });
  });
});
