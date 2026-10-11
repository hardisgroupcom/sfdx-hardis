import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
// (azureDevops -> utils/index -> gitUtils -> ticketProvider/index -> jiraProvider, which extends
// TicketProviderRoot), and entering through a leaf module of it throws.
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';
import { BuildQueryOrder, BuildReason, BuildResult, BuildStatus } from 'azure-devops-node-api/interfaces/BuildInterfaces.js';

const REPOSITORY_GUID = '0f0e0d0c-1111-2222-3333-444455556666';
const MIN_DATE = new Date('2026-09-01T00:00:00.000Z');

// Positions of the getBuilds arguments the provider sets
const ARG = { project: 0, minTime: 4, reasonFilter: 7, statusFilter: 8, top: 12, continuationToken: 13, queryOrder: 16, branchName: 17, repositoryId: 19, repositoryType: 20 };

// DORA metrics are computed from the builds of the deployment repository, which is most often not
// the repository of the current folder: nothing may come from the CI variables of the job.
describe('AzureDevopsProvider.listCiRuns', () => {
  const saved: Record<string, string | undefined> = {};
  const names = ['SYSTEM_COLLECTIONURI', 'SYSTEM_TEAMPROJECT', 'BUILD_REPOSITORY_ID', 'BUILD_REPOSITORY_NAME', 'BUILD_REPOSITORYNAME', 'SYSTEM_ACCESSTOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'AZURE_DEVOPS_EXT_PAT'];

  beforeEach(() => {
    for (const name of names) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of names) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  });

  const build = (overrides: any = {}) => ({
    id: 100,
    definition: { name: 'Deployment' },
    reason: BuildReason.IndividualCI,
    result: BuildResult.Succeeded,
    sourceBranch: 'refs/heads/integration',
    sourceVersion: 'abc1234',
    queueTime: new Date('2026-09-10T10:00:00.000Z'),
    startTime: new Date('2026-09-10T10:01:00.000Z'),
    finishTime: new Date('2026-09-10T10:09:00.000Z'),
    requestedFor: { displayName: 'Ada Lovelace' },
    requestedBy: { displayName: 'Project Build Service' },
    _links: { web: { href: 'https://dev.azure.com/acme/My%20Project/_build/results?buildId=100' } },
    ...overrides,
  });

  // The provider built for another repository, with the Build and Git APIs it asks azureApi for
  const buildProvider = (getBuilds: (...args: any[]) => Promise<any[]>, gitApi: any = {}) => {
    const provider = new AzureDevopsProvider({ remoteUrl: 'https://dev.azure.com/acme/My%20Project/_git/my-repo', token: 'x' }) as any;
    const gitCalls: any[][] = [];
    provider.azureApi = {
      getBuildApi: async () => ({ getBuilds, getBuildTimeline: async () => ({ records: [] }) }),
      getGitApi: async () => ({
        getRepository: async (...args: any[]) => {
          gitCalls.push(args);
          return { id: REPOSITORY_GUID, name: 'my-repo' };
        },
        ...gitApi,
      }),
    };
    return { provider, gitCalls };
  };

  it('is built for the repository of a remote URL without any CI variable', () => {
    const provider = new AzureDevopsProvider({ remoteUrl: 'https://dev.azure.com/acme/My%20Project/_git/my-repo', token: 'x' }) as any;

    expect(provider.serverUrl).to.equal('https://dev.azure.com/acme/');
    expect(provider.token).to.equal('x');
    expect(provider.teamProjectName).to.equal('My Project');
    expect(provider.repositoryIdOrName).to.equal('my-repo');
    expect(provider.buildPullRequestWebUrl(12)).to.equal('https://dev.azure.com/acme/My%20Project/_git/my-repo/pullrequest/12');
  });

  it('prefers the repository it was built for over the CI variables of the job', () => {
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/other/';
    process.env.SYSTEM_TEAMPROJECT = 'other-project';
    process.env.BUILD_REPOSITORY_ID = 'other-repo';
    process.env.SYSTEM_ACCESSTOKEN = 'job-token';

    const provider = new AzureDevopsProvider({ remoteUrl: 'https://dev.azure.com/acme/My%20Project/_git/my-repo', token: 'x' }) as any;

    expect(provider.serverUrl).to.equal('https://dev.azure.com/acme/');
    expect(provider.token).to.equal('x');
    expect(provider.teamProjectName).to.equal('My Project');
    expect(provider.repositoryIdOrName).to.equal('my-repo');
  });

  it('refuses a remote URL that is not an Azure DevOps one', () => {
    expect(() => new AzureDevopsProvider({ remoteUrl: 'https://github.com/acme/my-repo.git', token: 'x' })).to.throw();
  });

  it('still reads the CI variables when built without argument', () => {
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme/';
    process.env.SYSTEM_TEAMPROJECT = 'acme-project';
    process.env.BUILD_REPOSITORY_ID = REPOSITORY_GUID;
    process.env.SYSTEM_ACCESSTOKEN = 'job-token';

    const provider = new AzureDevopsProvider() as any;

    expect(provider.serverUrl).to.equal('https://dev.azure.com/acme/');
    expect(provider.token).to.equal('job-token');
    expect(provider.teamProjectName).to.equal('acme-project');
    expect(provider.repositoryIdOrName).to.equal(REPOSITORY_GUID);
  });

  it('asks for the completed builds of each branch of this repository, and resolves its id once', async () => {
    const calls: any[][] = [];
    const { provider, gitCalls } = buildProvider(async (...args: any[]) => {
      calls.push(args);
      return [];
    });

    await provider.listCiRuns({ branches: ['integration', 'main'], minDate: MIN_DATE, kinds: ['deployment', 'validation'] });

    expect(gitCalls).to.deep.equal([['my-repo', 'My Project']]);
    expect(calls).to.have.length(3);
    for (const call of calls) {
      expect(call[ARG.project]).to.equal('My Project');
      expect(call[ARG.minTime]).to.equal(MIN_DATE);
      expect(call[ARG.statusFilter]).to.equal(BuildStatus.Completed);
      expect(call[ARG.continuationToken]).to.equal(undefined);
      expect(call[ARG.queryOrder]).to.equal(BuildQueryOrder.FinishTimeAscending);
      expect(call[ARG.repositoryId]).to.equal(REPOSITORY_GUID);
      expect(call[ARG.repositoryType]).to.equal('TfsGit');
    }
    expect(calls.map((call) => call[ARG.branchName])).to.deep.equal(['refs/heads/integration', 'refs/heads/main', undefined]);
    expect(calls.map((call) => call[ARG.reasonFilter])).to.deep.equal([undefined, undefined, BuildReason.PullRequest]);
  });

  it('skips the listing of a kind that is not asked for', async () => {
    const calls: any[][] = [];
    const { provider } = buildProvider(async (...args: any[]) => {
      calls.push(args);
      return [];
    });

    await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['validation'] });
    expect(calls.map((call) => call[ARG.reasonFilter])).to.deep.equal([BuildReason.PullRequest]);

    calls.length = 0;
    await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });
    expect(calls.map((call) => call[ARG.branchName])).to.deep.equal(['refs/heads/integration']);
  });

  it('uses the repository GUID of a pipeline job without asking the Git API', async () => {
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme/';
    process.env.SYSTEM_TEAMPROJECT = 'acme-project';
    process.env.BUILD_REPOSITORY_ID = REPOSITORY_GUID;
    const calls: any[][] = [];
    const provider = new AzureDevopsProvider() as any;
    provider.azureApi = {
      getBuildApi: async () => ({
        getBuildTimeline: async () => ({ records: [] }),
        getBuilds: async (...args: any[]) => {
          calls.push(args);
          return [];
        },
      }),
      getGitApi: async () => {
        throw new Error('the Git API must not be asked');
      },
    };

    await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(calls[0][ARG.project]).to.equal('acme-project');
    expect(calls[0][ARG.repositoryId]).to.equal(REPOSITORY_GUID);
  });

  it('keeps the builds of a push or a manual run as deployments, and drops the others', async () => {
    const { provider } = buildProvider(async () => [
      build({ id: 1, reason: BuildReason.IndividualCI }),
      build({ id: 2, reason: BuildReason.BatchedCI }),
      build({ id: 3, reason: BuildReason.Manual }),
      build({ id: 4, reason: BuildReason.PullRequest }),
      build({ id: 5, reason: BuildReason.Schedule }),
      build({ id: 6, reason: BuildReason.BuildCompletion }),
    ]);

    const runs = await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(runs.map((run: any) => run.id)).to.deep.equal(['1', '2', '3']);
    expect(runs[0]).to.deep.equal({
      id: '1',
      name: 'Deployment',
      kind: 'deployment',
      branch: 'integration',
      status: 'succeeded',
      queuedAt: '2026-09-10T10:00:00.000Z',
      startedAt: '2026-09-10T10:01:00.000Z',
      finishedAt: '2026-09-10T10:09:00.000Z',
      commitSha: 'abc1234',
      triggeredBy: 'Ada Lovelace',
      webUrl: 'https://dev.azure.com/acme/My%20Project/_build/results?buildId=100',
    });
  });

  it('classifies on the pipeline name: a MegaLinter build of the branch is not a deployment', async () => {
    const { provider } = buildProvider(async () => [
      build({ id: 1, definition: { name: 'Deployment' } }),
      build({ id: 2, definition: { name: 'MegaLinter' } }),
    ]);

    const runs = await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(runs.map((run: any) => run.id)).to.deep.equal(['1']);
  });

  it('falls back on the other fields when a build misses some', async () => {
    const { provider } = buildProvider(async () => [
      build({ id: 1, startTime: undefined, finishTime: undefined, sourceVersion: undefined, requestedFor: undefined, _links: undefined }),
      build({ id: 2, queueTime: undefined, startTime: undefined, requestedFor: undefined, requestedBy: undefined }),
    ]);

    const runs = await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(runs[0].startedAt).to.equal('2026-09-10T10:00:00.000Z');
    expect(runs[0].finishedAt).to.equal('');
    expect(runs[0].commitSha).to.equal('');
    expect(runs[0].triggeredBy).to.equal('Project Build Service');
    expect(runs[0].webUrl).to.equal('');
    expect(runs[1].queuedAt).to.equal('');
    expect(runs[1].startedAt).to.equal('');
    expect(runs[1].triggeredBy).to.equal('');
  });

  it('maps the Pull Request builds with the number and the target branch of their trigger', async () => {
    const { provider } = buildProvider(async () => [
      build({
        id: 7,
        definition: { name: 'DeploymentCheck' },
        reason: BuildReason.PullRequest,
        sourceBranch: 'refs/pull/34/merge',
        triggerInfo: { 'pr.number': '34', 'pr.targetBranch': 'refs/heads/integration' },
      }),
      // No trigger info: the number comes from the merge ref, and the target branch is unknown
      build({ id: 8, definition: { name: 'DeploymentCheck' }, reason: BuildReason.PullRequest, sourceBranch: 'refs/pull/12/merge' }),
      // Not a deployment check
      build({ id: 9, definition: { name: 'MegaLinter' }, reason: BuildReason.PullRequest, sourceBranch: 'refs/pull/12/merge' }),
      // The server filter is not trusted alone
      build({ id: 10, definition: { name: 'DeploymentCheck' }, reason: BuildReason.IndividualCI }),
    ]);

    const runs = await provider.listCiRuns({ branches: [], minDate: MIN_DATE, kinds: ['validation'] });

    expect(runs.map((run: any) => [run.id, run.kind, run.pullRequestId, run.branch])).to.deep.equal([
      ['7', 'validation', '34', 'integration'],
      ['8', 'validation', '12', ''],
    ]);
  });

  it('maps the result of a build, and skips a build without a usable one', async () => {
    const { provider } = buildProvider(async () => [
      build({ id: 1, result: BuildResult.Succeeded }),
      build({ id: 2, result: BuildResult.PartiallySucceeded }),
      build({ id: 3, result: BuildResult.Failed }),
      build({ id: 4, result: BuildResult.Canceled }),
      build({ id: 5, result: BuildResult.None }),
      build({ id: 6, result: undefined }),
    ]);

    const runs = await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(runs.map((run: any) => [run.id, run.status])).to.deep.equal([
      ['1', 'succeeded'],
      ['2', 'succeeded'],
      ['3', 'failed'],
      ['4', 'canceled'],
    ]);
  });

  it('asks again from the finish time of the last build while pages come back full', async () => {
    const pageSize = (AzureDevopsProvider as any).BUILDS_PAGE_SIZE;
    const calls: any[][] = [];
    const lastOfFirstPage = new Date('2026-09-12T08:00:00.000Z');
    const firstPage = Array.from({ length: pageSize }, (_, index) =>
      build({ id: index + 1, finishTime: index === pageSize - 1 ? lastOfFirstPage : new Date('2026-09-11T08:00:00.000Z') }),
    );
    // The second window starts at a time already seen: its first build comes back again
    const secondPage = [firstPage[pageSize - 1], build({ id: pageSize + 1, finishTime: new Date('2026-09-13T08:00:00.000Z') })];
    const { provider } = buildProvider(async (...args: any[]) => {
      calls.push(args);
      return calls.length === 1 ? firstPage : secondPage;
    });

    const runs = await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(calls).to.have.length(2);
    expect(calls[0][ARG.top]).to.equal(pageSize);
    expect(calls[0][ARG.minTime]).to.equal(MIN_DATE);
    expect(calls[1][ARG.minTime].toISOString()).to.equal(lastOfFirstPage.toISOString());
    expect(runs).to.have.length(pageSize + 1);
    expect(new Set(runs.map((run: any) => run.id)).size).to.equal(pageSize + 1);
  });

  it('stops when a full page brings nothing new', async () => {
    const pageSize = (AzureDevopsProvider as any).BUILDS_PAGE_SIZE;
    const samePage = Array.from({ length: pageSize }, (_, index) => build({ id: index + 1 }));
    let callsCount = 0;
    const { provider } = buildProvider(async () => {
      callsCount++;
      return samePage;
    });

    const runs = await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });

    expect(callsCount).to.equal(2);
    expect(runs).to.have.length(pageSize);
  });

  it('throws an error of the Build API instead of answering an empty list', async () => {
    const { provider } = buildProvider(async () => {
      throw new Error('TF400813: The user is not authorized to access this resource');
    });

    let thrown: Error | null = null;
    try {
      await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown?.message).to.contain('TF400813');
  });

  it('reads what a build did from its own job, whatever the pipeline is called', async () => {
    const getBuilds = async (...args: any[]) =>
      args[7] === BuildReason.PullRequest
        ? [
          build({
            id: 201,
            // The name typed when the pipeline was created says nothing, and the build failed because of MegaLinter
            definition: { name: 'sfdx-hardis check (my-repo)' },
            reason: BuildReason.PullRequest,
            result: BuildResult.Failed,
            sourceBranch: 'refs/pull/42/merge',
            triggerInfo: { 'pr.number': '42' },
            parameters: JSON.stringify({ 'system.pullRequest.sourceBranch': 'refs/heads/feature/a', 'system.pullRequest.targetBranch': 'refs/heads/integration' }),
          }),
          // Its deployment check was skipped: nothing was checked
          build({ id: 202, definition: { name: 'sfdx-hardis check (my-repo)' }, reason: BuildReason.PullRequest, sourceBranch: 'refs/pull/43/merge' }),
        ]
        : [build({ id: 101, definition: { name: 'sfdx-hardis deployment (my-repo)' } })];
    const { provider } = buildProvider(getBuilds);
    const timelines: Record<number, any[]> = {
      101: [{ type: 'Job', name: 'Deployment', result: 0, startTime: new Date('2026-09-10T10:02:00.000Z'), finishTime: new Date('2026-09-10T10:08:00.000Z') }],
      201: [
        { type: 'Stage', name: 'DeploymentCheck', result: 2 },
        { type: 'Job', name: 'MegaLinter', result: 2 },
        { type: 'Job', name: 'DeploymentCheck', result: 1, startTime: new Date('2026-09-10T10:03:00.000Z'), finishTime: new Date('2026-09-10T10:07:00.000Z') },
      ],
      202: [{ type: 'Job', name: 'DeploymentCheck', result: 4 }],
    };
    const timelineCalls: any[][] = [];
    const buildApi = await provider.azureApi.getBuildApi();
    provider.azureApi.getBuildApi = async () => ({
      ...buildApi,
      getBuildTimeline: async (...args: any[]) => {
        timelineCalls.push(args);
        return { records: timelines[args[1]] };
      },
    });

    const runs = await provider.listCiRuns({ branches: ['integration'], minDate: new Date('2026-09-01T00:00:00.000Z'), kinds: ['deployment', 'validation'] });

    expect(runs.map((run: any) => [run.id, run.kind, run.name, run.status, run.branch, run.sourceBranch, run.startedAt, run.finishedAt])).to.deep.equal([
      ['101', 'deployment', 'Deployment', 'succeeded', 'integration', undefined, '2026-09-10T10:02:00.000Z', '2026-09-10T10:08:00.000Z'],
      ['201', 'validation', 'DeploymentCheck', 'succeeded', 'integration', 'feature/a', '2026-09-10T10:03:00.000Z', '2026-09-10T10:07:00.000Z'],
    ]);
    expect(timelineCalls.map((args) => args[0])).to.deep.equal(['My Project', 'My Project', 'My Project']);
  });

  it('throws when the jobs of a build cannot be read', async () => {
    const { provider } = buildProvider(async (...args: any[]) => (args[7] === BuildReason.PullRequest ? [] : [build()]));
    const buildApi = await provider.azureApi.getBuildApi();
    provider.azureApi.getBuildApi = async () => ({
      ...buildApi,
      getBuildTimeline: async () => {
        throw new Error('timeline unavailable');
      },
    });
    let error: any = null;
    try {
      await provider.listCiRuns({ branches: ['integration'], minDate: new Date('2026-09-01T00:00:00.000Z'), kinds: ['deployment'] });
    } catch (e) {
      error = e;
    }
    expect(error?.message).to.contain('timeline unavailable');
  });

  it('throws when the repository cannot be found, or the Git API fails', async () => {
    const notFound = buildProvider(async () => [], { getRepository: async () => null });
    const failing = buildProvider(async () => [], {
      getRepository: async () => {
        throw new Error('TF401019');
      },
    });

    for (const { provider } of [notFound, failing]) {
      let thrown: Error | null = null;
      try {
        await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).to.not.equal(null);
    }
  });

  it('throws when neither the repository nor the team project is known', async () => {
    const provider = new AzureDevopsProvider() as any;
    provider.azureApi = { getBuildApi: async () => ({ getBuilds: async () => [] }), getGitApi: async () => ({}) };

    let thrown: Error | null = null;
    try {
      await provider.listCiRuns({ branches: ['integration'], minDate: MIN_DATE, kinds: ['deployment'] });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).to.not.equal(null);
  });

  it('lists the Pull Requests of the repository it was built for', async () => {
    const calls: any[][] = [];
    const { provider } = buildProvider(async () => [], {
      getPullRequests: async (...args: any[]) => {
        calls.push(args);
        return [{ pullRequestId: 12, targetRefName: 'refs/heads/integration', sourceRefName: 'refs/heads/feature/one', repository: { id: REPOSITORY_GUID } }];
      },
      getThreads: async (...args: any[]) => {
        calls.push(args);
        return [];
      },
    });

    const pullRequests = await provider.listPullRequests({ pullRequestStatus: 'merged', targetBranch: 'integration' });

    expect(calls[0][0]).to.equal('my-repo');
    expect(calls[0][2]).to.equal('My Project');
    expect(calls[1]).to.deep.equal([REPOSITORY_GUID, 12, 'My Project']);
    expect(pullRequests[0].webUrl).to.equal('https://dev.azure.com/acme/My%20Project/_git/my-repo/pullrequest/12');
  });
});
