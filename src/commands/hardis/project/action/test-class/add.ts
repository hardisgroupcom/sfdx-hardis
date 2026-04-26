import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../../common/utils/index.js';
import { t } from '../../../../../common/utils/i18n.js';
import {
  ActionScope,
  readTestClasses,
  resolvePrId,
  writeTestClasses,
} from '../../../../../common/utils/actionUtils.js';
import { ActionCommandBase } from '../base.js';
import { getConfig } from '../../../../../config/index.js';
import { getApexTestClasses } from '../../../../../common/utils/classUtils.js';
import { prompts } from '../../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionTestClassAdd extends ActionCommandBase {
  public static title = 'Add deployment Apex test class';

  public static description = `
## Command Behavior

**Adds one or more Apex test classes to the deployment test class list for the project configuration.**

Requires \`enableDeploymentApexTestClasses: true\` in \`config/.sfdx-hardis.yml\`. If the feature is not activated, the command stops with an error.

In interactive mode, discovers all Apex test classes available in the repository sources and lets the user select the ones to add.

In agent mode, requires \`--class-name\` (can be specified multiple times to add several classes at once) and validates that each class exists in the repository sources.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:test-class:add --agent --scope pr --class-name MyTestClass_Test --class-name AnotherTest_Test
\`\`\`

Required in agent mode:

- \`--scope\`, \`--class-name\` (one or more)

Defaults applied: validates each class exists in sources before adding.

<details markdown="1">
<summary>Technical explanations</summary>

- Discovers test classes by scanning \`.cls\` files for the \`@IsTest\` annotation using \`getApexTestClasses()\`.
- Reads and writes \`deploymentApexTestClasses\` in the YAML config file at the selected scope.
- Skips duplicates silently after logging a warning.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:test-class:add',
    '$ sf hardis:project:action:test-class:add --agent --scope pr --class-name MyTest_Test',
    '$ sf hardis:project:action:test-class:add --agent --scope project --class-name FooTest --class-name BarTest',
  ];

  public static flags: any = {
    scope: Flags.string({
      options: ['project', 'branch', 'pr'],
      description: 'Configuration scope: project, branch, or pr',
    }),
    'class-name': Flags.string({
      description: 'Apex test class name(s) to add (required in agent mode; can be specified multiple times)',
      multiple: true,
    }),
    branch: Flags.string({
      description: 'Target branch name (for branch scope, defaults to current branch)',
    }),
    'pr-id': Flags.string({
      description: 'Pull request ID (for pr scope, defaults to draft)',
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
    const { flags } = await this.parse(ActionTestClassAdd);
    const agentMode = flags.agent === true;

    // Stop if enableDeploymentApexTestClasses is not activated
    const projectConfig = await getConfig('project');
    if (!projectConfig.enableDeploymentApexTestClasses) {
      throw new SfError(t('deploymentApexTestClassesNotActivated'));
    }

    // Collect scope
    const scope: ActionScope = agentMode || isCI
      ? this.requireFlag(flags.scope, 'scope') as ActionScope
      : flags.scope || await this.promptSelect(t('selectActionScope'), [
        { title: t('actionScopeProject'), value: 'project', description: t('actionScopeProjectDesc') },
        { title: t('actionScopeBranch'), value: 'branch', description: t('actionScopeBranchDesc') },
        { title: t('actionScopePr'), value: 'pr', description: t('actionScopePrDesc') },
      ]);

    // Resolve PR ID if scope is pr
    const resolvedPrId = scope === 'pr' ? await resolvePrId(this, flags['pr-id'], agentMode) : flags['pr-id'];

    // Read already-configured test classes for this scope
    const existingClasses = await readTestClasses(scope, flags.branch, resolvedPrId);

    let classesToAdd: string[] = [];

    if (agentMode || isCI) {
      // Agent mode: --class-name is required (one or more values)
      const classNameFlag = flags['class-name'];
      if (!classNameFlag || (Array.isArray(classNameFlag) && classNameFlag.length === 0)) {
        throw new SfError(t('missingRequiredFlag', { flag: 'class-name' }));
      }
      const requestedClasses: string[] = Array.isArray(classNameFlag) ? classNameFlag : [classNameFlag];

      // Validate each class exists in sources
      const availableClasses = await getApexTestClasses();
      for (const className of requestedClasses) {
        if (!availableClasses.includes(className)) {
          throw new SfError(t('apexTestClassNotFoundInSources', { className }));
        }
      }

      classesToAdd = requestedClasses;
    } else {
      // Interactive mode: discover all test classes and let user multi-select
      const availableClasses = await getApexTestClasses();

      if (availableClasses.length === 0) {
        uxLog('warning', this, c.yellow(t('noApexClassFoundInTheProject')));
        return { outputString: 'No Apex test classes found in sources', classes: existingClasses };
      }

      // Show all available classes; mark already-configured ones as disabled
      const choices = availableClasses.map((cls: string) => ({
        title: existingClasses.includes(cls) ? `${cls} (already added)` : cls,
        value: cls,
        disabled: existingClasses.includes(cls),
      }));

      const response = await prompts({
        type: 'multiselect',
        name: 'value',
        message: c.cyanBright(t('selectApexTestClassesToAdd')),
        choices,
        description: t('selectApexTestClassesToAdd'),
      });

      classesToAdd = (response.value || []) as string[];

      if (classesToAdd.length === 0) {
        uxLog('log', this, c.grey('No classes selected. Nothing to do.'));
        return { outputString: 'No classes selected', classes: existingClasses };
      }
    }

    // Add classes (skip duplicates)
    const updatedClasses = [...existingClasses];
    const added: string[] = [];

    for (const className of classesToAdd) {
      if (updatedClasses.includes(className)) {
        uxLog('warning', this, c.yellow(t('apexTestClassAlreadyInList', { className })));
      } else {
        updatedClasses.push(className);
        added.push(className);
      }
    }

    if (added.length === 0) {
      return { outputString: 'No new classes added (all already in list)', classes: existingClasses };
    }

    // Write back to config file
    const configFile = await writeTestClasses(scope, updatedClasses, flags.branch, resolvedPrId);

    for (const className of added) {
      uxLog('success', this, c.green(t('apexTestClassAddedSuccessfully', { className, scope })));
    }
    uxLog('log', this, c.grey(t('apexTestClassSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: `Added ${added.length} Apex test class(es)`, classes: updatedClasses, added, configFile };
  }
}
