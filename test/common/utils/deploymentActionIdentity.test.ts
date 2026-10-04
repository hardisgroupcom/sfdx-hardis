/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { ActionsProvider, ActionResult, PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { ApexAction } from '../../../src/common/actionsProvider/apexAction.js';
import { CommandAction } from '../../../src/common/actionsProvider/commandAction.js';
import { CustomFunctionAction } from '../../../src/common/actionsProvider/customFunctionAction.js';
import { DataAction } from '../../../src/common/actionsProvider/dataAction.js';
import { ManualAction } from '../../../src/common/actionsProvider/manualAction.js';
import { PublishCommunityAction } from '../../../src/common/actionsProvider/publishCommunityAction.js';
import { RemovePackageXmlItemsAction } from '../../../src/common/actionsProvider/removePackageXmlItemsAction.js';
import { RunBatchAction } from '../../../src/common/actionsProvider/runBatchAction.js';
import { ScheduleBatchAction } from '../../../src/common/actionsProvider/scheduleBatchAction.js';
import {
  buildIdenticalCopyResult,
  buildIdentityKeyFromProvider,
  canonicalizeIdentityValue,
  findIdenticalActionRun,
  findIdenticalCopies,
  formatIdenticalActionSource,
  isIdenticalActionCopy,
  normalizeIdentityPath,
  recordSuccessfulActionRun,
  resetIdenticalActionRuns,
} from '../../../src/common/utils/deploymentActionIdentityUtils.js';
import {
  SingleActionRunContext,
  getActionOutputs,
  getRecordedActionStatus,
  markActionsStoppedByFailure,
  resetActionOutputsRegistry,
  runSingleDeploymentAction,
} from '../../../src/common/utils/prePostCommandUtils.js';
import {
  buildIdenticalActionNote,
  buildManualActionCheckboxMarker,
  checkActionInState,
  checkManualActionCheckboxInBody,
  getActionStateEntry,
  upsertActionInState,
  type DeploymentActionStateEntry,
} from '../../../src/common/utils/deploymentActionsStateUtils.js';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import { ActionForecast, applyIdenticalForecasts, markIdenticalForecasts } from '../../../src/common/utils/deploymentActionForecastUtils.js';
import { collectBackpromoteActions, executeBackpromoteActions } from '../../../src/common/utils/backpromoteUtils.js';
import { BackpromotePlanAction, markIdenticalPlanActions } from '../../../src/common/utils/backpromotePlanUtils.js';
import { backpromoteActionKey } from '../../../src/common/utils/backpromoteCommentUtils.js';

function action(overrides: Partial<PrePostCommand>): PrePostCommand {
  return {
    id: 'action-1',
    label: 'Publish the site',
    type: 'command',
    command: 'sf community publish -n "Customer"',
    context: 'all',
    ...overrides,
  } as PrePostCommand;
}

function pullRequest(idNumber: number): any {
  return { idNumber, idStr: String(idNumber), webUrl: `https://git.example.com/pr/${idNumber}` };
}

function keyOf(provider: ActionsProvider, cmd: PrePostCommand, when: 'pre-deploy' | 'post-deploy' = 'post-deploy'): string | null {
  return buildIdentityKeyFromProvider(provider, cmd, when);
}

describe('Identity of a deployment action', () => {
  it('ignores the id, the label, the Pull Request, the context and allowFailure', () => {
    const first = action({ id: 'a', label: 'Publish', pullRequest: pullRequest(101), context: 'all' });
    const second = action({ id: 'b', label: 'Publish the portal', pullRequest: pullRequest(105), context: 'process-deployment-only', allowFailure: true });
    expect(keyOf(new CommandAction(), first)).to.equal(keyOf(new CommandAction(), second));
  });

  it('tells apart another command, another phase and another user', () => {
    const base = keyOf(new CommandAction(), action({}));
    expect(keyOf(new CommandAction(), action({ command: 'sf community publish -n "Partner"' }))).to.not.equal(base);
    expect(keyOf(new CommandAction(), action({}), 'pre-deploy')).to.not.equal(base);
    expect(keyOf(new CommandAction(), action({ customUsername: 'admin@acme.com' }))).to.not.equal(base);
  });

  it('compares the command line of a command action, trimmed, and nothing else', () => {
    expect(keyOf(new CommandAction(), action({ command: '  sf community publish -n "Customer" ', parameters: { unused: 'x' } }))).to.equal(
      keyOf(new CommandAction(), action({}))
    );
  });

  it('reads one Apex script or one data workspace whatever the slashes', () => {
    const apex = (apexScript: string) => keyOf(new ApexAction(), action({ type: 'apex', parameters: { apexScript } }));
    expect(apex('./scripts/apex/init.apex')).to.equal(apex('scripts\\apex\\init.apex'));
    expect(apex('scripts/apex/init.apex')).to.not.equal(apex('scripts/apex/other.apex'));
    const data = (sfdmuProject: string) => keyOf(new DataAction(), action({ type: 'data', parameters: { sfdmuProject } }));
    expect(data('EmailTemplates/')).to.equal(data('EmailTemplates'));
  });

  it('compares a site name, trimmed', () => {
    const site = (communityName: string) => keyOf(new PublishCommunityAction(), action({ type: 'publish-community', parameters: { communityName } }));
    expect(site(' Customer ')).to.equal(site('Customer'));
    expect(site('Partner')).to.not.equal(site('Customer'));
  });

  it('applies the default job name of a schedule-batch action', () => {
    const schedule = (parameters: Record<string, any>) => keyOf(new ScheduleBatchAction(), action({ type: 'schedule-batch', parameters }));
    expect(schedule({ className: 'NightlyBatch', cronExpression: '0 0 2 * * ?' })).to.equal(
      schedule({ className: 'NightlyBatch', cronExpression: '0 0 2 * * ?', jobName: 'NightlyBatch_Schedule' })
    );
  });

  it('applies the defaults of a run-batch action, and ignores the wait options without waiting', () => {
    const batch = (parameters: Record<string, any>) => keyOf(new RunBatchAction(), action({ type: 'run-batch', parameters }));
    expect(batch({ className: 'CrewBatch' })).to.equal(batch({ className: 'CrewBatch', runMode: 'wait', batchSize: 200, waitTimeoutMinutes: 60 }));
    expect(batch({ className: 'CrewBatch', batchSize: 50 })).to.not.equal(batch({ className: 'CrewBatch' }));
    expect(batch({ className: 'CrewBatch', runMode: 'no-wait', waitTimeoutMinutes: 30 })).to.equal(batch({ className: 'CrewBatch', runMode: 'no-wait' }));
  });

  it('compares the package.xml items to remove whatever their order', () => {
    const remove = (packageXmlItems: string[]) => keyOf(new RemovePackageXmlItemsAction(), action({ type: 'remove-packagexml-items', parameters: { packageXmlItems } }));
    expect(remove(['ApexClass:B,A', 'Layout:L'])).to.equal(remove(['Layout:L', 'ApexClass:A,B']));
    expect(remove(['ApexClass:A'])).to.not.equal(remove(['ApexClass:B']));
  });

  it('compares the type and the input parameters of a custom function action', () => {
    const fn = (type: string, parameters: Record<string, any>) => keyOf(new CustomFunctionAction(), action({ type, parameters }));
    expect(fn('notifySlack', { channel: '#releases', severity: '' })).to.equal(fn('notifySlack', { channel: '#releases' }));
    expect(fn('notifySlack', { channel: '#releases' })).to.not.equal(fn('notifySlack', { channel: '#ops' }));
    expect(fn('notifySlack', { channel: '#releases' })).to.not.equal(fn('notifyTeams', { channel: '#releases' }));
  });

  it('never merges a manual action', () => {
    expect(keyOf(new ManualAction(), action({ type: 'manual', parameters: { instructions: 'Open Setup' } }))).to.equal(null);
  });

  it('refuses a key built on an unresolved reference when asked to', () => {
    const cmd = action({ command: 'sf data update record --record-id ${{ actions.find.outputs.id }}' });
    expect(buildIdentityKeyFromProvider(new CommandAction(), cmd, 'post-deploy', { refusePlaceholders: true })).to.equal(null);
    expect(buildIdentityKeyFromProvider(new CommandAction(), cmd, 'post-deploy')).to.be.a('string');
  });

  it('sorts keys and drops empty values at every level', () => {
    expect(canonicalizeIdentityValue({ b: 1, a: { d: '', c: null, e: [{ g: undefined, f: 2 }] } })).to.deep.equal({ a: { e: [{ f: 2 }] }, b: 1 });
    expect(normalizeIdentityPath('.\\scripts//data\\Accounts\\')).to.equal('scripts/data/Accounts');
  });
});

describe('Identical actions already run in this process', () => {
  afterEach(() => resetIdenticalActionRuns());

  it('keeps the first successful run of a key, until the reset', () => {
    recordSuccessfulActionRun('k', { ref: { actionId: 'a', label: 'First', pr: 101 } });
    recordSuccessfulActionRun('k', { ref: { actionId: 'b', label: 'Second', pr: 105 } });
    expect(findIdenticalActionRun('k')?.ref.actionId).to.equal('a');
    expect(findIdenticalActionRun(null)).to.equal(null);
    resetIdenticalActionRuns();
    expect(findIdenticalActionRun('k')).to.equal(null);
  });

  it('points the later items of a key from other sources at the first one, and never groups items without a key', () => {
    // [identity key, source Pull Request, name]
    const items: Array<[string | null, number, string]> = [
      ['a', 101, 'a@101'],
      ['b', 101, 'b@101'],
      ['a', 105, 'a@105'],
      [null, 105, 'x@105'],
      ['a', 107, 'a@107'],
      ['a', 107, 'a@107 again'],
    ];
    const copies = findIdenticalCopies(items, (item) => item[0], (item) => item[1]);
    expect([...copies.entries()].map(([copy, first]) => [copy[2], first[2]])).to.deep.equal([
      ['a@105', 'a@101'],
      ['a@107', 'a@101'],
    ]);
  });

  it('never groups an action written twice by the same source', () => {
    const items: Array<[string, number]> = [
      ['a', 101],
      ['a', 101],
    ];
    expect(findIdenticalCopies(items, (item) => item[0], (item) => item[1]).size).to.equal(0);
  });

  it('builds the result of a copy, recorded as done in the state stores', () => {
    const result = buildIdenticalCopyResult({ ref: { actionId: 'a', label: 'Publish the site', pr: 101 }, outputs: { siteId: '0DB' } });
    const copy = action({ id: 'b', result });
    expect(result).to.include({ statusCode: 'skipped', skippedCode: 'identical-action-already-run' });
    expect(result.skippedReason).to.contain('Publish the site').and.to.contain('#101');
    expect(result.outputs).to.deep.equal({ siteId: '0DB' });
    expect(isIdenticalActionCopy(copy)).to.be.true;
    expect(getRecordedActionStatus(copy)).to.equal('success');
    expect(formatIdenticalActionSource({ pr: 0 })).to.equal('branch or project config');
    expect(buildIdenticalActionNote({ label: 'Publish the site', pr: 101 })).to.equal(
      'Not run twice: the identical action "Publish the site" of #101 ran earlier in the same run.'
    );
  });
});

describe('Identical actions in a deployment job', () => {
  const runs: string[] = [];
  let results: Record<string, ActionResult> = {};
  const originalBuild = ActionsProvider.buildActionInstance;
  const originalGitProvider = {
    getJobUrl: GitProvider.getJobUrl,
    tryGet: GitProvider.tryGetDeploymentActionsCommentBodyForPr,
    tryUpsert: GitProvider.tryUpsertDeploymentActionsCommentForPr,
  };

  class FakeAction extends ActionsProvider {
    public getLabel(): string {
      return 'FakeAction';
    }
    public async checkValidityIssues(): Promise<ActionResult | null> {
      return null;
    }
    public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
      return cmd.type === 'manual' ? null : { command: cmd.command };
    }
    public async run(cmd: PrePostCommand): Promise<ActionResult> {
      runs.push(cmd.id);
      return results[cmd.id] || { statusCode: 'success', output: 'done', outputs: { siteId: '0DB1' }, outputsForDisplay: { siteId: '0DB1' } };
    }
  }

  const context = (overrides: Partial<SingleActionRunContext> = {}): SingleActionRunContext => ({
    checkOnly: false,
    deployWhen: 'post-deploy',
    orgBranchName: 'uat',
    currentPrNumber: 200,
    executionOrder: 0,
    targetBranchCandidates: ['uat'],
    hasGitProvider: false,
    pipelineContext: {} as any,
    skipRunOnlyOnceCheck: true,
    ...overrides,
  });

  beforeEach(() => {
    runs.length = 0;
    results = {};
    resetActionOutputsRegistry();
    ActionsProvider.buildActionInstance = async () => new FakeAction();
    GitProvider.getJobUrl = async () => 'https://ci.example.com/job/1';
    GitProvider.tryGetDeploymentActionsCommentBodyForPr = async () => null;
    GitProvider.tryUpsertDeploymentActionsCommentForPr = async () => undefined;
  });

  afterEach(() => {
    ActionsProvider.buildActionInstance = originalBuild;
    GitProvider.getJobUrl = originalGitProvider.getJobUrl;
    GitProvider.tryGetDeploymentActionsCommentBodyForPr = originalGitProvider.tryGet;
    GitProvider.tryUpsertDeploymentActionsCommentForPr = originalGitProvider.tryUpsert;
    resetActionOutputsRegistry();
    delete (globalThis as any)._deploymentActionsMultiPrState;
  });

  it('runs the first of two identical actions, and the second gets its outputs without running', async () => {
    const first = action({ id: 'a', pullRequest: pullRequest(101) });
    const second = action({ id: 'b', label: 'Publish the portal', pullRequest: pullRequest(105) });
    await runSingleDeploymentAction(first, context());
    await runSingleDeploymentAction(second, context({ executionOrder: 1 }));
    expect(runs).to.deep.equal(['a']);
    expect(second.result).to.include({ statusCode: 'skipped', skippedCode: 'identical-action-already-run' });
    expect(second.result?.identicalTo).to.include({ actionId: 'a', pr: 101 });
    expect(getActionOutputs('b')).to.deep.equal({ siteId: '0DB1' });
  });

  it('runs the next copy when the first one failed, even when it was allowed to fail', async () => {
    results.a = { statusCode: 'failed', output: 'boom' };
    await runSingleDeploymentAction(action({ id: 'a', allowFailure: true, pullRequest: pullRequest(101) }), context());
    await runSingleDeploymentAction(action({ id: 'b', pullRequest: pullRequest(105) }), context());
    expect(runs).to.deep.equal(['a', 'b']);
  });

  it('runs twice an action written twice in the same Pull Request, and merges only the other Pull Requests', async () => {
    await runSingleDeploymentAction(action({ id: 'a1', pullRequest: pullRequest(101) }), context());
    await runSingleDeploymentAction(action({ id: 'a2', pullRequest: pullRequest(101) }), context());
    const other = action({ id: 'b', pullRequest: pullRequest(105) });
    await runSingleDeploymentAction(other, context());
    expect(runs).to.deep.equal(['a1', 'a2']);
    expect(isIdenticalActionCopy(other)).to.be.true;
  });

  it('runs twice an action written twice in the branch or project config', async () => {
    await runSingleDeploymentAction(action({ id: 'c1' }), context());
    await runSingleDeploymentAction(action({ id: 'c2' }), context());
    expect(runs).to.deep.equal(['c1', 'c2']);
  });

  it('keeps the identical actions of two phases apart', async () => {
    await runSingleDeploymentAction(action({ id: 'a', pullRequest: pullRequest(101) }), context({ deployWhen: 'pre-deploy' }));
    await runSingleDeploymentAction(action({ id: 'b', pullRequest: pullRequest(105) }), context());
    expect(runs).to.deep.equal(['a', 'b']);
  });

  it('never stands for an action of a later run of the process', async () => {
    await runSingleDeploymentAction(action({ id: 'a', pullRequest: pullRequest(101) }), context());
    resetActionOutputsRegistry();
    await runSingleDeploymentAction(action({ id: 'b', pullRequest: pullRequest(105) }), context());
    expect(runs).to.deep.equal(['a', 'b']);
  });

  it('records a copy as done on its own Pull Request, with a note naming the action that ran', async () => {
    await runSingleDeploymentAction(action({ id: 'a', pullRequest: pullRequest(101) }), context({ hasGitProvider: true }));
    await runSingleDeploymentAction(action({ id: 'b', pullRequest: pullRequest(105) }), context({ hasGitProvider: true, executionOrder: 1 }));
    expect(getActionStateEntry(101, 'a', 'uat')?.status).to.equal('success');
    const copyEntry = getActionStateEntry(105, 'b', 'uat');
    expect(copyEntry?.status).to.equal('success');
    expect(copyEntry?.note).to.equal('Not run twice: the identical action "Publish the site" of #101 ran earlier in the same run.');
    expect(copyEntry?.outputs).to.deep.equal({ siteId: '0DB1' });
  });

  it('records as done, not as stopped, an action whose identical action ran before the failure', async () => {
    const commands = [
      action({ id: 'a', pullRequest: pullRequest(101) }),
      action({ id: 'f', command: 'sf apex run --file broken.apex', pullRequest: pullRequest(102) }),
      action({ id: 'b', pullRequest: pullRequest(105) }),
      action({ id: 'c', command: 'sf org assign permset -n Crew', pullRequest: pullRequest(106) }),
      action({ id: 'm', type: 'manual', parameters: { instructions: 'Open Setup' }, pullRequest: pullRequest(107) }),
    ];
    results.f = { statusCode: 'failed', output: 'boom' };
    await runSingleDeploymentAction(commands[0], context());
    await runSingleDeploymentAction(commands[1], context({ executionOrder: 1 }));
    const stopped = await markActionsStoppedByFailure(commands, 1, context());
    expect(stopped.map((cmd) => cmd.id)).to.deep.equal(['c', 'm']);
    expect(isIdenticalActionCopy(commands[2])).to.be.true;
    expect(commands[3].result).to.include({ statusCode: 'not-run' });
    expect(commands[3].result?.skippedReason).to.contain('previous action failed');
    expect(runs).to.deep.equal(['a', 'f']);
  });

  it('leaves stopped an action this job would not have run', async () => {
    const commands = [
      action({ id: 'a', pullRequest: pullRequest(101) }),
      action({ id: 'f', command: 'sf apex run --file broken.apex', pullRequest: pullRequest(102) }),
      action({ id: 'b', context: 'check-deployment-only', pullRequest: pullRequest(105) }),
    ];
    results.f = { statusCode: 'failed', output: 'boom' };
    await runSingleDeploymentAction(commands[0], context());
    await runSingleDeploymentAction(commands[1], context());
    const stopped = await markActionsStoppedByFailure(commands, 1, context());
    expect(stopped.map((cmd) => cmd.id)).to.deep.equal(['b']);
  });
});

