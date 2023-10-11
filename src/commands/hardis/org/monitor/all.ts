/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { execCommand, uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class MonitorAll extends SfdxCommand {
  public static title = "Monitor org";

  public static description = "Monitor org, generate reports and sends notifications";

  public static examples = ["$ sfdx hardis:org:monitor:all"];

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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    // Build target org full manifest
    uxLog(this, c.cyan("Running monitoring scripts for org " + c.bold(this.org.getConnection().instanceUrl)) + " ...");

    const commands = ["sfdx hardis:org:diagnose:legacyapi"];

    for (const command of commands) {
      const execCommandResult = await execCommand(command, this, { fail: false, output: true });
      uxLog(this, c.gray(JSON.stringify(execCommandResult, null, 2)));
    }

    return { outputString: "Monitoring processed on org " + this.org.getConnection().instanceUrl };
  }
}
