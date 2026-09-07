/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { XrayTestProvider, xrayBaseUrlFor } from '../../../src/common/testManagementProvider/xrayTestProvider.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookTypes.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

const ENV_KEYS = [
  'XRAY_CLIENT_ID',
  'XRAY_CLIENT_SECRET',
  'XRAY_REGION',
  'JIRA_HOST',
  'JIRA_PROJECT_KEY',
  'JIRA_EMAIL',
  'JIRA_TOKEN',
];

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Gestion des devis',
    priority: 1,
    title: 'Créer un devis',
    preconditions: 'Voir [la fiche](https://example.test/fiche)',
    steps: [{ action: 'Ouvrir', expected: 'La page apparait' }],
    expected: 'Le devis existe',
    ...overrides,
  };
}

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

  it('stays inactive without its variables and activates with the Xray and Jira ones', () => {
    expect(new XrayTestProvider().isActive).to.be.false;
    setAllEnv();
    expect(new XrayTestProvider().isActive).to.be.true;
  });

  it('names every variable it needs, reusing the Jira names the plugin already reads', () => {
    const required = new XrayTestProvider().getRequiredEnvVars();
    expect(required).to.include('XRAY_CLIENT_ID');
    expect(required).to.include('JIRA_HOST');
    expect(required).to.include('JIRA_TOKEN');
    expect(required).to.include('JIRA_PROJECT_KEY');
  });

  it('authenticates on /api/v2/authenticate and carries the JWT as a Bearer on the next call', async () => {
    setAllEnv();
    mockFetch(jsonResponse('the-jwt'), jsonResponse({ data: { createTest: { test: { issueId: '1', jira: { key: 'PROJ-9' } } } } }));
    await new XrayTestProvider().create(makeCase());
    expect(requests[0].url).to.equal('https://xray.cloud.getxray.app/api/v2/authenticate');
    expect(requests[0].init.method).to.equal('POST');
    expect(JSON.parse(requests[0].init.body).client_id).to.equal('cid');
    expect(requests[1].init.headers.Authorization).to.equal('Bearer the-jwt');
  });

  it('follows the region and falls back to the global endpoint on an unknown one', () => {
    expect(xrayBaseUrlFor('us')).to.equal('https://us.xray.cloud.getxray.app');
    expect(xrayBaseUrlFor('eu')).to.equal('https://eu.xray.cloud.getxray.app');
    expect(xrayBaseUrlFor('au')).to.equal('https://au.xray.cloud.getxray.app');
    expect(xrayBaseUrlFor('mars')).to.equal('https://xray.cloud.getxray.app');
    expect(xrayBaseUrlFor(null)).to.equal('https://xray.cloud.getxray.app');
  });

  it('creates a test with a single GraphQL mutation, not two', async () => {
    setAllEnv();
    mockFetch(jsonResponse('jwt'), jsonResponse({ data: { createTest: { test: { issueId: '1', jira: { key: 'PROJ-9' } } } } }));
    const ref = await new XrayTestProvider().create(makeCase());
    const graphqlCalls = requests.filter((request) => request.url.endsWith('/api/v2/graphql'));
    expect(graphqlCalls).to.have.lengthOf(1);
    expect(JSON.parse(graphqlCalls[0].init.body).query).to.contain('createTest');
    expect(ref.url).to.equal('https://acme.atlassian.net/browse/PROJ-9');
  });

  it('translates the normalized priority into its Jira name', () => {
    const nameOf = (priority: 1 | 2 | 3): string =>
      XrayTestProvider.buildVariables(makeCase({ priority }), 'PROJ').jira.fields.priority.name;
    expect(nameOf(1)).to.equal('Highest');
    expect(nameOf(2)).to.equal('High');
    expect(nameOf(3)).to.equal('Medium');
  });

  it('carries the idempotency key and the module in the Jira labels', () => {
    const labels = XrayTestProvider.buildVariables(makeCase(), 'PROJ').jira.fields.labels;
    expect(labels).to.include('TESTKIT:PROJ-123:F01');
    // A Jira label cannot hold a space, so the module name is underscored.
    expect(labels).to.include('MODULE:Gestion_des_devis');
  });

  it('leaves the step data field absent, because nothing produces it', () => {
    const steps = XrayTestProvider.buildVariables(makeCase(), 'PROJ').steps;
    expect(steps).to.deep.equal([{ action: 'Ouvrir', result: 'La page apparait' }]);
    expect(Object.keys(steps[0])).to.not.include('data');
  });

  it('reduces a markdown link of the description to a bare URL', () => {
    const description = XrayTestProvider.buildVariables(makeCase(), 'PROJ').jira.fields.description;
    expect(description).to.contain('https://example.test/fiche');
    expect(description).to.not.contain('[la fiche]');
  });

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

  it('searches the label and returns null on zero result', async () => {
    setAllEnv();
    mockFetch(jsonResponse({ issues: [] }));
    const found = await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01');
    expect(found).to.equal(null);
    expect(requests[0].url).to.contain('/rest/api/3/search');
    // Read the parameter itself: the query is form encoded, so a raw string match would be
    // asserting on the encoding rather than on the JQL.
    const jql = new URL(requests[0].url).searchParams.get('jql');
    expect(jql).to.equal('project = "PROJ" AND labels = "TESTKIT:PROJ-123:F01"');
  });

  it('returns the found issue when the label matches', async () => {
    setAllEnv();
    mockFetch(jsonResponse({ issues: [{ id: '10', key: 'PROJ-9' }] }));
    const found = await new XrayTestProvider().findByKey('TESTKIT:PROJ-123:F01');
    expect(found).to.deep.equal({ id: 'PROJ-9', url: 'https://acme.atlassian.net/browse/PROJ-9' });
  });

  // The authenticate endpoint answers with a quoted JSON string. Served as application/json it
  // is parsed and the token arrives bare; served as text/plain it arrives as the literal
  // `"eyJ..."`, quotes included. The quote strip used to sit on the object branch, where
  // neither shape ever goes, so a text/plain instance sent a Bearer with quotes in it.
  it('strips the quotes of a JWT served as text/plain, so the Bearer carries the bare token', async () => {
    setAllEnv();
    mockFetch(
      new Response('"the-jwt"', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      jsonResponse({ data: { createTest: { test: { issueId: '1', jira: { key: 'PROJ-9' } } } } })
    );
    await new XrayTestProvider().create(makeCase());
    expect(requests[1].init.headers.Authorization).to.equal('Bearer the-jwt');
  });

  // An update used to send only the summary and the labels, so a description or a priority
  // corrected in the notebook was silently dropped while the case was reported as updated.
  it('updates every Jira field it owns, not just the summary', async () => {
    setAllEnv();
    mockFetch(jsonResponse('the-jwt'), jsonResponse({}));
    await new XrayTestProvider().update(
      { id: 'PROJ-9', url: 'https://acme.atlassian.net/browse/PROJ-9' },
      makeCase({ priority: 2, expected: 'Le devis est enregistre' })
    );
    const call = requests.find((entry) => entry.url.includes('/rest/api/3/issue/PROJ-9'));
    expect(call?.init.method).to.equal('PUT');
    const fields = JSON.parse(call?.init.body).fields;
    expect(fields.summary).to.equal('Créer un devis');
    expect(fields.description).to.contain('Le devis est enregistre');
    expect(fields.priority).to.deep.equal({ name: 'High' });
    expect(fields.labels).to.include('TESTKIT:PROJ-123:F01');
  });
});
