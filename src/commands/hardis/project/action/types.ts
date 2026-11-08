/* jscpd:ignore-start */
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { buildActionTypesDescription, describeBuiltInType } from '../../../../common/utils/actionTypesUtils.js';
import { DEPLOYMENT_ACTION_TYPES } from '../../../../common/actionsProvider/actionTypes.js';
import { ActionWhen } from '../../../../common/actionsProvider/actionsProvider.js';
import { assertNoFlagsOfOtherTypes, getBuiltInActionProvider } from '../../../../common/utils/actionUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionTypes extends SfCommand<any> {
  public static title = 'Describe deployment action types';

  public static description = `
## Command Behavior

**Describes the deployment action types: what each one takes, in which phase and context it runs, and its defaults.**

It is meant for AI agents and scripts that create deployment actions with \`sf hardis:project:action:create --agent\`: they read here which flags and parameters a type expects, instead of guessing them.

For each built-in type:

- \`allowedWhen\`: the phases it may run in (\`pre-deploy\`, \`post-deploy\`)
- \`defaultContext\`: the context a new action gets, and \`deploymentOnly\` when it only runs in deployment jobs
- \`runOnlyOnceByOrgDefault\`: whether it runs once per org by default
- \`parameters\`: each field of the action, where it is stored, the flag of \`action:create\` that sets it, its type, whether it is required and its default

The custom functions declared in the project (\`customFunctions\`) are listed too, with their inputs.

### Browser actions

A \`browser\` action applies one setting of [Browserforce](https://github.com/amtrack/sfdx-browserforce-plugin) (sfdx-browserforce-plugin), installed when missing. With \`--type browser\`, the result lists the settings Browserforce can apply. With \`--type browser --browser-setting <key>\`, it describes that setting: its fields, its JSON Schema, examples and warnings, which is what \`--browser-config\` of \`action:create\` must follow.

Both also describe the names of the CI/CD variables a value can be read from, for each major branch (\`secretsLookup\`).

### Agent Mode

Supports non-interactive execution with \`--agent\`. The command never prompts: \`--agent\` is accepted so agents can pass it to every sfdx-hardis command.

\`\`\`sh
sf hardis:project:action:types --json
sf hardis:project:action:types --type browser --json
sf hardis:project:action:types --type browser --browser-setting densitySettings --json
\`\`\`

<details markdown="1">
<summary>Technical explanations</summary>

- Built from the provider class of each action type (\`getParameterDescriptions()\`, \`getAllowedWhen()\`, \`getDefaultContext()\`, \`describeTypeDetails()\`) and the registries of \`actionTypes.ts\`.
- The Browserforce catalog comes from \`sf browserforce plugins list --json\`, cached per Browserforce version in \`~/.sfdx/sfdx-hardis-cache/browserforce\` (shared with the VS Code extension).
- The variable names come from the secrets provider of the project (\`secretsProvider\`, CI/CD variables by default).
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:types',
    '$ sf hardis:project:action:types --json',
    '$ sf hardis:project:action:types --when pre-deploy --json',
    '$ sf hardis:project:action:types --type browser --json',
    '$ sf hardis:project:action:types --type browser --browser-setting densitySettings --json',
    '$ sf hardis:project:action:types --agent',
  ];

  public static flags: any = {
    type: Flags.string({
      description: 'Describe only this type: a built-in type or the id of a project custom function',
    }),
    when: Flags.string({
      options: ['pre-deploy', 'post-deploy'],
      description: 'Only the types that can run in this phase',
    }),
    'browser-setting': Flags.string({
      description: 'With --type browser: describe this Browserforce setting (fields, JSON Schema, examples)',
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
    const { flags } = await this.parse(ActionTypes);
    if (flags.type) {
      await assertNoFlagsOfOtherTypes(flags.type, flags);
    }
    const description = await buildActionTypesDescription({ type: flags.type, when: flags.when as ActionWhen, flags });
    if (flags.type && description.types.length === 0 && description.customFunctions.length === 0) {
      // A built-in type filtered out by --when exists: say it cannot run in that phase
      if ((DEPLOYMENT_ACTION_TYPES as readonly string[]).includes(flags.type)) {
        const { allowedWhen } = await describeBuiltInType(flags.type);
        throw new SfError(t('actionTypeWrongPhase', { type: flags.type, when: allowedWhen.join(', ') }));
      }
      throw new SfError(t('actionValidationUnknownType', { type: flags.type }));
    }

    uxLog("action", this, c.cyan(t('actionTypesTitle')));
    await uxLogTableWithReport(this, [
      ...description.types.map((type) => ({
        type: type.type,
        when: type.allowedWhen.join(', '),
        context: type.defaultContext,
        flags: type.parameters.map((parameter) => `--${parameter.flag}${parameter.required ? '' : ' (optional)'}`).join(' '),
      })),
      ...description.customFunctions.map((fn) => ({
        type: fn.type,
        when: fn.when || 'pre-deploy, post-deploy',
        context: fn.defaults?.context || 'process-deployment-only',
        flags: fn.inputs.map((input) => `--function-input ${input.name}=...`).join(' '),
      })),
    ], ['type', 'when', 'context', 'flags'], { fileNamePrefix: 'deployment-action-types', fileTitle: t('actionTypesTitle') });
    const detailedType = description.types.find((type) => type.details);
    if (detailedType) {
      const provider = await getBuiltInActionProvider(detailedType.type);
      await provider?.logTypeDetails(detailedType.details!, this);
    }

    return description as unknown as AnyJson;
  }
}
/* jscpd:ignore-end */