describe('Two Pull Requests reusing one action id', () => {
  const entry = (overrides: Partial<DeploymentActionStateEntry>): DeploymentActionStateEntry => ({
    actionId: 'publishSite',
    actionLabel: 'Publish the site',
    orgBranch: 'uat',
    when: 'post-deploy',
    executionOrder: 0,
    status: 'success',
    jobId: '1',
    jobUrl: '',
    date: '2026-10-04T08:00:00.000Z',
    ...overrides,
  });

  afterEach(() => {
    delete (globalThis as any)._deploymentActionsMultiPrState;
  });

  it('reads whether an action ran from the Pull Requests that own it only', () => {
    upsertActionInState(entry({}), 101);
    expect(checkActionInState('publishSite', 'uat', [105])).to.equal(null);
    expect(checkActionInState('publishSite', 'uat', [101])).to.not.equal(null);
    // A moved action is read from its fix Pull Request and from the one it was moved from
    expect(checkActionInState('publishSite', 'uat', [105, 101])).to.not.equal(null);
    // An action of the branch or project config is searched in every loaded Pull Request
    expect(checkActionInState('publishSite', 'uat')).to.not.equal(null);
  });

  it('ticks only the checkbox of the Pull Request it is told', () => {
    const body = [
      `- [ ] ${buildManualActionCheckboxMarker('publishSite', 'uat', 101, 'post-deploy')} Publish (#101)`,
      `- [ ] ${buildManualActionCheckboxMarker('publishSite', 'uat', 105, 'post-deploy')} Publish (#105)`,
    ].join('\n');
    const result = checkManualActionCheckboxInBody(body, 'publishSite', 'uat', 105);
    expect(result.changed).to.be.true;
    expect(result.body.split('\n')[0]).to.match(/^- \[ \]/);
    expect(result.body.split('\n')[1]).to.match(/^- \[x\]/);
  });
});

