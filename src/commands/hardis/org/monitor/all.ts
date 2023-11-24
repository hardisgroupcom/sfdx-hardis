/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { execCommand, uxLog } from "../../../../common/utils";
import { getConfig } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class MonitorAll extends SfdxCommand {
  public static title = "Monitor org";

  public static description = `Monitor org, generate reports and sends notifications

A default list of monitoring commands is used, if you want to override it you can define property **monitoringCommands** in your .sfdx-hardis.yml file

Example:

\`\`\`yaml
monitoringCommands:
  - title: Detect calls to deprecated API versions
    command: sfdx hardis:org:diagnose:legacyapi
  - title: Detect suspect setup actions in major orgs
    command: sfdx hardis:org:diagnose:audittrail
  - title: Detect custom elements with no access rights defined in permission sets
    command: sfdx hardis:lint:access
  - title: My Custom command
    command: sfdx my:custom:command
\`\`\`
`;

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

    const monitoringCommandsDefault = [
      { title: "Detect suspect setup actions in major org", command: "sfdx hardis:org:diagnose:audittrail" },
      { title: "Detect calls to deprecated API versions", command: "sfdx hardis:org:diagnose:legacyapi" },
      { title: "Detect custom elements with no access rights defined in permission sets", command: "sfdx hardis:lint:access" },
      { title: "Detect custom labels and custom permissions that are not in use", command: "sfdx hardis:lint:unusedmetadatas" },
      { title: "Detect inactive metadata", command: "sfdx hardis:lint:metadatastatus" },
      { title: "Detect missing description on custom field", command: "sfdx hardis:lint:missingattributes" },
    ];
    const config = await getConfig("user");
    const commands = config.monitoringCommands || monitoringCommandsDefault;

    let success = true;
    const commandsSummary = [];
    for (const command of commands) {
      uxLog(this, c.cyan(`Running monitoring command ${c.bold(command.title)}`));
      const execCommandResult = await execCommand(command.command, this, { fail: false, output: true });
      if (execCommandResult.status === 0) {
        uxLog(this, c.green(`Command ${c.bold(command.title)} has been run successfully`));
      } else {
        success = false;
        uxLog(this, c.yellow(`Command ${c.bold(command.title)} has encountered error(s)`));
      }
      commandsSummary.push({
        title: command.title,
        status: execCommandResult.status === 0 ? "success" : "failure",
        command: command.command,
      });
    }

    uxLog(this, c.cyan("Summary of monitoring scripts"));
    console.table(commandsSummary);
    uxLog(this, c.cyan("You can check details in reports in Job Artifacts"));

    uxLog(this, c.yellow("To know more about sfdx-hardis monitoring, please check https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/"));

    // Exit code is 1 if monitoring detected stuff
    if (success === false) {
      process.exitCode = 1;
    }
    return { outputString: "Monitoring processed on org " + this.org.getConnection().instanceUrl };
  }
}
