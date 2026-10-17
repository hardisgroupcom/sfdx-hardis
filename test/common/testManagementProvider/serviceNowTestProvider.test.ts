/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { ServiceNowTestProvider } from '../../../src/common/testManagementProvider/serviceNowTestProvider.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookUtils.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

// The names the repo already reads, in misc:servicenow-report and in the ServiceNow ticket provider
const ENV_KEYS = ['SERVICENOW_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD'];

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Quotes',
    priority: 1,
    title: 'Create a quote',
    preconditions: 'See [the spec](https://example.test/spec)',
    steps: [
      { action: 'Open the page', expected: 'The page is displayed' },
      { action: 'Save', expected: '' },
    ],
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

describe('ServiceNowTestProvider', () => {
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
      return nextResponses.shift() ?? jsonResponse({ result: {} });
    });
  }

  function setAllEnv(url = 'https://acme.service-now.com') {
    process.env.SERVICENOW_URL = url;
    process.env.SERVICENOW_USERNAME = 'integration';
    process.env.SERVICENOW_PASSWORD = 'secret';
  }

  function createResponses(): Response[] {
    return [
      jsonResponse({ result: { sys_id: 'test-1' } }),
      jsonResponse({ result: { sys_id: 'version-1' } }),
      jsonResponse({ result: { sys_id: 'step-1' } }),
      jsonResponse({ result: { sys_id: 'step-2' } }),
    ];
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
    it('stays inactive without its variables and activates with the three', () => {
      expect(new ServiceNowTestProvider().isActive).to.be.false;
      setAllEnv();
      expect(new ServiceNowTestProvider().isActive).to.be.true;
    });

    it('names the three variables the repo already documents', () => {
      const required = new ServiceNowTestProvider().getRequiredEnvVars();
      expect(required).to.deep.equal(['SERVICENOW_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD']);
    });

    it('accepts a bare instance host as well as a full URL, with or without a trailing slash', async () => {
      for (const raw of ['acme.service-now.com', 'https://acme.service-now.com/', 'https://acme.service-now.com']) {
        setAllEnv(raw);
        mockFetch(jsonResponse({ result: [] }));
        await new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01');
        expect(requests[0].url).to.contain('https://acme.service-now.com/api/now/table/');
        expect(requests[0].url).to.not.contain('//api/now');
      }
    });
  });

  describe('checkPrerequisites', () => {
    it('names the missing settings without any call', async () => {
      mockFetch();
      const message = await errorOf(new ServiceNowTestProvider().checkPrerequisites());
      expect(message).to.contain('SERVICENOW_URL');
      expect(requests).to.be.empty;
    });

    for (const status of [403, 404]) {
      it(`names the plugin on a ${status}, without attempting a write`, async () => {
        setAllEnv();
        mockFetch(jsonResponse({ error: { message: 'no' } }, status));
        const message = await errorOf(new ServiceNowTestProvider().checkPrerequisites());
        expect(message).to.contain('com.snc.test_management.2.0');
        expect(message).to.contain('sn_test_management_test');
        expect(message).to.contain(String(status));
        // Only the probe GET was issued: nothing was written.
        expect(requests).to.have.lengthOf(1);
        expect(requests[0].init.method).to.equal('GET');
      });
    }

    it('surfaces the server error detail on another failure', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ error: { message: 'User Not Authenticated', detail: 'Required to provide Auth information' } }, 401));
      const message = await errorOf(new ServiceNowTestProvider().checkPrerequisites());
      expect(message).to.contain('401');
      expect(message).to.contain('User Not Authenticated');
      expect(message).to.contain('Required to provide Auth information');
    });

    it('passes on a reachable table', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [] }));
      await new ServiceNowTestProvider().checkPrerequisites();
      expect(requests[0].url).to.contain('/api/now/table/sn_test_management_test?');
      expect(new URL(requests[0].url).searchParams.get('sysparm_limit')).to.equal('1');
      expect(requests[0].init.headers.Authorization).to.match(/^Basic /);
    });

    // A hibernating developer instance answers every call with a 200 HTML page
    it('refuses a 200 HTML page, as a hibernating instance answers', async () => {
      setAllEnv();
      mockFetch(
        new Response('<html><body>Your instance is hibernating</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      );
      const message = await errorOf(new ServiceNowTestProvider().checkPrerequisites());
      expect(message).to.contain('https://acme.service-now.com');
    });

    it('refuses a JSON answer that is not a Table API list', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ status: 'ok' }));
      const message = await errorOf(new ServiceNowTestProvider().checkPrerequisites());
      expect(message).to.contain('https://acme.service-now.com');
    });
  });

  describe('buildShortDescription', () => {
    it('prefixes the title with the idempotency key only, without the module', () => {
      expect(ServiceNowTestProvider.buildShortDescription(makeCase())).to.equal('[TESTKIT:PROJ-123:F01] Create a quote');
    });
  });

  describe('buildStepText', () => {
    it('writes the expected result inside the step text, the step table having no such column', () => {
      const text = ServiceNowTestProvider.buildStepText('Open the page', 'The page is displayed');
      expect(text.startsWith('Open the page\n')).to.be.true;
      expect(text.endsWith(' The page is displayed')).to.be.true;
    });

    it('keeps the action alone when the step has no expected result', () => {
      expect(ServiceNowTestProvider.buildStepText('Save', '')).to.equal('Save');
    });
  });

  describe('create', () => {
    it('chains the three inserts in order: test, version, then one step per step', async () => {
      setAllEnv();
      mockFetch(...createResponses());
      const ref = await new ServiceNowTestProvider().create(makeCase());
      const tables = requests.map((request) => String(request.url).split('/api/now/table/')[1]);
      expect(tables).to.deep.equal([
        'sn_test_management_test',
        'sn_test_management_test_version',
        'sn_test_management_step',
        'sn_test_management_step',
      ]);
      expect(requests.every((request) => request.init.method === 'POST')).to.be.true;
      expect(JSON.parse(requests[1].init.body)).to.deep.equal({ test: 'test-1', version: 1, short_description: '[TESTKIT:PROJ-123:F01] Create a quote' });
      expect(ref).to.deep.equal({ id: 'test-1', url: 'https://acme.service-now.com/sn_test_management_test.do?sys_id=test-1' });
    });

    it('orders the steps by 100 increments and puts the expected result in the step text', async () => {
      setAllEnv();
      mockFetch(...createResponses());
      await new ServiceNowTestProvider().create(makeCase());
      const steps = requests.slice(2).map((request) => JSON.parse(request.init.body));
      expect(steps.map((step) => step.order)).to.deep.equal([100, 200]);
      expect(steps[0].test_version).to.equal('version-1');
      expect(steps[0].step).to.contain('Open the page');
      expect(steps[0].step).to.contain('The page is displayed');
      expect(steps[0]).to.not.have.property('expected_result');
      expect(steps[1].step).to.equal('Save');
    });

    it('inserts no step record for a case without steps', async () => {
      setAllEnv();
      mockFetch(...createResponses());
      await new ServiceNowTestProvider().create(makeCase({ steps: undefined }));
      expect(requests).to.have.lengthOf(2);
    });

    it('writes the title on the test and on its version, and nothing the test table does not have', async () => {
      setAllEnv();
      mockFetch(...createResponses());
      await new ServiceNowTestProvider().create(makeCase());
      // Test Management 2.0 has no description nor priority field: the Table API would drop them silently
      expect(JSON.parse(requests[0].init.body)).to.deep.equal({ short_description: '[TESTKIT:PROJ-123:F01] Create a quote' });
      expect(JSON.parse(requests[1].init.body).short_description).to.equal('[TESTKIT:PROJ-123:F01] Create a quote');
    });

    it('throws when an insert answer carries no sys_id, instead of chaining on undefined', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: {} }));
      const message = await errorOf(new ServiceNowTestProvider().create(makeCase()));
      expect(message).to.contain('sn_test_management_test');
      expect(requests).to.have.lengthOf(1);
    });

    it('throws when the version insert carries no sys_id, before any step', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: { sys_id: 'test-1' } }), new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
      const message = await errorOf(new ServiceNowTestProvider().create(makeCase()));
      expect(message).to.contain('sn_test_management_test_version');
      expect(requests).to.have.lengthOf(2);
    });

    it('surfaces the detail of a 400 answer', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({ error: { message: 'Invalid field', detail: 'priority: value 9 is not allowed' }, status: 'failure' }, 400)
      );
      const message = await errorOf(new ServiceNowTestProvider().create(makeCase()));
      expect(message).to.contain('400');
      expect(message).to.contain('Invalid field');
      expect(message).to.contain('priority: value 9 is not allowed');
      expect(message).to.contain('sn_test_management_test');
    });
  });

  describe('findByKey', () => {
    it('queries the short_description prefix and returns null on zero result', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [] }));
      const found = await new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      expect(found).to.equal(null);
      const params = new URL(requests[0].url).searchParams;
      expect(params.get('sysparm_query')).to.equal('short_descriptionSTARTSWITH[TESTKIT:PROJ-123:F01]');
      expect(params.get('sysparm_fields')).to.equal('sys_id,short_description');
    });

    it('returns the record when its short_description starts with the bracketed key', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [{ sys_id: 'test-9', short_description: '[TESTKIT:PROJ-123:F01] Create a quote' }] }));
      const found = await new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      expect(found).to.deep.equal({
        id: 'test-9',
        url: 'https://acme.service-now.com/sn_test_management_test.do?sys_id=test-9',
      });
    });

    it('ignores a hit whose short_description does not start with the bracketed key', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({
          result: [
            { sys_id: 'test-1', short_description: 'Copy of [TESTKIT:PROJ-123:F01] Create a quote' },
            { sys_id: 'test-2', short_description: '[TESTKIT:PROJ-123:F010] Another case' },
            { sys_id: 'test-3' },
          ],
        })
      );
      expect(await new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01')).to.equal(null);
    });

    it('picks the exact hit among near matches', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({
          result: [
            { sys_id: 'test-2', short_description: 'TESTKIT:PROJ-123:F01 without brackets' },
            { sys_id: 'test-3', short_description: '[TESTKIT:PROJ-123:F01] Create a quote' },
          ],
        })
      );
      expect((await new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01'))?.id).to.equal('test-3');
    });

    it('surfaces the server error detail of a failed search', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ error: { message: 'Invalid query' } }, 400));
      const message = await errorOf(new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01'));
      expect(message).to.contain('400');
      expect(message).to.contain('Invalid query');
    });
  });

  describe('update', () => {
    it('renames the latest version, the test copying its read-only title from it, without touching the steps', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [{ sys_id: 'version-3' }] }), jsonResponse({ result: { sys_id: 'version-3' } }));
      const ref = await new ServiceNowTestProvider().update(
        { id: 'test-9', url: 'https://acme.service-now.com/sn_test_management_test.do?sys_id=test-9' },
        makeCase()
      );
      expect(requests).to.have.lengthOf(2);
      const params = new URL(requests[0].url).searchParams;
      expect(params.get('sysparm_query')).to.equal('test=test-9^ORDERBYDESCversion');
      expect(requests[1].init.method).to.equal('PATCH');
      expect(requests[1].url).to.equal('https://acme.service-now.com/api/now/table/sn_test_management_test_version/version-3');
      expect(JSON.parse(requests[1].init.body)).to.deep.equal({ short_description: '[TESTKIT:PROJ-123:F01] Create a quote' });
      expect(ref.id).to.equal('test-9');
    });

    it('gives a version holding the title to a test that has none', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [] }), jsonResponse({ result: { sys_id: 'version-1' } }));
      await new ServiceNowTestProvider().update({ id: 'test-9', url: 'x' }, makeCase());
      expect(requests[1].init.method).to.equal('POST');
      expect(JSON.parse(requests[1].init.body)).to.deep.equal({ test: 'test-9', version: 1, short_description: '[TESTKIT:PROJ-123:F01] Create a quote' });
    });

    it('surfaces the server error detail of a failed update, with the record id', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [{ sys_id: 'version-3' }] }), jsonResponse({ error: { message: 'ACL restricts the record' } }, 403));
      const message = await errorOf(new ServiceNowTestProvider().update({ id: 'test-9', url: 'x' }, makeCase()));
      expect(message).to.contain('test-9');
      expect(message).to.contain('ACL restricts the record');
    });
  });

  describe('carrier ticket', () => {
    it('reads every carrier record once before any write, and refuses a missing one', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [{ sys_id: 'task-1' }] }), jsonResponse({ result: [] }));
      const cases = [makeCase(), makeCase({ id: 'PROJ-123-F02' }), makeCase({ id: 'INC0099999-F01', ticket: 'INC0099999' })];
      const message = await errorOf(new ServiceNowTestProvider().prepare(cases));
      expect(requests).to.have.lengthOf(2);
      expect(new URL(requests[0].url).pathname).to.equal('/api/now/table/task');
      expect(new URL(requests[0].url).searchParams.get('sysparm_query')).to.equal('number=PROJ-123');
      expect(message).to.contain('INC0099999');
    });

    it('links the test to the record of its ticket once', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [{ sys_id: 'task-1' }] }), jsonResponse({ result: [] }), jsonResponse({ result: { sys_id: 'link-1' } }));
      const provider = new ServiceNowTestProvider();
      await provider.linkToStory({ id: 'test-9', url: 'x' }, 'INC0010005');
      expect(requests[2].url).to.equal('https://acme.service-now.com/api/now/table/sn_test_management_m2m_task_test');
      expect(JSON.parse(requests[2].init.body)).to.deep.equal({ test: 'test-9', task: 'task-1' });

      // The task id is cached, and an existing link is not added twice
      mockFetch(jsonResponse({ result: [{ sys_id: 'link-1' }] }));
      await provider.linkToStory({ id: 'test-9', url: 'x' }, 'INC0010005');
      expect(requests).to.have.lengthOf(1);
    });
  });
});

describe('ServiceNowTestProvider partial create', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ['SERVICENOW_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD']) {
      saved[key] = process.env[key];
    }
    process.env.SERVICENOW_URL = 'https://acme.service-now.com';
    process.env.SERVICENOW_USERNAME = 'integration';
    process.env.SERVICENOW_PASSWORD = 'secret';
  });
  afterEach(() => {
    setFetchForTests(null);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('names the created test when its version cannot be inserted', async () => {
    const answers = [
      new Response(JSON.stringify({ result: { sys_id: 'test-9' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
      new Response(JSON.stringify({ error: { message: 'Insert refused' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    ];
    setFetchForTests(async () => answers.shift());
    const testCase: NormalizedTestCase = { id: 'PROJ-1-F01', ticket: 'PROJ-1', kind: 'functional', title: 'Title', expected: 'Expected', steps: [] };
    let message = '';
    try {
      await new ServiceNowTestProvider().create(testCase);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.contain('test-9');
    expect(message).to.contain('Insert refused');
  });
});
