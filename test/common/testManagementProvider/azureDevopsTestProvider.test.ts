/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { AzureDevopsTestProvider } from '../../../src/common/testManagementProvider/azureDevopsTestProvider.js';
import { azureDevopsStepsXml } from '../../../src/common/testManagementProvider/azureDevopsStepsXml.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookTypes.js';

const ENV_KEYS = [
  'SYSTEM_COLLECTIONURI',
  'SYSTEM_TEAMPROJECT',
  'CI_SFDX_HARDIS_AZURE_TOKEN',
  'SYSTEM_ACCESSTOKEN',
  'AZURE_DEVOPS_EXT_PAT',
];

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Devis',
    priority: 1,
    title: 'Créer un devis',
    preconditions: 'Un compte **actif**',
    steps: [{ action: 'Ouvrir', expected: 'La page apparait' }],
    expected: 'Le devis existe',
    ...overrides,
  };
}

describe('AzureDevopsTestProvider', () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('activation', () => {
    it('stays inactive when its environment variables are missing', () => {
      expect(new AzureDevopsTestProvider().isActive).to.be.false;
    });

    it('activates on the sfdx-hardis token first', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.SYSTEM_TEAMPROJECT = 'DSI';
      process.env.CI_SFDX_HARDIS_AZURE_TOKEN = 'tok';
      expect(new AzureDevopsTestProvider().isActive).to.be.true;
    });

    it('falls back to SYSTEM_ACCESSTOKEN, the Azure Pipelines built-in', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.SYSTEM_TEAMPROJECT = 'DSI';
      process.env.SYSTEM_ACCESSTOKEN = 'tok';
      expect(new AzureDevopsTestProvider().isActive).to.be.true;
    });

    it('does not activate on AZURE_DEVOPS_EXT_PAT alone, keeping Azure detection uniform', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.SYSTEM_TEAMPROJECT = 'DSI';
      process.env.AZURE_DEVOPS_EXT_PAT = 'pat';
      expect(new AzureDevopsTestProvider().isActive).to.be.false;
    });

    it('names every variable it needs when it is inactive', () => {
      const required = new AzureDevopsTestProvider().getRequiredEnvVars();
      expect(required).to.include('SYSTEM_COLLECTIONURI');
      expect(required).to.include('SYSTEM_TEAMPROJECT');
    });
  });

  describe('buildPatch', () => {
    it('maps every normalized attribute to its Azure DevOps field', () => {
      const patch = AzureDevopsTestProvider.buildPatch(makeCase(), null);
      const paths = patch.map((op: any) => op.path);
      expect(paths).to.include('/fields/System.Title');
      expect(paths).to.include('/fields/Microsoft.VSTS.Common.Priority');
      expect(paths).to.include('/fields/Microsoft.VSTS.TCM.Steps');
      expect(paths).to.include('/fields/System.Description');
      expect(paths).to.include('/fields/System.Tags');
    });

    it('carries the idempotency key and the module in System.Tags', () => {
      const patch = AzureDevopsTestProvider.buildPatch(makeCase(), null);
      const tags = patch.find((op: any) => op.path === '/fields/System.Tags').value;
      expect(tags).to.contain('TESTKIT:PROJ-123:F01');
      expect(tags).to.contain('MODULE:Devis');
    });

    it('inherits area, iteration and assignee from the carrier work item', () => {
      const carrier = { areaPath: 'DSI\\Sales', iterationPath: 'DSI\\Sprint 1', assignedTo: 'a@b.c' };
      const patch = AzureDevopsTestProvider.buildPatch(makeCase(), carrier);
      expect(patch.find((op: any) => op.path === '/fields/System.AreaPath').value).to.equal('DSI\\Sales');
      expect(patch.find((op: any) => op.path === '/fields/System.AssignedTo').value).to.equal('a@b.c');
    });

    it('omits the assignee entirely when the carrier is unassigned, never inventing one', () => {
      const carrier = { areaPath: 'DSI\\Sales', iterationPath: null, assignedTo: null };
      const patch = AzureDevopsTestProvider.buildPatch(makeCase(), carrier);
      expect(patch.map((op: any) => op.path)).to.not.include('/fields/System.AssignedTo');
      expect(patch.map((op: any) => op.path)).to.not.include('/fields/System.IterationPath');
    });

    it('escapes html before converting markdown, so content cannot break out', () => {
      const testCase = makeCase({ preconditions: '<script>alert(1)</script> et **gras**' });
      const description = AzureDevopsTestProvider.buildPatch(testCase, null).find(
        (op: any) => op.path === '/fields/System.Description'
      ).value;
      expect(description).to.contain('&lt;script&gt;');
      expect(description).to.not.contain('<script>');
      expect(description).to.contain('<b>gras</b>');
    });
  });

  describe('azureDevopsStepsXml', () => {
    it('starts step ids at 2 and sets last to steps + 1', () => {
      const xml = azureDevopsStepsXml([
        { action: 'A', expected: 'B' },
        { action: 'C', expected: 'D' },
      ]);
      expect(xml).to.contain('<steps id="0" last="3">');
      expect(xml).to.contain('<step id="2"');
      expect(xml).to.contain('<step id="3"');
    });

    it('carries the step own expected result, not a blank placeholder', () => {
      const xml = azureDevopsStepsXml([{ action: 'Ouvrir', expected: 'La page apparait' }]);
      expect(xml).to.contain('La page apparait');
    });

    it('renders an empty step list as a valid empty steps element', () => {
      expect(azureDevopsStepsXml([])).to.equal('<steps id="0" last="1"></steps>');
    });
  });
});

