/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { getReportDirectory } from '../../../src/config/index.js';
import {
  buildEventEnvelope,
  buildRetrieveEventData,
  buildSalesforceRunEventData,
  countEventListeners,
  emitDeploymentStartEvent,
  emitPluginEvent,
  emitRetrieveEvent,
  emitSalesforceRunEvent,
  emitTestSelectionEvent,
  getDeployRunEventName,
  getDeployStartEventName,
  readPluginTestSelection,
} from '../../../src/common/utils/pluginEventUtils.js';
import { enableMajorBranchCheckMode, resetMajorBranchCheckMode } from '../../../src/common/utils/majorBranchCheckUtils.js';

const PR_INFO = {
  idNumber: 42,
  idStr: '42',
  webUrl: 'https://example.com/pr/42',
  sourceBranch: 'feature/story',
  targetBranch: 'integration',
};

// A fake oclif config: one plugin per entry, listening to the given events
function fakeOclifConfig(listeners: string[][], runHookImpl?: (event: string, payload: any) => Promise<any>) {
  const calls: { event: string; payload: any }[] = [];
  const plugins = new Map<string, any>();
  listeners.forEach((events, index) => {
    const hooks: Record<string, string[]> = {};
    for (const event of events) {
      hooks[event] = [`./lib/hooks/plugin${index}.js`];
    }
    plugins.set(`plugin-${index}`, { name: `plugin-${index}`, hooks });
  });
  return {
    calls,
    config: {
      plugins,
      runHook: async (event: string, payload: any) => {
        calls.push({ event, payload });
        return runHookImpl ? runHookImpl(event, payload) : { successes: [], failures: [] };
      },
    },
  };
}

