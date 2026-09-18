import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import { FunctionCommandBase } from './base.js';
import {
  CUSTOM_FUNCTION_RUNTIMES,
  CustomFunctionDefinition,
  readCustomFunctionsFromProjectFile,
  validateCustomFunctionDefinition,
  writeCustomFunctionsToProjectFile,
} from '../../../../common/utils/customFunctionUtils.js';
import { parseInputsFlag, parseOutputsFlag } from '../../../../common/utils/customFunctionFlagUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FunctionUpdate extends FunctionCommandBase {
  public static title = 'Update custom function';

  public static description = `
## Command Behavior

**Updates a custom function declared in the project configuration.**

Only the fields you pass are changed; everything else keeps its current value.

\`--inputs\` and \`--outputs\` **replace** the whole contract rather than merging into it, so a single flag fully describes the new shape. Pass an empty value to remove every input or output.

Changing the contract does not rewrite the deployment actions already using the function: an action that no longer matches (a missing required input, a value outside a \`select\` list) is reported by \`hardis:project:action:list\` and fails at deployment time with the reason.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:function:update --agent --id notifySlack --label "Notify the release channel" --timeout 1200
\`\`\`

Required in agent mode: \`--id\`. Every other flag is optional, and every prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes \`config/.sfdx-hardis.yml\` with \`js-yaml\`, preserving every other key.
- Re-validates the whole definition after the merge, so an update cannot leave an invalid function behind.
- Renaming a function through \`--new-id\` is deliberately not supported: the id is the action type, and existing actions reference it.
</details>
`;

  public static examples = [
    '$ sf hardis:project:function:update',
    '$ sf hardis:project:function:update --agent --id notifySlack --label "Notify the release channel"',
    '$ sf hardis:project:function:update --agent --id notifySlack --inputs "channel:string:required;severity:select|info,warning,critical=info"',
    '$ sf hardis:project:function:update --agent --id notifySlack --timeout 1200 --when post-deploy',
  ];

  public static flags: any = {
    id: Flags.string({
      description: 'Id of the function to update',
    }),
    label: Flags.string({
      description: 'New label',
    }),
    description: Flags.string({
      description: 'New description',
    }),
    runtime: Flags.string({
      options: [...CUSTOM_FUNCTION_RUNTIMES],
      description: 'New runtime: node, python or bash',
    }),
    script: Flags.string({
      description: 'New script path',
    }),
    timeout: Flags.integer({
      description: 'New maximum duration of a run, in seconds',
    }),
    when: Flags.string({
      options: ['pre-deploy', 'post-deploy', 'any'],
      description: 'Restrict the function to one deployment phase, or "any" to remove the restriction',
    }),
    'allowed-contexts': Flags.string({
      description: 'New comma-separated execution contexts. Pass an empty value to remove the restriction',
    }),
    inputs: Flags.string({
      description: 'Replace the input contract: "name[:type][:required][|opt1,opt2][=default]" entries separated by ";". Empty value removes every input',
    }),
    outputs: Flags.string({
      description: 'Replace the output contract: "name[:type]" entries separated by ";". Empty value removes every output',
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
    const { flags } = await this.parse(FunctionUpdate);
    const agentMode = flags.agent === true;
    const headless = agentMode || isCI;

    const customFunctions = await readCustomFunctionsFromProjectFile();
    if (customFunctions.length === 0) {
      throw new SfError(t('noCustomFunctionDefined'));
    }

    const functionId = headless
      ? this.requireFlag(flags.id, 'id')
      : flags.id || await this.promptSelect(
        t('selectCustomFunctionToUpdate'),
        customFunctions.map((definition) => ({
          title: `${definition.label || definition.id} (${definition.runtime})`,
          value: definition.id,
          description: definition.script,
        }))
      );

    const functionIndex = customFunctions.findIndex((definition) => definition.id === functionId);
    if (functionIndex === -1) {
      throw new SfError(t('customFunctionNotFound', { id: functionId }));
    }
    const definition: CustomFunctionDefinition = { ...customFunctions[functionIndex] };

    if (flags.label) {
      definition.label = flags.label;
    } else if (!headless) {
      definition.label = await this.promptText(t('enterCustomFunctionLabel'), definition.label || '');
    }
    if (flags.description !== undefined) {
      definition.description = flags.description;
    }
    if (flags.runtime) {
      definition.runtime = flags.runtime;
    } else if (!headless) {
      definition.runtime = (await this.promptRuntime(definition.runtime)) as CustomFunctionDefinition['runtime'];
    }
    if (flags.script) {
      definition.script = flags.script;
    } else if (!headless) {
      definition.script = await this.promptText(t('enterCustomFunctionScript'), definition.script);
    }
    if (flags.timeout) {
      definition.timeout = flags.timeout;
    }
    if (flags.when) {
      // "any" is how a restriction is removed: an empty --when would be indistinguishable from
      // not passing the flag at all.
      if (flags.when === 'any') {
        delete definition.when;
      } else {
        definition.when = flags.when;
      }
    }
    if (flags['allowed-contexts'] !== undefined) {
      const contexts = String(flags['allowed-contexts'])
        .split(',')
        .map((context: string) => context.trim())
        .filter(Boolean);
      if (contexts.length > 0) {
        definition.allowedContexts = contexts as CustomFunctionDefinition['allowedContexts'];
      } else {
        delete definition.allowedContexts;
      }
    }
    if (flags.inputs !== undefined) {
      const inputs = parseInputsFlag(flags.inputs);
      if (inputs.length > 0) {
        definition.inputs = inputs;
      } else {
        delete definition.inputs;
      }
    } else if (!headless) {
      const inputs = await this.promptInputs(definition.inputs || []);
      if (inputs.length > 0) {
        definition.inputs = inputs;
      }
    }
    if (flags.outputs !== undefined) {
      const outputs = parseOutputsFlag(flags.outputs);
      if (outputs.length > 0) {
        definition.outputs = outputs;
      } else {
        delete definition.outputs;
      }
    } else if (!headless) {
      const outputs = await this.promptOutputs(definition.outputs || []);
      if (outputs.length > 0) {
        definition.outputs = outputs;
      }
    }

    // The function being updated must not count as a duplicate of itself
    const otherFunctions = customFunctions.filter((_definition, index) => index !== functionIndex);
    const validationErrors = validateCustomFunctionDefinition(definition, otherFunctions);
    if (validationErrors.length > 0) {
      throw new SfError(t('customFunctionValidationErrors', { errors: validationErrors.join('\n') }));
    }

    uxLog('action', this, c.cyan(t('savingCustomFunction')));
    customFunctions[functionIndex] = definition;
    const configFile = await writeCustomFunctionsToProjectFile(customFunctions);

    uxLog('success', this, c.green(t('customFunctionUpdatedSuccessfully', { label: definition.label || '', id: definition.id })));
    this.logFunctionSummary(definition);
    uxLog('log', this, c.grey(t('customFunctionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Custom function updated', customFunction: definition as any, configFile };
  }
}
