/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { execCommand, execSfdxJson, uxLog } from "../../../common/utils";
import { prompts } from "../../../common/utils/prompts";
import * as c from "chalk";
import * as sortArray from "sort-array";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchDelete extends SfdxCommand {
  public static title = "Delete scratch orgs(s)";

  public static description = "Assisted menu to delete scratch orgs associated to a DevHub";

  public static examples = ["$ sfdx hardis:scratch:delete"];

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
  protected static requiresDevhubUsername = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const debugMode = this.flags.debug || false;

    // List all scratch orgs referenced on local computer
    const orgListRequest = "sf org list";
    const hubOrgUsername = this.hubOrg.getUsername();
    const orgListResult = await execSfdxJson(orgListRequest, this, { fail: true, output: false, debug: debugMode });
    const scratchOrgsSorted = sortArray(orgListResult?.result?.scratchOrgs || [], {
      by: ["username", "alias", "instanceUrl"],
      order: ["asc", "asc", "asc"],
    });
    const scratchOrgChoices = scratchOrgsSorted
      .filter((scratchInfo) => {
        return scratchInfo.devHubUsername === hubOrgUsername;
      })
      .map((scratchInfo) => {
        return {
          title: scratchInfo.username,
          description: `${scratchInfo.instanceUrl}, last used on ${new Date(scratchInfo.lastUsed).toLocaleDateString()}`,
          value: scratchInfo,
        };
      });

    // Request user which scratch he/she wants to delete
    const scratchToDeleteRes = await prompts({
      type: "multiselect",
      name: "value",
      message: c.cyanBright("Please select the list of scratch orgs you want to delete"),
      choices: scratchOrgChoices,
    });

    // Delete scratch orgs
    for (const scratchOrgToDelete of scratchToDeleteRes.value) {
      const deleteCommand = `sf org delete scratch --no-prompt --target-org ${scratchOrgToDelete.username}`;
      await execCommand(deleteCommand, this, { fail: false, debug: debugMode, output: true });
      uxLog(this, c.cyan(`Scratch org ${c.green(scratchOrgToDelete.username)} at ${scratchOrgToDelete.instanceUrl} has been deleted`));
    }

    // Return an object to be displayed with --json
    return { outputString: "Deleted scratch orgs" };
  }
}
