import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEPLOYMENT_ACTION_TYPES } from '../../../src/common/actionsProvider/actionTypes.js';
import { getBuiltInActionProvider } from '../../../src/common/utils/actionUtils.js';
import {
  buildDeploymentActionHint,
  buildTipDeploymentAction,
  formatDeploymentActionHint,
  getSolveDeploymentErrorPromptVariables,
} from '../../../src/common/utils/deployTipActions.js';
import { getAllTips } from '../../../src/common/utils/deployTipsList.js';
import { analyzeDeployErrorLogs } from '../../../src/common/utils/deployTips.js';
import { getPullRequestData } from '../../../src/common/utils/gitUtils.js';
import { t } from '../../../src/common/utils/i18n.js';
import { stripAnsi } from '../../../src/common/utils/index.js';

const RECORD_TYPE_ACTION = {
  type: 'browser',
  when: 'pre-deploy' as const,
  label: 'Delete record type {1}',
  parameters: { setting: 'recordTypes', config: { deletions: [{ fullName: '{1}' }] } },
};

// The log of a failed deployment, with its --json result
function failedDeployLog(componentFailures: Array<{ componentType: string; fullName: string; problem: string }>): string {
  const failures = componentFailures.map((failure) => ({ success: false, problemType: 'Error', ...failure }));
  const resultJson = { status: 1, result: { success: false, status: 'Failed', details: { componentFailures: failures } } };
  return `[sfdx-hardis] Sadly there has been Deployment error(s)
${JSON.stringify(resultJson, null, 2)}
`;
}

