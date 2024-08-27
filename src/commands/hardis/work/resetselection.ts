/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { execCommand, getCurrentGitBranch, git, uxLog } from "../../../common/utils/index.js";
import { selectTargetBranch } from "../../../common/utils/gitUtils.js";
import { setConfig } from "../../../config/index.js";
import { prompts } from "../../../common/utils/prompts.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class RebuildSelection extends SfCommand<any> {
  public static title = "Select again";

  public static description = `Resets the selection that we want to add in the merge request

Calls a soft git reset behind the hood  
`;

  public static examples = ["$ sf hardis:work:resetsave"];

  // public static args = [{name: 'file'}];

  public static flags = {
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = flags.debug || false;

    const targetBranch = await selectTargetBranch({ message: "Please select the target branch of your current or future merge request" });

    uxLog(this, c.cyan(`This script will rebuild selection that you will want to merge into ${c.green(targetBranch)}`));

    const currentGitBranch = await getCurrentGitBranch();
    if (currentGitBranch === targetBranch) {
      throw new SfError(c.red("[sfdx-hardis] You can not revert commits of a protected branch !"));
    }

    // Ask user to confirm
    const confirm = await prompts({
      type: "confirm",
      message: `This command will git reset (soft) your branch ${currentGitBranch}. You will need to select and commit again your files. Are you sure ?`,
    });
    if (confirm.value === false) {
      throw new SfError(c.red("[sfdx-hardis] Cancelled by user"));
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
