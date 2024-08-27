/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { execCommand, getCurrentGitBranch, git, uxLog } from "../../../common/utils";
import { forceSourcePull, forceSourcePush } from "../../../common/utils/deployUtils";
import { prompts } from "../../../common/utils/prompts";
import { getConfig } from "../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class RefreshTask extends SfdxCommand {
  public static title = "Refresh work task";

  public static description = messages.getMessage("refreshWorkTask");

  public static examples = ["$ sf hardis:work:refresh"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    nopull: flags.boolean({
      char: "n",
      default: false,
      description: "No scratch pull before save (careful if you use that!)",
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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected debugMode = false;
  protected noPull = false;
  protected mergeBranch = null;

  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    const config = await getConfig("project");
    if (config.get("EXPERIMENTAL", "") !== "true") {
      const msg = "This command is not stable enough to be used. Use EXPERIMENTAL=true to use it anyway";
      uxLog(this, c.yellow(msg));
      return { outputString: msg };
    }

    this.noPull = this.flags.nopull || false;
    uxLog(this, c.cyan("This command will refresh your git branch and your org with the content of another git branch"));
    // Verify that the user saved his/her work before merging another branch
    const savePromptRes = await prompts({
      type: "select",
      message: c.cyanBright(`This is a SENSITIVE OPERATION. Did you run ${c.green("hardis:work:save")} BEFORE running this command ?`),
      name: "value",
      choices: [
        {
          title: "Yes I did save my current updates before merging updates from others !",
          value: true,
        },
        { title: "No, I did not, I will do that right now", value: false },
      ],
    });
    if (savePromptRes.value !== true) {
      process.exit(0);
    }
    // Select branch to merge
    const localBranch = await getCurrentGitBranch();
    const branchSummary = await git().branch(["-r"]);
    const branchChoices = [
      {
        title: `${config.developmentBranch} (recommended)`,
        value: config.developmentBranch,
      },
    ];
    for (const branchName of Object.keys(branchSummary.branches)) {
      const branchNameLocal = branchName.replace("origin/", "");
      if (branchNameLocal !== config.developmentBranch) {
        branchChoices.push({ title: branchNameLocal, value: branchNameLocal });
      }
    }
    const branchRes = await prompts({
      type: "select",
      message: `Please select the branch that you want to merge in your current branch ${c.green(localBranch)}`,
      name: "value",
      choices: branchChoices,
    });
    this.mergeBranch = branchRes.value;
    // Run refresh of local branch
    try {
      return await this.runRefresh(localBranch);
    } catch (e) {
      uxLog(this, c.yellow("There has been a merge conflict or a technical error, please contact a Developer for help !"));
      throw e;
    }
  }

  private async runRefresh(localBranch): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    uxLog(
      this,
      c.cyan(
        `sfdx-hardis will refresh your local branch ${c.green(localBranch)} and your local scratch org ${c.green(
          this.org.getUsername(),
        )} with the latest state of ${c.green(this.mergeBranch)}`,
      ),
    );

    if (localBranch === this.mergeBranch) {
      throw new SfdxError("[sfdx-hardis] You can not refresh from the same branch");
    }

    // Pull from scratch org
    if (this.noPull) {
      uxLog(this, c.cyan(`Skipped pull from scratch org`));
    } else {
      uxLog(this, c.cyan(`Pulling sources from scratch org ${this.org.getUsername()}...`));
      await forceSourcePull(this.org.getUsername(), this.debugMode);
    }

    // Stash
    uxLog(
      this,
      c.cyan(
        `Stashing your uncommitted updates in ${c.green(localBranch)} before merging ${c.green(this.mergeBranch)} into your local branch ${c.green(
          localBranch,
        )}...`,
      ),
    );
    const stashResult = await git({ output: true }).stash(["save", `[sfdx-hardis] Stash of ${localBranch}`]);
    const stashed = stashResult.includes("Saved working directory");
    // Pull most recent version of development branch
    uxLog(this, c.cyan(`Pulling most recent version of remote branch ${c.green(this.mergeBranch)}...`));
    await git({ output: true }).fetch();
    await git({ output: true }).checkout(this.mergeBranch);
    const pullRes = await git({ output: true }).pull();
    // Go back to current work branch
    await git({ output: true }).checkout(localBranch);
    // Check if merge is necessary ( https://stackoverflow.com/a/30177226/7113625 )
    const mergeRef = (
      await execCommand(`git show-ref --heads -s ${this.mergeBranch}`, this, {
        output: true,
      })
    ).stdout;
    const localRef = (await execCommand(`git merge-base ${this.mergeBranch} ${localBranch}`, this, { output: true })).stdout;
    // Merge into current branch if necessary
    if (pullRes.summary.changes > 0 || mergeRef !== localRef) {
      // Create new commit from merge
      uxLog(this, c.cyan(`Creating a merge commit of ${c.green(this.mergeBranch)} within ${c.green(localBranch)}...`));
      let mergeSummary = await git({ output: true }).merge([this.mergeBranch]);
      while (mergeSummary.failed) {
        const mergeResult = await prompts({
          type: "select",
          name: "value",
          message: c.cyanBright(
            "There are merge conflicts, please solve them, then select YES here. Otherwise, exit the script and call a developer for help :)",
          ),
          choices: [
            { value: true, title: "If finished to merge conflicts" },
            {
              value: false,
              title: "I can't merge conflicts, I give up for now",
            },
          ],
        });
        if (mergeResult.value === false) {
          uxLog(this, "Refresh script stopped by user");
          process.exit(0);
        }
        mergeSummary = await git({ output: true }).merge(["--continue"]);
      }
    } else {
      uxLog(this, c.cyan(`Local branch ${c.green(localBranch)} is already up to date with ${c.green(this.mergeBranch)}`));
    }
    // Restoring stash
    if (stashed) {
      uxLog(this, c.cyan(`Restoring stash into your local branch ${c.green(localBranch)}...`));
      await git({ output: true }).stash(["pop"]);
    }

    // Push new branch state to scratch org
    await forceSourcePush(this.org.getUsername(), this, this.debugMode, { conn: this.org.getConnection() });

    // Return an object to be displayed with --json
    return { outputString: "Refreshed the task & org" };
  }
}
