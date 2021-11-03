/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import {
  ensureGitBranch,
  ensureGitRepository,
  execCommand,
  generateSSLCertificate,
  getCurrentGitBranch,
  gitAddCommitPush,
  promptInstanceUrl,
  uxLog,
} from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { getConfig, setInConfigFile } from "../../../../config";

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
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  /* jscpd:ignore-end */

  protected static requiresDependencies = ["openssl"];

  public async run(): Promise<AnyJson> {
    // Clone repository if there is not
    await ensureGitRepository({ clone: true });

    // Copying folder structure
    uxLog(this, "Copying default files...");
    if (fs.existsSync("README.md") && fs.readFileSync("README.md", "utf8").toString().split("\n").length < 5) {
      // Remove default README if necessary
      await fs.remove("README.md");
    }
    await fs.copy(path.join(__dirname, "../../../../../defaults/monitoring", "."), process.cwd(), { overwrite: false });

    const gitLabInfo = `- If you're using GitLab, ACCESS_TOKEN must be defined in ${c.bold("Project -> Settings -> Access Token")}
    - name: ${c.bold("ACCESS_TOKEN")}
    - scopes: ${c.bold("read_repository, write_repository")}
    - Copy generated token in clipboard (CTRL+C)
- Then define CI variable ACCESS_TOKEN in ${c.bold("Project -> Settings -> CI / CD -> Variables")}
    - name: ${c.bold("ACCESS_TOKEN")}
    - value: Paste token previously generated (CTRL+V)
    - Select "Mask variable", unselect "Protected variable"`;
    this.ux.log(c.blue(gitLabInfo));
    await prompts({
      type: "confirm",
      message: c.cyanBright("Hit ENTER when done (or if previously done on the same repository)"),
    });
    const config = await getConfig("project");
    // Get branch name to configure
    const currentBranch = await getCurrentGitBranch({ formatted: true });
    const branchResponse = await prompts({
      type: "text",
      name: "value",
      initial: currentBranch,
      message: c.cyanBright("What is the name of the git branch you want to configure ? Exemples: developpement,recette,production"),
    });
    const branchName = branchResponse.value;

    // Create and checkout branch if not existing
    await ensureGitBranch(branchName);

    // Ask to login again in case
    if (currentBranch != null && branchName !== currentBranch && branchName !== "master") {
      await execCommand("sfdx auth:logout --noprompt || true", this, {
        fail: true,
      });
      uxLog(this, c.yellow("You need to login to new org, please run again the same command :)"));
      process.exit(0);
    }

    // Request instanceUrl
    const instanceUrl = await promptInstanceUrl();

    // Request username
    const usernameMsTeamsResponse = await prompts([
      {
        type: "text",
        name: "username",
        message: c.cyanBright("What is the username you will use for sfdx in the org you want to monitor ? Example: admin.sfdx@myclient.com"),
        initial: config.targetUsername,
      },
      {
        type: "text",
        name: "teamsHook",
        initial: config.msTeamsWebhookUrl,
        message: c.cyanBright(
          "If you want notifications of updates in orgs in a Microsoft Teams channel:\n- Create the WebHook: https://docs.microsoft.com/fr-fr/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook#add-an-incoming-webhook-to-a-teams-channel\n- paste the hook Url here\nIf you do not want Ms Team notifications, just leave empty and hit ENTER"
        ),
      },
    ]);

    // Update config file
    await setInConfigFile(
      [],
      {
        targetUsername: usernameMsTeamsResponse.username,
        instanceUrl,
        msTeamsWebhookUrl: usernameMsTeamsResponse.teamsHook ? usernameMsTeamsResponse.teamsHook : null,
      },
      "./.sfdx-hardis.yml"
    );

    // Generate SSL certificate (requires openssl to be installed on computer)
    await generateSSLCertificate(branchName, "./.ssh", this, this.org.getConnection(), {});

    uxLog(this, c.italic("You can customize monitoring by updating .gitlab-ci-config.yml"));

    // Confirm & push on server
    const confirmPush = await prompts({
      type: "confirm",
      name: "value",
      initial: true,
      message: c.cyanBright("Do you want sfdx-hardis to save your configuration on server ? (git stage, commit & push)"),
    });

    if (confirmPush.value === true) {
      await gitAddCommitPush({
        message: "[sfdx-hardis] Update monitoring configuration",
      });
      uxLog(this, c.green("Your configuration for org monitoring is now ready :)"));
    } else {
      uxLog(this, c.yellow("Please manually git add, commit and push to the remote repository :)"));
    }
    uxLog(
      this,
      c.greenBright(
        `You may schedule monitoring to be automatically run every day. To do that, go in ${c.bold("Project -> CI -> Schedules -> New schedule")}`
      )
    );
    // Return an object to be displayed with --json
    return { outputString: "Configured branch for authentication" };
  }
}
