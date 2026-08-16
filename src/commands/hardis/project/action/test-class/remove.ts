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
import { prompts } from '../../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionTestClassRemove extends ActionCommandBase {
  public static title = 'Remove deployment Apex test class';

  public static description = `
## Command Behavior

**Removes one or more Apex test classes from the deployment test class list for the project configuration.**

Requires \`enableDeploymentApexTestClasses: true\` in \`config/.sfdx-hardis.yml\`. If the feature is not activated, the command stops with an error.

In interactive mode, shows the currently configured test classes and lets the user select which ones to remove.

In agent mode, requires \`--class-name\` (can be specified multiple times) or \`--all-class\` to clear the entire list.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:test-class:remove --agent --scope pr --class-name MyTestClass_Test
sf hardis:project:action:test-class:remove --agent --scope project --all-class
\`\`\`

Required in agent mode:

- \`--scope\`
- \`--class-name\` (one or more) OR \`--all-class\`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes \`deploymentApexTestClasses\` in the YAML config file at the selected scope.
- \`--all-class\` clears the entire list for the given scope.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:test-class:remove',
    '$ sf hardis:project:action:test-class:remove --agent --scope pr --class-name MyTest_Test',
    '$ sf hardis:project:action:test-class:remove --agent --scope pr --class-name FooTest --class-name BarTest',
    '$ sf hardis:project:action:test-class:remove --agent --scope project --all-class',
  ];

  public static flags: any = {
    scope: Flags.string({
      options: ['project', 'branch', 'pr'],
      description: 'Configuration scope: project, branch, or pr',
    }),
    'class-name': Flags.string({
      description: 'Apex test class name(s) to remove (can be specified multiple times)',
      multiple: true,
    }),
    'all-class': Flags.boolean({
      default: false,
      description: 'Remove all Apex test classes from the list (clears the entire list for the scope)',
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
    const { flags } = await this.parse(ActionTestClassRemove);
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

    // Read currently configured test classes
    const existingClasses = await readTestClasses(scope, flags.branch, resolvedPrId);

    if (existingClasses.length === 0) {
      uxLog('log', this, c.grey(t('noApexTestClassesConfigured', { scope })));
      return { outputString: 'No Apex test classes configured', classes: [] };
    }

    // --all-class: clear the entire list
    if (flags['all-class']) {
      const configFile = await writeTestClasses(scope, [], flags.branch, resolvedPrId);
      uxLog('success', this, c.green(t('testClassAllClassesRemoved', { scope })));
      uxLog('log', this, c.grey(t('apexTestClassSavedToFile', { file: configFile })));
      WebSocketClient.sendRefreshPipelineMessage();
      return { outputString: 'All Apex test classes removed', classes: [], configFile };
    }

    let classesToRemove: string[] = [];

    if (agentMode || isCI) {
      // Agent mode: --class-name is required (one or more values)
      const classNameFlag = flags['class-name'];
      if (!classNameFlag || (Array.isArray(classNameFlag) && classNameFlag.length === 0)) {
        throw new SfError(t('missingRequiredFlag', { flag: 'class-name or --all-class' }));
      }
      classesToRemove = Array.isArray(classNameFlag) ? classNameFlag : [classNameFlag];
    } else {
      // Interactive mode: multi-select from configured classes
      const response = await prompts({
        type: 'multiselect',
        name: 'value',
        message: c.cyanBright(t('selectApexTestClassesToRemove')),
        choices: existingClasses.map((cls: string) => ({ title: cls, value: cls })),
        description: t('selectApexTestClassesToRemove'),
      });

      classesToRemove = (response.value || []) as string[];

      if (classesToRemove.length === 0) {
        uxLog('log', this, c.grey('No classes selected. Nothing to do.'));
        return { outputString: 'No classes selected', classes: existingClasses };
      }
    }

    // Remove classes
    const updatedClasses = existingClasses.filter(cls => !classesToRemove.includes(cls));
    const removed = classesToRemove.filter(cls => existingClasses.includes(cls));
    const notFound = classesToRemove.filter(cls => !existingClasses.includes(cls));

    for (const cls of notFound) {
      uxLog('warning', this, c.yellow(`Apex test class ${cls} is not in the list. Skipping.`));
    }

    if (removed.length === 0) {
      return { outputString: 'No classes removed (none found in list)', classes: existingClasses };
    }

    const configFile = await writeTestClasses(scope, updatedClasses, flags.branch, resolvedPrId);

    for (const className of removed) {
      uxLog('success', this, c.green(t('testClassRemovedSuccessfully', { className, scope })));
    }
    uxLog('log', this, c.grey(t('apexTestClassSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: `Removed ${removed.length} Apex test class(es)`, classes: updatedClasses, removed, configFile };
  }
}