describe('Identical actions in the forecast of a promotion', () => {
  const forecast = (actionId: string, code: ActionForecast['forecast']): ActionForecast => ({
    actionId,
    actionLabel: `Action ${actionId}`,
    when: 'post-deploy',
    forecast: code,
    reason: 'deploy-only',
    status: null,
    date: '',
    jobUrl: '',
    note: '',
    movedTo: null,
    identicalTo: null,
  });

  it('points the later copies of one job at the first one, and keeps two jobs apart', () => {
    const items = [
      { prNumber: 101, forecast: forecast('a', 'runs-at-deployment') },
      { prNumber: 101, forecast: forecast('a2', 'runs-at-deployment') },
      { prNumber: 105, forecast: forecast('b', 'runs-at-deployment') },
      { prNumber: 107, forecast: forecast('c', 'runs-at-validation') },
    ];
    const keys = new Map<ActionForecast, string | null>([
      [items[0].forecast, 'runs-at-deployment|k'],
      [items[1].forecast, 'runs-at-deployment|k'],
      [items[2].forecast, 'runs-at-deployment|k'],
      [items[3].forecast, 'runs-at-validation|k'],
    ]);
    applyIdenticalForecasts(items, keys);
    expect(items[0].forecast.identicalTo).to.equal(null);
    // Written twice in #101: it runs twice
    expect(items[1].forecast.identicalTo).to.equal(null);
    expect(items[2].forecast.reason).to.equal('identical-action');
    expect(items[2].forecast.identicalTo).to.deep.equal({ pr: 101, actionId: 'a', actionLabel: 'Action a' });
    expect(items[3].forecast.identicalTo).to.equal(null);
  });

  it('compares the definitions of the actions the promotion runs, but not those still holding a reference', async () => {
    const def = (id: string, command: string): PrePostCommand => action({ id, command, when: 'post-deploy', context: 'process-deployment-only' });
    const items = [
      { prNumber: 101, def: def('a', 'sf community publish -n "Customer"'), forecast: forecast('a', 'runs-at-deployment') },
      { prNumber: 105, def: def('b', 'sf community publish -n "Customer"'), forecast: forecast('b', 'runs-at-deployment') },
      { prNumber: 106, def: def('c', 'sf community publish -n "Customer"'), forecast: forecast('c', 'done') },
      { prNumber: 107, def: def('d', 'sf data update record --where "Id=\'${{ pipeline.prId }}\'"'), forecast: forecast('d', 'runs-at-deployment') },
      { prNumber: 108, def: def('e', 'sf data update record --where "Id=\'${{ pipeline.prId }}\'"'), forecast: forecast('e', 'runs-at-deployment') },
    ];
    await markIdenticalForecasts(items);
    expect(items[1].forecast.identicalTo?.actionId).to.equal('a');
    expect(items[2].forecast.identicalTo).to.equal(null);
    expect(items[4].forecast.identicalTo).to.equal(null);
  });
});

