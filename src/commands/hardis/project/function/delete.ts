/* jscpd:ignore-start */
import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import { FunctionCommandBase } from './base.js';
import {
  findActionsUsingCustomFunction,
  writeCustomFunctionsToProjectFile,
} from '../../../../common/utils/customFunctionUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */

export default class FunctionDelete extends FunctionCommandBase {
  public static title = 'Delete custom function';

  public static description = `
## Command Behavior

**Removes a custom function from the project configuration.**

Before deleting, the command scans the project config, every branch config and every Pull Request action file for deployment actions still using the function as their \`type\`. Those actions would fail at deployment time with an unknown type, so:

- Interactively, the usages are listed and confirmation is asked.
- In agent mode, the deletion is **refused** unless \`--force\` is passed.

The script file itself is never deleted: it is an ordinary file of your repository, and it may be shared or kept for reference.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:function:delete --agent --id notifySlack
\`\`\`

Required in agent mode: \`--id\`. Add \`--force\` to delete a function that deployment actions still reference.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes \`config/.sfdx-hardis.yml\` with \`js-yaml\`, preserving every other key.
- Usage scan covers \`config/.sfdx-hardis.yml\`, \`config/branches/*.yml\` and \`scripts/actions/*.yml\`.
</details>
`;

  public static examples = [
    '$ sf hardis:project:function:delete',
    '$ sf hardis:project:function:delete --agent --id notifySlack',
    '$ sf hardis:project:function:delete --agent --id notifySlack --force',
  ];

  public static flags: any = {
    id: Flags.string({
      description: 'Id of the function to delete',
    }),
    force: Flags.boolean({
      default: false,
      description: 'Delete even when deployment actions still use this function',
    }),
    /* jscpd:ignore-start */
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
    /* jscpd:ignore-end */
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FunctionDelete);
    const agentMode = flags.agent === true;
    const headless = agentMode || isCI;

    const { customFunctions, functionIndex } = await this.resolveTargetFunction(
      flags.id,
      headless,
      t('selectCustomFunctionToDelete')
    );
    const definition = customFunctions[functionIndex];
    const functionId = definition.id;

    const usages = await findActionsUsingCustomFunction(functionId);
    if (usages.length > 0) {
      uxLog('warning', this, c.yellow(t('customFunctionStillUsed', { id: functionId, count: usages.length })));
      uxLogTable(this, usages.map((usage) => ({
        File: usage.file,
        ActionId: usage.actionId,
        ActionLabel: usage.actionLabel,
      })));
      if (headless && flags.force !== true) {
        throw new SfError(t('customFunctionDeleteRefusedStillUsed', { id: functionId }));
      }
      if (!headless && flags.force !== true) {
        const confirmed = await this.promptConfirm(t('customFunctionConfirmDeleteStillUsed', { id: functionId }));
        if (!confirmed) {
          uxLog('action', this, c.cyan(t('customFunctionDeleteCancelled')));
          return { outputString: 'Deletion cancelled', deleted: false };
        }
      }
    }

    uxLog('action', this, c.cyan(t('deletingCustomFunction')));
    customFunctions.splice(functionIndex, 1);
    const configFile = await writeCustomFunctionsToProjectFile(customFunctions);

    uxLog('success', this, c.green(t('customFunctionDeletedSuccessfully', { label: definition.label || '', id: definition.id })));
    uxLog('log', this, c.grey(t('customFunctionScriptFileKept', { path: definition.script })));
    uxLog('log', this, c.grey(t('customFunctionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Custom function deleted', deleted: true, customFunction: definition as any, configFile };
  }
}
