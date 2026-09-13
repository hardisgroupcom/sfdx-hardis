/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  AzureDevopsTestProvider,
  azureDevopsStepsXml,
} from '../../../src/common/testManagementProvider/azureDevopsTestProvider.js';
import { pushCases } from '../../../src/common/testManagementProvider/index.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookUtils.js';
import { reinitI18n } from '../../../src/common/utils/i18n.js';

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
    module: 'Quotes',
    priority: 1,
    title: 'Create a quote',
    preconditions: 'An **active** account',
    steps: [{ action: 'Open the page', expected: 'The page is displayed' }],
    expected: 'The quote exists',
    ...overrides,
  };
}

function valueOf(patch: any[], path: string): any {
  return patch.find((op: any) => op.path === path)?.value;
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('Expected a rejection');
}

let savedEnv: Record<string, string | undefined> = {};

function saveEnv(): void {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

describe('AzureDevopsTestProvider', () => {
  beforeEach(saveEnv);
  afterEach(restoreEnv);

  describe('activation', () => {
    it('stays inactive when its environment variables are missing', () => {
      expect(new AzureDevopsTestProvider().isActive).to.be.false;
    });

    it('activates on the sfdx-hardis token', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.SYSTEM_TEAMPROJECT = 'Sales';
      process.env.CI_SFDX_HARDIS_AZURE_TOKEN = 'tok';
      expect(new AzureDevopsTestProvider().isActive).to.be.true;
    });

    it('falls back to SYSTEM_ACCESSTOKEN, the Azure Pipelines built-in', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.SYSTEM_TEAMPROJECT = 'Sales';
      process.env.SYSTEM_ACCESSTOKEN = 'tok';
      expect(new AzureDevopsTestProvider().isActive).to.be.true;
    });

    it('activates on AZURE_DEVOPS_EXT_PAT, the token of the az devops CLI', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.SYSTEM_TEAMPROJECT = 'Sales';
      process.env.AZURE_DEVOPS_EXT_PAT = 'pat';
      const provider = new AzureDevopsTestProvider();
      expect(provider.isActive).to.be.true;
      expect((provider as any).token).to.equal('pat');
    });

    it('prefers the sfdx-hardis token over AZURE_DEVOPS_EXT_PAT', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.SYSTEM_TEAMPROJECT = 'Sales';
      process.env.CI_SFDX_HARDIS_AZURE_TOKEN = 'hardis';
      process.env.AZURE_DEVOPS_EXT_PAT = 'pat';
      expect((new AzureDevopsTestProvider() as any).token).to.equal('hardis');
    });

    it('stays inactive with a token but no project', () => {
      process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
      process.env.AZURE_DEVOPS_EXT_PAT = 'pat';
      expect(new AzureDevopsTestProvider().isActive).to.be.false;
    });

    it('names every variable it needs, AZURE_DEVOPS_EXT_PAT included', () => {
      const required = new AzureDevopsTestProvider().getRequiredEnvVars().join(' ');
      expect(required).to.contain('SYSTEM_COLLECTIONURI');
      expect(required).to.contain('SYSTEM_TEAMPROJECT');
      expect(required).to.contain('CI_SFDX_HARDIS_AZURE_TOKEN');
      expect(required).to.contain('AZURE_DEVOPS_EXT_PAT');
    });
  });

  describe('buildCreatePatch', () => {
    it('maps every normalized attribute to its Azure DevOps field, with add operations', () => {
      const patch = AzureDevopsTestProvider.buildCreatePatch(makeCase(), null);
      const paths = patch.map((op: any) => op.path);
      expect(paths).to.include.members([
        '/fields/System.Title',
        '/fields/Microsoft.VSTS.Common.Priority',
        '/fields/Microsoft.VSTS.TCM.Steps',
        '/fields/System.Description',
        '/fields/System.Tags',
      ]);
      expect(patch.every((op: any) => op.op === 'add')).to.be.true;
    });

    it('defaults the priority to 2 when the notebook has no priority column', () => {
      const patch = AzureDevopsTestProvider.buildCreatePatch(makeCase({ priority: undefined }), null);
      expect(valueOf(patch, '/fields/Microsoft.VSTS.Common.Priority')).to.equal(2);
    });

    it('sends an empty steps element when the case has no steps', () => {
      const patch = AzureDevopsTestProvider.buildCreatePatch(makeCase({ steps: undefined }), null);
      expect(valueOf(patch, '/fields/Microsoft.VSTS.TCM.Steps')).to.equal('<steps id="0" last="1"></steps>');
    });

    it('carries the idempotency key and the module in System.Tags', () => {
      const tags = valueOf(AzureDevopsTestProvider.buildCreatePatch(makeCase(), null), '/fields/System.Tags');
      expect(tags).to.equal('TESTKIT:PROJ-123:F01; MODULE:Quotes');
    });

    it('omits the module tag when the case has no module', () => {
      const tags = valueOf(AzureDevopsTestProvider.buildCreatePatch(makeCase({ module: undefined }), null), '/fields/System.Tags');
      expect(tags).to.equal('TESTKIT:PROJ-123:F01');
    });

    it('inherits area, iteration and assignee from the carrier work item', () => {
      const carrier = { areaPath: 'Sales\\Team A', iterationPath: 'Sales\\Sprint 1', assignedTo: 'owner@acme.test' };
      const patch = AzureDevopsTestProvider.buildCreatePatch(makeCase(), carrier);
      expect(valueOf(patch, '/fields/System.AreaPath')).to.equal('Sales\\Team A');
      expect(valueOf(patch, '/fields/System.IterationPath')).to.equal('Sales\\Sprint 1');
      expect(valueOf(patch, '/fields/System.AssignedTo')).to.equal('owner@acme.test');
    });

    it('omits the assignee entirely when the carrier is unassigned, never inventing one', () => {
      const carrier = { areaPath: 'Sales\\Team A', iterationPath: null, assignedTo: null };
      const paths = AzureDevopsTestProvider.buildCreatePatch(makeCase(), carrier).map((op: any) => op.path);
      expect(paths).to.not.include('/fields/System.AssignedTo');
      expect(paths).to.not.include('/fields/System.IterationPath');
      expect(paths).to.include('/fields/System.AreaPath');
    });

    it('escapes html before converting markdown, so content cannot break out', () => {
      const testCase = makeCase({ preconditions: '<script>alert(1)</script> and **bold**' });
      const description = valueOf(AzureDevopsTestProvider.buildCreatePatch(testCase, null), '/fields/System.Description');
      expect(description).to.contain('&lt;script&gt;');
      expect(description).to.not.contain('<script>');
      expect(description).to.contain('<b>bold</b>');
    });

    it('turns a markdown link into an anchor, and inline code into a code tag', () => {
      const testCase = makeCase({ preconditions: 'See [the spec](https://example.test/spec) and `Account.Name`' });
      const description = valueOf(AzureDevopsTestProvider.buildCreatePatch(testCase, null), '/fields/System.Description');
      expect(description).to.contain('<a href="https://example.test/spec">the spec</a>');
      expect(description).to.contain('<code>Account.Name</code>');
    });

    it('renders real line breaks of the description as <br>', () => {
      const testCase = makeCase({ expected: 'The quote exists\r\nIts total is 100\nIt is visible' });
      const description = valueOf(AzureDevopsTestProvider.buildCreatePatch(testCase, null), '/fields/System.Description');
      expect(description).to.contain('The quote exists<br>Its total is 100<br>It is visible');
    });

    it('writes the description labels in English whatever the locale', () => {
      const testCase = makeCase({ target: 'QuoteService.create', soql: 'SELECT Id FROM Quote' });
      const render = (): string => valueOf(AzureDevopsTestProvider.buildCreatePatch(testCase, null), '/fields/System.Description');
      const saved = process.env.SFDX_HARDIS_LANG;
      let english = '';
      let french = '';
      try {
        process.env.SFDX_HARDIS_LANG = 'en';
        reinitI18n();
        english = render();
        process.env.SFDX_HARDIS_LANG = 'fr';
        reinitI18n();
        french = render();
      } finally {
        if (saved === undefined) {
          delete process.env.SFDX_HARDIS_LANG;
        } else {
          process.env.SFDX_HARDIS_LANG = saved;
        }
        reinitI18n();
      }
      expect(french).to.equal(english);
      expect(english).to.contain('<code>QuoteService.create</code>');
      expect(english).to.contain('<pre>SELECT Id FROM Quote</pre>');
      // Five labelled blocks: module, target, preconditions, expected result, SOQL
      expect(english.match(/<div><b>/g)).to.have.lengthOf(5);
    });

    it('escapes a SOQL query without converting it', () => {
      const testCase = makeCase({ soql: "SELECT Id FROM Account WHERE Name = '**x**' AND Amount < 5" });
      const description = valueOf(AzureDevopsTestProvider.buildCreatePatch(testCase, null), '/fields/System.Description');
      expect(description).to.contain('<pre>SELECT Id FROM Account WHERE Name = \'**x**\' AND Amount &lt; 5</pre>');
    });
  });

  describe('buildUpdatePatch', () => {
    it('never sends assignee, area or iteration, which the team owns', () => {
      const paths = AzureDevopsTestProvider.buildUpdatePatch(makeCase(), []).map((op: any) => op.path);
      expect(paths).to.not.include('/fields/System.AssignedTo');
      expect(paths).to.not.include('/fields/System.AreaPath');
      expect(paths).to.not.include('/fields/System.IterationPath');
      expect(paths).to.include.members(['/fields/System.Title', '/fields/System.Description', '/fields/System.Tags']);
    });

    it('sends priority and steps when the notebook has those columns', () => {
      const patch = AzureDevopsTestProvider.buildUpdatePatch(makeCase({ priority: 3 }), []);
      expect(valueOf(patch, '/fields/Microsoft.VSTS.Common.Priority')).to.equal(3);
      expect(valueOf(patch, '/fields/Microsoft.VSTS.TCM.Steps')).to.contain('The page is displayed');
    });

    it('leaves priority and steps alone when the notebook has no such column', () => {
      const paths = AzureDevopsTestProvider.buildUpdatePatch(makeCase({ priority: undefined, steps: undefined }), []).map(
        (op: any) => op.path
      );
      expect(paths).to.not.include('/fields/Microsoft.VSTS.Common.Priority');
      expect(paths).to.not.include('/fields/Microsoft.VSTS.TCM.Steps');
    });

    it('sends an empty step list as an empty steps element, since the column exists', () => {
      const patch = AzureDevopsTestProvider.buildUpdatePatch(makeCase({ steps: [] }), []);
      expect(valueOf(patch, '/fields/Microsoft.VSTS.TCM.Steps')).to.equal('<steps id="0" last="1"></steps>');
    });

    it('keeps the tags added by hand and adds the missing ones without duplicates', () => {
      const patch = AzureDevopsTestProvider.buildUpdatePatch(makeCase(), [' Regression ', 'TESTKIT:PROJ-123:F01', '']);
      expect(valueOf(patch, '/fields/System.Tags')).to.equal('Regression; TESTKIT:PROJ-123:F01; MODULE:Quotes');
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
      const xml = azureDevopsStepsXml([{ action: 'Open the page', expected: 'The page is displayed' }]);
      expect(xml).to.contain('The page is displayed');
    });

    it('renders an empty or missing step list as a valid empty steps element', () => {
      expect(azureDevopsStepsXml([])).to.equal('<steps id="0" last="1"></steps>');
      expect(azureDevopsStepsXml(undefined)).to.equal('<steps id="0" last="1"></steps>');
    });

    it('skips a step with neither action nor expected result, keeping ids contiguous', () => {
      const xml = azureDevopsStepsXml([
        { action: 'A', expected: '' },
        { action: '', expected: '' },
        { action: 'C', expected: 'D' },
      ]);
      expect(xml).to.contain('<steps id="0" last="3">');
      expect(xml).to.not.contain('<step id="4"');
    });

    it('escapes step text twice, so angle brackets stay text once Azure DevOps decodes the XML', () => {
      const xml = azureDevopsStepsXml([{ action: 'Enter <Account Name> & search', expected: 'List<Account>' }]);
      expect(xml).to.contain('&lt;DIV&gt;&lt;P&gt;Enter &amp;lt;Account Name&amp;gt; &amp;amp; search&lt;/P&gt;&lt;/DIV&gt;');
      expect(xml).to.contain('List&amp;lt;Account&amp;gt;');
      expect(xml).to.not.contain('<Account');
    });

    it('flattens a multi-line step to one line', () => {
      const xml = azureDevopsStepsXml([{ action: 'Open\r\n  the page', expected: '' }]);
      expect(xml).to.contain('Open the page');
    });

    it('types a step with an expected result as ValidateStep, and one without as ActionStep', () => {
      const xml = azureDevopsStepsXml([
        { action: 'Open the page', expected: 'The page is displayed' },
        { action: 'Close', expected: '' },
      ]);
      expect(xml).to.contain('<step id="2" type="ValidateStep">');
      expect(xml).to.contain('<step id="3" type="ActionStep">');
    });
  });
});

