import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
import '../../../src/common/gitProvider/index.js';
import { GitlabProvider } from '../../../src/common/gitProvider/gitlab.js';

// DORA metrics are computed from the jobs GitLab lists. The listing has no date filter, so the
// paging has to stop by itself, and a job says what triggered it only through its ref and the
// source of its pipeline. An API error must come out: an empty list would read as "no deployment".
describe('GitlabProvider.listCiRuns', () => {
  const CI_VARIABLES = [
    'CI_SERVER_URL',
    'CI_PROJECT_ID',
    'CI_PROJECT_PATH',
    'CI_JOB_TOKEN',
    'CI_SFDX_HARDIS_GITLAB_TOKEN',
    'ACCESS_TOKEN',
    'CI_MERGE_REQUEST_IID',
  ];

  // Runs with the given CI variables only, and puts the previous ones back afterwards
  const withEnv = async (values: Record<string, string>, run: () => Promise<void>) => {
    const previous: Record<string, string | undefined> = {};
    for (const name of CI_VARIABLES) {
      previous[name] = process.env[name];
      delete process.env[name];
    }
    Object.assign(process.env, values);
    try {
      await run();
    } finally {
      for (const name of CI_VARIABLES) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  };

  const REPOSITORY = { remoteUrl: 'https://gitlab.example.com/group/sub/project.git', token: 'x' };
  const MIN_DATE = new Date('2026-09-01T00:00:00Z');

  // One job as GitLab returns it in the project jobs listing
  const rawJob = (id: number, name: string, ref: string, overrides: any = {}) => ({
    id,
    name,
    ref,
    tag: false,
    status: 'success',
    created_at: '2026-09-10T10:00:00.000Z',
    started_at: '2026-09-10T10:01:00.000Z',
    finished_at: '2026-09-10T10:05:00.000Z',
    commit: { id: `sha-${id}` },
    pipeline: { id: id * 10, sha: `pipeline-sha-${id}`, ref, source: ref.startsWith('refs/merge-requests/') ? 'merge_request_event' : 'push' },
    user: { name: 'Jane Doe', username: 'jdoe' },
    web_url: `https://gitlab.example.com/group/sub/project/-/jobs/${id}`,
    ...overrides,
  });

  // Replaces the GitLab client with one that records the calls and serves fixed pages
  const stubClient = (provider: any, pages: any[][]) => {
    const calls: Array<{ projectId: any; options: any }> = [];
    provider.gitlabApi = {
      Jobs: {
        all: async (projectId: any, options: any) => {
          calls.push({ projectId, options });
          return pages[(options.page || 1) - 1] || [];
        },
      },
    };
    return calls;
  };

  const fullPage = (firstId: number, createdAt: string) =>
    Array.from({ length: 100 }, (_, index) => rawJob(firstId - index, 'deploy_to_org', 'main', { created_at: createdAt }));

  it('targets the host and the project of the repository given, without any CI variable', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      expect(provider.serverUrl).to.equal('https://gitlab.example.com');
      expect(provider.token).to.equal('x');
      // The real client, before it is stubbed: its base URL is the one of the repository host
      expect(String((provider as any).gitlabApi.Jobs.url)).to.contain('https://gitlab.example.com/api/v4');

      const calls = stubClient(provider as any, [[rawJob(1, 'deploy_to_org', 'main')]]);
      const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

      expect(calls[0].projectId).to.equal('group/sub/project');
      expect(runs.length).to.equal(1);
    });
  });

  it('ignores the CI variables of the current job when a repository is given', async () => {
    await withEnv(
      { CI_SERVER_URL: 'https://gitlab.com', CI_PROJECT_ID: '4242', CI_PROJECT_PATH: 'other/project', CI_SFDX_HARDIS_GITLAB_TOKEN: 'current' },
      async () => {
        const provider = new GitlabProvider({ remoteUrl: 'git@gitlab.example.com:group/sub/project.git', token: 'x' });
        const calls = stubClient(provider as any, [[]]);

        await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

        expect(provider.serverUrl).to.equal('https://gitlab.example.com');
        expect(provider.token).to.equal('x');
        expect(calls[0].projectId).to.equal('group/sub/project');
      },
    );
  });

  it('refuses a repository URL it cannot read', async () => {
    await withEnv({}, async () => {
      expect(() => new GitlabProvider({ remoteUrl: 'not a url', token: 'x' })).to.throw();
    });
  });

  it('keeps reading the project from the CI variables without the argument', async () => {
    await withEnv({ CI_SERVER_URL: 'https://gitlab.com', CI_PROJECT_ID: '4242' }, async () => {
      const provider = new GitlabProvider();
      const calls = stubClient(provider as any, [[]]);

      await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

      expect(calls[0].projectId).to.equal('4242');
    });
  });

  it('asks for the finished jobs, 100 per page', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      const calls = stubClient(provider as any, [[]]);

      await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment', 'validation'] });

      expect(calls.length).to.equal(1);
      expect(calls[0].options).to.deep.equal({ scope: ['success', 'failed', 'canceled'], perPage: 100, page: 1 });
    });
  });

  it('stops paging at the first page that is entirely older than minDate', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      const straddling = fullPage(800, '2026-09-05T00:00:00.000Z');
      // The second half of the page is older than the window
      for (const job of straddling.slice(50)) {
        job.created_at = '2026-08-20T00:00:00.000Z';
      }
      const calls = stubClient(provider as any, [
        fullPage(1000, '2026-09-20T00:00:00.000Z'),
        straddling,
        fullPage(600, '2026-08-10T00:00:00.000Z'),
        fullPage(400, '2026-07-10T00:00:00.000Z'),
      ]);

      const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

      expect(calls.map((call) => call.options.page)).to.deep.equal([1, 2, 3]);
      expect(runs.length).to.equal(150);
      expect(runs.every((run) => run.queuedAt >= '2026-09-01')).to.equal(true);
    });
  });

  it('stops paging at the last page of the listing', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      const calls = stubClient(provider as any, [fullPage(1000, '2026-09-20T00:00:00.000Z'), [rawJob(1, 'deploy_to_org', 'main')]]);

      const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

      expect(calls.length).to.equal(2);
      expect(runs.length).to.equal(101);
    });
  });

  it('tells the deployment of a branch from the check of a merge request', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      stubClient(provider as any, [[
        rawJob(10, 'deploy_to_org', 'main'),
        rawJob(9, 'check_quality', 'main'),
        rawJob(8, 'check_deploy_to_target_branch_org', 'refs/merge-requests/42/head'),
        rawJob(7, 'check_quality', 'refs/merge-requests/42/head'),
        rawJob(6, 'check_deploy_to_target_branch_org', 'refs/merge-requests/43/merge'),
        // Source branch as the ref: only the pipeline source says it is a merge request
        rawJob(5, 'check_deploy_to_target_branch_org', 'feature/abc', { pipeline: { id: 50, sha: 'pipeline-sha-5', source: 'merge_request_event' } }),
      ]]);

      const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment', 'validation'] });

      expect(runs.map((run) => [run.id, run.kind, run.branch, run.pullRequestId])).to.deep.equal([
        ['10', 'deployment', 'main', undefined],
        ['8', 'validation', '', '42'],
        ['6', 'validation', '', '43'],
        ['5', 'validation', '', ''],
      ]);
    });
  });

  it('never reads a merge request job as a deployment, even on a branch asked for', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      stubClient(provider as any, [[
        rawJob(3, 'deploy_to_org', 'integration', { pipeline: { id: 30, sha: 'pipeline-sha-3', source: 'merge_request_event' } }),
        rawJob(2, 'deploy_to_org', 'integration', { tag: true }),
      ]]);

      const runs = await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment', 'validation'] });

      expect(runs).to.deep.equal([]);
    });
  });

  it('fills the run from the job', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      stubClient(provider as any, [[
        rawJob(10, 'deploy_to_org', 'main'),
        // Never picked by a runner, and no commit nor user name
        rawJob(9, 'deploy_to_org', 'main', { status: 'canceled', started_at: null, finished_at: null, commit: null, user: { username: 'jdoe' }, web_url: undefined }),
      ]]);

      const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

      expect(runs[0]).to.deep.equal({
        id: '10',
        name: 'deploy_to_org',
        kind: 'deployment',
        branch: 'main',
        status: 'succeeded',
        queuedAt: '2026-09-10T10:00:00.000Z',
        startedAt: '2026-09-10T10:01:00.000Z',
        finishedAt: '2026-09-10T10:05:00.000Z',
        commitSha: 'sha-10',
        triggeredBy: 'Jane Doe',
        webUrl: 'https://gitlab.example.com/group/sub/project/-/jobs/10',
      });
      expect(runs[1]).to.deep.equal({
        id: '9',
        name: 'deploy_to_org',
        kind: 'deployment',
        branch: 'main',
        status: 'canceled',
        queuedAt: '2026-09-10T10:00:00.000Z',
        startedAt: '2026-09-10T10:00:00.000Z',
        finishedAt: '',
        commitSha: 'pipeline-sha-9',
        triggeredBy: 'jdoe',
        webUrl: '',
      });
    });
  });

  it('maps the job statuses and skips the ones that are not an outcome', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      stubClient(provider as any, [[
        rawJob(5, 'deploy_to_org', 'main', { status: 'success' }),
        rawJob(4, 'deploy_to_org', 'main', { status: 'failed' }),
        rawJob(3, 'deploy_to_org', 'main', { status: 'canceled' }),
        rawJob(2, 'deploy_to_org', 'main', { status: 'skipped' }),
        rawJob(1, 'deploy_to_org', 'main', { status: 'manual' }),
      ]]);

      const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });

      expect(runs.map((run) => [run.id, run.status])).to.deep.equal([
        ['5', 'succeeded'],
        ['4', 'failed'],
        ['3', 'canceled'],
      ]);
    });
  });

  it('ignores a job of a branch that was not asked for', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      stubClient(provider as any, [[
        rawJob(3, 'deploy_to_org', 'main'),
        rawJob(2, 'deploy_to_org', 'feature/abc'),
        rawJob(1, 'deploy_to_org', 'preprod'),
      ]]);

      const runs = await provider.listCiRuns({ branches: ['main', 'preprod'], minDate: MIN_DATE, kinds: ['deployment'] });

      expect(runs.map((run) => run.branch)).to.deep.equal(['main', 'preprod']);
    });
  });

  it('leaves out the pipelines of a branch that no merge triggered', async () => {
    const provider = new GitlabProvider(REPOSITORY);
    const withSource = (id: number, source: string) => rawJob(id, 'deploy_to_org', 'main', { pipeline: { id: id * 10, ref: 'main', source } });
    stubClient(provider as any, [[withSource(5, 'push'), withSource(4, 'web'), withSource(3, 'schedule'), withSource(2, 'api'), withSource(1, 'trigger')]]);

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment', 'validation'] });

    expect(runs.map((run: any) => run.id)).to.deep.equal(['5', '4']);
  });

  it('returns only the kinds asked for', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      const jobs = [rawJob(2, 'deploy_to_org', 'main'), rawJob(1, 'check_deploy_to_target_branch_org', 'refs/merge-requests/42/head')];
      stubClient(provider as any, [jobs]);

      const deployments = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });
      const validations = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['validation'] });

      expect(deployments.map((run) => run.id)).to.deep.equal(['2']);
      expect(validations.map((run) => run.id)).to.deep.equal(['1']);
    });
  });

  it('throws an API error instead of returning an empty list', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      (provider as any).gitlabApi = {
        Jobs: {
          all: async () => {
            throw new Error('403 Forbidden');
          },
        },
      };

      let thrown: any = null;
      try {
        await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment', 'validation'] });
      } catch (e) {
        thrown = e;
      }

      expect(thrown?.message).to.equal('403 Forbidden');
    });
  });

  it('throws an API error met on a later page', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider(REPOSITORY);
      (provider as any).gitlabApi = {
        Jobs: {
          all: async (_projectId: any, options: any) => {
            if (options.page === 2) {
              throw new Error('500 Internal Server Error');
            }
            return fullPage(1000, '2026-09-20T00:00:00.000Z');
          },
        },
      };

      let thrown: any = null;
      try {
        await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });
      } catch (e) {
        thrown = e;
      }

      expect(thrown?.message).to.equal('500 Internal Server Error');
    });
  });

  it('throws when no project is known', async () => {
    await withEnv({}, async () => {
      const provider = new GitlabProvider();
      const calls = stubClient(provider as any, [[rawJob(1, 'deploy_to_org', 'main')]]);

      let thrown: any = null;
      try {
        await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['deployment'] });
      } catch (e) {
        thrown = e;
      }

      expect(thrown).to.not.equal(null);
      expect(calls.length).to.equal(0);
    });
  });
});