describe('Plugin events', () => {
  const originalGetPullRequestInfo = GitProvider.getPullRequestInfo;
  const originalDisableEnv = process.env.SFDX_HARDIS_DISABLE_PLUGIN_EVENTS;
  let pullRequestLookups = 0;

  beforeEach(() => {
    pullRequestLookups = 0;
    GitProvider.getPullRequestInfo = (async () => {
      pullRequestLookups++;
      return PR_INFO;
    }) as any;
    delete process.env.SFDX_HARDIS_DISABLE_PLUGIN_EVENTS;
    resetMajorBranchCheckMode();
  });

  afterEach(() => {
    GitProvider.getPullRequestInfo = originalGetPullRequestInfo;
    if (originalDisableEnv === undefined) {
      delete process.env.SFDX_HARDIS_DISABLE_PLUGIN_EVENTS;
    } else {
      process.env.SFDX_HARDIS_DISABLE_PLUGIN_EVENTS = originalDisableEnv;
    }
    resetMajorBranchCheckMode();
  });

  it('names the deployment events from the check mode', () => {
    expect(getDeployRunEventName(true)).to.equal('sfdx-hardis:validation-done');
    expect(getDeployRunEventName(false)).to.equal('sfdx-hardis:deployment-done');
  });

  it('counts only the plugins that listen to the event', () => {
    const { config } = fakeOclifConfig([['sfdx-hardis:deployment-done'], ['other:event'], ['sfdx-hardis:deployment-done']]);
    expect(countEventListeners(config, 'sfdx-hardis:deployment-done')).to.equal(2);
    expect(countEventListeners(config, 'sfdx-hardis:validation-done')).to.equal(0);
    expect(countEventListeners({}, 'sfdx-hardis:validation-done')).to.equal(0);
  });

  it('does nothing, not even a Pull Request lookup, when no plugin listens', async () => {
    const { config, calls } = fakeOclifConfig([['other:event']]);
    let dataBuilt = false;
    await emitPluginEvent({ id: 'hardis:test', config }, 'sfdx-hardis:apex-tests-done', async () => {
      dataBuilt = true;
      return {} as any;
    });
    expect(calls).to.be.empty;
    expect(dataBuilt).to.be.false;
    expect(pullRequestLookups).to.equal(0);
  });

  it('does nothing without an oclif config', async () => {
    await emitSalesforceRunEvent({}, { event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success' });
    await emitSalesforceRunEvent(null, { event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success' });
  });

  it('sends the envelope and the data of a Salesforce run to the listening plugins', async () => {
    const { config, calls } = fakeOclifConfig([['sfdx-hardis:validation-done']]);
    await emitSalesforceRunEvent({ id: 'hardis:project:deploy:smart', config }, {
      event: 'sfdx-hardis:validation-done',
      checkOnly: true,
      status: 'failed',
      deploymentLabel: 'main',
      targetUsername: 'user@example.com',
    });
    expect(calls).to.have.length(1);
    const payload = calls[0].payload;
    expect(calls[0].event).to.equal('sfdx-hardis:validation-done');
    expect(payload.payloadVersion).to.equal(1);
    expect(payload.event).to.equal('sfdx-hardis:validation-done');
    expect(payload.commandId).to.equal('hardis:project:deploy:smart');
    expect(payload.org).to.deep.equal({ username: 'user@example.com' });
    expect(payload.reportDir).to.be.a('string').and.not.empty;
    expect(payload.pullRequest).to.deep.equal({
      id: '42',
      number: 42,
      url: 'https://example.com/pr/42',
      sourceBranch: 'feature/story',
      targetBranch: 'integration',
    });
    expect(payload.data).to.include({ checkOnly: true, status: 'failed', deploymentLabel: 'main' });
  });

  it('sends nothing when the env variable disables the plugin events', async () => {
    process.env.SFDX_HARDIS_DISABLE_PLUGIN_EVENTS = 'true';
    const { config, calls } = fakeOclifConfig([['sfdx-hardis:deployment-done']]);
    await emitSalesforceRunEvent({ config }, { event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success' });
    expect(calls).to.be.empty;
  });

  it('turns a failing plugin into a warning, without throwing', async () => {
    const failing = fakeOclifConfig([['sfdx-hardis:deployment-done']], async () => ({
      successes: [],
      failures: [{ plugin: { name: 'plugin-0' }, error: new Error('boom') }],
    }));
    await emitSalesforceRunEvent({ config: failing.config }, { event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success' });
    expect(failing.calls).to.have.length(1);

    const throwing = fakeOclifConfig([['sfdx-hardis:deployment-done']], async () => {
      throw new Error('hook crashed');
    });
    await emitSalesforceRunEvent({ config: throwing.config }, { event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success' });
    expect(throwing.calls).to.have.length(1);
  });

  it('still sends the events to the plugins during a major branch check, without Pull Request', async () => {
    GitProvider.getPullRequestInfo = originalGetPullRequestInfo;
    enableMajorBranchCheckMode();
    const { config, calls } = fakeOclifConfig([['sfdx-hardis:validation-done']]);
    await emitSalesforceRunEvent({ id: 'hardis:project:deploy:smart', config }, { event: 'sfdx-hardis:validation-done', checkOnly: true, status: 'success' });
    expect(calls).to.have.length(1);
    expect(calls[0].payload.pullRequest).to.be.null;
  });

  it('has no Pull Request in a major branch check', async () => {
    // The real lookup: it is the one that knows a major branch check has no Pull Request
    GitProvider.getPullRequestInfo = originalGetPullRequestInfo;
    enableMajorBranchCheckMode();
    const envelope = await buildEventEnvelope({ id: 'hardis:project:deploy:smart' }, 'sfdx-hardis:validation-done', {});
    expect(envelope.pullRequest).to.be.null;
  });

  it('sends no coverage file when the command knows that no test ran', async () => {
    const data = await buildSalesforceRunEventData({ event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success', coverageExpected: false });
    expect(data.coverageFile).to.be.null;
  });

  it('asks oclif to capture the errors of each plugin', async () => {
    const captured: any[] = [];
    const config = {
      plugins: new Map([['plugin-0', { name: 'plugin-0', hooks: { 'sfdx-hardis:deployment-done': ['./hook.js'] } }]]),
      runHook: async (...args: any[]) => {
        captured.push(args);
        return { successes: [], failures: [] };
      },
    };
    await emitSalesforceRunEvent({ config }, { event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success' });
    expect(captured).to.have.length(1);
    expect(captured[0][3]).to.equal(true);
  });

  it('has no Pull Request when the lookup fails', async () => {
    GitProvider.getPullRequestInfo = (async () => {
      throw new Error('API down');
    }) as any;
    const envelope = await buildEventEnvelope({}, 'sfdx-hardis:deployment-done', {});
    expect(envelope.pullRequest).to.be.null;
    expect(envelope.org).to.deep.equal({ username: null });
  });

  it('gives the deployment label and the coverage file only when they exist', async () => {
    const data = await buildSalesforceRunEventData({ event: 'sfdx-hardis:deployment-done', checkOnly: false, status: 'success' });
    expect(data.deploymentLabel).to.be.null;
    expect(data).to.have.property('coverageFile');
    expect(data).not.to.have.property('testsRun');
  });

  it('names the start events from the check mode', () => {
    expect(getDeployStartEventName(true)).to.equal('sfdx-hardis:validation-start');
    expect(getDeployStartEventName(false)).to.equal('sfdx-hardis:deployment-start');
  });

  it('sends the validation start event with the check mode to the listening plugins', async () => {
    const { config, calls } = fakeOclifConfig([['sfdx-hardis:validation-start'], ['sfdx-hardis:deployment-start']]);
    await emitDeploymentStartEvent({ id: 'hardis:project:deploy:smart', config }, { checkOnly: true, targetUsername: 'user@example.com' });
    expect(calls).to.have.length(1);
    expect(calls[0].event).to.equal('sfdx-hardis:validation-start');
    expect(calls[0].payload.commandId).to.equal('hardis:project:deploy:smart');
    expect(calls[0].payload.org).to.deep.equal({ username: 'user@example.com' });
    expect(calls[0].payload.data).to.deep.equal({ checkOnly: true });
  });

  it('sends the envelope and the data of a retrieve to the listening plugins', async () => {
    const { config, calls } = fakeOclifConfig([['sfdx-hardis:retrieve-done'], ['sfdx-hardis:deployment-done']]);
    await emitRetrieveEvent({ id: 'hardis:source:retrieve', config }, {
      status: 'success',
      metadata: ['ApexClass', 'CustomObject'],
      targetUsername: 'user@example.com',
    });
    expect(calls).to.have.length(1);
    const payload = calls[0].payload;
    expect(calls[0].event).to.equal('sfdx-hardis:retrieve-done');
    expect(payload.commandId).to.equal('hardis:source:retrieve');
    expect(payload.org).to.deep.equal({ username: 'user@example.com' });
    expect(payload.data).to.deep.equal({
      status: 'success',
      manifest: null,
      metadata: ['ApexClass', 'CustomObject'],
      sourcePaths: [],
      packageNames: [],
    });
  });

  it('gives absolute paths for the manifest and the source paths of a retrieve', () => {
    const data = buildRetrieveEventData({
      status: 'failed',
      manifest: 'manifest/package.xml',
      sourcePaths: ['force-app/main/default/classes'],
      packageNames: ['MyPackage'],
    });
    expect(data.status).to.equal('failed');
    expect(data.manifest).to.equal(path.resolve('manifest/package.xml'));
    expect(data.sourcePaths).to.deep.equal([path.resolve('force-app/main/default/classes')]);
    expect(data.packageNames).to.deep.equal(['MyPackage']);
    expect(data.metadata).to.deep.equal([]);
  });

  it('sends no retrieve event when no plugin listens', async () => {
    const { config, calls } = fakeOclifConfig([['sfdx-hardis:deployment-done']]);
    await emitRetrieveEvent({ config }, { status: 'success' });
    expect(calls).to.be.empty;
    expect(pullRequestLookups).to.equal(0);
  });

  describe('Test selection event', () => {
    const SELECTION_INPUT = {
      checkOnly: true,
      packageXmlFile: 'manifest/package.xml',
      delta: true,
      testLevel: 'RunLocalTests',
      testClasses: [],
      targetUsername: 'user@example.com',
    };

    // A fake oclif config whose plugin writes the given content in the selection file
    function selectingPlugin(content: string | null) {
      return fakeOclifConfig([['sfdx-hardis:test-selection']], async (_event, payload) => {
        if (content !== null) {
          fs.writeFileSync(payload.data.selectionFile, content);
        }
        return { successes: [], failures: [] };
      });
    }

    async function selectionFilePath(): Promise<string> {
      return path.resolve(path.join(await getReportDirectory(), 'plugin-test-selection.json'));
    }

    afterEach(async () => {
      fs.rmSync(await selectionFilePath(), { force: true });
    });

    it('sends the package.xml, the current selection and the selection file to the listening plugins', async () => {
      const { config, calls } = selectingPlugin(null);
      const selection = await emitTestSelectionEvent({ id: 'hardis:project:deploy:smart', config }, {
        ...SELECTION_INPUT,
        testLevel: 'RunSpecifiedTests',
        testClasses: ['FromPrTest'],
      });
      expect(selection).to.be.null;
      expect(calls).to.have.length(1);
      expect(calls[0].event).to.equal('sfdx-hardis:test-selection');
      expect(calls[0].payload.org).to.deep.equal({ username: 'user@example.com' });
      expect(calls[0].payload.data).to.deep.equal({
        checkOnly: true,
        packageXmlFile: path.resolve('manifest/package.xml'),
        delta: true,
        testLevel: 'RunSpecifiedTests',
        testClasses: ['FromPrTest'],
        selectionFile: await selectionFilePath(),
      });
    });

    it('returns the tests a plugin selected, without duplicates', async () => {
      const { config } = selectingPlugin(JSON.stringify({
        plugin: 'apextestlist',
        testLevel: 'RunSpecifiedTests',
        testClasses: ['AccountServiceTest', 'OrderTest', 'AccountServiceTest'],
      }));
      const selection = await emitTestSelectionEvent({ config }, SELECTION_INPUT);
      expect(selection).to.deep.equal({
        plugin: 'apextestlist',
        testLevel: 'RunSpecifiedTests',
        testClasses: ['AccountServiceTest', 'OrderTest'],
      });
    });

    it('drops the test classes when the plugin selects another test level', async () => {
      const { config } = selectingPlugin(JSON.stringify({ testLevel: 'RunLocalTests', testClasses: ['IgnoredTest'] }));
      const selection = await emitTestSelectionEvent({ config }, SELECTION_INPUT);
      expect(selection).to.deep.equal({ testLevel: 'RunLocalTests', testClasses: [], plugin: undefined });
    });

    it('ignores a selection that is not valid', async () => {
      const invalidContents = [
        'not json',
        '[]',
        JSON.stringify({ testLevel: 'NoTestRun' }),
        JSON.stringify({ testLevel: 'RunRelevantTests' }),
        JSON.stringify({ testLevel: 'RunSpecifiedTests' }),
        JSON.stringify({ testLevel: 'RunSpecifiedTests', testClasses: [] }),
        JSON.stringify({ testLevel: 'RunSpecifiedTests', testClasses: ['GoodTest', 'Bad Test; rm -rf'] }),
        JSON.stringify({ testLevel: 'RunSpecifiedTests', testClasses: ['GoodTest', 42] }),
        JSON.stringify({ testLevel: 'RunSpecifiedTests', testClasses: ['GoodTest', 'CaseTest.testClose'] }),
        JSON.stringify({ testLevel: 'RunSpecifiedTests', testClasses: ['GoodTest', 'ns.OrderTest'] }),
      ];
      for (const content of invalidContents) {
        const { config } = selectingPlugin(content);
        // eslint-disable-next-line no-await-in-loop
        expect(await emitTestSelectionEvent({ config }, SELECTION_INPUT), content).to.be.null;
      }
    });

    it('never reads a selection file left by an earlier run', async () => {
      const selectionFile = await selectionFilePath();
      fs.writeFileSync(selectionFile, JSON.stringify({ testLevel: 'RunSpecifiedTests', testClasses: ['OldTest'] }));
      const { config, calls } = fakeOclifConfig([['sfdx-hardis:deployment-done']]);
      const selection = await emitTestSelectionEvent({ config }, SELECTION_INPUT);
      expect(calls).to.be.empty;
      expect(selection).to.be.null;
      expect(fs.existsSync(selectionFile)).to.be.false;
    });

    it('reads nothing when the plugin events are disabled', async () => {
      process.env.SFDX_HARDIS_DISABLE_PLUGIN_EVENTS = 'true';
      const { config, calls } = selectingPlugin(JSON.stringify({ testLevel: 'RunLocalTests' }));
      const selection = await emitTestSelectionEvent({ config }, SELECTION_INPUT);
      expect(calls).to.be.empty;
      expect(selection).to.be.null;
    });

    it('returns null when there is no selection file', async () => {
      expect(await readPluginTestSelection({}, path.resolve('does-not-exist.json'))).to.be.null;
    });
  });
});
