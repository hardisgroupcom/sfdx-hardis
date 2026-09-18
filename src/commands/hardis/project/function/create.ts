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

export default class FunctionCreate extends FunctionCommandBase {
  public static title = 'Create custom function';

  public static description = `
## Command Behavior

**Declares a custom function: a script that becomes a deployment action type of your project.**

A custom function packages a **node**, **python** or **bash** script behind a typed parameter contract. Once declared, its id is a valid deployment action \`type\`, next to the built-in ones (\`command\`, \`apex\`, \`data\`...), and \`hardis:project:action:create\` offers it in the type list.

Functions are stored in the **project** configuration (\`config/.sfdx-hardis.yml\`), under \`customFunctions\`. They are deliberately not branch or Pull Request scoped: a function id is an action type, so the catalog must be identical everywhere.

### What the script receives

Every value arrives as an environment variable:

- One \`SFDX_HARDIS_IN_<NAME>\` per declared input (uppercased).
- The pipeline context: \`SFDX_HARDIS_TARGET_BRANCH\`, \`SFDX_HARDIS_PR_ID\`, \`SFDX_HARDIS_ORG_USERNAME\`, \`SFDX_HARDIS_CHECK_ONLY\` and the rest of the git, Pull Request, org and deployment groups.

### What the script returns

When the function declares outputs, the **last non-empty line of stdout must be a JSON object** holding them. Everything printed before it is ordinary logging, kept as the action output.

Outputs are consumable by any later action of the run with \`\${{ actions.<actionId>.outputs.<name> }}\`, and are displayed in the job log, the Pull Request comment and the deployment notification.

### Secrets

An input of type \`secret\` never stores a value in the configuration file. The action stores the **name of a CI/CD variable**, sfdx-hardis resolves it from the environment when the action runs, passes the value to the script, and masks it everywhere it reports. A variable that is not defined fails the action.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:function:create --agent --id notifySlack --label "Notify Slack channel" --runtime node --script scripts/functions/notify-slack.js --inputs "channel:string:required;severity:select|info,warning,critical=info;webhookToken:secret:required" --outputs "messageId;permalink"
\`\`\`

Required in agent mode: \`--id\`, \`--label\`, \`--runtime\`, \`--script\`.

Defaults applied: no input, no output, no phase restriction, and the standard execution timeout. Every interactive prompt is skipped.

The \`--inputs\` syntax is \`name[:type][:required][|option1,option2][=default]\`, entries separated by \`;\`. Types: \`string\`, \`number\`, \`boolean\`, \`select\`, \`multiline\`, \`secret\`.
The \`--outputs\` syntax is \`name[:type]\`, entries separated by \`;\`.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes \`config/.sfdx-hardis.yml\` with \`js-yaml\`, preserving every other key.
- Rejects an id colliding with a built-in action type, a duplicate id, and a missing script file.
- The interpreter is resolved when the action runs, not here: \`node\` is the interpreter running sfdx-hardis, \`python\` tries \`python3\` then \`python\`, \`bash\` is taken from PATH.
- Sends a refresh message so the VS Code extension reloads the DevOps Pipeline panel.
</details>
`;

  public static examples = [
    '$ sf hardis:project:function:create',
    '$ sf hardis:project:function:create --agent --id notifySlack --label "Notify Slack channel" --runtime node --script scripts/functions/notify-slack.js',
    '$ sf hardis:project:function:create --agent --id findAccount --label "Find an account" --runtime python --script scripts/functions/find-account.py --inputs "name:string:required" --outputs "accountId"',
    '$ sf hardis:project:function:create --agent --id warmCache --label "Warm the cache" --runtime bash --script scripts/functions/warm-cache.sh --when post-deploy --timeout 1200',
  ];

  public static flags: any = {
    id: Flags.string({
      description: 'Function id, used as the deployment action type (ex: notifySlack)',
    }),
    label: Flags.string({
      description: 'Human-readable label for the function',
    }),
    description: Flags.string({
      description: 'Description of what the function does',
    }),
    runtime: Flags.string({
      options: [...CUSTOM_FUNCTION_RUNTIMES],
      description: 'Script runtime: node, python or bash',
    }),
    script: Flags.string({
      description: 'Path to the script file, relative to the repository root',
    }),
    timeout: Flags.integer({
      description: 'Maximum duration of a run, in seconds (default: 600)',
    }),
    when: Flags.string({
      options: ['pre-deploy', 'post-deploy'],
      description: 'Restrict the function to one deployment phase (default: both)',
    }),
    'allowed-contexts': Flags.string({
      description: 'Comma-separated execution contexts the function may be used with (default: all of them)',
    }),
    inputs: Flags.string({
      description: 'Input contract: "name[:type][:required][|opt1,opt2][=default]" entries separated by ";"',
    }),
    outputs: Flags.string({
      description: 'Output contract: "name[:type]" entries separated by ";"',
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
    const { flags } = await this.parse(FunctionCreate);
    const agentMode = flags.agent === true;
    const headless = agentMode || isCI;

    const functionId = headless
      ? this.requireFlag(flags.id, 'id')
      : flags.id || await this.promptText(t('enterCustomFunctionId'), '');
    const label = headless
      ? this.requireFlag(flags.label, 'label')
      : flags.label || await this.promptText(t('enterCustomFunctionLabel'), '');
    const runtime = headless
      ? this.requireFlag(flags.runtime, 'runtime')
      : flags.runtime || await this.promptRuntime();
    const script = headless
      ? this.requireFlag(flags.script, 'script')
      : flags.script || await this.promptText(t('enterCustomFunctionScript'), '');

    const definition: CustomFunctionDefinition = {
      id: functionId,
      label,
      runtime: runtime as CustomFunctionDefinition['runtime'],
      script,
    };

    const description = flags.description || (headless ? '' : await this.promptText(t('enterCustomFunctionDescription'), ''));
    if (description) {
      definition.description = description;
    }
    if (flags.timeout) {
      definition.timeout = flags.timeout;
    }
    if (flags.when) {
      definition.when = flags.when;
    }
    if (flags['allowed-contexts']) {
      definition.allowedContexts = flags['allowed-contexts']
        .split(',')
        .map((context: string) => context.trim())
        .filter(Boolean) as CustomFunctionDefinition['allowedContexts'];
    }

    const inputs = flags.inputs ? parseInputsFlag(flags.inputs) : headless ? [] : await this.promptInputs();
    if (inputs.length > 0) {
      definition.inputs = inputs;
    }
    const outputs = flags.outputs ? parseOutputsFlag(flags.outputs) : headless ? [] : await this.promptOutputs();
    if (outputs.length > 0) {
      definition.outputs = outputs;
    }

    const existingFunctions = await readCustomFunctionsFromProjectFile();
    const validationErrors = validateCustomFunctionDefinition(definition, existingFunctions);
    if (validationErrors.length > 0) {
      throw new SfError(t('customFunctionValidationErrors', { errors: validationErrors.join('\n') }));
    }

    uxLog('action', this, c.cyan(t('savingCustomFunction')));
    existingFunctions.push(definition);
    const configFile = await writeCustomFunctionsToProjectFile(existingFunctions);

    uxLog('success', this, c.green(t('customFunctionCreatedSuccessfully', { label: definition.label || '', id: definition.id })));
    this.logFunctionSummary(definition);
    uxLog('log', this, c.grey(t('customFunctionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Custom function created', customFunction: definition as any, configFile };
  }
}
