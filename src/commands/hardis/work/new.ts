/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as path from "path";
import { MetadataUtils } from "../../../common/metadata-utils";
import { checkGitClean, ensureGitBranch, execCommand, execSfdxJson, git, gitCheckOutRemote, uxLog } from "../../../common/utils";
import { selectTargetBranch } from "../../../common/utils/gitUtils";
import {
  initApexScripts,
  initOrgData,
  initOrgMetadatas,
  initPermissionSetAssignments,
  installPackages,
  promptOrg,
} from "../../../common/utils/orgUtils";
import { prompts } from "../../../common/utils/prompts";
import { WebSocketClient } from "../../../common/websocketClient";
import { getConfig, setConfig } from "../../../config";
import SandboxCreate from "../org/create";
import ScratchCreate from "../scratch/create";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class NewTask extends SfdxCommand {
  public static title = "New work task";

  public static description = `Assisted menu to start working on a Salesforce task.

Advanced instructions in [Create New Task documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-create-new-task/)

At the end of the command, it will allow you to work on either a scratch org or a sandbox, depending on your choices.

Under the hood, it can:

- Make **git pull** to be up to date with target branch
- Create **new git branch** with formatted name (you can override the choices using .sfdx-hardis.yml property **branchPrefixChoices**)
- Create and initialize a scratch org or a source-tracked sandbox (config can be defined using \`config/.sfdx-hardis.yml\`):
- (and for scratch org only for now):
  - **Install packages**
      - Use property \`installedPackages\`
    - **Push sources**
    - **Assign permission sets**
      - Use property \`initPermissionSets\`
    - **Run apex initialization scripts**
      - Use property \`scratchOrgInitApexScripts\`
    - **Load data**
      - Use property \`dataPackages\`
`;

  public static examples = ["$ sfdx hardis:work:task:new"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected targetBranch: string;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    uxLog(this, c.cyan("This tool will assist you to create a new task (dev or config) with Hardis CI/CD"));
    uxLog(this, c.cyan("When you don't know what to answer, you can let the default value and push ENTER"));

    // Make sure the git status is clean, to not delete uncommitted updates
    await checkGitClean({ allowStash: true });

    const config = await getConfig("project");

    this.targetBranch = await selectTargetBranch();

    const defaultBranchPrefixChoices = [
      {
        title: "Feature",
        value: "features",
        description: "New feature, evolution of an existing feature... If you don't know, just select Feature",
      },
      { title: "Debug", value: "fixes", description: "A bug has been identified and you are the right person to solve it !" },
    ];
    const branchPrefixChoices = config.branchPrefixChoices || defaultBranchPrefixChoices;

    // Select project if multiple projects are defined in availableProjects .sfdx-hardis.yml property
    let projectBranchPart = "";
    const availableProjects = config.availableProjects || [];
    if (availableProjects.length > 1) {
      const projectResponse = await prompts({
        type: "select",
        name: "project",
        message: c.cyanBright("Please select the project your task is for"),
        choices: availableProjects.map((project: string) => {
          return { title: project, value: project };
        }),
      });
      projectBranchPart = projectResponse.project + "/";
    }

    // Request info to build branch name. ex features/config/MYTASK
    const response = await prompts([
      {
        type: "select",
        name: "branch",
        message: c.cyanBright("What is the type of the task you want to do ?"),
        initial: 0,
        choices: branchPrefixChoices,
      },
      {
        type: "select",
        name: "sources",
        message: c.cyanBright("What type(s) of Salesforce updates will you have to perform for this task ?"),
        initial: 0,
        choices: [
          { title: "Configuration", value: "config", description: "You will update anything in the setup except apex code :)" },
          { title: "Development", value: "dev", description: "You are a developer who will do magic with Apex or Javascript !" },
          {
            title: "Configuration + Development",
            value: "dev",
            description: "Like the unicorn you are, you will update configuration but also write code :)",
          },
        ],
      },
      {
        type: "text",
        name: "taskName",
        message: c.cyanBright(
          "What is the name of your new task ? (examples: JIRA123-webservice-get-account, T1000-flow-process-opportunity...). Please avoid accents or special characters",
        ),
      },
    ]);

    // Checkout development main branch
    const branchName = `${projectBranchPart}${response.branch || "features"}/${response.sources || "dev"}/${response.taskName.replace(/\s/g, "-")}`;
    uxLog(this, c.cyan(`Checking out the most recent version of branch ${c.bold(this.targetBranch)} from git server...`));
    await gitCheckOutRemote(this.targetBranch);
    // Pull latest version of target branch
    await git().pull();
    // Create new branch
    uxLog(this, c.cyan(`Creating new git branch ${c.green(branchName)}...`));
    await ensureGitBranch(branchName);
    // Update config if necessary
    if (config.developmentBranch !== this.targetBranch && (config.availableTargetBranches || null) == null) {
      const updateDefaultBranchRes = await prompts({
        type: "confirm",
        name: "value",
        message: c.cyanBright(`Do you want to update your default target git branch to ${c.green(this.targetBranch)} ?`),
        default: false,
      });
      if (updateDefaultBranchRes.value === true) {
        await setConfig("user", { developmentBranch: this.targetBranch });
      }
    }
    // Update local user config files to store the target of the just created branch
    const currentUserConfig = await getConfig("user");
    const localStorageBranchTargets = currentUserConfig.localStorageBranchTargets || {};
    localStorageBranchTargets[branchName] = this.targetBranch;
    await setConfig("user", { localStorageBranchTargets: localStorageBranchTargets });

    // Get allowed work org types from config if possible
    const allowedOrgTypes = config?.allowedOrgTypes || [];
    let selectedOrgType = allowedOrgTypes.length == 1 ? allowedOrgTypes[0] : null;
    // If necessary, Prompt if you want to use a scratch org or a tracked sandbox org, or no org
    const orgTypeChoices = [];
    if (allowedOrgTypes.includes("sandbox") || allowedOrgTypes.length === 0) {
      orgTypeChoices.push({
        title: "Sandbox org with source tracking",
        value: "sandbox",
        description: "Release manager told me that I can work on Sandboxes on my project so let's use fresh dedicated one",
      });
    }
    if (allowedOrgTypes.includes("scratch") || allowedOrgTypes.length === 0) {
      orgTypeChoices.push({
        title: "Scratch org",
        value: "scratch",
        description: "Scratch orgs are configured on my project so I want to create or reuse one",
      });
    }
    orgTypeChoices.push({
      title: "I'm hardcore, I don't need an org !",
      value: "noOrg",
      description: "You just want to play with XML and sfdx-hardis configuration, and you know what you are doing !",
    });
    const orgTypeResponse = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright(`Do you want to use a scratch org or a tracked sandbox org ?`),
      initial: 0,
      choices: orgTypeChoices,
    });
    selectedOrgType = orgTypeResponse.value;

    // Select or create org that user will work in
    if (selectedOrgType === "scratch") {
      // scratch org
      await this.selectOrCreateScratchOrg(branchName);
    } else if (selectedOrgType === "sandbox") {
      // source tracked sandbox
      await this.selectOrCreateSandbox(branchName, config);
    } else {
      uxLog(this, c.yellow(`No org selected... I hope you know what you are doing, don't break anything :)`));
    }

    uxLog(this, c.cyan(`You are now ready to work in branch ${c.green(branchName)} :)`));
    // Return an object to be displayed with --json
    return { outputString: "Created new task" };
  }

  // Select/Create scratch org
  async selectOrCreateScratchOrg(branchName) {
    const hubOrgUsername = this?.hubOrg?.getUsername();
    const scratchOrgList = await MetadataUtils.listLocalOrgs("scratch", { devHubUsername: hubOrgUsername });
    const currentOrg = await MetadataUtils.getCurrentOrg();
    const baseChoices = [
      {
        title: c.yellow("Create new scratch org"),
        value: "newScratchOrg",
        description: "This will generate a new scratch org, and in a few minutes you'll be ready to work",
      },
    ];
    if (currentOrg) {
      baseChoices.push({
        title: c.yellow(`Reuse current org`),
        value: currentOrg,
        description: `This will reuse current org ${currentOrg.instanceUrl}. Beware of conflicts if others merged merge requests :)`,
      });
    }
    const scratchResponse = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright(`Please select a scratch org to use for your branch ${c.green(branchName)}`),
      initial: 0,
      choices: [
        ...baseChoices,
        ...scratchOrgList.map((scratchOrg: any) => {
          return {
            title: `Reuse scratch org ${c.yellow(scratchOrg.alias)}`,
            description: scratchOrg.instanceUrl,
            value: scratchOrg,
          };
        }),
      ],
    });
    if (scratchResponse.value === "newScratchOrg") {
      await setConfig("user", {
        scratchOrgAlias: null,
        scratchOrgUsername: null,
      });
      // Check if DevHub is connected
      await this.config.runHook("auth", {
        Command: this,
        devHub: true,
        scratch: false,
      });
      this.assignHubOrg();
      // Create scratch org
      const config = await getConfig();
      const createResult = await ScratchCreate.run(["--forcenew", "--targetdevhubusername", config.devHubAlias]);
      if (createResult == null) {
        throw new SfdxError("Unable to create scratch org");
      }
    } else {
      // Set selected org as default org
      await execCommand(`sfdx config:set defaultusername=${scratchResponse.value.username}`, this, {
        output: true,
        fail: true,
      });
      uxLog(
        this,
        c.cyan(`Selected and opening scratch org ${c.green(scratchResponse.value.instanceUrl)} with user ${c.green(scratchResponse.value.username)}`),
      );
      // Open selected org
      await execSfdxJson("sfdx force:org:open", this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      // Trigger a status refresh on VsCode WebSocket Client
      WebSocketClient.sendMessage({ event: "refreshStatus" });
    }
  }

  // Select or create sandbox
  async selectOrCreateSandbox(branchName, config) {
    const hubOrgUsername = this?.hubOrg?.getUsername();
    const sandboxOrgList = await MetadataUtils.listLocalOrgs("devSandbox", { devHubUsername: hubOrgUsername });
    const sandboxResponse = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright(
        `Please select a sandbox org to use for your branch ${c.green(
          branchName,
        )} (if you want to avoid conflicts, you should often refresh your sandbox)`,
      ),
      initial: 0,
      choices: [
        ...[
          {
            title: c.yellow("Connect to a sandbox not appearing in this list"),
            description: "Login in web browser to your source-tracked sandbox",
            value: "connectSandbox",
          },
          /* {
            title: c.yellow("Create new sandbox from another sandbox or production org (ALPHA -> UNSTABLE, DO NOT USE YET)"),
            value: "newSandbox",
          }, */
        ],
        ...sandboxOrgList.map((sandboxOrg: any) => {
          return {
            title: `Use sandbox org ${c.yellow(sandboxOrg.username || sandboxOrg.alias)}`,
            description: sandboxOrg.instanceUrl,
            value: sandboxOrg,
          };
        }),
      ],
    });
    // Remove scratch org info in user config
    await setConfig("user", {
      scratchOrgAlias: null,
      scratchOrgUsername: null,
    });
    let orgUsername = "";
    let openOrg = false;
    // Connect to a sandbox
    if (sandboxResponse.value === "connectSandbox") {
      const slctdOrg = await promptOrg(this, { setDefault: true, devSandbox: true });
      orgUsername = slctdOrg.username;
    }
    // Create a new sandbox ( NOT WORKING YET, DO NOT USE)
    else if (sandboxResponse.value === "newSandbox") {
      const createResult = await SandboxCreate.run();
      if (createResult == null) {
        throw new SfdxError("Unable to create sandbox org");
      }
      orgUsername = createResult.username;
    }
    // Selected sandbox from list
    else {
      await execCommand(`sfdx config:set defaultusername=${sandboxResponse.value.username}`, this, {
        output: true,
        fail: true,
      });
      orgUsername = sandboxResponse.value.username;
      openOrg = true;
    }
    // Initialize / Update existing sandbox if required
    const initSandboxResponse = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright(
        `Do you want to update the sandbox according to git branch "${this.targetBranch}" current state ? (packages,SOURCES,permission set assignments,apex scripts,initial data)`,
      ),
      choices: [
        {
          title: "No, continue working on my current sandbox state",
          value: "no",
          description: "Use if you are multiple users in the same SB, or have have uncommitted changes in your sandbox",
        },
        {
          title: "Yes, please try to update my sandbox !",
          value: "init",
          description: `Integrate new updates from the parent branch "${this.targetBranch}" before working on your new task`,
        },
      ],
    });
    if (initSandboxResponse.value === "init") {
      let initSourcesErr: any = null;
      let initSandboxErr: any = null;
      try {
        if (config.installedPackages) {
          await installPackages(config.installedPackages || [], orgUsername);
        }
        try {
          // Continue initialization even if push did not work... it could work and be not such a problem :)
          uxLog(this, c.cyan("Resetting local sfdx tracking..."));
          await execCommand(`sfdx force:source:tracking:clear --noprompt -u ${orgUsername}`, this, { fail: false, output: true });
          await initOrgMetadatas(config, orgUsername, orgUsername, {}, this.debugMode, { scratch: false });
        } catch (e1) {
          initSourcesErr = e1;
        }
        await initPermissionSetAssignments(config.initPermissionSets || [], orgUsername);
        await initApexScripts(config.scratchOrgInitApexScripts || [], orgUsername);
        await initOrgData(path.join(".", "scripts", "data", "ScratchInit"), orgUsername);
      } catch (e) {
        initSandboxErr = e;
      }
      if (initSandboxErr) {
        uxLog(this, c.grey("Error(s) while initializing sandbox: " + initSandboxErr.message + "\n" + initSandboxErr.stack));
        uxLog(this, c.yellow("Your sandbox may not be completely initialized from git. You can send the error above to your release manager"));
      }
      if (initSourcesErr) {
        uxLog(this, c.grey("Error(s) while pushing sources to sandbox: " + initSourcesErr.message + "\n" + initSourcesErr.stack));
        uxLog(
          this,
          c.yellow(`If you really want your sandbox to be up to date with branch ${c.bold(this.targetBranch)}, you may:
  - ${c.bold("Fix the errors")} (probably by manually updating the target sandbox in setup), then run new task again and select again the same sandbox
  - ${c.bold("Refresh your sandbox")} (ask your release manager if you don't know how)
  Else, you can start working now (but beware of conflicts ^^):)
        `),
        );
      }
    }
    // Open of if not already open
    if (openOrg === true) {
      await execSfdxJson("sfdx force:org:open", this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
    }

    // Trigger a status refresh on VsCode WebSocket Client
    WebSocketClient.sendMessage({ event: "refreshStatus" });
  }
}
