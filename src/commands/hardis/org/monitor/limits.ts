/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { execSfdxJson, uxLog } from "../../../../common/utils";
import { getEnvVar } from "../../../../config";
import { NotifProvider, NotifSeverity } from "../../../../common/notifProvider";
import { MessageAttachment } from "@slack/web-api";
import { getNotificationButtons, getOrgMarkdown } from "../../../../common/utils/notifUtils";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class MonitorBackup extends SfdxCommand {
  public static title = "Check org limits";

  public static description = `Check limits of a SF org and send relatednotifications`;

  public static examples = ["$ sfdx hardis:org:monitor:limits"];

  protected static flagsConfig = {
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
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
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  protected limitThresoldWarning = Number(getEnvVar("LIMIT_THRESOLD_WARNING") || 50.0);
  protected limitThresoldError = Number(getEnvVar("LIMIT_THRESOLD_WARNING") || 75.0);

  protected limitEntries = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.outputFile = this.flags.outputfile || null;
    this.debugMode = this.flags.debug || false;

    // List org limits
    uxLog(this, c.cyan(`Run the org limits list command ...`));
    const limitsCommandRes = await execSfdxJson(`sf org limits list`, this, {
      fail: true,
      output: true,
      debug: this.debugMode,
    });
    this.limitEntries = limitsCommandRes.result
      .filter((limit) => limit?.max > 0)
      .map((limit) => {
        limit.used = limit.max - limit.remaining;
        limit.percentUsed = ((100 / limit.max) * limit.used).toFixed(2);
        limit.severity = limit.percentUsed > this.limitThresoldError ? "error" : limit.percentUsed > this.limitThresoldWarning ? "warning" : "info";
        return limit;
      });

    console.table(this.limitEntries);

    this.outputFile = await generateReportPath("lint-unusedmetadatas", this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.limitEntries, this.outputFile);

    const limitsError = this.limitEntries.filter((limit) => limit.severity === "error");
    const numberLimitsError = limitsError.length;
    const limitsWarning = this.limitEntries.filter((limit) => limit.severity === "warning");
    const numberLimitsWarning = limitsWarning.length;

    // Build notifications
    const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = "log";
    let notifText = `No limit issues detected in ${orgMarkdown}`;
    const notifAttachments: MessageAttachment[] = [];

    // Dangerous limits has been found
    if (numberLimitsError > 0) {
      notifSeverity = "error";
      notifText = `Limit severe alerts have been detected in ${orgMarkdown} (error: ${numberLimitsError}, warning: ${numberLimitsWarning})`;
      const errorText = `*Error Limits*\n${limitsError
        .map((limit) => `• ${limit.name}: ${limit.percentUsed.toFixed(2)}% used (${limit.used}/${limit.max})`)
        .join("\n")}`;
      notifAttachments.push({
        text: errorText,
      });
      uxLog(this, c.red(notifText + "\n" + errorText));
      process.exitCode = 1;
    }
    // Warning limits detected
    else if (numberLimitsWarning > 0) {
      notifSeverity = "warning";
      notifText = `Limit warning alerts have been detected in ${orgMarkdown} (${numberLimitsWarning})`;
      const warningText = `*Warning Limits*\n${limitsWarning
        .map((limit) => `• ${limit.name}: ${limit.percentUsed.toFixed(2)}% used (${limit.used}/${limit.max})`)
        .join("\n")}`;
      notifAttachments.push({
        text: warningText,
      });
      uxLog(this, c.yellow(notifText + "\n" + warningText));
    } else {
      uxLog(this, c.green("No limit issue has been found"));
    }

    // Post notifications
    globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: "ORG_LIMITS",
      text: notifText,
      buttons: notifButtons,
      attachments: notifAttachments,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.limitEntries,
      metric: numberLimitsWarning + numberLimitsError,
    });

    return { outputString: "Limits check on org " + this.org.getConnection().instanceUrl, limitEntries: this.limitEntries };
  }
}
