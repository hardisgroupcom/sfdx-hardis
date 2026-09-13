/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { XrayTestProvider, xrayBaseUrlFor } from '../../../src/common/testManagementProvider/xrayTestProvider.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookUtils.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

const ENV_KEYS = ['XRAY_CLIENT_ID', 'XRAY_CLIENT_SECRET', 'XRAY_REGION', 'JIRA_HOST', 'JIRA_PROJECT_KEY', 'JIRA_EMAIL', 'JIRA_TOKEN'];

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Quote management',
    priority: 1,
    title: 'Create a quote',
    preconditions: 'See [the spec](https://example.test/spec)',
    steps: [{ action: 'Open the page', expected: 'The page is displayed' }],
    expected: 'The quote exists',
    ...overrides,
  };
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('Expected a rejection');
}

const CREATED = { data: { createTest: { test: { issueId: '10001', jira: { key: 'PROJ-9' } }, warnings: [] } } };

describe('XrayTestProvider', () => {
  let requests: Array<{ url: string; init: any }> = [];
  let nextResponses: Response[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  function jsonResponse(body: any, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  function mockFetch(...responses: Response[]) {
    requests = [];
    nextResponses = responses;
    setFetchForTests(async (url: any, init: any) => {
      requests.push({ url: String(url), init });
      return nextResponses.shift() ?? jsonResponse({});
    });
  }

  function setAllEnv() {
    process.env.XRAY_CLIENT_ID = 'cid';
    process.env.XRAY_CLIENT_SECRET = 'secret';
    process.env.JIRA_HOST = 'https://acme.atlassian.net/';
    process.env.JIRA_PROJECT_KEY = 'PROJ';
    process.env.JIRA_EMAIL = 'bot@acme.test';
    process.env.JIRA_TOKEN = 'jira-token';
  }

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

  describe('activation', () => {
    it('stays inactive without its variables and activates with the Xray and Jira ones', () => {
      expect(new XrayTestProvider().isActive).to.be.false;
      setAllEnv();
      expect(new XrayTestProvider().isActive).to.be.true;
    });

    it('names every variable it needs, reusing the Jira names the plugin already reads', () => {
      const required = new XrayTestProvider().getRequiredEnvVars().join(' ');
      for (const name of ['XRAY_CLIENT_ID', 'XRAY_CLIENT_SECRET', 'JIRA_HOST', 'jiraHost', 'JIRA_TOKEN', 'JIRA_PROJECT_KEY', 'JIRA_EMAIL']) {
        expect(required).to.contain(name);
      }
    });

    it('reads the Jira host from the jiraHost configuration when JIRA_HOST is unset', async () => {
      setAllEnv();
      delete process.env.JIRA_HOST;
      expect(new XrayTestProvider().isActive).to.be.false;
      const provider = new XrayTestProvider({ jiraHost: 'acme.atlassian.net/' });
      expect(provider.isActive).to.be.true;
      mockFetch(jsonResponse({ issues: [] }));
      await provider.findByKey('TESTKIT:PROJ-123:F01');
      expect(requests[0].url).to.match(/^https:\/\/acme\.atlassian\.net\/rest\/api\/3\/search\/jql\?/);
    });

    it('prefers JIRA_HOST over the jiraHost configuration', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ issues: [] }));
      await new XrayTestProvider({ jiraHost: 'https://other.atlassian.net' }).findByKey('TESTKIT:PROJ-123:F01');
      expect(requests[0].url).to.contain('https://acme.atlassian.net/rest/api/3/search/jql');
    });

    it('accepts a bare JIRA_HOST, as the Jira ticket provider does', async () => {
      setAllEnv();
      process.env.JIRA_HOST = 'acme.atlassian.net';
      mockFetch(jsonResponse({ issues: [{ id: '10', key: 'PROJ-9', fields: { labels: ['TESTKIT:PROJ-123:F01'] } }] }));
      const found = await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      expect(requests[0].url).to.match(/^https:\/\/acme\.atlassian\.net\/rest\/api\/3\/search\/jql\?/);
      expect(found?.url).to.equal('https://acme.atlassian.net/browse/PROJ-9');
    });
  });

  describe('checkPrerequisites', () => {
    it('names only the missing settings, without calling Xray', async () => {
      setAllEnv();
      delete process.env.JIRA_TOKEN;
      mockFetch();
      const message = await errorOf(new XrayTestProvider().checkPrerequisites());
      expect(message).to.contain('JIRA_TOKEN');
      expect(message).to.not.contain('XRAY_CLIENT_ID');
      expect(requests).to.be.empty;
    });

    it('authenticates on /api/v2/authenticate with the client credentials', async () => {
      setAllEnv();
      mockFetch(jsonResponse('the-jwt'));
      await new XrayTestProvider().checkPrerequisites();
      expect(requests[0].url).to.equal('https://xray.cloud.getxray.app/api/v2/authenticate');
      expect(requests[0].init.method).to.equal('POST');
      expect(JSON.parse(requests[0].init.body)).to.deep.equal({ client_id: 'cid', client_secret: 'secret' });
    });

    it('surfaces the Xray error detail when authentication is refused', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ error: 'Authentication failed. Invalid client credentials!' }, 401));
      const message = await errorOf(new XrayTestProvider().checkPrerequisites());
      expect(message).to.contain('401');
    });

    it('refuses an empty token', async () => {
      setAllEnv();
      mockFetch(new Response('""', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
      const message = await errorOf(new XrayTestProvider().checkPrerequisites());
      expect(message).to.contain('empty token');
    });

    it('follows XRAY_REGION', async () => {
      setAllEnv();
      process.env.XRAY_REGION = 'EU';
      mockFetch(jsonResponse('the-jwt'));
      await new XrayTestProvider().checkPrerequisites();
      expect(requests[0].url).to.equal('https://eu.xray.cloud.getxray.app/api/v2/authenticate');
    });
  });

  it('follows the region and falls back to the global endpoint on an unknown one', () => {
    expect(xrayBaseUrlFor('us')).to.equal('https://us.xray.cloud.getxray.app');
    expect(xrayBaseUrlFor('eu')).to.equal('https://eu.xray.cloud.getxray.app');
    expect(xrayBaseUrlFor('au')).to.equal('https://au.xray.cloud.getxray.app');
    expect(xrayBaseUrlFor('mars')).to.equal('https://xray.cloud.getxray.app');
    expect(xrayBaseUrlFor(null)).to.equal('https://xray.cloud.getxray.app');
  });

  describe('create', () => {
    it('carries the JWT as a Bearer on the GraphQL call', async () => {
      setAllEnv();
      mockFetch(jsonResponse('the-jwt'), jsonResponse(CREATED));
      await new XrayTestProvider().create(makeCase());
      expect(requests[0].url).to.equal('https://xray.cloud.getxray.app/api/v2/authenticate');
      expect(requests[1].url).to.equal('https://xray.cloud.getxray.app/api/v2/graphql');
      expect(requests[1].init.headers.Authorization).to.equal('Bearer the-jwt');
    });

    it('creates a test with a single GraphQL mutation, not two', async () => {
      setAllEnv();
      mockFetch(jsonResponse('jwt'), jsonResponse(CREATED));
      const ref = await new XrayTestProvider().create(makeCase());
      const graphqlCalls = requests.filter((request) => request.url.endsWith('/api/v2/graphql'));
      expect(graphqlCalls).to.have.lengthOf(1);
      const body = JSON.parse(graphqlCalls[0].init.body);
      expect(body.query).to.contain('createTest');
      expect(body.variables.jira.fields.project).to.deep.equal({ key: 'PROJ' });
      expect(ref).to.deep.equal({ id: 'PROJ-9', url: 'https://acme.atlassian.net/browse/PROJ-9' });
    });

    it('authenticates once for two creates, the token being cached', async () => {
      setAllEnv();
      mockFetch(jsonResponse('the-jwt'), jsonResponse(CREATED), jsonResponse(CREATED));
      const provider = new XrayTestProvider();
      await provider.create(makeCase({ id: 'PROJ-123-F01' }));
      await provider.create(makeCase({ id: 'PROJ-123-F02' }));
      expect(requests.filter((request) => request.url.endsWith('/api/v2/authenticate'))).to.have.lengthOf(1);
      expect(requests.filter((request) => request.url.endsWith('/api/v2/graphql'))).to.have.lengthOf(2);
      expect(requests[2].init.headers.Authorization).to.equal('Bearer the-jwt');
    });

    it('reuses the token obtained by checkPrerequisites', async () => {
      setAllEnv();
      mockFetch(jsonResponse('the-jwt'), jsonResponse(CREATED));
      const provider = new XrayTestProvider();
      await provider.checkPrerequisites();
      await provider.create(makeCase());
      expect(requests.filter((request) => request.url.endsWith('/api/v2/authenticate'))).to.have.lengthOf(1);
    });

    it('falls back to the issue id when the answer carries no Jira key', async () => {
      setAllEnv();
      mockFetch(jsonResponse('jwt'), jsonResponse({ data: { createTest: { test: { issueId: '10001' } } } }));
      const ref = await new XrayTestProvider().create(makeCase());
      expect(ref.id).to.equal('10001');
    });

    // The authenticate endpoint answers with a quoted JSON string. Served as text/plain it
    // arrives as the literal `"eyJ..."`, quotes included.
    it('strips the quotes of a JWT served as text/plain, so the Bearer carries the bare token', async () => {
      setAllEnv();
      mockFetch(new Response('"the-jwt"', { status: 200, headers: { 'Content-Type': 'text/plain' } }), jsonResponse(CREATED));
      await new XrayTestProvider().create(makeCase());
      expect(requests[1].init.headers.Authorization).to.equal('Bearer the-jwt');
    });

    it('fails with the GraphQL error messages of a 200 answer', async () => {
      setAllEnv();
      mockFetch(jsonResponse('jwt'), jsonResponse({ errors: [{ message: 'priority is invalid' }, { message: 'summary is required' }] }));
      const message = await errorOf(new XrayTestProvider().create(makeCase()));
      expect(message).to.contain('priority is invalid');
      expect(message).to.contain('summary is required');
    });

    it('surfaces the detail of a failed GraphQL call', async () => {
      setAllEnv();
      mockFetch(jsonResponse('jwt'), jsonResponse({ error: { message: 'Bad Request', detail: 'steps: malformed' } }, 400));
      const message = await errorOf(new XrayTestProvider().create(makeCase()));
      expect(message).to.contain('400');
      expect(message).to.contain('steps: malformed');
    });

    it('fails when the answer carries no test', async () => {
      setAllEnv();
      mockFetch(jsonResponse('jwt'), jsonResponse({ data: { createTest: { test: null } } }));
      const message = await errorOf(new XrayTestProvider().create(makeCase()));
      expect(message).to.be.a('string').and.not.empty;
    });
  });

  describe('buildVariables', () => {
    it('translates the normalized priority into its Jira name, defaulting to High', () => {
      const nameOf = (priority: 1 | 2 | 3 | undefined): string =>
        XrayTestProvider.buildVariables(makeCase({ priority }), 'PROJ').jira.fields.priority.name;
      expect(nameOf(1)).to.equal('Highest');
      expect(nameOf(2)).to.equal('High');
      expect(nameOf(3)).to.equal('Medium');
      expect(nameOf(undefined)).to.equal('High');
    });

    it('carries the idempotency key and the module in the Jira labels', () => {
      const labels = XrayTestProvider.buildVariables(makeCase(), 'PROJ').jira.fields.labels;
      // A Jira label cannot hold a space, so the module name is underscored.
      expect(labels).to.deep.equal(['TESTKIT:PROJ-123:F01', 'MODULE:Quote_management']);
    });

    it('carries only the idempotency key when the case has no module', () => {
      expect(XrayTestProvider.buildLabels(makeCase({ module: undefined }))).to.deep.equal(['TESTKIT:PROJ-123:F01']);
    });

    it('maps steps to action and result, without a data field', () => {
      const steps = XrayTestProvider.buildVariables(makeCase(), 'PROJ').steps;
      expect(steps).to.deep.equal([{ action: 'Open the page', result: 'The page is displayed' }]);
      expect(XrayTestProvider.buildVariables(makeCase({ steps: undefined }), 'PROJ').steps).to.deep.equal([]);
    });

    it('reduces a markdown link of the description to a bare URL', () => {
      const description = XrayTestProvider.buildVariables(makeCase(), 'PROJ').jira.fields.description;
      expect(description).to.contain('https://example.test/spec');
      expect(description).to.not.contain('[the spec]');
    });
  });

  describe('findByKey', () => {
    it('searches the label and returns null on zero result', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ issues: [] }));
      const found = await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      expect(found).to.equal(null);
      expect(requests[0].url).to.contain('/rest/api/3/search/jql');
      expect(requests[0].init.headers.Authorization).to.match(/^Basic /);
      // Read the parameter itself: the query is form encoded
      const params = new URL(requests[0].url).searchParams;
      expect(params.get('jql')).to.equal('project = "PROJ" AND labels = "TESTKIT:PROJ-123:F01"');
      expect(params.get('fields')).to.equal('labels');
    });

    // An identifier cannot hold a quote, but the JQL string escaping must hold on its own
    it('escapes a quote and a backslash of the key inside the JQL string', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ issues: [] }));
      await new XrayTestProvider().findByKey('TESTKIT:A"B\\C:F01');
      const jql = new URL(requests[0].url).searchParams.get('jql');
      expect(jql).to.equal('project = "PROJ" AND labels = "TESTKIT:A\\"B\\\\C:F01"');
    });

    it('escapes a quote of the project key too', async () => {
      setAllEnv();
      process.env.JIRA_PROJECT_KEY = 'PR"OJ';
      mockFetch(jsonResponse({ issues: [] }));
      await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      const jql = new URL(requests[0].url).searchParams.get('jql');
      expect(jql).to.equal('project = "PR\\"OJ" AND labels = "TESTKIT:PROJ-123:F01"');
    });

    it('returns the found issue when its labels hold the key', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ issues: [{ id: '10', key: 'PROJ-9', fields: { labels: ['Regression', 'TESTKIT:PROJ-123:F01'] } }] }));
      const found = await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      expect(found).to.deep.equal({ id: 'PROJ-9', url: 'https://acme.atlassian.net/browse/PROJ-9' });
    });

    it('ignores a hit whose labels do not hold the exact key', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({
          issues: [
            { id: '10', key: 'PROJ-9' },
            { id: '11', key: 'PROJ-10', fields: { labels: ['TESTKIT:PROJ-123:F010'] } },
          ],
        })
      );
      expect(await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01')).to.equal(null);
    });

    it('picks the hit holding the exact key among others', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({
          issues: [
            { id: '11', key: 'PROJ-10', fields: { labels: ['TESTKIT:PROJ-123:F010'] } },
            { id: '12', key: 'PROJ-11', fields: { labels: ['TESTKIT:PROJ-123:F01'] } },
          ],
        })
      );
      expect((await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01'))?.id).to.equal('PROJ-11');
    });

    it('surfaces the Jira error messages of a failed search', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ errorMessages: ["The value 'PROJ' does not exist for the field 'project'."] }, 400));
      const message = await errorOf(new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01'));
      expect(message).to.contain('400');
      expect(message).to.contain("does not exist for the field 'project'");
    });
  });

  describe('update', () => {
    it('sends the update through REST API v2, where the description is a plain string', async () => {
      setAllEnv();
      mockFetch(jsonResponse({}));
      const ref = await new XrayTestProvider().update({ id: 'PROJ-9', url: 'x' }, makeCase());
      expect(requests).to.have.lengthOf(1);
      expect(requests[0].url).to.equal('https://acme.atlassian.net/rest/api/2/issue/PROJ-9');
      expect(requests[0].init.method).to.equal('PUT');
      expect(JSON.parse(requests[0].init.body).fields.description).to.be.a('string');
      expect(ref).to.deep.equal({ id: 'PROJ-9', url: 'https://acme.atlassian.net/browse/PROJ-9' });
    });

    it('updates summary, description and priority, and adds labels instead of replacing them', async () => {
      setAllEnv();
      mockFetch(jsonResponse({}));
      await new XrayTestProvider().update({ id: 'PROJ-9', url: 'x' }, makeCase({ priority: 2, expected: 'The quote is saved' }));
      const body = JSON.parse(requests[0].init.body);
      expect(body.fields.summary).to.equal('Create a quote');
      expect(body.fields.description).to.contain('The quote is saved');
      expect(body.fields.priority).to.deep.equal({ name: 'High' });
      // Setting fields.labels would wipe the labels added by hand
      expect(body.fields).to.not.have.property('labels');
      expect(body.update.labels).to.deep.equal([{ add: 'TESTKIT:PROJ-123:F01' }, { add: 'MODULE:Quote_management' }]);
    });

    it('leaves the priority alone when the notebook has no priority column', () => {
      const body = XrayTestProvider.buildUpdateBody(makeCase({ priority: undefined }));
      expect(body.fields).to.not.have.property('priority');
    });

    it('does not authenticate on Xray for a Jira update', async () => {
      setAllEnv();
      mockFetch(jsonResponse({}));
      await new XrayTestProvider().update({ id: 'PROJ-9', url: 'x' }, makeCase());
      expect(requests.some((request) => request.url.includes('xray'))).to.be.false;
    });

    it('surfaces the Jira field errors of a failed update, with the issue key', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ errorMessages: [], errors: { priority: 'Specify a valid priority' } }, 400));
      const message = await errorOf(new XrayTestProvider().update({ id: 'PROJ-9', url: 'x' }, makeCase()));
      expect(message).to.contain('PROJ-9');
      expect(message).to.contain('priority: Specify a valid priority');
    });
  });

  describe('linkToStory', () => {
    it('links to the story through Jira REST with the Jira credentials, not the Xray JWT', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ id: '10001' }));
      await new XrayTestProvider().linkToStory({ id: 'PROJ-9', url: 'x' }, 'PROJ-123');
      expect(requests[0].url).to.equal('https://acme.atlassian.net/rest/api/3/issueLink');
      expect(requests[0].init.headers.Authorization).to.match(/^Basic /);
      expect(requests[0].init.headers.Authorization).to.not.match(/Bearer/);
      const body = JSON.parse(requests[0].init.body);
      expect(body.type.name).to.equal('Test');
      expect(body.inwardIssue.key).to.equal('PROJ-9');
      expect(body.outwardIssue.key).to.equal('PROJ-123');
    });

    it('surfaces the Jira error of a refused link, with both keys', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ errorMessages: ['No issue link type with name Test found.'] }, 404));
      const message = await errorOf(new XrayTestProvider().linkToStory({ id: 'PROJ-9', url: 'x' }, 'PROJ-123'));
      expect(message).to.contain('PROJ-9');
      expect(message).to.contain('PROJ-123');
      expect(message).to.contain('No issue link type with name Test found.');
    });
  });

  it('puts a timeout on every Xray and Jira call', async () => {
    setAllEnv();
    mockFetch(jsonResponse('jwt'), jsonResponse(CREATED), jsonResponse({}), jsonResponse({ issues: [] }), jsonResponse({}));
    const provider = new XrayTestProvider();
    await provider.create(makeCase());
    await provider.linkToStory({ id: 'PROJ-9', url: 'x' }, 'PROJ-123');
    await provider.findByKey('TESTKIT:PROJ-123:F01');
    await provider.update({ id: 'PROJ-9', url: 'x' }, makeCase());
    expect(requests).to.have.lengthOf(5);
    for (const request of requests) {
      expect(request.init.signal, request.url).to.be.instanceOf(AbortSignal);
    }
  });
});
