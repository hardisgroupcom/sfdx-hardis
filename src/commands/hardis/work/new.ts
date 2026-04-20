/* jscpd:ignore-start */
import { SfCommand, Flags, optionalHubFlagWithDeprecations, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import {
  checkGitClean,
  ensureGitBranch,
  execCommand,
  execSfdxJson,
  getGitRepoUrl,
  gitCheckOutRemote,
  gitPull,
  uxLog,
} from '../../../common/utils/index.js';
import { selectTargetBranch } from '../../../common/utils/gitUtils.js';
import {
  initApexScripts,
  initOrgData,
  initOrgMetadatas,
  initPermissionSetAssignments,
  installPackages,
  makeSureOrgIsConnected,
  promptOrg,
} from '../../../common/utils/orgUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { CONSTANTS, getConfig, setConfig } from '../../../config/index.js';
import SandboxCreate from '../org/create.js';
import ScratchCreate from '../scratch/create.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class NewTask extends SfCommand<any> {
  public static title = 'New User Story';

  public static description = `
## Command Behavior

**Assisted menu to start working on a Salesforce User Story, streamlining the setup of your development environment.**

This command guides you through the process of preparing your local environment and a Salesforce org for a new development or configuration based User Story. It automates several steps, ensuring consistency and adherence to project standards.

Key features include:

- **Git Branch Management:** Ensures your local Git repository is up-to-date with the target branch and creates a new Git branch with a formatted name based on your User Story details. Branch naming conventions can be customized via the \`branchPrefixChoices\` property in \`.sfdx-hardis.yml\`.

- **Org Provisioning & Initialization:** Facilitates the creation and initialization of either a scratch org or a source-tracked sandbox. The configuration for org initialization (e.g., package installation, source push, permission set assignments, Apex script execution, data loading) can be defined in \`config/.sfdx-hardis.yml\

- **Project-Specific Configuration:** Supports defining multiple target branches (\`availableTargetBranches\`) and projects (\`availableProjects\`) in \`.sfdx-hardis.yml\`, allowing for tailored User Stories workflows.

- **User Story Name Validation:** Enforces User Story name formatting using \`newTaskNameRegex\` and provides examples via \`newTaskNameRegexExample\

- **Shared Development Sandboxes:** Accounts for scenarios with shared development sandboxes, adjusting prompts to prevent accidental overwrites.

- **Agent Mode (\`--agent\`):** Enables a fully non-interactive execution path for AI agents and automation. In this mode, all required decisions must be provided as flags and are validated at command start with explicit error messages listing missing inputs and available options.

### Agent Mode Invocation

Use \`--agent\` to disable all prompts. Typical usage:

\`sf hardis:work:new --agent --task-name "MYPROJECT-123 My Story" --target-branch integration --target-org my-org@example.com\`

Required in agent mode:

- \`--task-name\`
- \`--target-branch\`

In \`--agent\` mode, org type is computed automatically:

- \`currentOrg\` when \`allowedOrgTypes\` is missing
- \`currentOrg\` when \`allowedOrgTypes\` only contains \`sandbox\`
- otherwise first value of \`allowedOrgTypes\`

In \`--agent\` mode, the command also computes automatically:

- branch prefix: first configured branch prefix choice, fallback \`feature\`
- scratch mode: always create a new scratch org

In \`--agent\` mode, the command intentionally skips:

- sandbox initialization
- updating default target branch in user config

In \`--agent\` mode, opening org in browser is optional via \`--open-org\`.

Advanced instructions are available in the [Create New User Story documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-create-new-task/).

<details markdown="1">
<summary>Technical explanations</summary>

The command's logic orchestrates various underlying processes:

- **Git Operations:** Utilizes \`checkGitClean\`, \`ensureGitBranch\`, \`gitCheckOutRemote\`, and \`git().pull()\` to manage Git repository state and branches.
- **Interactive Prompts:** Leverages the \`prompts\` library to gather user input for User Story type, source types, and User Story names.
- **Configuration Management:** Reads and applies project-specific configurations from \`.sfdx-hardis.yml\` using \`getConfig\` and \`setConfig\
- **Org Initialization Utilities:** Calls a suite of utility functions for org setup, including \`initApexScripts\`, \`initOrgData\`, \`initOrgMetadatas\`, \`initPermissionSetAssignments\`, \`installPackages\`, and \`makeSureOrgIsConnected\
- **Salesforce CLI Interaction:** Executes Salesforce CLI commands (e.g., \`sf config set target-org\`, \`sf org open\`, \`sf project delete tracking\`) via \`execCommand\` and \`execSfdxJson\
- **Dynamic Org Selection:** Presents choices for scratch orgs or sandboxes based on project configuration and existing orgs, dynamically calling \`ScratchCreate.run\` or \`SandboxCreate.run\` as needed.
- **WebSocket Communication:** Sends refresh status messages via \`WebSocketClient.sendRefreshStatusMessage()\` to update connected VS Code clients.
</details>
`;

  public static examples = ['$ sf hardis:work:new'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'task-name': Flags.string({
      description: 'Task name used in created branch name',
    }),
    'target-branch': Flags.string({
      description: 'Target branch to branch from',
    }),
    'open-org': Flags.boolean({
      default: false,
      description: 'Open the selected org in browser',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-dev-hub': optionalHubFlagWithDeprecations,
    'target-org': optionalOrgFlagWithDeprecations
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected targetBranch: string;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(NewTask);
    this.debugMode = flags.debug || false;

    const config = await getConfig('project');
    const agentMode = flags.agent === true;
    const agentInputs = agentMode ? await this.validateAgentInputs(flags, config) : null;

    uxLog("action", this, c.cyan(t('creatingNewUserStoryDevOrConfig')));
    if (!agentMode) {
      uxLog("log", this, c.grey(t('whenUnsurePressEnterToUseThe')));
    }

    // Make sure the git status is clean, to not delete uncommitted updates
    await checkGitClean({ allowStash: true });

    this.targetBranch = agentMode
      ? agentInputs.targetBranch
      : (flags['target-branch'] || await selectTargetBranch());

    const defaultBranchPrefixChoices = [
      {
        title: t('choiceBranchFeature'),
        value: 'feature',
        description: t('branchPrefixFeatureDescription'),
      },
      {
        title: t('choiceBranchFix'),
        value: 'fix',
        description: t('branchPrefixFixDescription'),
      },
    ];
    const branchPrefixChoices = config.branchPrefixChoices || defaultBranchPrefixChoices;

    // Select project if multiple projects are defined in availableProjects .sfdx-hardis.yml property
    let projectBranchPart = '';
    const availableProjects = config.availableProjects || [];
    if (!agentMode && availableProjects.length > 1) {
      const projectResponse = await prompts({
        type: 'select',
        name: 'project',
        message: c.cyanBright(t('pleaseSelectTheProjectYourUserStory')),
        description: t('chooseWhichProjectWorkItemBelongsTo'),
        placeholder: t('selectAProject'),
        choices: availableProjects.map((project: string) => {
          return {
            title: project.includes(',') ? project.split(',').join(' - ') : project,
            value: project.includes(',') ? project.split(',')[0] : project,
          };
        }),
      });
      projectBranchPart = projectResponse.project + '/';
    }

    // Request info to build branch name. ex features/config/MYTASK
    const response = agentMode
      ? { branch: agentInputs.branchPrefix }
      : await prompts([
        {
          type: 'select',
          name: 'branch',
          message: c.cyanBright(t('whatTypeOfUserStoryDoYou')),
          description: t('selectCategoryOfWorkForUserStory'),
          placeholder: t('selectUserStoryType'),
          initial: 0,
          choices: branchPrefixChoices,
        },
      ]);

    // Request task name
    const taskName = agentMode
      ? agentInputs.normalizedTaskName
      : flags['task-name']
        ? this.normalizeTaskName(flags['task-name'])
        : await this.promptTaskName(config.newTaskNameRegex || null, config.newTaskNameRegexExample || null);
    this.validateTaskNameOrThrow(taskName, config.newTaskNameRegex || null, config.newTaskNameRegexExample || null);

    // Checkout development main branch
    const branchName = `${projectBranchPart}${response.branch || 'feature'}/${taskName}`;
    const repoUrl = await getGitRepoUrl();
    uxLog(
      "action",
      this,
      c.cyan(t('checkingOutLatestVersionOfBranch', { branch: c.bold(this.targetBranch), repoUrl }))
    );
    await gitCheckOutRemote(this.targetBranch);
    // Pull latest version of target branch
    await gitPull();
    // Create new branch
    uxLog("action", this, c.cyan(t('creatingNewBranch', { branchName: c.green(branchName) })));
    await ensureGitBranch(branchName);
    // Update config if necessary
    if (config.developmentBranch !== this.targetBranch && (config.availableTargetBranches || null) == null) {
      let shouldUpdateDefaultTargetBranch = false;
      if (agentMode) {
        shouldUpdateDefaultTargetBranch = false;
      } else {
        const updateDefaultBranchRes = await prompts({
          type: 'confirm',
          name: 'value',
          message: c.cyanBright(t('doYouWantToUpdateDefaultTargetBranch', { branch: c.green(this.targetBranch) })),
          description: t('setAsDefaultTargetForFutureWorkItems'),
          default: false,
        });
        shouldUpdateDefaultTargetBranch = updateDefaultBranchRes.value === true;
      }
      if (shouldUpdateDefaultTargetBranch) {
        await setConfig('user', { developmentBranch: this.targetBranch });
      }
    }
    // Update local user config files to store the target of the just created branch
    const currentUserConfig = await getConfig('user');
    const localStorageBranchTargets = currentUserConfig.localStorageBranchTargets || {};
    localStorageBranchTargets[branchName] = this.targetBranch;
    await setConfig('user', { localStorageBranchTargets: localStorageBranchTargets });

    // Get allowed work org types from config if possible
    const allowedOrgTypes = config?.allowedOrgTypes || [];
    let selectedOrgType = allowedOrgTypes.length == 1 ? allowedOrgTypes[0] : null;
    // If necessary, Prompt if you want to use a scratch org or a tracked sandbox org, or no org
    const orgTypeChoices: any[] = [];
    if (allowedOrgTypes.includes('sandbox') || allowedOrgTypes.length === 0) {
      orgTypeChoices.push({
        title: t('choiceSandboxOrgWithSourceTracking'),
        value: 'sandbox',
        description: t('workInDeveloperSandboxDescription'),
      });
    }
    if (allowedOrgTypes.includes('scratch') || allowedOrgTypes.length === 0) {
      orgTypeChoices.push({
        title: t('choiceScratchOrg'),
        value: 'scratch',
        description: t('scratchOrgsConfiguredCreateOrReuse'),
      });
    }
    if (flags['target-org'] && flags['target-org']?.getConnection()) {
      orgTypeChoices.push({
        title: `😎 Current org ${flags['target-org']?.getConnection().instanceUrl.replace("https://", "")}`,
        value: 'currentOrg',
        description: t('useYourDefaultOrgWithUsername', { username: flags['target-org']?.getUsername() }),
      });
    }
    orgTypeChoices.push({
      title: t('choiceHardcoreNoOrg'),
      value: 'noOrg',
      description: t('workWithXmlAndSfdxHardisConfigOnly'),
    });
    if (agentMode) {
      selectedOrgType = agentInputs.selectedOrgType;
    } else {
      const orgTypeResponse = await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(t('whichSalesforceOrgDoYouWantToWorkIn')),
        description: t('chooseTypeOfSalesforceOrgForWork'),
        placeholder: t('selectOrgType'),
        initial: 0,
        choices: orgTypeChoices,
      });
      selectedOrgType = orgTypeResponse.value;
    }

    let selectedOrgInfo: { username?: string; instanceUrl?: string } | null = null;

    // Select or create org that user will work in
    if (selectedOrgType === 'scratch') {
      // scratch org
      selectedOrgInfo = await this.selectOrCreateScratchOrg(branchName, flags, agentInputs);
    } else if (selectedOrgType === 'sandbox' || selectedOrgType === 'currentOrg') {
      // source tracked sandbox
      selectedOrgInfo = await this.selectOrCreateSandbox(branchName, config, flags, selectedOrgType, agentInputs);
    } else {
      uxLog("warning", this, c.yellow(t('noOrgSelectedEnsureYouKnow')));
    }

    uxLog("action", this, c.cyan(t('readyToWorkInBranch', { branchName: c.green(branchName) })));
    if (selectedOrgInfo?.username) {
      uxLog("log", this, c.cyan(t('useYourDefaultOrgWithUsername', { username: c.green(selectedOrgInfo.username) })));
    }
    if (selectedOrgInfo?.instanceUrl) {
      uxLog("log", this, c.cyan(t('yourCurrentOrgUrlIs', { url: selectedOrgInfo.instanceUrl })));
    }
    // Return an object to be displayed with --json
    return { outputString: 'Created new User Story' };
  }

  private validateTaskNameOrThrow(taskName: string, validationRegex: string | null, taskNameExample: string | null): void {
    const effectiveTaskNameExample = taskNameExample || 'MYPROJECT-123 Update account status validation rule';
    if (validationRegex != null && !new RegExp(validationRegex).test(taskName)) {
      throw new SfError(
        `task-name "${taskName}" does not match required pattern (${validationRegex}). Example: ${effectiveTaskNameExample}`
      );
    }
  }

  private buildAgentUsageHelp(): string {
    return [
      'Agent mode usage:',
      '  --agent',
      '  --task-name <name>',
      '  --target-branch <branch>',
      '  --open-org (optional, opens org in browser when set)',
      '  branch-prefix is auto-selected in --agent mode: first configured prefix, else feature',
      '  project is never used in --agent mode',
      '  org-type is auto-selected in --agent mode: currentOrg when allowedOrgTypes is missing or starts with sandbox, else first allowedOrgTypes value',
      '  scratch mode is auto-selected in --agent mode: always new',
      'In --agent mode, sandbox init and updating default target branch are always skipped.',
    ].join('\n');
  }

  private computeAgentBranchPrefix(config: any): string {
    const defaultBranchPrefixChoices = [
      {
        title: t('choiceBranchFeature'),
        value: 'feature',
        description: t('branchPrefixFeatureDescription'),
      },
      {
        title: t('choiceBranchFix'),
        value: 'fix',
        description: t('branchPrefixFixDescription'),
      },
    ];
    const branchPrefixChoices = config.branchPrefixChoices || defaultBranchPrefixChoices;
    return branchPrefixChoices[0]?.value || 'feature';
  }

  private computeAgentOrgType(config: any): 'scratch' | 'sandbox' | 'currentOrg' | 'noOrg' {
    const allowedOrgTypes = config?.allowedOrgTypes || [];
    if (!Array.isArray(allowedOrgTypes) || allowedOrgTypes.length === 0) {
      return 'currentOrg';
    }
    if (allowedOrgTypes[0] === 'sandbox') {
      return 'currentOrg';
    }
    if (Array.isArray(allowedOrgTypes) && allowedOrgTypes.length > 0) {
      return allowedOrgTypes[0];
    }
    return 'currentOrg';
  }

  private parseProjectValue(project: string): string {
    return project.includes(',') ? project.split(',')[0] : project;
  }

  private toOptionList(items: string[]): string {
    return items.length > 0 ? items.join(', ') : '(none)';
  }

  private throwAgentValidationError(missing: string[], availableOptions: string[]): never {
    const missingBlock = missing.length > 0 ? missing.map((m) => `- ${m}`).join('\n') : '- (none)';
    const optionsBlock = availableOptions.length > 0 ? availableOptions.map((o) => `- ${o}`).join('\n') : '- (none)';
    throw new SfError(
      `Invalid --agent invocation.\n\nMissing or invalid inputs:\n${missingBlock}\n\nAvailable options:\n${optionsBlock}\n\n${this.buildAgentUsageHelp()}`
    );
  }

  private normalizeTaskName(taskName: string): string {
    let normalizedTaskName = taskName.replace(/[^a-zA-Z0-9 -]|\s/g, '-');
    normalizedTaskName = normalizedTaskName.replace(/-+/g, '-');
    normalizedTaskName = normalizedTaskName.replace(/^-+|-+$/g, '');
    return normalizedTaskName;
  }

  private async validateAgentInputs(flags: any, config: any): Promise<any> {
    const missing: string[] = [];
    const available: string[] = [];

    const defaultBranchPrefixChoices = [
      {
        title: t('choiceBranchFeature'),
        value: 'feature',
        description: t('branchPrefixFeatureDescription'),
      },
      {
        title: t('choiceBranchFix'),
        value: 'fix',
        description: t('branchPrefixFixDescription'),
      },
    ];

    const branchPrefixChoices = config.branchPrefixChoices || defaultBranchPrefixChoices;
    const availableBranchPrefixes = branchPrefixChoices.map((choice: any) => choice.value);
    const branchPrefix = this.computeAgentBranchPrefix(config);
    available.push(`branch-prefix: auto-selected as ${branchPrefix} from ${this.toOptionList(availableBranchPrefixes)}`);

    const availableTargetBranches = [
      ...(Array.isArray(config.availableTargetBranches) ? config.availableTargetBranches : []),
      ...(config.developmentBranch ? [config.developmentBranch] : []),
    ].filter((value: string, index: number, self: string[]) => value && self.indexOf(value) === index);
    available.push(`target-branch: ${this.toOptionList(availableTargetBranches)}`);

    const availableProjects = (config.availableProjects || []).map((project: string) => this.parseProjectValue(project));
    if (availableProjects.length > 0) {
      available.push(`project: ignored in --agent mode. Configured values: ${this.toOptionList(availableProjects)}`);
    }

    const orgType = this.computeAgentOrgType(config);
    available.push(`org-type: auto-selected as ${orgType}`);

    const taskNameRaw = flags['task-name'];
    if (!taskNameRaw) {
      missing.push('task-name is required with --agent');
    }
    let targetBranch = flags['target-branch'];
    if (!targetBranch) {
      if (availableTargetBranches.length === 1) {
        targetBranch = availableTargetBranches[0];
      } else {
        missing.push(`target-branch is required with --agent. Available: ${this.toOptionList(availableTargetBranches)}`);
      }
    } else if (availableTargetBranches.length === 0) {
      missing.push(
        `target-branch="${targetBranch}" cannot be validated: availableTargetBranches is not configured in .sfdx-hardis.yml (usually set to [integration] or [integration,preprod])`
      );
    } else if (!availableTargetBranches.includes(targetBranch)) {
      missing.push(
        `target-branch="${targetBranch}" is not in availableTargetBranches. Available: ${this.toOptionList(availableTargetBranches)}`
      );
    }

    const taskNameExample = config.newTaskNameRegexExample || 'MYPROJECT-123 Update account status validation rule';
    const normalizedTaskName = this.normalizeTaskName(taskNameRaw || '');
    if (!normalizedTaskName) {
      missing.push('task-name produced an empty normalized value');
    }
    if (config.newTaskNameRegex && normalizedTaskName && !new RegExp(config.newTaskNameRegex).test(normalizedTaskName)) {
      missing.push(
        `task-name does not match newTaskNameRegex (${config.newTaskNameRegex}). Example: ${taskNameExample}`
      );
    }

    if (orgType === 'scratch') {
      available.push('scratch-mode: auto-selected as new');
    }
    available.push(`open-org: ${flags['open-org'] === true ? 'enabled' : 'disabled'}`);

    if (orgType === 'currentOrg' && !flags['target-org']?.getUsername()) {
      missing.push('target-org is required because selected org-type is currentOrg');
    }

    if (missing.length > 0) {
      this.throwAgentValidationError(missing, available);
    }

    return {
      taskNameRaw,
      normalizedTaskName,
      branchPrefix,
      targetBranch,
      project: null,
      selectedOrgType: orgType,
      scratchMode: 'new',
      scratchOrgUsername: null,
      sandboxOrgUsername: null,
      initSandbox: false,
      openOrg: flags['open-org'] === true,
      updateDefaultTargetBranch: false,
    };
  }

  async promptTaskName(validationRegex: string | null, taskNameExample: string | null) {
    if (taskNameExample == null) {
      taskNameExample = 'MYPROJECT-123 Update account status validation rule';
    }
    const taskResponse = await prompts({
      type: 'text',
      name: 'taskName',
      message: c.cyanBright(t('whatIsNameOfNewUserStory')),
      description: t('enterDescriptiveNameForUserStoryBranch'),
      placeholder: `Ex: ${taskNameExample}`,
    });
    let taskName = taskResponse.taskName.replace(/[^a-zA-Z0-9 -]|\s/g, '-');
    // If there are multiple "-" , replace by single "-", otherwise it messes with mermaid diagrams
    taskName = taskName.replace(/-+/g, '-');
    if (validationRegex != null && !new RegExp(validationRegex).test(taskName)) {
      uxLog(
        "warning",
        this,
        c.yellow(t('userStoryNameDoesNotMatchPattern', { taskName: c.bold(taskName), validationRegex: c.bold(validationRegex) }))
      );
      return this.promptTaskName(validationRegex, taskNameExample);
    }
    return taskName;
  }

  // Select/Create scratch org
  async selectOrCreateScratchOrg(branchName, flags, agentInputs: any = null): Promise<{ username?: string; instanceUrl?: string } | null> {
    if (agentInputs) {
      const config = await getConfig();
      if (!config.devHubAlias) {
        throw new SfError(
          'No DevHub is currently selected. Please authenticate and select a DevHub first (e.g. sf hardis:auth:login --devhub), then retry.'
        );
      }
      await setConfig('user', {
        scratchOrgAlias: null,
        scratchOrgUsername: null,
      });
      const createResult = await ScratchCreate.run(['--forcenew', '--targetdevhubusername', config.devHubAlias]);
      if (createResult == null) {
        throw new SfError('Unable to create scratch org');
      }
      const currentScratchOrg = await MetadataUtils.getCurrentOrg();
      return currentScratchOrg
        ? { username: currentScratchOrg.username, instanceUrl: currentScratchOrg.instanceUrl }
        : null;
    }

    const hubOrgUsername = flags['target-dev-hub'].getUsername();
    const scratchOrgList = await MetadataUtils.listLocalOrgs('scratch', { devHubUsername: hubOrgUsername });
    const currentOrg = await MetadataUtils.getCurrentOrg();

    const baseChoices = [
      {
        title: c.yellow(t('createNewScratchOrg')),
        value: 'newScratchOrg',
        description: t('generateNewScratchOrgReady'),
      },
    ];
    if (currentOrg) {
      baseChoices.push({
        title: c.yellow(t('reuseCurrentOrg')),
        value: currentOrg,
        description: t('reuseCurrentOrgBewareConflicts', { instanceUrl: currentOrg.instanceUrl }),
      });
    }
    const scratchResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('selectScratchOrgForBranch', { branchName: c.green(branchName) })),
      description: t('chooseCreateOrReuseScratchOrg'),
      placeholder: t('selectScratchOrgOption'),
      initial: 0,
      choices: [
        ...baseChoices,
        ...scratchOrgList.map((scratchOrg: any) => {
          return {
            title: t('reuseScratchOrgAlias', { alias: c.yellow(scratchOrg.alias) }),
            description: scratchOrg.instanceUrl,
            value: scratchOrg,
          };
        }),
      ],
    });
    if (scratchResponse.value === 'newScratchOrg') {
      await setConfig('user', {
        scratchOrgAlias: null,
        scratchOrgUsername: null,
      });
      // Check if DevHub is connected
      await this.config.runHook('auth', {
        Command: this,
        devHub: true,
        scratch: false,
      });
      // Create scratch org
      const config = await getConfig();
      const createResult = await ScratchCreate.run(['--forcenew', '--targetdevhubusername', config.devHubAlias]);
      if (createResult == null) {
        throw new SfError('Unable to create scratch org');
      }
      const currentScratchOrg = await MetadataUtils.getCurrentOrg();
      return currentScratchOrg
        ? { username: currentScratchOrg.username, instanceUrl: currentScratchOrg.instanceUrl }
        : null;
    } else {
      // Set selected org as default org
      await execCommand(`sf config set target-org=${scratchResponse.value.username}`, this, {
        output: true,
        fail: true,
      });
      uxLog(
        "action",
        this,
        c.cyan(
          `Selected scratch org ${c.green(scratchResponse.value.instanceUrl)} with user ${c.green(
            scratchResponse.value.username
          )}`
        )
      );
      // Open selected org
      uxLog("action", this, c.cyan(t('openingScratchOrgInBrowser')));
      await execSfdxJson('sf org open', this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      // Trigger a status refresh on VS Code WebSocket Client
      WebSocketClient.sendRefreshStatusMessage();
      return {
        username: scratchResponse.value.username,
        instanceUrl: scratchResponse.value.instanceUrl,
      };
    }
    return null;
  }

  // Select or create sandbox
  async selectOrCreateSandbox(branchName, config, flags, selectedOrgType: 'sandbox' | 'currentOrg', agentInputs: any = null): Promise<{ username?: string; instanceUrl?: string } | null> {
    let openOrg = false;
    let orgUsername = '';
    let orgInstanceUrl: string | undefined;
    if (selectedOrgType === 'currentOrg') {
      openOrg = true;
      orgUsername = flags['target-org'].getUsername();
      orgInstanceUrl = flags['target-org']?.getConnection()?.instanceUrl;
      await makeSureOrgIsConnected(orgUsername);
    } else {
      const promptRes = await this.promptSandbox(flags, branchName);
      orgUsername = promptRes.orgUsername;
      orgInstanceUrl = promptRes.instanceUrl;
      openOrg = promptRes.openOrg;
    }

    // Initialize / Update existing sandbox if available
    if (!(config.sharedDevSandboxes === true)) {
      let initSandbox = false;
      if (agentInputs) {
        initSandbox = agentInputs.initSandbox === true;
      } else {
        const initSandboxResponse = await prompts({
          type: 'select',
          name: 'value',
          message: c.cyanBright(t('doYouWantToUpdateSandboxToMatchBranch', { branch: this.targetBranch })),
          description: t('chooseSyncSandboxWithLatestChanges'),
          placeholder: t('selectSyncOption'),
          choices: [
            {
              title: t('continueWorkingOnCurrentSandboxState'),
              value: 'no',
              description: t('useIfMultipleUsersShareSandbox'),
            },
            {
              title: t('yesUpdateMySandbox'),
              value: 'init',
              description: t('integrateNewUpdatesFromParentBranch', { targetBranch: this.targetBranch }),
            },
          ],
        });
        initSandbox = initSandboxResponse.value === 'init';
        // Ask the user if he's really sure of what he's doing !
        if (initSandbox) {
          const promptConfirm = await prompts({
            type: 'confirm',
            message: c.cyanBright(t('confirmUpdateDevSandboxWithBranchState', { branch: this.targetBranch })),
            description: t('confirmResetSandboxToMatchTargetBranch'),
          });
          initSandbox = promptConfirm.value === true;
        }
      }

      if (initSandbox) {
        let initSourcesErr: any = null;
        let initSandboxErr: any = null;
        try {
          if (config.installedPackages) {
            await installPackages(config.installedPackages || [], orgUsername);
          }
          try {
            // Continue initialization even if push did not work... it could work and be not such a problem 😊
            uxLog("action", this, c.cyan(t('resettingLocalSfCliTracking')));
            await execCommand(`sf project delete tracking --no-prompt -o ${orgUsername}`, this, {
              fail: false,
              output: true,
            });
            await initOrgMetadatas(config, orgUsername, orgUsername, {}, this.debugMode, { scratch: false });
          } catch (e1) {
            initSourcesErr = e1;
          }
          await initPermissionSetAssignments(config.initPermissionSets || [], orgUsername);
          await initApexScripts(config.scratchOrgInitApexScripts || [], orgUsername);
          await initOrgData(path.join('.', 'scripts', 'data', 'ScratchInit'), orgUsername);
        } catch (e) {
          initSandboxErr = e;
        }
        if (initSandboxErr) {
          uxLog(
            "log",
            this,
            c.grey('Error(s) while initializing sandbox: ' + initSandboxErr.message + '\n' + initSandboxErr.stack)
          );
          uxLog(
            "warning",
            this,
            c.yellow(
              'Sandbox may not be fully initialized from git. Share the error above with your release manager.'
            )
          );
        }
        if (initSourcesErr) {
          uxLog(
            "log",
            this,
            c.grey('Error(s) while pushing sources to sandbox: ' + initSourcesErr.message + '\n' + initSourcesErr.stack)
          );
          uxLog(
            "warning",
            this,
            c.yellow(`To sync sandbox with branch ${c.bold(this.targetBranch)}:
  - ${c.bold(
              'Fix the errors'
            )} (manually update target sandbox in setup), then run "New User Story" again with same sandbox
  - ${c.bold('Refresh your sandbox')} (contact release manager if needed)
  Otherwise, start working now (beware of potential conflicts)
        `)
          );
        }
      }
    }
    // Open of if not already open
    if (openOrg === true) {
      let shouldOpenOrg = false;
      if (agentInputs) {
        shouldOpenOrg = agentInputs.openOrg === true;
      } else {
        const openOrgRes = await prompts({
          type: 'confirm',
          name: 'value',
          message: c.cyanBright(t('doYouWantToOpenOrgIn', { orgUsername: c.green(orgUsername) })),
          description: t('openTheSandboxOrgInYourWebBrowser'),
          initial: true
        });
        shouldOpenOrg = openOrgRes.value === true;
      }

      if (shouldOpenOrg) {
        uxLog("action", this, c.cyan(t('openingOrg', { orgUsername: c.green(orgUsername) })));
        await execSfdxJson('sf org open', this, {
          fail: true,
          output: false,
          debug: this.debugMode,
        });
      }
    }

    // Trigger a status refresh on VS Code WebSocket Client
    WebSocketClient.sendRefreshStatusMessage();
    return {
      username: orgUsername || undefined,
      instanceUrl: orgInstanceUrl,
    };
  }

  private async promptSandbox(flags: any, branchName: any) {
    const hubOrgUsername = flags['target-dev-hub']?.getUsername();
    const sandboxOrgList = await MetadataUtils.listLocalOrgs('devSandbox', { devHubUsername: hubOrgUsername });
    const defaultSandbox = sandboxOrgList.find((org: any) => {
      return org.username === flags['target-org']?.getUsername();
    });
    const sandboxResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('selectSandboxOrgToWorkInBranch', { branchName: c.green(branchName) })),
      description: t('chooseExistingSandboxOrConnectNew'),
      placeholder: t('selectSandbox'),
      default: defaultSandbox ? defaultSandbox : undefined,
      choices: [
        ...[
          {
            title: c.yellow('🌐 ' + t('connectToSandboxNotInList')),
            description: t('connectToSandboxNotInListDescription'),
            value: 'connectSandbox',
          },
          /* {
            title: c.yellow("Create new sandbox from another sandbox or production org (ALPHA -> UNSTABLE, DO NOT USE YET)"),
            value: "newSandbox",
          }, */
        ],
        ...sandboxOrgList.map((sandboxOrg: any) => {
          return {
            title: sandboxOrg.instanceUrl,
            description: `☁️ ${t('useSandboxOrg', { sandbox: c.yellow(sandboxOrg.username || sandboxOrg.alias) })}`,
            value: sandboxOrg,
          };
        }),
      ],
    });
    // Remove scratch org info in user config if necessary
    const config = await getConfig("user");
    if (config.scratchOrgAlias || config.scratchOrgUsername) {
      await setConfig('user', {
        scratchOrgAlias: null,
        scratchOrgUsername: null,
      });
    }

    // Connect to a sandbox
    let orgUsername = '';
    let openOrg = false;
    let instanceUrl: string | undefined;
    if (sandboxResponse.value === 'connectSandbox') {
      const slctdOrg = await promptOrg(this, { setDefault: true, devSandbox: true });
      orgUsername = slctdOrg.username;
      instanceUrl = slctdOrg.instanceUrl;
    }

    // Create a new sandbox ( NOT WORKING YET, DO NOT USE)
    else if (sandboxResponse.value === 'newSandbox') {
      const createResult = await SandboxCreate.run();
      if (createResult == null) {
        throw new SfError('Unable to create sandbox org');
      }
      orgUsername = (createResult as any).username;
      instanceUrl = (createResult as any).instanceUrl;
    }

    // Selected sandbox from list
    else {
      await makeSureOrgIsConnected(sandboxResponse.value);
      uxLog("action", this, c.cyan(t('settingAsDefaultOrg', { sandboxResponse: c.green(sandboxResponse.value.instanceUrl), sandboxResponse1: sandboxResponse.value.username })));
      await execCommand(`sf config set target-org=${sandboxResponse.value.username}`, this, {
        output: true,
        fail: true,
      });
      orgUsername = sandboxResponse.value.username;
      instanceUrl = sandboxResponse.value.instanceUrl;
      openOrg = true;
    }
    return { orgUsername, instanceUrl, openOrg };
  }
}