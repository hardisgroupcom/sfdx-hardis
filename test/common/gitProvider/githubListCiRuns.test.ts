import { expect } from 'chai';
// Load the provider index first so the gitProviderRoot / provider module cycle is
// resolved in the same order as in production (see gitProviderRoot.test.ts)
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { BitbucketProvider } from '../../../src/common/gitProvider/bitbucket.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

const ENV_KEYS = [
  'GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN', 'PAT', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_OWNER', 'GITHUB_SERVER_URL', 'GITHUB_API_URL',
  'CI_SFDX_HARDIS_GITLAB_TOKEN', 'ACCESS_TOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'SYSTEM_ACCESSTOKEN', 'AZURE_DEVOPS_EXT_PAT',
  'CI_SFDX_HARDIS_BITBUCKET_TOKEN', 'CI_SFDX_HARDIS_BITBUCKET_EMAIL',
];
const MIN_DATE = new Date('2026-09-01T00:00:00Z');

// One workflow run as GitHub returns it
const rawRun = (id: number, name: string, conclusion: string | null, overrides: any = {}) => ({
  id,
  name,
  conclusion,
  head_branch: 'main',
  head_sha: `sha${id}`,
  created_at: '2026-09-10T10:00:00Z',
  run_started_at: '2026-09-10T10:00:05Z',
  updated_at: '2026-09-10T10:12:00Z',
  html_url: `https://github.com/acme/widgets/actions/runs/${id}`,
  triggering_actor: { login: 'mariia' },
  pull_requests: [],
  ...overrides,
});

