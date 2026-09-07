/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { ServiceNowTestProvider } from '../../../src/common/testManagementProvider/serviceNowTestProvider.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookTypes.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

// The names the repo already reads, in misc:servicenow-report and in the ticketing connector
// added by #2158. Not SERVICENOW_INSTANCE / SERVICENOW_USER, which the skill used.
const ENV_KEYS = ['SERVICENOW_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD'];

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Devis',
    priority: 1,
    title: 'Creer un devis',
    preconditions: 'Voir [la fiche](https://example.test/fiche)',
    steps: [
      { action: 'Ouvrir', expected: 'La page apparait' },
      { action: 'Valider', expected: 'Le devis est cree' },
    ],
    expected: 'Le devis existe',
    ...overrides,
  };
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
    for (const status of [403, 404]) {
      it(`names the plugin and its license dependency on a ${status}, without attempting a write`, async () => {
        setAllEnv();
        mockFetch(jsonResponse({ error: { message: 'no' } }, status));
        let message = '';
        try {
          await new ServiceNowTestProvider().checkPrerequisites();
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).to.contain('com.snc.test_management.2.0');
        expect(message).to.match(/SPM|ITBM/);
        // Only the probe GET was issued: nothing was written.
        expect(requests).to.have.lengthOf(1);
        expect(requests[0].init.method).to.equal('GET');
      });
    }

    it('passes on a reachable table', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [] }));
      await new ServiceNowTestProvider().checkPrerequisites();
      expect(requests[0].url).to.contain('/api/now/table/sn_test_management_test');
      expect(requests[0].init.headers.Authorization).to.match(/^Basic /);
    });
  });

  describe('create', () => {
    it('chains the three inserts in order: test, version, then one step per step', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({ result: { sys_id: 'test-1' } }),
        jsonResponse({ result: { sys_id: 'version-1' } }),
        jsonResponse({ result: { sys_id: 'step-1' } }),
        jsonResponse({ result: { sys_id: 'step-2' } })
      );
      const ref = await new ServiceNowTestProvider().create(makeCase());
      const tables = requests.map((request) => String(request.url).split('/api/now/table/')[1]);
      expect(tables).to.deep.equal([
        'sn_test_management_test',
        'sn_test_management_test_version',
        'sn_test_management_test_step',
        'sn_test_management_test_step',
      ]);
      expect(ref.id).to.equal('test-1');
      expect(ref.url).to.equal('https://acme.service-now.com/sn_test_management_test.do?sys_id=test-1');
    });

    it('orders the steps by 100 increments', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({ result: { sys_id: 'test-1' } }),
        jsonResponse({ result: { sys_id: 'version-1' } }),
        jsonResponse({ result: { sys_id: 'step-1' } }),
        jsonResponse({ result: { sys_id: 'step-2' } })
      );
      await new ServiceNowTestProvider().create(makeCase());
      const steps = requests.slice(2).map((request) => JSON.parse(request.init.body));
      expect(steps.map((step) => step.order)).to.deep.equal([100, 200]);
      expect(steps[0].description).to.equal('Ouvrir');
      expect(steps[0].expected_result).to.equal('La page apparait');
      expect(steps[0].test_version).to.equal('version-1');
    });

    it('keeps the idempotency key as a short_description prefix, the retained fallback', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({ result: { sys_id: 'test-1' } }),
        jsonResponse({ result: { sys_id: 'version-1' } }),
        jsonResponse({ result: { sys_id: 'step-1' } }),
        jsonResponse({ result: { sys_id: 'step-2' } })
      );
      await new ServiceNowTestProvider().create(makeCase());
      const body = JSON.parse(requests[0].init.body);
      expect(body.short_description).to.contain('[TESTKIT:PROJ-123:F01]');
      expect(body.short_description).to.contain('Creer un devis');
      expect(body.priority).to.equal(1);
    });

    it('sends a plain text description, reducing a markdown link to a bare URL', async () => {
      setAllEnv();
      mockFetch(
        jsonResponse({ result: { sys_id: 'test-1' } }),
        jsonResponse({ result: { sys_id: 'version-1' } }),
        jsonResponse({ result: { sys_id: 'step-1' } }),
        jsonResponse({ result: { sys_id: 'step-2' } })
      );
      await new ServiceNowTestProvider().create(makeCase());
      const description = JSON.parse(requests[0].init.body).description;
      expect(description).to.contain('https://example.test/fiche');
      expect(description).to.not.contain('[la fiche]');
      expect(description).to.not.contain('<');
    });
  });

  describe('findByKey', () => {
    it('queries the short_description prefix and returns null on zero result', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [] }));
      const found = await new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      expect(found).to.equal(null);
      const query = new URL(requests[0].url).searchParams.get('sysparm_query');
      expect(query).to.equal('short_descriptionSTARTSWITH[TESTKIT:PROJ-123:F01]');
    });

    it('returns the record when the prefix matches', async () => {
      setAllEnv();
      mockFetch(jsonResponse({ result: [{ sys_id: 'test-9' }] }));
      const found = await new ServiceNowTestProvider().findByKey('TESTKIT:PROJ-123:F01');
      expect(found).to.deep.equal({
        id: 'test-9',
        url: 'https://acme.service-now.com/sn_test_management_test.do?sys_id=test-9',
      });
    });
  });

  it('updates the test record in place without touching its steps', async () => {
    setAllEnv();
    mockFetch(jsonResponse({ result: { sys_id: 'test-9' } }));
    const ref = await new ServiceNowTestProvider().update(
      { id: 'test-9', url: 'https://acme.service-now.com/sn_test_management_test.do?sys_id=test-9' },
      makeCase()
    );
    expect(requests).to.have.lengthOf(1);
    expect(requests[0].init.method).to.equal('PATCH');
    expect(requests[0].url).to.equal('https://acme.service-now.com/api/now/table/sn_test_management_test/test-9');
    expect(ref.id).to.equal('test-9');
  });
});
