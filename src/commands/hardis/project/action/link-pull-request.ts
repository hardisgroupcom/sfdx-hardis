/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import { renameDraftToPr } from '../../../../common/utils/actionUtils.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionLinkPullRequest extends SfCommand<any> {
  public static title = 'Link draft actions to a pull request';

  public static description = `
## Command Behavior

**Renames the draft deployment actions file to associate it with a specific pull request.**

When deployment actions are created with PR scope but no \`--pr-id\`, they are stored in a draft file (\`scripts/actions/.sfdx-hardis.draft.yml\`). This command renames that file to match a pull request ID, so the actions will be picked up during CI/CD deployments for that PR.

If \`--pr-id\` is set to \`current\`, the command will attempt to detect the pull request associated with the current git branch.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:link-pull-request --agent --pr-id 123
sf hardis:project:action:link-pull-request --agent --pr-id current
\`\`\`

Required in agent mode:

- \`--pr-id\`

<details markdown="1">
<summary>Technical explanations</summary>

- Renames \`scripts/actions/.sfdx-hardis.draft.yml\` to \`scripts/actions/.sfdx-hardis.<prId>.yml\`.
- Fails if the draft file does not exist or if the target file already exists.
- When \`--pr-id current\` is used, resolves the PR ID from the current branch via GitProvider.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:link-pull-request',
    '$ sf hardis:project:action:link-pull-request --pr-id 123',
    '$ sf hardis:project:action:link-pull-request --agent --pr-id current',
  ];

  public static flags: any = {
    'pr-id': Flags.string({
      description: 'Pull request ID to link, or "current" to auto-detect from the current branch',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
  };

  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ActionLinkPullRequest);
    const agentMode = flags.agent === true;

    // Collect PR ID
    let prId: string | undefined = flags['pr-id'];

    if (!prId && (agentMode || isCI)) {
      throw new SfError(t('missingRequiredFlag', { flag: 'pr-id' }));
    }

    // If "current", resolve from branch
    if (prId === 'current') {
      try {
        const prInfo = await GitProvider.getPullRequestInfo();
        if (prInfo && prInfo.idStr) {
          prId = prInfo.idStr;
          uxLog("log", this, c.grey(t('prResolvedFromBranch', { prId })));
        } else {
          if (agentMode || isCI) {
            throw new SfError(t('prNotFoundCannotLink'));
          }
          uxLog("warning", this, c.yellow(t('prNotFoundForCurrentBranch')));
          prId = undefined;
        }
      } catch (e) {
        if ((e as Error).message === t('prNotFoundCannotLink')) {
          throw e;
        }
        uxLog("warning", this, c.yellow(t('prResolutionFailed', { message: (e as Error).message })));
        prId = undefined;
      }
    }

    // If still no PR ID, prompt in interactive mode
    if (!prId && !agentMode && !isCI) {
      const response = await prompts({
        type: 'text',
        name: 'value',
        message: c.cyanBright(t('enterPrIdToLink')),
        description: t('enterPrIdToLink'),
      });
      prId = (response.value || '').trim();
      if (!prId) {
        throw new SfError(t('prIdRequiredForLink'));
      }
    }

    if (!prId) {
      throw new SfError(t('prIdRequiredForLink'));
    }

    // Rename draft to PR
    const targetFile = await renameDraftToPr(prId);

    uxLog("success", this, c.green(t('draftLinkedToPr', { prId, file: targetFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Draft linked to pull request', prId, file: targetFile };
  }
}
