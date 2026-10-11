import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
import '../../../src/common/gitProvider/index.js';
import { BitbucketProvider } from '../../../src/common/gitProvider/bitbucket.js';
import { httpStatusOf } from '../../../src/common/utils/adaptiveBatch.js';

// DORA metrics are computed from what listCiRuns returns. Bitbucket lists pipelines, which have no
// name: what a pipeline does is read from its steps. Anything that goes wrong on the way has to be
// thrown, because an empty list reads as "no deployment".
describe('BitbucketProvider.listCiRuns', () => {
  const ENV_VARS = [
    'BITBUCKET_WORKSPACE', 'BITBUCKET_REPO_SLUG', 'BITBUCKET_BRANCH', 'BITBUCKET_PR_ID', 'BITBUCKET_BUILD_NUMBER',
    'CI_SFDX_HARDIS_BITBUCKET_TOKEN', 'CI_SFDX_HARDIS_BITBUCKET_EMAIL',
  ];
  const saved: Record<string, string | undefined> = {};

  // No CI variable at all: the repository is the one given to the constructor
  beforeEach(() => {
    for (const name of ENV_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  const MIN_DATE = new Date('2026-09-01T00:00:00Z');
  const ALL_KINDS: Array<'deployment' | 'validation'> = ['deployment', 'validation'];

  const newProvider = () => new BitbucketProvider({ remoteUrl: 'https://bitbucket.org/acme/sfdx-project.git', token: 'x' });

  // One pipeline of a branch as Bitbucket returns it
  const branchPipeline = (buildNumber: number, branch: string, result: string, createdOn: string, extra: any = {}) => ({
    uuid: `{pipeline-${buildNumber}}`,
    build_number: buildNumber,
    created_on: createdOn,
    completed_on: createdOn.replace(':00:00Z', ':30:00Z'),
    state: { name: 'COMPLETED', result: { name: result } },
    trigger: { name: 'PUSH', type: 'pipeline_trigger_push' },
    target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: branch, commit: { hash: `sha${buildNumber}` } },
    creator: { display_name: 'Victor' },
    ...extra,
  });

  // One pipeline of a Pull Request
  const pullRequestPipeline = (buildNumber: number, prId: number, destination: string, result: string, createdOn: string) => ({
    ...branchPipeline(buildNumber, '', result, createdOn),
    target: {
      type: 'pipeline_pullrequest_target',
      source: `feature/${prId}`,
      destination,
      pullrequest: { id: prId },
      commit: { hash: `sha${buildNumber}` },
    },
  });

  const step = (name: string, result: string, startedOn: string, completedOn: string = startedOn) => ({
    name,
    started_on: startedOn,
    completed_on: completedOn,
    state: { name: 'COMPLETED', result: { name: result } },
  });

  const httpError = (status: number) => Object.assign(new Error(status === 403 ? 'Forbidden' : 'Not Found'), { name: 'HTTPError', status });

  // Replaces the Bitbucket client with one that records the parameters, serves fixed pages of
  // pipelines and the steps of each pipeline
  const stubClient = (provider: any, pages: any[][], stepsByUuid: Record<string, any[]> = {}) => {
    const calls = { list: [] as any[], listSteps: [] as any[] };
    provider.bitbucket = {
      pipelines: {
        list: async (params: any) => {
          calls.list.push(params);
          return { data: { values: pages[(params.page || 1) - 1] || [] } };
        },
        listSteps: async (params: any) => {
          calls.listSteps.push(params);
          return { data: { values: stepsByUuid[params.pipeline_uuid] || [] } };
        },
      },
    };
    return calls;
  };

  it('targets the repository of the remote URL, without any CI variable', async () => {
    const provider = newProvider();
    const calls = stubClient(provider as any, [[branchPipeline(7, 'main', 'SUCCESSFUL', '2026-09-10T10:00:00Z')]], {
      '{pipeline-7}': [step('Deploy to major org', 'SUCCESSFUL', '2026-09-10T10:02:00Z')],
    });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(calls.list[0]).to.include({ workspace: 'acme', repo_slug: 'sfdx-project', sort: '-created_on', pagelen: 100, page: 1 });
    expect(calls.listSteps[0]).to.include({ workspace: 'acme', repo_slug: 'sfdx-project', pipeline_uuid: '{pipeline-7}' });
    expect(runs).to.deep.equal([{
      id: '{pipeline-7}',
      name: 'Deploy to major org',
      kind: 'deployment',
      branch: 'main',
      status: 'succeeded',
      queuedAt: '2026-09-10T10:00:00Z',
      startedAt: '2026-09-10T10:02:00Z',
      finishedAt: '2026-09-10T10:02:00Z',
      commitSha: 'sha7',
      triggeredBy: 'Victor',
      webUrl: 'https://bitbucket.org/acme/sfdx-project/pipelines/results/7',
    }]);
  });

  it('reads the workspace and the repository from an ssh remote URL', async () => {
    const provider = new BitbucketProvider({ remoteUrl: 'git@bitbucket.org:acme/sfdx-project.git', token: 'x' });
    const calls = stubClient(provider as any, [[]]);

    await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(calls.list[0]).to.include({ workspace: 'acme', repo_slug: 'sfdx-project' });
  });

  it('refuses a remote URL that is not a repository', () => {
    expect(() => new BitbucketProvider({ remoteUrl: 'not-a-url', token: 'x' })).to.throw();
  });

  it('lists the Pull Requests of the repository given to the constructor', async () => {
    const provider = newProvider();
    const calls: any[] = [];
    (provider as any).bitbucket = {
      repositories: {
        listPullRequests: async (params: any) => {
          calls.push(params);
          return { data: { values: [{ id: 1, state: 'MERGED', destination: { branch: { name: 'main' } } }] } };
        },
      },
    };

    const result = await provider.listPullRequests({ status: 'merged' });

    expect(calls[0]).to.include({ workspace: 'acme', repo_slug: 'sfdx-project' });
    expect(result?.map((pr) => pr.idNumber)).to.deep.equal([1]);
  });

  it('stops paging at the first page entirely older than minDate', async () => {
    const provider = newProvider();
    const calls = stubClient(provider as any, [
      [branchPipeline(5, 'main', 'SUCCESSFUL', '2026-09-20T10:00:00Z'), branchPipeline(4, 'main', 'SUCCESSFUL', '2026-09-15T10:00:00Z')],
      // Half of this page is before minDate: the next one still has to be asked
      [branchPipeline(3, 'main', 'SUCCESSFUL', '2026-09-02T10:00:00Z'), branchPipeline(2, 'main', 'SUCCESSFUL', '2026-08-30T10:00:00Z')],
      [branchPipeline(1, 'main', 'SUCCESSFUL', '2026-08-20T10:00:00Z')],
      [branchPipeline(0, 'main', 'SUCCESSFUL', '2026-08-10T10:00:00Z')],
    ]);

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(calls.list.map((params) => params.page)).to.deep.equal([1, 2, 3]);
    expect(runs.map((run) => run.id)).to.deep.equal(['{pipeline-5}', '{pipeline-4}', '{pipeline-3}']);
    expect(calls.listSteps.length, 'no steps call for a pipeline before minDate').to.equal(3);
  });

  it('stops paging when Bitbucket has no more pipelines', async () => {
    const provider = newProvider();
    const calls = stubClient(provider as any, [[branchPipeline(1, 'main', 'SUCCESSFUL', '2026-09-20T10:00:00Z')]]);

    await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(calls.list.map((params) => params.page)).to.deep.equal([1, 2]);
  });

  it('tells the pipelines of a branch from the pipelines of a Pull Request', async () => {
    const provider = newProvider();
    stubClient(provider as any, [[
      branchPipeline(2, 'main', 'SUCCESSFUL', '2026-09-12T10:00:00Z'),
      pullRequestPipeline(1, 42, 'main', 'SUCCESSFUL', '2026-09-11T10:00:00Z'),
    ]], {
      '{pipeline-2}': [step('Deploy to major org', 'SUCCESSFUL', '2026-09-12T10:01:00Z')],
      '{pipeline-1}': [step('Simulate SFDX deployment', 'SUCCESSFUL', '2026-09-11T10:01:00Z')],
    });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(runs.map((run) => [run.kind, run.branch, run.pullRequestId, run.name])).to.deep.equal([
      ['deployment', 'main', undefined, 'Deploy to major org'],
      ['validation', 'main', '42', 'Simulate SFDX deployment'],
    ]);
  });

  it('leaves out the scheduled and the custom pipelines of a branch', async () => {
    const provider = newProvider();
    const custom = branchPipeline(3, 'main', 'SUCCESSFUL', '2026-09-13T10:00:00Z', { trigger: { name: 'MANUAL', type: 'pipeline_trigger_manual' } });
    custom.target = { ...custom.target, selector: { type: 'custom', pattern: 'load-data' } } as any;
    stubClient(provider as any, [[
      custom,
      branchPipeline(2, 'main', 'SUCCESSFUL', '2026-09-12T10:00:00Z', { trigger: { name: 'SCHEDULE', type: 'pipeline_trigger_schedule' } }),
      branchPipeline(1, 'main', 'SUCCESSFUL', '2026-09-11T10:00:00Z'),
    ]], Object.fromEntries([1, 2, 3].map((n) => [`{pipeline-${n}}`, [step('Deploy to major org', 'SUCCESSFUL', '2026-09-11T10:01:00Z')]])));

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(runs.map((run) => run.id)).to.deep.equal(['{pipeline-1}']);
  });

  it('maps the results, and leaves out what did not finish', async () => {
    const provider = newProvider();
    const running = { ...branchPipeline(7, 'main', '', '2026-09-17T10:00:00Z'), state: { name: 'IN_PROGRESS' } };
    const calls = stubClient(provider as any, [[
      running,
      branchPipeline(6, 'main', 'EXPIRED', '2026-09-16T10:00:00Z'),
      branchPipeline(5, 'main', 'STOPPED', '2026-09-15T10:00:00Z'),
      branchPipeline(4, 'main', 'ERROR', '2026-09-14T10:00:00Z'),
      branchPipeline(3, 'main', 'FAILED', '2026-09-13T10:00:00Z'),
      branchPipeline(2, 'main', 'SUCCESSFUL', '2026-09-12T10:00:00Z'),
    ]], Object.fromEntries(Object.entries({ 2: 'SUCCESSFUL', 3: 'FAILED', 4: 'ERROR', 5: 'STOPPED', 6: 'EXPIRED', 7: '' }).map(([n, result]) => [`{pipeline-${n}}`, [step('Deploy to major org', result, '2026-09-12T10:01:00Z')]])));

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(runs.map((run) => [run.id, run.status])).to.deep.equal([
      ['{pipeline-5}', 'canceled'],
      ['{pipeline-4}', 'failed'],
      ['{pipeline-3}', 'failed'],
      ['{pipeline-2}', 'succeeded'],
    ]);
    expect(calls.listSteps.length, 'no steps call for a pipeline that is left out').to.equal(4);
  });

  it('reads what a pipeline does from the names of its steps', async () => {
    const provider = newProvider();
    stubClient(provider as any, [[
      branchPipeline(3, 'main', 'SUCCESSFUL', '2026-09-13T10:00:00Z'),
      branchPipeline(2, 'main', 'SUCCESSFUL', '2026-09-12T10:00:00Z'),
      pullRequestPipeline(1, 42, 'main', 'SUCCESSFUL', '2026-09-11T10:00:00Z'),
    ]], {
      '{pipeline-3}': [
        step('Prepare', 'SUCCESSFUL', '2026-09-13T10:05:00Z'),
        step('Deploy to major org', 'SUCCESSFUL', '2026-09-13T10:02:00Z'),
      ],
      // A code quality pipeline of the branch is not a deployment
      '{pipeline-2}': [step('Run MegaLinter', 'SUCCESSFUL', '2026-09-12T10:01:00Z')],
      // A Pull Request pipeline without a deployment check is not a validation
      '{pipeline-1}': [step('Run MegaLinter', 'SUCCESSFUL', '2026-09-11T10:01:00Z')],
    });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(runs.map((run) => [run.id, run.name, run.startedAt])).to.deep.equal([
      ['{pipeline-3}', 'Deploy to major org', '2026-09-13T10:02:00Z'],
    ]);
  });

  it('counts a Pull Request pipeline as a succeeded validation when only MegaLinter failed', async () => {
    const provider = newProvider();
    stubClient(provider as any, [[pullRequestPipeline(1, 42, 'uat', 'FAILED', '2026-09-11T10:00:00Z')]], {
      '{pipeline-1}': [
        step('Run MegaLinter', 'FAILED', '2026-09-11T10:01:00Z', '2026-09-11T10:20:00Z'),
        step('Simulate SFDX deployment', 'SUCCESSFUL', '2026-09-11T10:03:00Z', '2026-09-11T10:12:00Z'),
      ],
    });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(runs).to.have.length(1);
    expect(runs[0]).to.include({
      kind: 'validation',
      name: 'Simulate SFDX deployment',
      status: 'succeeded',
      branch: 'uat',
      pullRequestId: '42',
      queuedAt: '2026-09-11T10:00:00Z',
      startedAt: '2026-09-11T10:03:00Z',
      finishedAt: '2026-09-11T10:12:00Z',
    });
  });

  it('counts a failed deployment check as a failed validation, and leaves out one that did not run', async () => {
    const provider = newProvider();
    stubClient(provider as any, [[
      pullRequestPipeline(2, 43, 'uat', 'FAILED', '2026-09-12T10:00:00Z'),
      pullRequestPipeline(1, 42, 'uat', 'FAILED', '2026-09-11T10:00:00Z'),
    ]], {
      '{pipeline-2}': [step('Simulate SFDX deployment', 'FAILED', '2026-09-12T10:03:00Z')],
      '{pipeline-1}': [step('Simulate SFDX deployment', 'NOT_RUN', '')],
    });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(runs.map((run) => [run.pullRequestId, run.status])).to.deep.equal([['43', 'failed']]);
  });

  it('ignores a branch that is not asked for, a tag and a scheduled pipeline', async () => {
    const provider = newProvider();
    const tag = branchPipeline(3, 'main', 'SUCCESSFUL', '2026-09-13T10:00:00Z');
    tag.target.ref_type = 'tag';
    const calls = stubClient(provider as any, [[
      branchPipeline(5, 'uat', 'SUCCESSFUL', '2026-09-15T10:00:00Z'),
      branchPipeline(4, 'main', 'SUCCESSFUL', '2026-09-14T10:00:00Z', { trigger: { name: 'SCHEDULE', type: 'pipeline_trigger_schedule' } }),
      tag,
      branchPipeline(2, 'main', 'SUCCESSFUL', '2026-09-12T10:00:00Z'),
    ]], {
      '{pipeline-2}': [step('Deploy to major org', 'SUCCESSFUL', '2026-09-12T10:01:00Z')],
    });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });

    expect(runs.map((run) => run.id)).to.deep.equal(['{pipeline-2}']);
    expect(calls.listSteps.map((params) => params.pipeline_uuid)).to.deep.equal(['{pipeline-2}']);
  });

  it('does not read the steps of a kind that is not asked for', async () => {
    const provider = newProvider();
    const calls = stubClient(provider as any, [[
      branchPipeline(2, 'main', 'SUCCESSFUL', '2026-09-12T10:00:00Z'),
      pullRequestPipeline(1, 42, 'main', 'SUCCESSFUL', '2026-09-11T10:00:00Z'),
    ]], {
      '{pipeline-2}': [step('Deploy to major org', 'SUCCESSFUL', '2026-09-12T10:01:00Z')],
      '{pipeline-1}': [step('Simulate SFDX deployment', 'SUCCESSFUL', '2026-09-11T10:01:00Z')],
    });

    const runs = await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ['validation'] });

    expect(runs.map((run) => run.kind)).to.deep.equal(['validation']);
    expect(calls.listSteps.map((params) => params.pipeline_uuid)).to.deep.equal(['{pipeline-1}']);
  });

  it('throws when the pipelines cannot be listed, with the status of the answer', async () => {
    const provider = newProvider();
    (provider as any).bitbucket = {
      pipelines: {
        list: async () => {
          throw httpError(403);
        },
      },
    };

    let thrown: unknown = null;
    try {
      await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });
    } catch (e) {
      thrown = e;
    }

    expect(thrown, 'a token without the pipeline scope must not read as no deployment').to.not.equal(null);
    expect(httpStatusOf(thrown)).to.equal(403);
  });

  it('throws when the steps of one pipeline cannot be read', async () => {
    const provider = newProvider();
    stubClient(provider as any, [[
      branchPipeline(2, 'main', 'SUCCESSFUL', '2026-09-12T10:00:00Z'),
      branchPipeline(1, 'main', 'SUCCESSFUL', '2026-09-11T10:00:00Z'),
    ]], {
      '{pipeline-2}': [step('Deploy to major org', 'SUCCESSFUL', '2026-09-12T10:01:00Z')],
    });
    const listSteps = (provider as any).bitbucket.pipelines.listSteps;
    (provider as any).bitbucket.pipelines.listSteps = async (params: any) => {
      if (params.pipeline_uuid === '{pipeline-1}') {
        throw httpError(404);
      }
      return listSteps(params);
    };

    let thrown: unknown = null;
    try {
      await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });
    } catch (e) {
      thrown = e;
    }

    expect(httpStatusOf(thrown)).to.equal(404);
  });

  it('throws without a workspace and a repository, instead of answering with no run', async () => {
    const provider = new BitbucketProvider();
    stubClient(provider as any, [[]]);

    let thrown: unknown = null;
    try {
      await provider.listCiRuns({ branches: ['main'], minDate: MIN_DATE, kinds: ALL_KINDS });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).to.be.instanceOf(Error);
  });
});