describe('AzureDevopsTestProvider - api calls through the injected factory', () => {
  // What the SDK client is asked to do, in order, so the assertions below read as a trace.
  interface Recorded {
    call: string;
    args: any[];
  }

  function stubApi(overrides: Record<string, any> = {}): { api: any; calls: Recorded[] } {
    const calls: Recorded[] = [];
    const api = {
      getFields: async (...args: any[]) => {
        calls.push({ call: 'getFields', args });
        return [];
      },
      getWorkItem: async (...args: any[]) => {
        calls.push({ call: 'getWorkItem', args });
        return {
          id: args[0],
          fields: {
            'System.AreaPath': 'DSI\\Sales',
            'System.IterationPath': 'DSI\\Sprint 1',
            'System.AssignedTo': { uniqueName: 'owner@acme.test' },
          },
          _links: { html: { href: `https://dev.azure.com/acme/_workitems/edit/${args[0]}` } },
        };
      },
      queryByWiql: async (...args: any[]) => {
        calls.push({ call: 'queryByWiql', args });
        return { workItems: [] };
      },
      createWorkItem: async (...args: any[]) => {
        calls.push({ call: 'createWorkItem', args });
        return { id: 4242, _links: { html: { href: 'https://dev.azure.com/acme/_workitems/edit/4242' } } };
      },
      updateWorkItem: async (...args: any[]) => {
        calls.push({ call: 'updateWorkItem', args });
        return { id: args[2], _links: { html: { href: `https://dev.azure.com/acme/_workitems/edit/${args[2]}` } } };
      },
      ...overrides,
    };
    return { api, calls };
  }

  function providerWith(api: any): AzureDevopsTestProvider {
    const provider = new AzureDevopsTestProvider(async () => api);
    // The factory alone activates the provider, but the project name still has to reach the
    // SDK calls, so set what production would read from the environment.
    (provider as any).serverUrl = 'https://dev.azure.com/acme';
    (provider as any).teamProject = 'DSI';
    (provider as any).token = 'tok';
    return provider;
  }

  it('reads the carrier work item once for a whole push, not once per case', async () => {
    const { api, calls } = stubApi();
    const provider = providerWith(api);
    await provider.create(makeCase({ id: 'PROJ-123-F01' }));
    await provider.create(makeCase({ id: 'PROJ-123-F02' }));
    await provider.create(makeCase({ id: 'PROJ-123-F03' }));
    expect(calls.filter((entry) => entry.call === 'getWorkItem')).to.have.lengthOf(1);
    expect(calls.filter((entry) => entry.call === 'createWorkItem')).to.have.lengthOf(3);
  });

  it('creates the work item in the configured project, as a Test Case, inheriting the carrier', async () => {
    const { api, calls } = stubApi();
    const ref = await providerWith(api).create(makeCase());
    const created = calls.find((entry) => entry.call === 'createWorkItem');
    expect(created?.args[2]).to.equal('DSI');
    expect(created?.args[3]).to.equal('Test Case');
    const patch = created?.args[1] as any[];
    expect(patch.every((op) => op.op === 'add')).to.be.true;
    expect(patch.find((op) => op.path === '/fields/System.AreaPath').value).to.equal('DSI\\Sales');
    expect(patch.find((op) => op.path === '/fields/System.AssignedTo').value).to.equal('owner@acme.test');
    expect(ref.id).to.equal('4242');
  });

  // This test used to require `replace`, which is what the provider sent and what Azure DevOps
  // rejects on a field the work item does not carry yet. `add` behaves as an upsert on a work
  // item field, so it covers both the field that exists and the one being set for the first time.
  it('updates the existing work item id with add operations, which upsert each field', async () => {
    const { api, calls } = stubApi();
    await providerWith(api).update({ id: '77', url: 'https://dev.azure.com/acme/_workitems/edit/77' }, makeCase());
    const updated = calls.find((entry) => entry.call === 'updateWorkItem');
    expect(updated?.args[2]).to.equal(77);
    const patch = updated?.args[1] as any[];
    expect(patch.every((op) => op.op === 'add')).to.be.true;
    expect(patch.some((op) => op.op === 'replace')).to.be.false;
    // The whole payload is still sent, not just the title.
    expect(patch.find((op) => op.path === '/fields/System.Title')).to.not.be.undefined;
    expect(patch.find((op) => op.path === '/fields/System.Tags')).to.not.be.undefined;
    expect(patch.find((op) => op.path === '/fields/Microsoft.VSTS.TCM.Steps')).to.not.be.undefined;
  });

  it('links the created case to its story through the TestedBy-Reverse relation', async () => {
    const { api, calls } = stubApi();
    await providerWith(api).linkToStory({ id: '4242', url: 'x' }, 'PROJ-123');
    const relation = (calls.find((entry) => entry.call === 'updateWorkItem')?.args[1] as any[])[0];
    expect(relation.op).to.equal('add');
    expect(relation.path).to.equal('/relations/-');
    expect(relation.value.rel).to.equal('Microsoft.VSTS.Common.TestedBy-Reverse');
    expect(relation.value.url).to.contain('/_apis/wit/workItems/123');
  });

  it('refuses the push before writing anything when the carrier cannot be read', async () => {
    const { api, calls } = stubApi({
      getWorkItem: async () => {
        throw new Error('TF401232 not found');
      },
    });
    let message = '';
    try {
      await providerWith(api).create(makeCase());
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.contain('#123');
    expect(message).to.match(/before writing anything/i);
    expect(calls.filter((entry) => entry.call === 'createWorkItem')).to.be.empty;
  });

  // Non-regression: a ticket key holding several groups of digits (a year plus the work item
  // number) must resolve to the LAST group. Stripping only the leading letters yielded
  // "2026-14545", which Number() turns into NaN, and the SDK was then asked for work item NaN.
  it('reads the work item number of a ticket key holding several digit groups', async () => {
    const { api, calls } = stubApi();
    await providerWith(api).create(makeCase({ id: 'DSI-2026-14545-F01', ticket: 'DSI-2026-14545' }));
    const read = calls.find((entry) => entry.call === 'getWorkItem');
    expect(read?.args[0]).to.equal(14545);
  });

  it('links to the work item number of such a ticket key too', async () => {
    const { api, calls } = stubApi();
    await providerWith(api).linkToStory({ id: '4242', url: 'x' }, 'DSI-2026-14545');
    const relation = (calls.find((entry) => entry.call === 'updateWorkItem')?.args[1] as any[])[0];
    expect(relation.value.url).to.contain('/_apis/wit/workItems/14545');
  });

  it('refuses a ticket key carrying no work item number, instead of asking for item NaN', async () => {
    const { api, calls } = stubApi();
    let message = '';
    try {
      await providerWith(api).create(makeCase({ id: 'PROJ-123-F01', ticket: 'RELEASE' }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.contain('RELEASE');
    expect(message).to.match(/work item number/i);
    expect(calls).to.be.empty;
  });

  it('finds nothing rather than guessing when the tag query returns no hit', async () => {
    const { api, calls } = stubApi();
    const found = await providerWith(api).findByKey('TESTKIT:PROJ-123:F01');
    expect(found).to.equal(null);
    const query = (calls.find((entry) => entry.call === 'queryByWiql')?.args[0] as any).query;
    expect(query).to.contain("[System.WorkItemType] = 'Test Case'");
    expect(query).to.contain("CONTAINS 'TESTKIT:PROJ-123:F01'");
  });

  // WIQL offers no exact match on tags, only CONTAINS, which is an unterminated substring
  // match: the key of case F1 is a prefix of the key of F10. Taking the first hit therefore
  // updated the wrong work item and then created the right one as a duplicate.
  describe('tag matching beyond the CONTAINS query', () => {
    function stubWithTags(tagsById: Record<number, string>): { api: any; calls: Recorded[] } {
      const ids = Object.keys(tagsById).map(Number);
      return stubApi({
        queryByWiql: async () => ({ workItems: ids.map((id) => ({ id })) }),
        getWorkItem: async (id: number) => ({
          id,
          fields: { 'System.Tags': tagsById[id] },
          _links: { html: { href: `https://dev.azure.com/acme/_workitems/edit/${id}` } },
        }),
      });
    }

    it('skips a work item whose tag merely starts with the key', async () => {
      const { api } = stubWithTags({ 10: 'TESTKIT:PROJ-123:F10; Devis', 1: 'TESTKIT:PROJ-123:F1; Devis' });
      const found = await providerWith(api).findByKey('TESTKIT:PROJ-123:F1');
      expect(found?.id).to.equal('1');
    });

    it('returns null when every hit only contains the key as a substring', async () => {
      const { api } = stubWithTags({ 10: 'TESTKIT:PROJ-123:F10', 11: 'TESTKIT:PROJ-123:F11' });
      expect(await providerWith(api).findByKey('TESTKIT:PROJ-123:F1')).to.equal(null);
    });

    it('matches the key whatever its position among the other tags', async () => {
      const { api } = stubWithTags({ 7: 'Devis; TESTKIT:PROJ-123:F01; Regression' });
      expect((await providerWith(api).findByKey('TESTKIT:PROJ-123:F01'))?.id).to.equal('7');
    });
  });
});
