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

    uxLog("action", this, c.cyan('Creating a new User Story (dev or config) with SFDX Hardis CI/CD'));
    uxLog("log", this, c.grey("When unsure, press ENTER to use the default value"));

    // Make sure the git status is clean, to not delete uncommitted updates
    await checkGitClean({ allowStash: true });

    const config = await getConfig('project');

    this.targetBranch = await selectTargetBranch();

    const defaultBranchPrefixChoices = [
      {
        title: '🏗️ Feature',
        value: 'feature',
        description: "New feature, evolution of an existing feature... If you don't know, just select Feature",
      },
      {
        title: '🛠️ Fix',
        value: 'fix',
        description: 'A bug has been identified and you are the right person to solve it !',
      },
    ];
    const branchPrefixChoices = config.branchPrefixChoices || defaultBranchPrefixChoices;

    // Select project if multiple projects are defined in availableProjects .sfdx-hardis.yml property
    let projectBranchPart = '';
    const availableProjects = config.availableProjects || [];
    if (availableProjects.length > 1) {
      const projectResponse = await prompts({
        type: 'select',
        name: 'project',
        message: c.cyanBright('Please select the project your User Story is for'),
        description: 'Choose which project this new work item belongs to',
        placeholder: 'Select a project',
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
    const response = await prompts([
      {
        type: 'select',
        name: 'branch',
        message: c.cyanBright('What type of User Story do you want to create?'),
        description: 'Select the category of work that best describes your User Story',
        placeholder: 'Select User Story type',
        initial: 0,
        choices: branchPrefixChoices,
      },
    ]);

    // Request task name
    const taskName = await this.promptTaskName(config.newTaskNameRegex || null, config.newTaskNameRegexExample || null);

    // Checkout development main branch
    const branchName = `${projectBranchPart}${response.branch || 'feature'}/${taskName}`;
    const repoUrl = await getGitRepoUrl();
    uxLog(
      "action",
      this,
      c.cyan(`Checking out latest version of branch ${c.bold(this.targetBranch)} from ${repoUrl}...`)
    );
    await gitCheckOutRemote(this.targetBranch);
    // Pull latest version of target branch
    await gitPull();
    // Create new branch
    uxLog("action", this, c.cyan(`Creating new branch ${c.green(branchName)}...`));
    await ensureGitBranch(branchName);
    // Update config if necessary
    if (config.developmentBranch !== this.targetBranch && (config.availableTargetBranches || null) == null) {
      const updateDefaultBranchRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(
          `Do you want to update your default target branch to ${c.green(this.targetBranch)}?`
        ),
        description: 'Set this branch as your default target for future work items',
        default: false,
      });
      if (updateDefaultBranchRes.value === true) {
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
        title: '🌎 Sandbox org with source tracking',
        value: 'sandbox',
        description:
          "Work in a developer sandbox provided by your Release Manager",
      });
    }
    if (allowedOrgTypes.includes('scratch') || allowedOrgTypes.length === 0) {
      orgTypeChoices.push({
        title: '🪐 Scratch org',
        value: 'scratch',
        description: 'Scratch orgs are configured on my project so I want to create or reuse one',
      });
    }
    if (flags['target-org'] && flags['target-org']?.getConnection()) {
      orgTypeChoices.push({
        title: `😎 Current org ${flags['target-org']?.getConnection().instanceUrl.replace("https://", "")}`,
        value: 'currentOrg',
        description: `Use your default org with username ${flags['target-org']?.getUsername()}`,
      });
    }
    orgTypeChoices.push({
      title: "🤠 I'm hardcore, I don't need an org !",
      value: 'noOrg',
      description: 'Work with XML and sfdx-hardis configuration only, without a connected org',
    });
    const orgTypeResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(`Which Salesforce org do you want to work in?`),
      description: 'Choose the type of Salesforce org to use for your development work',
      placeholder: 'Select org type',
      initial: 0,
      choices: orgTypeChoices,
    });
    selectedOrgType = orgTypeResponse.value;

    // Select or create org that user will work in
    if (selectedOrgType === 'scratch') {
      // scratch org
      await this.selectOrCreateScratchOrg(branchName, flags);
    } else if (selectedOrgType === 'sandbox' || selectedOrgType === 'currentOrg') {
      // source tracked sandbox
      await this.selectOrCreateSandbox(branchName, config, flags, selectedOrgType);
    } else {
      uxLog("warning", this, c.yellow(`No org selected. Ensure you know what you're doing.`));
    }

    uxLog("action", this, c.cyan(`Ready to work in branch ${c.green(branchName)}`));
    // Return an object to be displayed with --json
    return { outputString: 'Created new User Story' };
  }

  async promptTaskName(validationRegex: string | null, taskNameExample: string | null) {
    if (taskNameExample == null) {
      taskNameExample = 'MYPROJECT-123 Update account status validation rule';
    }
    const taskResponse = await prompts({
      type: 'text',
      name: 'taskName',
      message: c.cyanBright(
        `What is the name of your new User Story? Please avoid accents and special characters.`
      ),
      description: 'Enter a descriptive name for your User Story that will be used in the git branch name',
      placeholder: `Ex: ${taskNameExample}`,
    });
    let taskName = taskResponse.taskName.replace(/[^a-zA-Z0-9 -]|\s/g, '-');
    // If there are multiple "-" , replace by single "-", otherwise it messes with mermaid diagrams
    taskName = taskName.replace(/-+/g, '-');
    if (validationRegex != null && !new RegExp(validationRegex).test(taskName)) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `The User Story name ${c.bold(taskName)} does not match the expected pattern ${c.bold(validationRegex)}. Please try again`
        )
      );
      return this.promptTaskName(validationRegex, taskNameExample);
    }
    return taskName;
  }

  // Select/Create scratch org
  async selectOrCreateScratchOrg(branchName, flags) {
    const hubOrgUsername = flags['target-dev-hub'].getUsername();
    const scratchOrgList = await MetadataUtils.listLocalOrgs('scratch', { devHubUsername: hubOrgUsername });
    const currentOrg = await MetadataUtils.getCurrentOrg();
    const baseChoices = [
      {
        title: c.yellow('🆕 Create new scratch org'),
        value: 'newScratchOrg',
        description: "Generate a new scratch org; you'll be ready to work in a few minutes",
      },
    ];
    if (currentOrg) {
      baseChoices.push({
        title: c.yellow(`♻️ Reuse current org`),
        value: currentOrg,
        description: `Reuse current org ${currentOrg.instanceUrl}. Beware of conflicts if others have merged changes.`,
      });
    }
    const scratchResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(`Select a scratch org for branch ${c.green(branchName)}`),
      description: 'Choose whether to create a new scratch org or reuse an existing one',
      placeholder: 'Select scratch org option',
      initial: 0,
      choices: [
        ...baseChoices,
        ...scratchOrgList.map((scratchOrg: any) => {
          return {
            title: `☁️ Reuse scratch org ${c.yellow(scratchOrg.alias)}`,
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
      uxLog("action", this, c.cyan('Opening scratch org in browser...'));
      await execSfdxJson('sf org open', this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      // Trigger a status refresh on VS Code WebSocket Client
      WebSocketClient.sendRefreshStatusMessage();
    }
  }

  // Select or create sandbox
  async selectOrCreateSandbox(branchName, config, flags, selectedOrgType: "sandbox" | "currentOrg") {
    let openOrg = false;
    let orgUsername = "";
    if (selectedOrgType === "currentOrg") {
      openOrg = true;
      orgUsername = flags['target-org'].getUsername();
      await makeSureOrgIsConnected(orgUsername);
    }
    else {
      const promptRes = await this.promptSandbox(flags, branchName);
      orgUsername = promptRes.orgUsername;
      openOrg = promptRes.openOrg;
    }

    // Initialize / Update existing sandbox if available
    if (!(config.sharedDevSandboxes === true)) {
      const initSandboxResponse = await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(
          `Do you want to update the sandbox to match branch "${this.targetBranch}" current state?`
        ),
        description: 'Choose whether to sync your sandbox with the latest changes from the target branch (packages, sources, permission sets, apex scripts, initial data)',
        placeholder: 'Select sync option',
        choices: [
          {
            title: '🧑‍🤝‍🧑 No, continue working on my current sandbox state',
            value: 'no',
            description: 'Use if multiple users share the same sandbox, or if you have uncommitted changes',
          },
          {
            title: '☢️ Yes, please try to update my sandbox !',
            value: 'init',
            description: `Integrate new updates from the parent branch "${this.targetBranch}" before working on your new User Story. WARNING: Will overwrite uncommitted changes in your org !`,
          },
        ],
      });
      let initSandbox = initSandboxResponse.value === 'init';
      // Ask the user if he's really sure of what he's doing !
      if (initSandbox) {
        const promptConfirm = await prompts({
          type: 'confirm',
          message: c.cyanBright(
            `Confirm: Update dev sandbox with branch ${this.targetBranch} state? This will overwrite uncommitted changes by you or other users.`
          ),
          description: 'Confirm that you want to reset your sandbox to match the target branch state',
        });
        initSandbox = promptConfirm.value === true;
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
            uxLog("action", this, c.cyan('Resetting local SF Cli tracking...'));
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
      const openOrgRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(`Do you want to open org ${c.green(orgUsername)} in your browser ? `),
        description: 'Open the sandbox org in your web browser to start working on it',
        initial: true
      });
      if (openOrgRes.value === true) {
        uxLog("action", this, c.cyan(`Opening org ${c.green(orgUsername)}...`));
        await execSfdxJson('sf org open', this, {
          fail: true,
          output: false,
          debug: this.debugMode,
        });
      }
    }

    // Trigger a status refresh on VS Code WebSocket Client
    WebSocketClient.sendRefreshStatusMessage();
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
      message: c.cyanBright(
        `Select a sandbox org to work in branch ${c.green(
          branchName
        )
        } `
      ),
      description: 'Choose an existing sandbox or connect to a new one for this branch',
      placeholder: 'Select sandbox',
      default: defaultSandbox ? defaultSandbox : undefined,
      choices: [
        ...[
          {
            title: c.yellow('🌐 Connect to a sandbox not in this list'),
            description: 'Login via web browser to your source-tracked sandbox',
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
            description: `☁️ Use sandbox org ${c.yellow(sandboxOrg.username || sandboxOrg.alias)} `,
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
    if (sandboxResponse.value === 'connectSandbox') {
      const slctdOrg = await promptOrg(this, { setDefault: true, devSandbox: true });
      orgUsername = slctdOrg.username;
    }

    // Create a new sandbox ( NOT WORKING YET, DO NOT USE)
    else if (sandboxResponse.value === 'newSandbox') {
      const createResult = await SandboxCreate.run();
      if (createResult == null) {
        throw new SfError('Unable to create sandbox org');
      }
      orgUsername = (createResult as any).username;
    }

    // Selected sandbox from list
    else {
      await makeSureOrgIsConnected(sandboxResponse.value);
      uxLog("action", this, c.cyan(`Setting ${c.green(sandboxResponse.value.instanceUrl)} (${sandboxResponse.value.username}) as default org...`));
      await execCommand(`sf config set target - org=${sandboxResponse.value.username} `, this, {
        output: true,
        fail: true,
      });
      orgUsername = sandboxResponse.value.username;
      openOrg = true;
    }
    return { orgUsername, openOrg };
  }
}