describe('GithubProvider.listCiRuns', () => {
  let requests: URL[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  // Serves the runs of a query from its event, and the jobs of a run from its id
  const mockGithub = (runsByEvent: Record<string, any[]>, jobsByRun: Record<string, any[]> = {}, failJobs = false) => {
    requests = [];
    setFetchForTests(async (input: any) => {
      const url = new URL(String(input));
      requests.push(url);
      const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      const jobsMatch = url.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/);
      if (jobsMatch) {
        return failJobs ? json({ message: 'Server error' }, 500) : json({ jobs: jobsByRun[jobsMatch[1]] || [] });
      }
      const runs = runsByEvent[url.searchParams.get('event') || ''] || [];
      const page = Number(url.searchParams.get('page') || 1);
      return json({ workflow_runs: runs.slice((page - 1) * 100, page * 100) });
    });
  };

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    setFetchForTests(null);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('lists the deployments of each branch and the deployment checks of the Pull Requests', async () => {
    mockGithub(
      {
        push: [
          rawRun(1, 'Process Deployment (sfdx-hardis)', 'success'),
          rawRun(2, 'Process Deployment (sfdx-hardis)', 'failure'),
          rawRun(3, 'Process Deployment (sfdx-hardis)', 'cancelled'),
          rawRun(4, 'Process Deployment (sfdx-hardis)', 'skipped'),
          rawRun(5, 'Mega-Linter', 'success'),
        ],
        pull_request: [
          rawRun(6, 'Simulate Deployment (sfdx-hardis)', 'success', { head_branch: 'feature/a', pull_requests: [{ number: 42, base: { ref: 'main' } }] }),
          // The run of a Pull Request coming from a fork does not name it
          rawRun(7, 'Simulate Deployment (sfdx-hardis)', 'failure', { head_branch: 'feature/b' }),
          rawRun(8, 'Mega-Linter', 'failure', { pull_requests: [{ number: 42, base: { ref: 'main' } }] }),
        ],
      },
      { '1': [{ started_at: '2026-09-10T10:03:00Z' }, { started_at: '2026-09-10T10:02:00Z' }] },
    );
    const provider = new GithubProvider({ remoteUrl: 'https://github.com/acme/widgets.git', token: 'tok' });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment', 'validation'] });

    expect(runs.map((run) => [run.id, run.kind, run.status, run.branch, run.pullRequestId])).to.deep.equal([
      ['1', 'deployment', 'succeeded', 'main', undefined],
      ['2', 'deployment', 'failed', 'main', undefined],
      ['3', 'deployment', 'canceled', 'main', undefined],
      ['6', 'validation', 'succeeded', 'main', '42'],
      ['7', 'validation', 'failed', '', ''],
    ]);
    // When a runner picked the deployment comes from its jobs, the run only knows when it was asked for
    expect(runs[0]).to.include({ queuedAt: '2026-09-10T10:00:00Z', startedAt: '2026-09-10T10:02:00Z', finishedAt: '2026-09-10T10:12:00Z', triggeredBy: 'mariia' });
    expect(runs[1].startedAt).to.equal('2026-09-10T10:00:05Z');

    const pushQuery = requests.find((url) => url.searchParams.get('event') === 'push')!;
    expect(pushQuery.origin + pushQuery.pathname).to.equal('https://api.github.com/repos/acme/widgets/actions/runs');
    expect(pushQuery.searchParams.get('branch')).to.equal('main');
    expect(pushQuery.searchParams.get('status')).to.equal('completed');
    expect(pushQuery.searchParams.get('created')).to.equal('>=2026-09-01T00:00:00.000Z');
    // Jobs are only read for the deployments
    expect(requests.filter((url) => url.pathname.endsWith('/jobs')).length).to.equal(3);
  });

  it('follows the pages, and asks an older window when a query reaches the 1,000 results GitHub serves', async () => {
    const day = (n: number) => `2026-09-${String(1 + Math.floor(n / 50)).padStart(2, '0')}T10:00:00Z`;
    // Newest first, like GitHub: 1,200 runs over 24 days
    const all = Array.from({ length: 1200 }, (_, index) => rawRun(2000 - index, 'Process Deployment (sfdx-hardis)', 'success', { created_at: day(1199 - index) }));
    requests = [];
    setFetchForTests(async (input: any) => {
      const url = new URL(String(input));
      requests.push(url);
      const json = (body: any) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname.endsWith('/jobs')) {
        return json({ jobs: [] });
      }
      const until = (url.searchParams.get('created') || '').split('..')[1];
      const window = (until ? all.filter((run) => run.created_at <= until) : all).slice(0, 1000);
      const page = Number(url.searchParams.get('page') || 1);
      return json({ workflow_runs: window.slice((page - 1) * 100, page * 100) });
    });
    const provider = new GithubProvider({ remoteUrl: 'https://github.com/acme/widgets.git', token: 'tok' });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(runs.length).to.equal(1200);
    expect(new Set(runs.map((run) => run.id)).size).to.equal(1200);
  });

  it('throws when GitHub refuses the listing', async () => {
    setFetchForTests(async () => new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    const provider = new GithubProvider({ remoteUrl: 'https://github.com/acme/widgets.git', token: 'tok' });
    let error: any = null;
    try {
      await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });
    } catch (e) {
      error = e;
    }
    expect(error?.status).to.equal(403);
  });

  it('keeps the run start date when its jobs cannot be read', async () => {
    mockGithub({ push: [rawRun(1, 'Process Deployment (sfdx-hardis)', 'success')] }, {}, true);
    const provider = new GithubProvider({ remoteUrl: 'https://github.com/acme/widgets.git', token: 'tok' });
    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });
    expect(runs.map((run) => run.startedAt)).to.deep.equal(['2026-09-10T10:00:05Z']);
  });

  it('targets a GitHub Enterprise repository from its URL, whatever the CI variables say', async () => {
    process.env.GITHUB_REPOSITORY = 'other/monitoring';
    process.env.GITHUB_API_URL = 'https://api.github.com';
    mockGithub({ push: [] });
    const provider = new GithubProvider({ remoteUrl: 'git@github.acme.com:team/sfdx-project.git', token: 'tok' });
    await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });
    expect(requests[0].origin + requests[0].pathname).to.equal('https://github.acme.com/api/v3/repos/team/sfdx-project/actions/runs');
  });

  describe('GitProvider.getInstanceForRepository', () => {
    const options = { tokenVariableName: 'SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN' };

    it('uses the token given, on the provider the URL names', () => {
      process.env.GITHUB_TOKEN = 'monitoring-token';
      const provider = GitProvider.getInstanceForRepository('https://bitbucket.org/acme/sfdx-project.git', { ...options, token: 'deployment-token' });
      expect(provider).to.be.instanceOf(BitbucketProvider);
    });

    it('falls back on the token of the current repository when it is on the same provider', () => {
      process.env.GITHUB_TOKEN = 'monitoring-token';
      const provider = GitProvider.getInstanceForRepository('https://github.com/acme/sfdx-project.git', options);
      expect(provider).to.be.instanceOf(GithubProvider);
    });

    it('names the variable to set when the only token is the one of another provider', () => {
      process.env.GITHUB_TOKEN = 'monitoring-token';
      expect(() => GitProvider.getInstanceForRepository('https://gitlab.com/acme/sfdx-project.git', options)).to.throw(/SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN/);
    });

    it('fails when there is no token at all', () => {
      expect(() => GitProvider.getInstanceForRepository('https://github.com/acme/sfdx-project.git', options)).to.throw(/SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN/);
    });
  });
});