describe('Identical actions in a backpromote', () => {
  const group = (hash: string, prId: number, actions: any[]): any => ({
    commit: { hash, message: '', author: '', date: '' },
    associatedPrs: [],
    prConfigs: [{ config: { commandsPostDeploy: actions }, prId, prTitle: `Story ${prId}` }],
  });
  const publish = (communityName: string, extra: Record<string, any> = {}) => ({
    id: 'publishSite',
    label: 'Publish the site',
    type: 'publish-community',
    parameters: { communityName },
    ...extra,
  });

  it('keeps the actions of two Pull Requests reusing one id', () => {
    const actions = collectBackpromoteActions([group('c1', 101, [publish('Customer')]), group('c2', 105, [publish('Partner')])], 'integration', 'commandsPostDeploy', null);
    expect(actions.map((candidate) => `${candidate.prId}:${candidate.id}`)).to.deep.equal(['101:publishSite', '105:publishSite']);
  });

  it('runs an action moved to a fix Pull Request from the fix only', () => {
    const actions = collectBackpromoteActions(
      [group('c1', 101, [publish('Custmer')]), group('c2', 105, [publish('Customer', { movedFrom: 101 })])],
      'integration',
      'commandsPostDeploy',
      null
    );
    expect(actions.map((candidate) => `${candidate.prId}:${candidate.id}`)).to.deep.equal(['105:publishSite']);
  });

  it('keeps one copy of the action of a Pull Request listed twice', () => {
    const actions = collectBackpromoteActions([group('c1', 101, [publish('Customer')]), group('c2', 101, [publish('Customer')])], 'integration', 'commandsPostDeploy', null);
    expect(actions).to.have.length(1);
  });

  it('marks in the plan the actions that run once with an identical one', () => {
    const planAction = (key: string, overrides: Partial<BackpromotePlanAction> = {}): BackpromotePlanAction => ({
      id: key.split(':')[2],
      key,
      label: `Publish ${key}`,
      type: 'publish-community',
      phase: 'post',
      context: 'all',
      pullRequest: Number(key.split(':')[0]),
      alreadyRunOn: null,
      manual: false,
      customUsername: null,
      runnable: true,
      runOnlyOnceByOrg: true,
      identicalTo: null,
      ...overrides,
    });
    const actions = [
      planAction('101:post:a', { alreadyRunOn: '2026-10-01' }),
      planAction('105:post:b'),
      planAction('105:post:b2'),
      planAction('107:post:c'),
      planAction('108:pre:d', { phase: 'pre' }),
    ];
    const keys = new Map<string, string | null>([
      ['101:post:a', 'k'],
      ['105:post:b', 'k'],
      ['105:post:b2', 'k'],
      ['107:post:c', 'k'],
      ['108:pre:d', 'other'],
    ]);
    markIdenticalPlanActions(actions, keys);
    // Already run in the sandbox: it does not run, the next one does
    expect(actions[0].identicalTo).to.equal(null);
    expect(actions[1].identicalTo).to.equal(null);
    // Written twice in #105: it runs twice
    expect(actions[2].identicalTo).to.equal(null);
    expect(actions[3].identicalTo).to.deep.equal({ key: '105:post:b', id: 'b', pullRequest: 105, label: 'Publish 105:post:b' });
    expect(actions[4].identicalTo).to.equal(null);
  });

  it('keys an action by its Pull Request, its phase and its id', () => {
    expect(backpromoteActionKey(105, 'pre', 'x')).to.equal('105:pre:x');
    expect(backpromoteActionKey(105, 'pre', 'x')).to.not.equal(backpromoteActionKey(105, 'post', 'x'));
  });

  describe('executeBackpromoteActions()', () => {
    const originalBuild = ActionsProvider.buildActionInstance;
    const originalConn = (globalThis as any).jsForceConn;
    const ran: string[] = [];

    class FakeAction extends ActionsProvider {
      public getLabel(): string {
        return 'FakeAction';
      }
      public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
        return { command: cmd.command };
      }
      public async run(cmd: PrePostCommand): Promise<ActionResult> {
        ran.push(`${(cmd as any).prId}:${cmd.id}`);
        return { statusCode: 'success' };
      }
    }

    const candidate = (prId: number, id: string, command = 'sf community publish -n Customer'): any => ({
      id,
      label: `Publish (${id})`,
      type: 'command',
      command,
      context: 'all',
      prId,
      prLabel: `#${prId}`,
      commitHash: `c${prId}`,
    });
    const run = (actions: any[]) =>
      executeBackpromoteActions({
        actions,
        phase: 'commandsPostDeploy',
        selectedActionIds: new Set(actions.map((entry) => entry.id)),
        alreadyRun: new Map(),
        sandboxName: 'dev1',
        orgId: '00D000000000001',
        user: 'tester',
        conn: {},
        store: { update: async () => undefined } as any,
        commandThis: null,
      });

    beforeEach(() => {
      ran.length = 0;
      resetIdenticalActionRuns();
      ActionsProvider.buildActionInstance = async () => new FakeAction();
    });

    afterEach(() => {
      ActionsProvider.buildActionInstance = originalBuild;
      (globalThis as any).jsForceConn = originalConn;
      resetIdenticalActionRuns();
    });

    it('runs once the action two Pull Requests carry, and gives each one its outcome by key', async () => {
      const outcome = await run([candidate(101, 'x'), candidate(105, 'x')]);
      expect(ran).to.deep.equal(['101:x']);
      expect(outcome.byKey).to.deep.equal({ '101:post:x': 'run', '105:post:x': 'identical' });
      expect(outcome.identical).to.deep.equal(['x']);
      expect(outcome.skipped).to.deep.equal(['x']);
    });

    it('runs twice an action written twice in one Pull Request', async () => {
      const outcome = await run([candidate(101, 'x'), candidate(101, 'y')]);
      expect(ran).to.deep.equal(['101:x', '101:y']);
      expect(outcome.identical).to.deep.equal([]);
    });
  });
});
