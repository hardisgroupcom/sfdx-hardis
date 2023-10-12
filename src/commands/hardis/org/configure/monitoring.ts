/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import open = require("open");
import {
  ensureGitBranch,
  ensureGitRepository,
  execCommand,
  generateSSLCertificate,
  getGitRepoName,
  gitAddCommitPush,
  uxLog,
} from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { setInConfigFile } from "../../../../config";
import { PACKAGE_ROOT_DIR } from "../../../../settings";
import { promptOrg } from "../../../../common/utils/orgUtils";
import { WebSocketClient } from "../../../../common/websocketClient";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgConfigureMonitoring extends SfdxCommand {
  public static title = "Configure org monitoring";

  public static description = "Configure monitoring of an org";

  public static examples = ["$ sfdx hardis:org:configure:monitoring"];

  protected static flagsConfig = {
    orginstanceurl: flags.string({
      description: "Org instance url (technical param, do not use manually)",
    }),
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
  protected static supportsUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  /* jscpd:ignore-end */

  protected static requiresDependencies = ["openssl"];

  public async run(): Promise<AnyJson> {
    // Make sure that we are located in a git repository
    await ensureGitRepository();

    // Check git repo name is valid (contains monitoring)
    const repoName = await getGitRepoName();
    if (!repoName.includes("monitoring")) {
      throw new SfdxError('Your git repository name must contain the expression "monitoring"');
    }

    const confirmPreRequisites = await prompts({
      type: "select",
      name: "value",
      choices: [
        { title: "Yes", value: "yes"},
        { title: "No, help me !", value: "no" }
      ],
      message: c.cyanBright("Did you configure the pre-requisites on your Git server ?"),
    });
    if (confirmPreRequisites.value === "no") {
      const preRequisitesUrl = "https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/";
      const msg = "Please follow the instructions to configure the sfdx-hardis monitoring pre-requisites on your Git server\n" + preRequisitesUrl;
      uxLog(this,c.yellow(msg));
      await open(preRequisitesUrl, { wait: true });
      return { outputString: msg}
    }

    // Get current default org
    const currentOrgId = this.org?.getOrgId() || "";
    if (this.flags.orginstanceurl && this.org?.getConnection()?.instanceUrl === this.flags.orginstanceurl) {
      uxLog(this, c.cyan(`Default org ${this.org.getConnection()?.instanceUrl} is selected, let's configure its monitoring !`));
    } else {
      // Select the org that must be monitored
      const org = await promptOrg(this, {
        devHub: false,
        setDefault: true,
        scratch: false,
        promptMessage: "Please select or connect to the org that you want to monitor",
      });

      // Restart command so the org is selected as default org (will help to select profiles)
      if (currentOrgId !== org.orgId) {
        const infoMsg = "Default org changed. Please restart the same command if VsCode does not do that automatically for you :)";
        uxLog(this, c.yellow(infoMsg));
        const currentCommand = "sfdx " + this.id + " " + this.argv.join(" ") + " --orginstanceurl " + org.instanceUrl;
        WebSocketClient.sendMessage({
          event: "runSfdxHardisCommand",
          sfdxHardisCommand: currentCommand,
        });
        return { outputString: infoMsg };
      }
    }

    // Build monitoring branch name
    const branchName =
      "monitoring_" +
      this.org
        ?.getConnection()
        .instanceUrl.replace("https://", "")
        .replace(".my.salesforce.com", "")
        .replace(/\./gm, "_")
        .replace(/--/gm, "__")
        .replace(/-/gm, "_");

    // Checkout branch, or create it if not existing (stash before if necessary)
    await execCommand("git add --all", this, { output: true, fail: false });
    await execCommand("git stash", this, { output: true, fail: false });
    await ensureGitBranch(branchName, { parent: "main" });

    // Create sfdx project if not existing yet
    if (!fs.existsSync("sfdx-project.json")) {
      const createCommand = "sfdx force:project:create" + ` --projectname "sfdx-hardis-monitoring"`;
      uxLog(this, c.cyan("Creating sfdx-project..."));
      await execCommand(createCommand, this, {
        output: true,
        fail: true,
      });
      uxLog(this, c.cyan("Moving sfdx-project to root..."));
      await fs.copy("sfdx-hardis-monitoring", process.cwd(), { overwrite: true });
      await fs.remove("sfdx-hardis-monitoring");

      // Copying monitoring folder structure
      uxLog(this, "Copying default monitoring files...");
      if (fs.existsSync("README.md") && fs.readFileSync("README.md", "utf8").toString().split("\n").length < 5) {
        // Remove default README if necessary
        await fs.remove("README.md");
      }
      await fs.copy(path.join(PACKAGE_ROOT_DIR, "defaults/monitoring", "."), process.cwd(), { overwrite: true });
    }

    // Update config file
    await setInConfigFile(
      [],
      {
        targetUsername: this.org.getUsername(),
        instanceUrl: this.org.getConnection().instanceUrl,
      },
      "./.sfdx-hardis.yml"
    );

    // Generate SSL certificate (requires openssl to be installed on computer)
    await generateSSLCertificate(branchName, "./.ssh", this, this.org.getConnection(), {});

    // Confirm & push on server
    const confirmPush = await prompts({
      type: "confirm",
      name: "value",
      initial: true,
      message: c.cyanBright("(RECOMMENDED) Do you want sfdx-hardis to save your configuration on server ? (git stage, commit & push)"),
    });

    if (confirmPush.value === true) {
      await gitAddCommitPush({
        message: "[sfdx-hardis] Update monitoring configuration",
      });
      uxLog(this, c.green("Your configuration for org monitoring is now ready :)"));
    } else {
      uxLog(this, c.yellow("Please manually git add, commit and push to the remote repository :)"));
    }
    uxLog(this, c.greenBright(`Now you must schedule monitoring to run the job automatically every night :)`));
    const scheduleMonitoringUrl = "https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/";
    const msg = "Please follow the instructions to schedule sfdx-hardis monitoring on your Git server\n" + scheduleMonitoringUrl;
    uxLog(this,c.yellow(msg));
    await open(scheduleMonitoringUrl, { wait: true });
    // Return an object to be displayed with --json
    return { outputString: "Configured branch for authentication" };
  }
}
