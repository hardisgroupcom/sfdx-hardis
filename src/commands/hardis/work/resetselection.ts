/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { execCommand, getCurrentGitBranch, git, uxLog } from "../../../common/utils";
import { selectTargetBranch } from "../../../common/utils/gitUtils";
import { setConfig } from "../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class RebuildSelection extends SfdxCommand {
  public static title = "Select again";

  public static description = messages.getMessage("rebuildSelection");

  public static examples = ["$ sfdx hardis:work:resetsave"];

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
      description: "Skip authentication check when a default username is required"
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    const targetBranch = await selectTargetBranch({ message: "Please select the target branch of your current or future merge request" });

    uxLog(this, c.cyan(`This script will rebuild selection that you will want to merge into ${c.green(targetBranch)}`));

    const currentGitBranch = await getCurrentGitBranch();
    if (currentGitBranch === targetBranch) {
      throw new SfdxError(c.red("[sfdx-hardis] You can not revert commits of a protected branch !"));
    }

    // List all commits since the branch creation
    const logResult = await git().log([`${targetBranch}..${currentGitBranch}`]);
    const commitstoReset = logResult.all;
    const commitsToResetNumber = commitstoReset.length;
    // Reset commits
    await git({ output: true }).reset(["--soft", `HEAD~${commitsToResetNumber}`]);
    await setConfig("user", { canForcePush: true });
    // unstage files
    await execCommand("git reset", this, {
      output: true,
      fail: true,
      debug: this.debugMode,
    }); // await git({output:true}).reset(); does not work, let's use direct command
    await git({ output: true }).checkout(["--", "manifest/package.xml"]);
    await git({ output: true }).checkout(["--", "manifest/destructiveChanges.xml"]);
    await git({ output: true }).status();
    uxLog(this, c.cyan("The following items are not available for selection"));
    uxLog(this, c.cyan("Selection has been reset"));
    // Return an object to be displayed with --json
    return { outputString: "Reset selection pocessed" };
  }
}
