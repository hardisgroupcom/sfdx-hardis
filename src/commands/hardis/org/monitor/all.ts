/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { execCommand, uxLog } from "../../../../common/utils/index.js";
import { getConfig, getEnvVar } from "../../../../config/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class MonitorAll extends SfCommand<any> {
  public static title = "Monitor org";

  public static description = `Monitor org, generate reports and sends notifications

You can disable some commands defining either a **monitoringDisable** property in \`.sfdx-hardis.yml\`, or a comma separated list in env variable **MONITORING_DISABLE**

Example in .sfdx-hardis.yml:
  
\`\`\`yaml
monitoringDisable:
  - METADATA_STATUS
  - MISSING_ATTRIBUTES
  - UNUSED_METADATAS
\`\`\`
  
Example in env var:

\`\`\`sh
MONITORING_DISABLE=METADATA_STATUS,MISSING_ATTRIBUTES,UNUSED_METADATAS
\`\`\`

A [default list of monitoring commands](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/#monitoring-commands) is used, if you want to override it you can define property **monitoringCommands** in your .sfdx-hardis.yml file

Example:

\`\`\`yaml
monitoringCommands:
  - title: My Custom command
    command: sf my:custom:command
  - title: My Custom command 2
    command: sf my:other:custom:command
\`\`\`

You can force the daily run of all commands by defining env var \`MONITORING_IGNORE_FREQUENCY=true\`

`;

  public static examples = ["$ sf hardis:org:monitor:all"];

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
  };




  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = flags.debug || false;

    // Build target org full manifest
    uxLog(this, c.cyan("Running monitoring scripts for org " + c.bold(flags['target-org'].getConnection().instanceUrl)) + " ...");

    const monitoringCommandsDefault = [
      {
        key: "AUDIT_TRAIL",
        title: "Detect suspect setup actions in major org",
        command: "sf hardis:org:diagnose:audittrail",
        frequency: "daily",
      },
      {
        key: "LEGACY_API",
        title: "Detect calls to deprecated API versions",
        command: "sf hardis:org:diagnose:legacyapi",
        frequency: "daily",
      },
      {
        key: "ORG_LIMITS",
        title: "Detect if org limits are close to be reached",
        command: "sf hardis:org:monitor:limits",
        frequency: "daily",
      },
      {
        key: "LICENSES",
        title: "Extract licenses information",
        command: "sf hardis:org:diagnose:licenses",
        frequency: "weekly",
      },
      {
        key: "LINT_ACCESS",
        title: "Detect custom elements with no access rights defined in permission sets",
        command: "sf hardis:lint:access",
        frequency: "weekly",
      },
      {
        key: "UNUSED_LICENSES",
        title: "Detect permission set licenses that are assigned to users that do not need them",
        command: "sf hardis:org:diagnose:unusedlicenses",
        frequency: "weekly",
      },
      {
        key: "UNUSED_USERS",
        title: "Detect active users without recent logins",
        command: "sf hardis:org:diagnose:unusedusers",
        frequency: "weekly",
      },
      {
        key: "ACTIVE_USERS",
        title: "Detect active users with recent logins",
        command: "sf hardis:org:diagnose:unusedusers --returnactiveusers",
        frequency: "weekly",
      },
      {
        key: "ORG_INFO",
        title: "Get org info + SF instance info + next major upgrade date",
        command: "sf hardis:org:diagnose:instanceupgrade",
        frequency: "weekly",
      },
      {
        key: "UNUSED_METADATAS",
        title: "Detect custom labels and custom permissions that are not in use",
        command: "sf hardis:lint:unusedmetadatas",
        frequency: "weekly",
      },
      {
        key: "METADATA_STATUS",
        title: "Detect inactive metadata",
        command: "sf hardis:lint:metadatastatus",
        frequency: "weekly",
      },
      {
        key: "MISSING_ATTRIBUTES",
        title: "Detect missing description on custom field",
        command: "sf hardis:lint:missingattributes",
        frequency: "weekly",
      },
    ];
    const config = await getConfig("user");
    const commands = monitoringCommandsDefault.concat(config.monitoringCommands || []);
    const monitoringDisable = config.monitoringDisable ?? (process.env?.MONITORING_DISABLE ? process.env.MONITORING_DISABLE.split(",") : []);

    let success = true;
    const commandsSummary: any[] = [];
    for (const command of commands) {
      if (monitoringDisable.includes(command.key)) {
        uxLog(this, c.grey(`Skipped command ${c.bold(command.key)} according to custom configuration`));
        continue;
      }
      if (command?.frequency === "weekly" && new Date().getDay() !== 6 && getEnvVar("MONITORING_IGNORE_FREQUENCY") !== "true") {
        uxLog(this, c.grey(`Skipped command ${c.bold(command.key)} as its frequency is defined as weekly and we are not Saturday`));
        continue;
      }
      // Run command
      uxLog(this, c.cyan(`Running monitoring command ${c.bold(command.title)} (key: ${c.bold(command.key)})`));
      try {
        const execCommandResult = await execCommand(command.command, this, { fail: false, output: true });
        if (execCommandResult.status === 0) {
          uxLog(this, c.green(`Command ${c.bold(command.title)} has been run successfully`));
        } else {
          success = false;
          uxLog(this, c.yellow(`Command ${c.bold(command.title)} has failed`));
        }
        commandsSummary.push({
          title: command.title,
          status: execCommandResult.status === 0 ? "success" : "failure",
          command: command.command,
        });
      } catch (e) {
        // Handle unexpected failure
        success = false;
        uxLog(this, c.yellow(`Command ${c.bold(command.title)} has failed !\n${(e as Error).message}`));
        commandsSummary.push({
          title: command.title,
          status: "error",
          command: command.command,
        });
      }
    }

    uxLog(this, c.cyan("Summary of monitoring scripts"));
    console.table(commandsSummary);
    uxLog(this, c.cyan("You can check details in reports in Job Artifacts"));

    uxLog(this, c.yellow("To know more about sfdx-hardis monitoring, please check https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/"));

    // Exit code is 1 if monitoring detected stuff
    if (success === false) {
      process.exitCode = 1;
    }
    return { outputString: "Monitoring processed on org " + flags['target-org'].getConnection().instanceUrl };
  }
}
