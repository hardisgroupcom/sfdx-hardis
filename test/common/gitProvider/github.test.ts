/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import os from 'os';
import path from 'path';
// Load the provider index first so the gitProviderRoot / provider module cycle is
// resolved in the same order as in production (see gitProviderRoot.test.ts)
import '../../../src/common/gitProvider/index.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { GithubApiClient, GithubApiError, getGithubActionsContext } from '../../../src/common/gitProvider/githubApiClient.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

const ENV_KEYS = [
  'GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN', 'PAT', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_OWNER',
  'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_WORKFLOW', 'GITHUB_REF', 'GITHUB_REF_NAME',
  'GITHUB_RUN_ID', 'GITHUB_EVENT_PATH', 'JENKINS_URL', 'BUILD_URL', 'PIPELINE_JOB_URL', 'GITHUB_JOB_URL',
];

describe('GithubProvider (native fetch client)', () => {
  let requests: Array<{ url: string; init: any }> = [];
  let nextResponses: Response[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  function jsonResponse(body: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
    });
  }

  function mockFetch(...responses: Response[]) {
    requests = [];
    nextResponses = responses;
    setFetchForTests(async (url: any, init: any) => {
      requests.push({ url: String(url), init });
      return nextResponses.shift() ?? jsonResponse({});
    });
  }

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'acme/widgets';
    process.env.GITHUB_WORKFLOW = 'ci';
    process.env.GITHUB_RUN_ID = '777';
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

  it('sends GitHub auth and API version headers to the default API root', async () => {
    mockFetch(jsonResponse({ name: 'Jane Doe', email: null }));
    const provider = new GithubProvider();
    const identity = await provider.resolveUserIdentity('jane');
    expect(identity).to.deep.equal({ name: 'Jane Doe', email: null });
    expect(requests[0].url).to.equal('https://api.github.com/users/jane');
    expect(requests[0].init.method).to.equal('GET');
    expect(requests[0].init.headers.Authorization).to.equal('token tok');
    expect(requests[0].init.headers.Accept).to.equal('application/vnd.github+json');
    expect(requests[0].init.headers['X-GitHub-Api-Version']).to.equal('2022-11-28');
  });

  it('honors GITHUB_API_URL for GitHub Enterprise', async () => {
    process.env.GITHUB_API_URL = 'https://ghe.example.com/api/v3';
    mockFetch(jsonResponse({ name: 'Jane' }));
    const provider = new GithubProvider();
    await provider.resolveUserIdentity('jane');
    expect(requests[0].url).to.equal('https://ghe.example.com/api/v3/users/jane');
  });

  it('reads the context from the environment and the event payload', () => {
    const eventFile = path.join(os.tmpdir(), `sfdx-hardis-gh-event-${Date.now()}.json`);
    fs.writeJsonSync(eventFile, { pull_request: { number: 42 }, repository: { name: 'other', owner: { login: 'someone' } } });
    process.env.GITHUB_EVENT_PATH = eventFile;
    process.env.GITHUB_REF = 'refs/pull/42/merge';
    try {
      const context = getGithubActionsContext();
      expect(context.repo).to.deep.equal({ owner: 'acme', repo: 'widgets' });
      expect(context.issueNumber).to.equal(42);
      expect(context.runId).to.equal(777);
      expect(context.serverUrl).to.equal('https://github.com');
      expect(context.graphqlUrl).to.equal('https://api.github.com/graphql');
      const provider = new GithubProvider();
      expect(provider.prNumber).to.equal(42);
      expect(provider.branch).to.equal('refs/pull/42/merge');
      expect(provider.workflow).to.equal('ci');
      expect(provider.runId).to.equal(777);
    } finally {
      fs.removeSync(eventFile);
    }
  });

  it('falls back to the event payload repository when GITHUB_REPOSITORY is missing', () => {
    delete process.env.GITHUB_REPOSITORY;
    const eventFile = path.join(os.tmpdir(), `sfdx-hardis-gh-event-${Date.now()}-b.json`);
    fs.writeJsonSync(eventFile, { repository: { name: 'widgets', owner: { login: 'acme' } } });
    process.env.GITHUB_EVENT_PATH = eventFile;
    try {
      const context = getGithubActionsContext();
      expect(context.repo).to.deep.equal({ owner: 'acme', repo: 'widgets' });
    } finally {
      fs.removeSync(eventFile);
    }
  });

  it('builds the job url from the context', async () => {
    mockFetch();
    const provider = new GithubProvider();
    expect(await provider.getCurrentJobUrl()).to.equal('https://github.com/acme/widgets/actions/runs/777');
  });

  it('paginates comments over 3 pages following the Link header', async () => {
    const page2 = 'https://api.github.com/repos/acme/widgets/issues/7/comments?per_page=100&page=2';
    const page3 = 'https://api.github.com/repos/acme/widgets/issues/7/comments?per_page=100&page=3';
    mockFetch(
      jsonResponse([{ id: 1, body: 'MARK one', html_url: 'u1' }, { id: 2, body: 'other' }], 200, { Link: `<${page2}>; rel="next", <${page3}>; rel="last"` }),
      jsonResponse([{ id: 3, body: 'MARK three', html_url: 'u3' }], 200, { Link: `<${page3}>; rel="next", <${page3}>; rel="last"` }),
      jsonResponse([{ id: 4, body: 'MARK four', html_url: 'u4' }], 200, { Link: `<${page2}>; rel="prev"` }),
    );
    const provider = new GithubProvider();
    const refs = await provider.listPullRequestCommentsByMarker('MARK', 7);
    expect(requests.map((r) => r.url)).to.deep.equal([
      'https://api.github.com/repos/acme/widgets/issues/7/comments?per_page=100',
      page2,
      page3,
    ]);
    expect(refs.map((r) => r.ref)).to.deep.equal([1, 3, 4]);
    expect(refs[0]).to.deep.equal({ prNumber: 7, ref: 1, body: 'MARK one', url: 'u1' });
  });

  it('updates the existing comment when the marker is found (upsert)', async () => {
    mockFetch(
      jsonResponse([{ id: 10, body: 'hello' }, { id: 11, body: '<!-- marker --> old body' }]),
      jsonResponse({ id: 11, body: 'new body' }),
    );
    const provider = new GithubProvider();
    await provider.upsertPullRequestCommentByMarker('<!-- marker -->', 'new body', 7);
    expect(requests).to.have.length(2);
    expect(requests[0].url).to.equal('https://api.github.com/repos/acme/widgets/issues/7/comments');
    expect(requests[0].init.method).to.equal('GET');
    expect(requests[1].url).to.equal('https://api.github.com/repos/acme/widgets/issues/comments/11');
    expect(requests[1].init.method).to.equal('PATCH');
    expect(JSON.parse(requests[1].init.body)).to.deep.equal({ body: 'new body' });
  });

  it('creates a comment when no comment carries the marker (upsert)', async () => {
    mockFetch(
      jsonResponse([{ id: 10, body: 'hello' }]),
      jsonResponse({ id: 12, body: 'new body' }, 201),
    );
    const provider = new GithubProvider();
    await provider.upsertPullRequestCommentByMarker('<!-- marker -->', 'new body', 7);
    expect(requests).to.have.length(2);
    expect(requests[1].url).to.equal('https://api.github.com/repos/acme/widgets/issues/7/comments');
    expect(requests[1].init.method).to.equal('POST');
    expect(JSON.parse(requests[1].init.body)).to.deep.equal({ body: 'new body' });
  });

  it('returns the comment body matching a marker, or null', async () => {
    mockFetch(jsonResponse([{ id: 1, body: 'nope' }, { id: 2, body: 'with MARK inside' }]));
    const provider = new GithubProvider();
    expect(await provider.getPullRequestCommentByMarker('MARK', 3)).to.equal('with MARK inside');
    mockFetch(jsonResponse([{ id: 1, body: 'nope' }]));
    expect(await provider.getPullRequestCommentByMarker('MARK', 3)).to.be.null;
  });

  it('updates a comment by ref with PATCH', async () => {
    mockFetch(jsonResponse({ id: 55 }));
    const provider = new GithubProvider();
    await provider.updatePullRequestCommentByRef({ prNumber: 3, ref: 55, body: 'x' }, 'updated');
    expect(requests[0].url).to.equal('https://api.github.com/repos/acme/widgets/issues/comments/55');
    expect(requests[0].init.method).to.equal('PATCH');
    expect(JSON.parse(requests[0].init.body)).to.deep.equal({ body: 'updated' });
  });

  it('lists open pull requests by head branch (owner:branch) and base', async () => {
    mockFetch(jsonResponse([{ number: 99, html_url: 'https://github.com/acme/widgets/pull/99' }]));
    const provider = new GithubProvider();
    const found = await provider.findOpenPullRequest('feature/x', 'main');
    expect(found).to.deep.equal({ pullRequestUrl: 'https://github.com/acme/widgets/pull/99', id: 99 });
    const url = new URL(requests[0].url);
    expect(url.origin + url.pathname).to.equal('https://api.github.com/repos/acme/widgets/pulls');
    expect(url.searchParams.get('state')).to.equal('open');
    expect(url.searchParams.get('head')).to.equal('acme:feature/x');
    expect(url.searchParams.get('base')).to.equal('main');
  });

  it('returns null when no open pull request matches', async () => {
    mockFetch(jsonResponse([]));
    const provider = new GithubProvider();
    expect(await provider.findOpenPullRequest('feature/x', 'main')).to.be.null;
  });

  it('creates a pull request and updates its description', async () => {
    mockFetch(
      jsonResponse({ number: 5, html_url: 'https://github.com/acme/widgets/pull/5' }, 201),
      jsonResponse({ number: 5 }),
    );
    const provider = new GithubProvider();
    const created = await provider.createPullRequest({ sourceBranch: 'feat', targetBranch: 'main', title: 'T', body: 'B' } as any);
    expect(created.created).to.be.true;
    expect(created.pullRequestUrl).to.equal('https://github.com/acme/widgets/pull/5');
    expect(requests[0].url).to.equal('https://api.github.com/repos/acme/widgets/pulls');
    expect(requests[0].init.method).to.equal('POST');
    expect(JSON.parse(requests[0].init.body)).to.deep.equal({ title: 'T', body: 'B', head: 'feat', base: 'main' });
    await provider.updatePullRequestDescription(5, 'T2', 'B2');
    expect(requests[1].url).to.equal('https://api.github.com/repos/acme/widgets/pulls/5');
    expect(requests[1].init.method).to.equal('PATCH');
    expect(JSON.parse(requests[1].init.body)).to.deep.equal({ title: 'T2', body: 'B2' });
  });

  it('lists pull requests page by page and maps them to the common shape', async () => {
    mockFetch(jsonResponse([
      { number: 1, title: 'merged one', body: 'd', head: { ref: 'f1' }, base: { ref: 'main' }, user: { login: 'bob' }, html_url: 'h1', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-03T00:00:00Z', merged_at: '2026-01-03T00:00:00Z', merge_commit_sha: 'abc' },
      { number: 2, title: 'closed not merged', head: { ref: 'f2' }, base: { ref: 'main' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', merged_at: null },
    ]));
    const provider = new GithubProvider();
    const prs = await provider.listPullRequests({ status: 'merged', targetBranch: 'main' });
    expect(prs).to.have.length(1);
    expect(prs![0].idNumber).to.equal(1);
    expect(prs![0].sourceBranch).to.equal('f1');
    expect(prs![0].targetBranch).to.equal('main');
    expect(prs![0].authorName).to.equal('bob');
    expect(prs![0].mergeCommitSha).to.equal('abc');
    const url = new URL(requests[0].url);
    expect(url.searchParams.get('state')).to.equal('closed');
    expect(url.searchParams.get('base')).to.equal('main');
    expect(url.searchParams.get('per_page')).to.equal('100');
    expect(url.searchParams.get('page')).to.equal('1');
  });

  it('lists the pull requests of a go live through commits, compare and pulls endpoints', async () => {
    mockFetch(
      jsonResponse({ sha: 'merge1', parents: [{ sha: 'parent1' }] }),
      jsonResponse({ commits: [{ sha: 'c1' }, { sha: 'c2' }] }),
      jsonResponse([{ number: 21, merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: 'c1', head: { ref: 'f' }, base: { ref: 'preprod' } }]),
      jsonResponse([{ number: 22, merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: 'zzz', head: { ref: 'g' }, base: { ref: 'integ' } }]),
    );
    const provider = new GithubProvider();
    const prs = await provider.listPullRequestsInGoLive('preprod', ['integ'], 'merge1');
    expect(prs.map((pr) => pr.idNumber)).to.deep.equal([21]);
    expect(requests[0].url).to.equal('https://api.github.com/repos/acme/widgets/commits/merge1');
    expect(requests[1].url).to.equal('https://api.github.com/repos/acme/widgets/compare/parent1...merge1?per_page=1000');
  });

  it('runs a GraphQL query against the GraphQL endpoint', async () => {
    mockFetch(jsonResponse({ data: { repository: { name: 'widgets' } } }));
    const client = new GithubApiClient('tok');
    const data = await client.graphql('query q($owner: String!) { repository(owner: $owner) { name } }', { owner: 'acme' });
    expect(data).to.deep.equal({ repository: { name: 'widgets' } });
    expect(requests[0].url).to.equal('https://api.github.com/graphql');
    expect(requests[0].init.method).to.equal('POST');
    expect(requests[0].init.headers.Authorization).to.equal('token tok');
    const body = JSON.parse(requests[0].init.body);
    expect(body.query).to.include('repository(owner: $owner)');
    expect(body.variables).to.deep.equal({ owner: 'acme' });
  });

  it('honors GITHUB_GRAPHQL_URL and throws on GraphQL response errors', async () => {
    process.env.GITHUB_GRAPHQL_URL = 'https://ghe.example.com/api/graphql';
    mockFetch(jsonResponse({ data: null, errors: [{ message: 'Could not resolve to a Repository' }] }));
    const client = new GithubApiClient('tok');
    try {
      await client.graphql('query { x }');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(GithubApiError);
      expect(e.message).to.include('Could not resolve to a Repository');
    }
    expect(requests[0].url).to.equal('https://ghe.example.com/api/graphql');
  });

  it('maps a 404 to an error exposing status, message and response data', async () => {
    mockFetch(jsonResponse({ message: 'Not Found', documentation_url: 'https://docs.github.com' }, 404));
    const provider = new GithubProvider();
    try {
      await provider.resolveUserIdentity('ghost');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(GithubApiError);
      expect(e.status).to.equal(404);
      expect(e.response.status).to.equal(404);
      expect(e.response.data.message).to.equal('Not Found');
      expect(e.message).to.include('Not Found');
      expect(e.message).to.include('404');
    }
  });

  it('parses the next page url from a Link header', () => {
    expect(GithubApiClient.getNextPageUrl({ link: '<https://x/a?page=2>; rel="next", <https://x/a?page=9>; rel="last"' })).to.equal('https://x/a?page=2');
    expect(GithubApiClient.getNextPageUrl({ link: '<https://x/a?page=1>; rel="prev"' })).to.be.null;
    expect(GithubApiClient.getNextPageUrl({})).to.be.null;
  });

  it('omits the Authorization header when no token is available', async () => {
    mockFetch(jsonResponse({ name: 'x' }));
    const client = new GithubApiClient('');
    await client.get('/users/x');
    expect(requests[0].init.headers.Authorization).to.be.undefined;
  });
});
