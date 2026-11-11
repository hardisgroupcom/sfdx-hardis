import { expect } from 'chai';
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

  it('Keeps the last word of a group that also holds the path of the file', async () => {
    const hint = await buildDeploymentActionHint(RECORD_TYPE_ACTION, ['', ' force-app/main/default/objects/Account/recordTypes/Old.recordType-meta.xml  Account.Old ']);
    expect(hint!.parameters.config.deletions[0].fullName).to.equal('Account.Old');
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
    expect(hint!.command).to.contain('--label "Say \\"hello\\" for \\$HOME"');
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