describe('AzureDevopsTestProvider - api calls through the injected factory', () => {
  // What the SDK client is asked to do, in order, so the assertions below read as a trace.
  interface Recorded {
    call: string;
    args: any[];
  }

  beforeEach(saveEnv);
  afterEach(restoreEnv);

  function stubApi(overrides: Record<string, any> = {}): { api: any; calls: Recorded[] } {
    const calls: Recorded[] = [];
    const record =
      (name: string, impl: (...args: any[]) => any) =>
      async (...args: any[]) => {
        calls.push({ call: name, args });
        return impl(...args);
      };
    const defaults: Record<string, (...args: any[]) => any> = {
      getFields: () => [{ referenceName: 'System.Title' }],
      getWorkItem: (id: number) => ({
        id,
        fields: {
          'System.AreaPath': 'Sales\\Team A',
          'System.IterationPath': 'Sales\\Sprint 1',
          'System.AssignedTo': { uniqueName: 'owner@acme.test' },
          'System.Tags': 'Regression; TESTKIT:PROJ-123:F01',
        },
        _links: { html: { href: `https://dev.azure.com/acme/_workitems/edit/${id}` } },
      }),
      queryByWiql: () => ({ workItems: [] }),
      createWorkItem: () => ({ id: 4242, _links: { html: { href: 'https://dev.azure.com/acme/_workitems/edit/4242' } } }),
      updateWorkItem: (_headers: any, _patch: any, id: number) => ({
        id,
        _links: { html: { href: `https://dev.azure.com/acme/_workitems/edit/${id}` } },
      }),
    };
    const api: Record<string, any> = {};
    for (const name of Object.keys(defaults)) {
      api[name] = record(name, overrides[name] ?? defaults[name]);
    }
    return { api, calls };
  }

  function providerWith(api: any): AzureDevopsTestProvider {
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme/';
    process.env.SYSTEM_TEAMPROJECT = 'Sales';
    process.env.CI_SFDX_HARDIS_AZURE_TOKEN = 'tok';
    return new AzureDevopsTestProvider(async () => api);
  }

  const callsTo = (calls: Recorded[], name: string): Recorded[] => calls.filter((entry) => entry.call === name);

  describe('checkPrerequisites', () => {
    it('passes when the project fields can be read', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).checkPrerequisites();
      expect(callsTo(calls, 'getFields')[0].args[0]).to.equal('Sales');
    });

    it('refuses a project the SDK answers with null, as it does on a 404', async () => {
      const { api } = stubApi({ getFields: () => null });
      const message = await errorOf(providerWith(api).checkPrerequisites());
      expect(message).to.contain('Sales');
      expect(message).to.contain('https://dev.azure.com/acme/');
    });

    it('reports an unreachable server with its own error message', async () => {
      const { api } = stubApi({
        getFields: () => {
          throw new Error('TF400813 not authorized');
        },
      });
      const message = await errorOf(providerWith(api).checkPrerequisites());
      expect(message).to.contain('TF400813');
      expect(message).to.contain('Sales');
    });

    it('names the missing settings without calling the API', async () => {
      const { api, calls } = stubApi();
      const message = await errorOf(new AzureDevopsTestProvider(async () => api).checkPrerequisites());
      expect(message).to.contain('SYSTEM_COLLECTIONURI');
      expect(calls).to.be.empty;
    });
  });

  describe('prepare', () => {
    it('reads each carrier work item once, whatever the number of cases', async () => {
      const { api, calls } = stubApi();
      const provider = providerWith(api);
      await provider.prepare([makeCase({ id: 'PROJ-123-F01' }), makeCase({ id: 'PROJ-123-F02' }), makeCase({ id: 'PROJ-456-F01', ticket: 'PROJ-456' })]);
      expect(callsTo(calls, 'getWorkItem').map((entry) => entry.args[0])).to.deep.equal([123, 456]);
      // The cache built by prepare serves the creates that follow
      await provider.create(makeCase());
      expect(callsTo(calls, 'getWorkItem')).to.have.lengthOf(2);
    });

    it('refuses a carrier work item the SDK answers with null, as it does on a 404', async () => {
      const { api, calls } = stubApi({ getWorkItem: () => null });
      const message = await errorOf(providerWith(api).prepare([makeCase()]));
      expect(message).to.contain('123');
      expect(message).to.contain('Sales');
      expect(callsTo(calls, 'createWorkItem')).to.be.empty;
    });

    it('refuses a carrier work item that cannot be read, with the SDK message', async () => {
      const { api } = stubApi({
        getWorkItem: () => {
          throw new Error('TF401232 not found');
        },
      });
      const message = await errorOf(providerWith(api).prepare([makeCase()]));
      expect(message).to.contain('123');
      expect(message).to.contain('TF401232');
    });

    it('refuses a ticket key carrying no work item number, instead of asking for item NaN', async () => {
      const { api, calls } = stubApi();
      const message = await errorOf(providerWith(api).prepare([makeCase({ ticket: 'RELEASE' })]));
      expect(message).to.contain('RELEASE');
      expect(calls).to.be.empty;
    });
  });

  describe('create', () => {
    it('reads the carrier work item once for a whole push, not once per case', async () => {
      const { api, calls } = stubApi();
      const provider = providerWith(api);
      await provider.create(makeCase({ id: 'PROJ-123-F01' }));
      await provider.create(makeCase({ id: 'PROJ-123-F02' }));
      await provider.create(makeCase({ id: 'PROJ-123-F03' }));
      expect(callsTo(calls, 'getWorkItem')).to.have.lengthOf(1);
      expect(callsTo(calls, 'createWorkItem')).to.have.lengthOf(3);
    });

    it('creates the work item in the configured project, as a Test Case, inheriting the carrier', async () => {
      const { api, calls } = stubApi();
      const ref = await providerWith(api).create(makeCase());
      const created = callsTo(calls, 'createWorkItem')[0];
      expect(created.args[2]).to.equal('Sales');
      expect(created.args[3]).to.equal('Test Case');
      const patch = created.args[1] as any[];
      expect(patch.every((op) => op.op === 'add')).to.be.true;
      expect(valueOf(patch, '/fields/System.AreaPath')).to.equal('Sales\\Team A');
      expect(valueOf(patch, '/fields/System.AssignedTo')).to.equal('owner@acme.test');
      expect(ref).to.deep.equal({ id: '4242', url: 'https://dev.azure.com/acme/_workitems/edit/4242' });
    });

    it('builds the work item url when the SDK answer carries no html link', async () => {
      const { api } = stubApi({ createWorkItem: () => ({ id: 4242 }) });
      const ref = await providerWith(api).create(makeCase());
      expect(ref.url).to.equal('https://dev.azure.com/acme/Sales/_workitems/edit/4242');
    });

    it('refuses a create the SDK answers with null instead of reporting id undefined', async () => {
      const { api } = stubApi({ createWorkItem: () => null });
      const message = await errorOf(providerWith(api).create(makeCase()));
      expect(message).to.contain('Sales');
      expect(message).to.not.contain('undefined');
    });

    it('refuses the create before writing anything when the carrier cannot be read', async () => {
      const { api, calls } = stubApi({
        getWorkItem: () => {
          throw new Error('TF401232 not found');
        },
      });
      const message = await errorOf(providerWith(api).create(makeCase()));
      expect(message).to.contain('123');
      expect(callsTo(calls, 'createWorkItem')).to.be.empty;
    });

    // Non-regression: a ticket key holding several groups of digits (a year plus the work item
    // number) must resolve to the LAST group, not to NaN.
    it('reads the work item number of a ticket key holding several digit groups', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).create(makeCase({ id: 'ACME-2026-14545-F01', ticket: 'ACME-2026-14545' }));
      expect(callsTo(calls, 'getWorkItem')[0].args[0]).to.equal(14545);
    });
  });

  describe('update', () => {
    it('re-reads the tags and merges them, keeping those added by hand', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).update({ id: '77', url: 'https://dev.azure.com/acme/_workitems/edit/77' }, makeCase());
      const read = callsTo(calls, 'getWorkItem')[0];
      expect(read.args).to.deep.equal([77, ['System.Tags']]);
      const updated = callsTo(calls, 'updateWorkItem')[0];
      expect(updated.args[2]).to.equal(77);
      expect(updated.args[3]).to.equal('Sales');
      const patch = updated.args[1] as any[];
      expect(valueOf(patch, '/fields/System.Tags')).to.equal('Regression; TESTKIT:PROJ-123:F01; MODULE:Quotes');
    });

    it('sends add operations only, and never assignee, area or iteration', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).update({ id: '77', url: 'x' }, makeCase());
      const patch = callsTo(calls, 'updateWorkItem')[0].args[1] as any[];
      expect(patch.every((op) => op.op === 'add')).to.be.true;
      const paths = patch.map((op) => op.path);
      expect(paths).to.not.include('/fields/System.AssignedTo');
      expect(paths).to.not.include('/fields/System.AreaPath');
      expect(paths).to.not.include('/fields/System.IterationPath');
      expect(paths).to.include('/fields/Microsoft.VSTS.TCM.Steps');
    });

    it('does not read the carrier on update', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).update({ id: '77', url: 'x' }, makeCase());
      expect(callsTo(calls, 'getWorkItem')).to.have.lengthOf(1);
      expect(callsTo(calls, 'getWorkItem')[0].args[0]).to.equal(77);
    });

    it('refuses to update a work item the SDK answers with null on the tag read', async () => {
      const { api, calls } = stubApi({ getWorkItem: () => null });
      const message = await errorOf(providerWith(api).update({ id: '77', url: 'x' }, makeCase()));
      expect(message).to.contain('77');
      expect(callsTo(calls, 'updateWorkItem')).to.be.empty;
    });

    it('refuses an update the SDK answers with null', async () => {
      const { api } = stubApi({ updateWorkItem: () => null });
      const message = await errorOf(providerWith(api).update({ id: '77', url: 'x' }, makeCase()));
      expect(message).to.contain('77');
    });
  });

  describe('linkToStory', () => {
    it('links the created case to its story through the TestedBy-Reverse relation', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).linkToStory({ id: '4242', url: 'x' }, 'PROJ-123');
      const updated = callsTo(calls, 'updateWorkItem')[0];
      expect(updated.args[2]).to.equal(4242);
      const relation = (updated.args[1] as any[])[0];
      expect(relation.op).to.equal('add');
      expect(relation.path).to.equal('/relations/-');
      expect(relation.value.rel).to.equal('Microsoft.VSTS.Common.TestedBy-Reverse');
      // The trailing slash of the collection url does not double
      expect(relation.value.url).to.equal('https://dev.azure.com/acme/_apis/wit/workItems/123');
    });

    it('links to the work item number of a ticket key holding several digit groups', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).linkToStory({ id: '4242', url: 'x' }, 'ACME-2026-14545');
      const relation = (callsTo(calls, 'updateWorkItem')[0].args[1] as any[])[0];
      expect(relation.value.url).to.contain('/_apis/wit/workItems/14545');
    });

    it('fails when the SDK answers the link with null', async () => {
      const { api } = stubApi({ updateWorkItem: () => null });
      const message = await errorOf(providerWith(api).linkToStory({ id: '4242', url: 'x' }, 'PROJ-123'));
      expect(message).to.contain('4242');
    });
  });

  describe('findByKey', () => {
    it('finds nothing rather than guessing when the tag query returns no hit', async () => {
      const { api, calls } = stubApi();
      const found = await providerWith(api).findByKey('TESTKIT:PROJ-123:F01');
      expect(found).to.equal(null);
      const query = callsTo(calls, 'queryByWiql')[0].args[0].query;
      expect(query).to.contain("[System.WorkItemType] = 'Test Case'");
      expect(query).to.contain("CONTAINS 'TESTKIT:PROJ-123:F01'");
      // A key living in another project of the collection must never be matched.
      expect(query).to.contain('[System.TeamProject] = @project');
      expect(callsTo(calls, 'queryByWiql')[0].args[1]).to.deep.equal({ project: 'Sales' });
    });

    it('doubles a single quote of the key inside the WIQL string', async () => {
      const { api, calls } = stubApi();
      await providerWith(api).findByKey("TESTKIT:O'NEIL:F01");
      expect(callsTo(calls, 'queryByWiql')[0].args[0].query).to.contain("CONTAINS 'TESTKIT:O''NEIL:F01'");
    });

    it('treats a null query answer as no hit', async () => {
      const { api } = stubApi({ queryByWiql: () => null });
      expect(await providerWith(api).findByKey('TESTKIT:PROJ-123:F01')).to.equal(null);
    });

    // A live Azure DevOps instance answers a tag CONTAINS with whole-tag matches, so it would
    // not hand us a prefix hit in the first place. These stubs return one anyway, to pin the
    // provider's own check: accepting such a hit would update the wrong work item.
    function stubWithTags(tagsById: Record<number, string | null>): { api: any; calls: Recorded[] } {
      const ids = Object.keys(tagsById).map(Number);
      return stubApi({
        queryByWiql: () => ({ workItems: [{ id: undefined }, ...ids.map((id) => ({ id }))] }),
        getWorkItem: (id: number) =>
          tagsById[id] === null
            ? null
            : {
                id,
                fields: { 'System.Tags': tagsById[id] },
                _links: { html: { href: `https://dev.azure.com/acme/_workitems/edit/${id}` } },
              },
      });
    }

    it('skips a work item whose tag merely starts with the key', async () => {
      const { api } = stubWithTags({ 10: 'TESTKIT:PROJ-123:F10; Quotes', 1: 'TESTKIT:PROJ-123:F1; Quotes' });
      const found = await providerWith(api).findByKey('TESTKIT:PROJ-123:F1');
      expect(found).to.deep.equal({ id: '1', url: 'https://dev.azure.com/acme/_workitems/edit/1' });
    });

    it('returns null when every hit only contains the key as a substring', async () => {
      const { api } = stubWithTags({ 10: 'TESTKIT:PROJ-123:F10', 11: 'TESTKIT:PROJ-123:F11' });
      expect(await providerWith(api).findByKey('TESTKIT:PROJ-123:F1')).to.equal(null);
    });

    it('skips a hit that was deleted between the query and the read', async () => {
      const { api } = stubWithTags({ 5: null, 7: 'TESTKIT:PROJ-123:F01' });
      expect((await providerWith(api).findByKey('TESTKIT:PROJ-123:F01'))?.id).to.equal('7');
    });

    it('matches the key whatever its position among the other tags', async () => {
      const { api } = stubWithTags({ 7: 'Quotes; TESTKIT:PROJ-123:F01; Regression' });
      expect((await providerWith(api).findByKey('TESTKIT:PROJ-123:F01'))?.id).to.equal('7');
    });
  });

  describe('through pushCases', () => {
    it('reads the carrier in a dry run and writes nothing', async () => {
      const { api, calls } = stubApi();
      const report = await pushCases(providerWith(api), [makeCase()], { dryRun: true });
      expect(report.exitCode).to.equal(0);
      expect(report.rows).to.have.lengthOf(1);
      expect(report.rows[0]).to.include({ action: 'would create', caseId: 'PROJ-123-F01' });
      expect(callsTo(calls, 'getWorkItem').map((entry) => entry.args[0])).to.deep.equal([123]);
      expect(callsTo(calls, 'createWorkItem')).to.be.empty;
      expect(callsTo(calls, 'updateWorkItem')).to.be.empty;
    });

    it('refuses a dry run whose carrier is missing, before any search', async () => {
      const { api, calls } = stubApi({ getWorkItem: () => null });
      const report = await pushCases(providerWith(api), [makeCase({ id: 'PROJ-123-F01' }), makeCase({ id: 'PROJ-123-F02' })], {
        dryRun: true,
      });
      expect(report.exitCode).to.equal(1);
      expect(report.failed).to.equal(2);
      expect(report.rows.every((row) => row.action === 'failed')).to.be.true;
      expect(report.rows[0].error).to.contain('123');
      expect(callsTo(calls, 'queryByWiql')).to.be.empty;
    });

    it('refuses the run when the project is not found', async () => {
      const { api, calls } = stubApi({ getFields: () => null });
      const report = await pushCases(providerWith(api), [makeCase()]);
      expect(report.exitCode).to.equal(1);
      expect(report.rows[0].error).to.contain('Sales');
      expect(callsTo(calls, 'getWorkItem')).to.be.empty;
      expect(callsTo(calls, 'createWorkItem')).to.be.empty;
    });
  });
});
