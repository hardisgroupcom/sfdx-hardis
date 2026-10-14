import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../../common/utils/index.js';
import { t } from '../../../../../common/utils/i18n.js';
import {
  ActionScope,
  getActionConfigFilePath,
  readTestClasses,
  resolvePrId,
} from '../../../../../common/utils/actionUtils.js';
import { ActionCommandBase } from '../base.js';
import { getConfig } from '../../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionTestClassList extends ActionCommandBase {
  public static title = 'List deployment Apex test classes';

  public static description = `
## Command Behavior

**Lists the Apex test classes configured for deployment in the project configuration.**

Requires \`enableDeploymentApexTestClasses: true\` in \`config/.sfdx-hardis.yml\`. If the feature is not activated, the command stops with an error.

Displays the list of \`deploymentApexTestClasses\` for the specified scope (project, branch, or PR).

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:test-class:list --agent --scope project
\`\`\`

Required in agent mode:

- \`--scope\`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads \`deploymentApexTestClasses\` from the YAML config file at the given scope.
- Supports \`--json\` output via SfCommand.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:test-class:list',
    '$ sf hardis:project:action:test-class:list --agent --scope project',
    '$ sf hardis:project:action:test-class:list --scope pr --pr-id 123 --json',
  ];

  public static flags: any = {
    scope: Flags.string({
      options: ['project', 'branch', 'pr'],
      description: 'Configuration scope: project, branch, or pr',
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
    const { flags } = await this.parse(ActionTestClassList);
    const agentMode = flags.agent === true;

    // Stop if enableDeploymentApexTestClasses is not activated
    const projectConfig = await getConfig('project');
    if (!projectConfig.enableDeploymentApexTestClasses) {
      throw new SfError(t('deploymentApexTestClassesNotActivated'));
    }

    // Collect scope
    const scope: ActionScope = agentMode
      ? this.requireFlag(flags.scope, 'scope') as ActionScope
      : flags.scope || await this.promptSelect(t('selectActionScope'), [
        { title: t('actionScopeProject'), value: 'project', description: t('actionScopeProjectDesc') },
        { title: t('actionScopeBranch'), value: 'branch', description: t('actionScopeBranchDesc') },
        { title: t('actionScopePr'), value: 'pr', description: t('actionScopePrDesc') },
      ]);

    // Resolve PR ID if scope is pr
    const resolvedPrId = scope === 'pr' ? await resolvePrId(this, flags['pr-id'], agentMode) : flags['pr-id'];

    // Read test classes
    const classes = await readTestClasses(scope, flags.branch, resolvedPrId);
    const configFile = await getActionConfigFilePath(scope, flags.branch, resolvedPrId);

    uxLog('action', this, c.cyan(t('testClassListHeader', { scope })));

    if (classes.length === 0) {
      uxLog('log', this, c.grey(t('noApexTestClassesConfigured', { scope })));
      return { outputString: 'No Apex test classes configured', classes: [], configFile };
    }

    for (let i = 0; i < classes.length; i++) {
      uxLog('log', this, c.white(`  ${i + 1}. ${classes[i]}`));
    }
    uxLog('log', this, c.grey(t('actionSavedToFile', { file: configFile })));

    return { outputString: `Found ${classes.length} Apex test class(es)`, classes, configFile };
  }
}
