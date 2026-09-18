import { Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { FunctionCommandBase } from './base.js';
import { readCustomFunctionsFromProjectFile, resolveRuntimeInterpreter } from '../../../../common/utils/customFunctionUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FunctionList extends FunctionCommandBase {
  public static title = 'List custom functions';

  public static description = `
## Command Behavior

**Lists the custom functions declared in the project configuration.**

Each function shows its id (the deployment action type to use), its label, its runtime, its script, and its input and output contract.

With \`--check-runtimes\`, the command also reports whether the interpreter each function needs is available on the current machine. Use it in a validation job to catch a missing \`python\` on a runner before a deployment fails on it.

The \`--json\` output carries the full definitions, which is what the VS Code extension reads to populate the deployment action editor.

### Agent Mode

This command is read-only and never prompts, so it already runs headless. \`--agent\` is accepted for consistency with the other commands.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads \`customFunctions\` from \`config/.sfdx-hardis.yml\`.
- \`--check-runtimes\` resolves each interpreter the same way the action does at run time.
</details>
`;

  public static examples = [
    '$ sf hardis:project:function:list',
    '$ sf hardis:project:function:list --json',
    '$ sf hardis:project:function:list --check-runtimes',
  ];

  public static flags: any = {
    'check-runtimes': Flags.boolean({
      default: false,
      description: 'Also report whether each function runtime is available on this machine',
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

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FunctionList);
    const customFunctions = await readCustomFunctionsFromProjectFile();

    uxLog('action', this, c.cyan(t('listingCustomFunctions')));
    if (customFunctions.length === 0) {
      uxLog('log', this, c.grey(t('noCustomFunctionDefined')));
      return { outputString: 'No custom function found', customFunctions: [] };
    }

    const tableData = customFunctions.map((definition, index) => {
      const row: any = {
        '#': index + 1,
        Id: definition.id,
        Label: definition.label || '',
        Runtime: definition.runtime,
        Script: definition.script,
        Inputs: (definition.inputs || []).map((input) => input.name).join(', '),
        Outputs: (definition.outputs || []).map((output) => output.name).join(', '),
      };
      if (flags['check-runtimes']) {
        row.RuntimeAvailable = resolveRuntimeInterpreter(definition.runtime) ? 'yes' : 'no';
      }
      return row;
    });
    uxLogTable(this, tableData);

    if (flags['check-runtimes']) {
      const missingRuntimes = customFunctions.filter((definition) => !resolveRuntimeInterpreter(definition.runtime));
      if (missingRuntimes.length > 0) {
        uxLog('warning', this, c.yellow(t('customFunctionRuntimesMissing', {
          ids: missingRuntimes.map((definition) => `${definition.id} (${definition.runtime})`).join(', '),
        })));
      }
    }

    return {
      outputString: `Found ${customFunctions.length} custom functions`,
      customFunctions: customFunctions as any,
    };
  }
}
