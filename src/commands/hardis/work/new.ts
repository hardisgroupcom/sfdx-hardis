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
  git,
  gitCheckOutRemote,
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

## Technical explanations

The command's logic orchestrates various underlying processes:

- **Git Operations:** Utilizes \`checkGitClean\`, \`ensureGitBranch\`, \`gitCheckOutRemote\`, and \`git().pull()\` to manage Git repository state and branches.
- **Interactive Prompts:** Leverages the \`prompts\` library to gather user input for User Story type, source types, and User Story names.
- **Configuration Management:** Reads and applies project-specific configurations from \`.sfdx-hardis.yml\` using \`getConfig\` and \`setConfig\
- **Org Initialization Utilities:** Calls a suite of utility functions for org setup, including \`initApexScripts\`, \`initOrgData\`, \`initOrgMetadatas\`, \`initPermissionSetAssignments\`, \`installPackages\`, and \`makeSureOrgIsConnected\
- **Salesforce CLI Interaction:** Executes Salesforce CLI commands (e.g., \`sf config set target-org\`, \`sf org open\`, \`sf project delete tracking\`) via \`execCommand\` and \`execSfdxJson\
- **Dynamic Org Selection:** Presents choices for scratch orgs or sandboxes based on project configuration and existing orgs, dynamically calling \`ScratchCreate.run\` or \`SandboxCreate.run\` as needed.
- **WebSocket Communication:** Sends refresh status messages via \`WebSocketClient.sendRefreshStatusMessage()\` to update connected VS Code clients.
`

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

    uxLog(this, c.cyan('This tool will assist you to create a new User Story (dev or config) with Hardis CI/CD'));
    uxLog(this, c.grey("When you don't know what to answer, you can let the default value and push ENTER"));

    // Make sure the git status is clean, to not delete uncommitted updates
    await checkGitClean({ allowStash: true });

    const config = await getConfig('project');

    this.targetBranch = await selectTargetBranch();

    const defaultBranchPrefixChoices = [
      {
        title: '🏗️ Feature',
        value: 'features',
        description: "New feature, evolution of an existing feature... If you don't know, just select Feature",
      },
      {
        title: '🛠️ Debug',
        value: 'fixes',
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
        message: c.cyanBright('What is the type of the User Story you want to do ?'),
        description: 'Select the category of work that best describes your User Story',
        placeholder: 'Select User Story type',
        initial: 0,
        choices: branchPrefixChoices,
      },
      {
        type: 'select',
        name: 'sources',
        message: c.cyanBright('What type(s) of Salesforce updates will you implement to perform this User Story ?'),
        description: 'Choose the type of changes you will make to help set up the appropriate development environment',
        placeholder: 'Select update type',
        initial: 0,
        choices: [
          {
            title: '🥸 Configuration',
            value: 'config',
            description: 'You will update anything in the setup except apex code :)',
          },
          {
            title: '🤓 Development',
            value: 'dev',
            description: 'You are a developer who will do magic with Apex or Javascript !',
          },
          {
            title: '🥸🤓 Configuration + Development',
            value: 'dev',
            description: 'Like the unicorn you are, you will update configuration but also write code :)',
          },
        ],
      }
    ]);

    // Request task name
    const taskName = await this.promptTaskName(config.newTaskNameRegex || null, config.newTaskNameRegexExample || null);

    // Checkout development main branch
    const branchName = `${projectBranchPart}${response.branch || 'features'}/${response.sources || 'dev'}/${taskName}`;
    uxLog(
      this,
      c.cyan(`Checking out the most recent version of branch ${c.bold(this.targetBranch)} from git server...`)
    );
    await gitCheckOutRemote(this.targetBranch);
    // Pull latest version of target branch
    await git().pull();
    // Create new branch
    uxLog(this, c.cyan(`Creating new git branch ${c.green(branchName)}...`));
    await ensureGitBranch(branchName);
    // Update config if necessary
    if (config.developmentBranch !== this.targetBranch && (config.availableTargetBranches || null) == null) {
      const updateDefaultBranchRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(
          `Do you want to update your default target git branch to ${c.green(this.targetBranch)} ?`
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
          "Release manager told me that I can work on Sandboxes on my project so let's use fresh dedicated one",
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
        description: `Your default org with username ${flags['target-org']?.getUsername()} is already the org you want to use to work :)`,
      });
    }
    orgTypeChoices.push({
      title: "🤠 I'm hardcore, I don't need an org !",
      value: 'noOrg',
      description: 'You just want to play with XML and sfdx-hardis configuration, and you know what you are doing !',
    });
    const orgTypeResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(`Do you want to use a scratch org or a tracked sandbox org ?`),
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
      uxLog(this, c.yellow(`No org selected... I hope you know what you are doing, don't break anything :)`));
    }

    uxLog(this, c.cyan(`You are now ready to work in branch ${c.green(branchName)} :)`));
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
        `What is the name of your new User Story ? Please avoid accents or special characters`
      ),
      description: 'Enter a descriptive name for your User Story that will be used in the git branch name',
      placeholder: `Ex: ${taskNameExample}`,
    });
    const taskName = taskResponse.taskName.replace(/[^a-zA-Z0-9 -]|\s/g, '-');
    if (validationRegex != null && !new RegExp(validationRegex).test(taskName)) {
      uxLog(
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
        description: "This will generate a new scratch org, and in a few minutes you'll be ready to work",
      },
    ];
    if (currentOrg) {
      baseChoices.push({
        title: c.yellow(`♻️ Reuse current org`),
        value: currentOrg,
        description: `This will reuse current org ${currentOrg.instanceUrl}. Beware of conflicts if others merged merge requests :)`,
      });
    }
    const scratchResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(`Please select a scratch org to use for your branch ${c.green(branchName)}`),
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
        this,
        c.cyan(
          `Selected and opening scratch org ${c.green(scratchResponse.value.instanceUrl)} with user ${c.green(
            scratchResponse.value.username
          )}`
        )
      );
      // Open selected org
      uxLog(this, c.cyan('Opening scratch org in browser...'));
      await execSfdxJson('sf org open', this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      // Trigger a status refresh on VsCode WebSocket Client
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
          `Do you want to update the sandbox according to git branch "${this.targetBranch}" current state ?`
        ),
        description: 'Choose whether to sync your sandbox with the latest changes from the target branch (packages, sources, permission sets, apex scripts, initial data)',
        placeholder: 'Select sync option',
        choices: [
          {
            title: '🧑‍🤝‍🧑 No, continue working on my current sandbox state',
            value: 'no',
            description: 'Use if you are multiple users in the same SB, or have have uncommitted changes in your sandbox',
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
            `Are you really sure you want to update the dev sandbox with the state of git branch ${this.targetBranch} ? This will overwrite setup updates that you or other users have not committed yet`
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
            // Continue initialization even if push did not work... it could work and be not such a problem :)
            uxLog(this, c.cyan('Resetting local SF Cli tracking...'));
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
            this,
            c.grey('Error(s) while initializing sandbox: ' + initSandboxErr.message + '\n' + initSandboxErr.stack)
          );
          uxLog(
            this,
            c.yellow(
              'Your sandbox may not be completely initialized from git. You can send the error above to your release manager'
            )
          );
        }
        if (initSourcesErr) {
          uxLog(
            this,
            c.grey('Error(s) while pushing sources to sandbox: ' + initSourcesErr.message + '\n' + initSourcesErr.stack)
          );
          uxLog(
            this,
            c.yellow(`If you really want your sandbox to be up to date with branch ${c.bold(this.targetBranch)}, you may:
  - ${c.bold(
              'Fix the errors'
            )} (probably by manually updating the target sandbox in setup), then run "New User Story" again and select again the same sandbox
  - ${c.bold('Refresh your sandbox')} (ask your release manager if you don't know how)
  Else, you can start working now (but beware of conflicts ^^):)
        `)
          );
        }
      }
    }
    // Open of if not already open
    if (openOrg === true) {
      uxLog(this, c.cyan(`Opening sandbox org so you can work in it...`));
      await execSfdxJson('sf org open', this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
    }

    // Trigger a status refresh on VsCode WebSocket Client
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
        `Please select a sandbox org to use for your branch ${c.green(
          branchName
        )} (if you want to avoid conflicts, you should often refresh your sandbox)`
      ),
      description: 'Choose an existing sandbox or connect to a new one for this branch',
      placeholder: 'Select sandbox',
      default: defaultSandbox ? defaultSandbox : undefined,
      choices: [
        ...[
          {
            title: c.yellow('🌐 Connect to a sandbox not appearing in this list'),
            description: 'Login in web browser to your source-tracked sandbox',
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
            description: `☁️ Use sandbox org ${c.yellow(sandboxOrg.username || sandboxOrg.alias)}`,
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
      uxLog(this, c.cyan(`Setting sandbox org ${c.green(sandboxResponse.value.instanceUrl)} (${sandboxResponse.value.username}) as default org...`));
      await execCommand(`sf config set target-org=${sandboxResponse.value.username}`, this, {
        output: true,
        fail: true,
      });
      orgUsername = sandboxResponse.value.username;
      openOrg = true;
    }
    return { orgUsername, openOrg };
  }
}