describe('Deployment actions suggested by deployment error tips', () => {
  it('Fills the placeholders and builds the command that creates the action on the Pull Request', async () => {
    const hint = await buildDeploymentActionHint(RECORD_TYPE_ACTION, ['Error Account.Old Cannot delete record type through API', 'Account.Old']);
    expect(hint).to.not.equal(null);
    expect(hint!.label).to.equal('Delete record type Account.Old');
    expect(hint!.parameters).to.deep.equal({ setting: 'recordTypes', config: { deletions: [{ fullName: 'Account.Old' }] } });
    expect(hint!.command).to.equal(
      'sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Delete record type Account.Old" --browser-setting recordTypes --browser-config \'{"deletions":[{"fullName":"Account.Old"}]}\''
    );
    expect(hint!.docUrl).to.equal('https://amtrack.github.io/sfdx-browserforce-plugin/settings/recordTypes/');
    expect(hint!.notes).to.deep.equal([t('deployTipBrowserCheckOnly')]);
  });

  it('Drops the path of the file before the name, and keeps a value with spaces whole', async () => {
    const hint = await buildDeploymentActionHint(RECORD_TYPE_ACTION, ['', ' force-app/main/default/objects/Account/recordTypes/Old.recordType-meta.xml  Account.Old ']);
    expect(hint!.parameters.config.deletions[0].fullName).to.equal('Account.Old');
    const picklistTip: any = getAllTips().find((tip: any) => tip.name === 'picklist-value-not-found');
    const picklistHint = await buildTipDeploymentAction(picklistTip, ['', 'Closed Won', 'StageName']);
    expect(picklistHint!.label).to.equal('Activate value Closed Won of picklist StageName');
    expect(picklistHint!.parameters.config.picklistValues[0].value).to.equal('Closed Won');
  });

  it('Asks to replace the values the tip cannot know before running the command', async () => {
    const picklistTip: any = getAllTips().find((tip: any) => tip.name === 'picklist-value-not-found');
    const hint = await buildTipDeploymentAction(picklistTip, ['', 'Gold', 'Tier__c']);
    expect(hint!.toComplete).to.deep.equal(['OBJECT_NAME']);
    expect(hint!.notes[0]).to.equal(t('deployTipActionToComplete', { values: 'OBJECT_NAME' }));
    expect(hint!.command).to.contain('"metadataFullName":"OBJECT_NAME.Tier__c"');
  });

  it('Leaves a placeholder without a group as it is, for the documentation pages', async () => {
    const hint = await buildDeploymentActionHint(RECORD_TYPE_ACTION, []);
    expect(hint!.label).to.equal('Delete record type {1}');
    expect(hint!.command).to.contain('"fullName":"{1}"');
  });

  it('Quotes the values a shell would break', async () => {
    const hint = await buildDeploymentActionHint({
      type: 'browser',
      when: 'pre-deploy',
      label: 'Say "hello" for $HOME',
      parameters: { setting: 'companyInformation', config: { name: "O'Brien" } },
    });
    // Single quotes keep the dollar sign literal in bash and in PowerShell
    expect(hint!.command).to.contain(`--label 'Say "hello" for $HOME'`);
    expect(hint!.command).to.contain(`--browser-config '{"name":"O'\\''Brien"}'`);
  });

  it('Suggests nothing for a type that is not a built-in action type', async () => {
    expect(await buildDeploymentActionHint({ ...RECORD_TYPE_ACTION, type: 'not-a-type' })).to.equal(null);
    expect(await buildTipDeploymentAction({}, [])).to.equal(null);
  });

  it('Presents the action in a Pull Request comment with a shell block, its notes and its documentation', async () => {
    const hint = await buildDeploymentActionHint(RECORD_TYPE_ACTION, ['', 'Account.Old']);
    const markdown = formatDeploymentActionHint(hint!, 'markdown').join('\n');
    expect(markdown).to.contain(t('deployTipActionIntro'));
    expect(markdown).to.contain('```shell\n' + hint!.command + '\n```');
    expect(markdown).to.contain(t('deployTipBrowserCheckOnly'));
    expect(markdown).to.contain(t('deployTipActionDocumentation', { url: hint!.docUrl }));
    const consoleText = stripAnsi(formatDeploymentActionHint(hint!, 'console').join('\n'));
    expect(consoleText).to.contain(hint!.command);
    expect(consoleText).to.not.contain('```');
  });

  it('Every tip that suggests an action names a built-in type and only the parameters it describes', async () => {
    const tipsWithAction = getAllTips().filter((tip: any) => tip.deploymentAction);
    expect(tipsWithAction.map((tip: any) => tip.name)).to.include.members([
      'can-not-delete-record-type',
      'missing-feature-account-contact-relation',
      'send-email-disabled',
      'picklist-value-not-found',
      'shared-activities-not-deployable',
      'lightning-experience-theme-not-found',
      'history-tracking-not-enabled',
      'duplicate-label',
      'einstein-conversation-insights-not-enabled',
    ]);
    for (const tip of tipsWithAction) {
      const definition = (tip as any).deploymentAction;
      expect(DEPLOYMENT_ACTION_TYPES, tip.name).to.include(definition.type);
      expect(['pre-deploy', 'post-deploy'], tip.name).to.include(definition.when);
      const provider = await getBuiltInActionProvider(definition.type);
      const described = provider!.getParameterDescriptions().map((description) => description.name);
      expect(described, tip.name).to.include.members(Object.keys(definition.parameters));
      expect(await buildTipDeploymentAction(tip, []), tip.name).to.not.equal(null);
    }
  });

  it('Completes the action with what the tip resolves, and keeps the placeholders when it cannot', async () => {
    let calledWith: string[] | null = null;
    const resolving = {
      ...RECORD_TYPE_ACTION,
      toComplete: ['OLD_NAME'],
      resolve: async (_filled: any, values: string[]) => {
        calledWith = values;
        return { label: `Resolved ${values[1]}`, toComplete: [] };
      },
    };
    const hint = await buildDeploymentActionHint(resolving, ['', ' force-app/x/Old.recordType-meta.xml Account.Old ']);
    expect(calledWith).to.deep.equal(['', 'Account.Old']);
    expect(hint!.label).to.equal('Resolved Account.Old');
    expect(hint!.toComplete).to.deep.equal([]);
    // Not resolved without the groups of an error: the documentation pages show the template
    const template = await buildDeploymentActionHint(resolving, []);
    expect(template!.label).to.equal('Delete record type {1}');
    // A resolve function that fails leaves the filled action
    const failing = await buildDeploymentActionHint({ ...resolving, resolve: async () => Promise.reject(new Error('boom')) }, ['', 'Account.Old']);
    expect(failing!.label).to.equal('Delete record type Account.Old');
    expect(failing!.toComplete).to.deep.equal(['OLD_NAME']);
  });

  describe('Duplicate label after a renamed picklist value', () => {
    const initialCwd = process.cwd();
    let projectDir: string;
    const duplicateLabelTip: any = getAllTips().find((tip: any) => tip.name === 'duplicate-label');

    before(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-hardis-duplicate-label-'));
      fs.writeFileSync(path.join(projectDir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
      const fieldFile = path.join(projectDir, 'force-app/main/default/objects/Vehicle__c/fields/Features__c.field-meta.xml');
      fs.mkdirSync(path.dirname(fieldFile), { recursive: true });
      fs.writeFileSync(
        fieldFile,
        `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Features__c</fullName>
    <valueSet><valueSetDefinition><value><fullName>Satnav</fullName><default>false</default><label>Navigation</label></value></valueSetDefinition></valueSet>
</CustomField>`
      );
    });

    // Before each test: a root hook of another test file may put the working directory back
    beforeEach(() => process.chdir(projectDir));
    afterEach(() => process.chdir(initialCwd));

    after(() => {
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    it('Reads the new API name from the sources: only the old API name is left to complete', async () => {
      const hint = await buildTipDeploymentAction(duplicateLabelTip, ['', 'Vehicle__c.Features__c', 'Navigation']);
      expect(hint!.parameters).to.deep.equal({
        setting: 'picklists',
        config: {
          picklistValues: [{ metadataType: 'CustomField', metadataFullName: 'Vehicle__c.Features__c', value: 'OLD_API_NAME', newApiName: 'Satnav' }],
        },
      });
      expect(hint!.toComplete).to.deep.equal(['OLD_API_NAME']);
      expect(hint!.label).to.equal('Rename picklist value Navigation of Vehicle__c.Features__c to Satnav');
      expect(hint!.docUrl).to.equal('https://amtrack.github.io/sfdx-browserforce-plugin/settings/picklists/');
    });

    it('Matches the error of a deployment check, and drops the position the text log adds to the label', async () => {
      // As returned by sf project deploy start --dry-run --json on a scratch org
      const { errorsAndTips } = await analyzeDeployErrorLogs(
        failedDeployLog([{ componentType: 'CustomField', fullName: 'Vehicle__c.Features__c', problem: 'Duplicate label: Navigation' }]),
        true,
        { check: true }
      );
      const tip = errorsAndTips.find((errorAndTip: any) => errorAndTip.tip?.label === 'Duplicate label');
      expect(tip?.tip?.deploymentAction?.parameters.config.picklistValues[0].newApiName).to.equal('Satnav');
      const fromText = await buildTipDeploymentAction(duplicateLabelTip, ['', 'Vehicle__c.Features__c', 'Navigation (3:13)']);
      expect(fromText!.parameters.config.picklistValues[0].newApiName).to.equal('Satnav');
    });

    it('Falls back to the values to complete when the sources do not have the value', async () => {
      const field = await buildTipDeploymentAction(duplicateLabelTip, ['', 'Account.Industry', 'Banking']);
      expect(field!.parameters.config.picklistValues[0]).to.deep.include({ metadataType: 'CustomField', metadataFullName: 'Account.Industry', newApiName: 'NEW_API_NAME' });
      expect(field!.toComplete).to.deep.equal(['OLD_API_NAME', 'NEW_API_NAME']);
      const valueSet = await buildTipDeploymentAction(duplicateLabelTip, ['', 'Regions', 'EMEA']);
      expect(valueSet!.toComplete).to.deep.equal(['OLD_API_NAME', 'NEW_API_NAME', 'METADATA_TYPE']);
    });
  });

  it('Turns on Einstein Conversation Insights before a deployment of the settings that need it', async () => {
    // The three errors a scratch org returned with Einstein Conversation Insights turned off
    const problems = [
      'There was an error enabling or disabling a setting: OrgPreferences.CallSummarization',
      'There was an error enabling or disabling a setting: OrgPreferences.GenECI',
      'enableECICallScoring',
    ];
    for (const problem of problems) {
      const { errorsAndTips } = await analyzeDeployErrorLogs(
        failedDeployLog([{ componentType: 'ConversationalIntelligenceSettings', fullName: 'ConversationalIntelligence', problem }]),
        true,
        { check: true }
      );
      const tip = errorsAndTips.find((errorAndTip: any) => errorAndTip.tip?.label === 'Einstein Conversation Insights not enabled');
      expect(tip?.tip?.deploymentAction?.parameters, problem).to.deep.equal({ setting: 'einsteinConversationInsights', config: { enabled: true } });
    }
  });

  it('Gives the AI prompt a value for the deployment actions, even when no type describes itself', async () => {
    const variables = await getSolveDeploymentErrorPromptVariables('Error X');
    expect(variables.ERROR).to.equal('Error X');
    expect(variables.DEPLOYMENT_ACTION_HINTS).to.not.equal('');
  });

  it('Adds the action to the tip of a deployment error, in the log, the JSON result and the Pull Request comment', async () => {
    const resultJson = {
      status: 1,
      result: {
        success: false,
        status: 'Failed',
        details: {
          componentFailures: [
            {
              success: false,
              problemType: 'Error',
              componentType: 'RecordType',
              fullName: 'Account.Old',
              problem: 'Cannot delete record type through API',
            },
          ],
        },
      },
    };
    const log = `[sfdx-hardis] Sadly there has been Deployment error(s)\n${JSON.stringify(resultJson, null, 2)}\n`;
    const { errorsAndTips, errLog } = await analyzeDeployErrorLogs(log, true, { check: true });
    const recordTypeTip = errorsAndTips.find((errorAndTip: any) => errorAndTip.tip?.label === 'Can not delete record type');
    expect(recordTypeTip?.tip?.deploymentAction?.command).to.contain('--browser-config \'{"deletions":[{"fullName":"Account.Old"}]}\'');
    expect(stripAnsi(errLog)).to.contain('--browser-setting recordTypes');
    expect(getPullRequestData().deployErrorsMarkdownBody).to.contain('```shell\nsf hardis:project:action:create --agent --scope pr --pr-id current');
  });
});
