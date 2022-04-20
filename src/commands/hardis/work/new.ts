/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { MetadataUtils } from "../../../common/metadata-utils";
import { checkGitClean, ensureGitBranch, execCommand, execSfdxJson, git, gitCheckOutRemote, uxLog } from "../../../common/utils";
import { selectTargetBranch } from "../../../common/utils/gitUtils";
import { promptOrg } from "../../../common/utils/orgUtils";
import { prompts } from "../../../common/utils/prompts";
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

At the end of the command, it will allow you to work on either a scratch org or a sandbox, depending on your choices.

Under the hood, it can:

- Make git pull to be up to date with target branch
- Create new git branch with formatted name
- Create and initialize a scratch org or a source-tracked sandbox:
  - Install packages
  - Push sources
  - Load data
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
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    uxLog(this, c.cyan("This tool will assist you to create a new task (dev or config) with Hardis CI/CD"));
    uxLog(this, c.cyan("When you don't know what to answer, you can let the default value and push ENTER"));

    // Make sure the git status is clean, to not delete uncommitted updates
    await checkGitClean({ allowStash: true });

    const config = await getConfig("project");

    const targetBranch = await selectTargetBranch();

    // Request info to build branch name. ex features/config/MYTASK
    const response = await prompts([
      {
        type: "select",
        name: "branch",
        message: c.cyanBright("What is the type of the task you want to do ?"),
        initial: 0,
        choices: [
          {
            title: "Feature",
            value: "features",
            description: "New feature, evolution of an existing feature... If you don't know, just select Feature",
          },
          { title: "Debug", value: "bugs", description: "A bug has been identified and you are the right person to solve it !" },
        ],
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
          "What is the name of your new task ? (examples: webservice-get-account, flow-process-opportunity...). Please avoid accents or special characters"
        ),
      },
    ]);

    // Checkout development main branch
    const branchName = `${response.branch || "features"}/${response.sources || "dev"}/${response.taskName.replace(/\s/g, "-")}`;
    uxLog(this, c.cyan(`Checking out the most recent version of branch ${c.bold(targetBranch)} on server...`));
    await gitCheckOutRemote(targetBranch);
    // Pull latest version of target branch
    await git().pull();
    // Create new branch
    uxLog(this, c.cyan(`Creating new git branch ${c.green(branchName)}...`));
    await ensureGitBranch(branchName);

    // Update config if necessary
    if (config.developmentBranch !== targetBranch) {
      const updateDefaultBranchRes = await prompts({
        type: "confirm",
        name: "value",
        message: c.cyanBright(`Do you want to update your default target git branch to ${c.green(targetBranch)} ?`),
        default: false,
      });
      if (updateDefaultBranchRes.value === true) {
        await setConfig("user", { developmentBranch: targetBranch });
      }
    }

    // Prompt if you want to use a scratch org or a tracked sandbox org
    const orgTypeResponse = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright(`Do you want to use a scratch org or a tracked sandbox org ?`),
      initial: 0,
      choices: [
        {
          title: "Scratch org",
          value: "scratch",
          description: "Scratch orgs are configured on my project so I want to create or reuse one",
        },
        {
          title: "Sandbox org with source tracking (beta)",
          value: "sandbox",
          description: "Release manager told me that I can work on Sandboxes on my project so let's use fresh dedicated one",
        },
      ],
    });

    // Select or create org that user will work in
    if (orgTypeResponse.value === "scratch") {
      await this.selectOrCreateScratchOrg(branchName);
    } else {
      await this.selectOrCreateSandbox(branchName);
    }

    uxLog(this, c.cyan(`You are now ready to work in branch ${c.green(branchName)} :)`));
    // Return an object to be displayed with --json
    return { outputString: "Created new task" };
  }

  // Select/Create scratch org
  async selectOrCreateScratchOrg(branchName) {
    const hubOrgUsername = this?.hubOrg?.getUsername();
    const scratchOrgList = await MetadataUtils.listLocalOrgs("scratch", { devHubUsername: hubOrgUsername });
    const scratchResponse = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright(`Please select a scratch org to use for your branch ${c.green(branchName)}`),
      initial: 0,
      choices: [
        ...[
          {
            title: c.yellow("Create new scratch org"),
            value: "newScratchOrg",
            description: "This will generate a new scratch org, and in a few minutes you'll be ready to work",
          },
        ],
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
      const createResult = await ScratchCreate.run(["--forcenew"]);
      if (createResult == null) {
        throw new SfdxError("Unable to create scratch org");
      }
    } else {
      await execCommand(`sfdx config:set defaultusername=${scratchResponse.value.username}`, this, {
        output: true,
        fail: true,
      });
      uxLog(this, c.cyan(`Selected and opening scratch org ${c.green(scratchResponse.value.instanceUrl)} with user ${c.green(scratchResponse.value.username)}`));
      await execSfdxJson("sfdx force:org:open", this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
    }
  }

  // Select or create sandbox
  async selectOrCreateSandbox(branchName) {
    const hubOrgUsername = this?.hubOrg?.getUsername();
    const sandboxOrgList = await MetadataUtils.listLocalOrgs("sandbox", { devHubUsername: hubOrgUsername });
    const sandboxResponse = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright(
        `Please select a sandbox org to use for your branch ${c.green(
          branchName
        )} (if you want to avoid conflicts, you should often refresh your sandbox)`
      ),
      initial: 0,
      choices: [
        ...[
          {
            title: c.yellow("Connect to a sandbox not appearing in this list"),
            value: "connectSandbox",
          },
          {
            title: c.yellow("Create new sandbox from another sandbox or production org (ALPHA -> UNSTABLE, DO NOT USE YET)"),
            value: "newSandbox",
          },
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
    // Connect to a sandbox
    if (sandboxResponse.value === "connectSandbox") {
      await promptOrg(this, { setDefault: true, devSandbox: true });
    }
    // Create a new sandbox
    else if (sandboxResponse.value === "newSandbox") {
      const createResult = await SandboxCreate.run();
      if (createResult == null) {
        throw new SfdxError("Unable to create sandbox org");
      }
    }
    // Selected sandbox from list
    else {
      await execCommand(`sfdx config:set defaultusername=${sandboxResponse.value.username}`, this, {
        output: true,
        fail: true,
      });
    }
  }
}
