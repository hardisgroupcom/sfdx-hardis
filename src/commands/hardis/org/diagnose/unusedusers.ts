/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { bulkQuery } from "../../../../common/utils/apiUtils";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";
import { NotifProvider } from "../../../../common/notifProvider";
import { getNotificationButtons, getOrgMarkdown } from "../../../../common/utils/notifUtils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DiagnoseUnusedUsers extends SfdxCommand {
  public static title = "Detect unused Users in Salesforce";

  public static description = `Efficient user management is vital in Salesforce to ensure resources are optimized and costs are controlled. However, inactive or unused user accounts can often go unnoticed, leading to wasted licenses and potential security risks. This tool addresses this challenge by enabling administrators to identify users who haven't logged in within a specified period.

  By analyzing user login activity and last login timestamps, this feature highlights inactive user accounts, allowing administrators to take appropriate action. Whether it's deactivating dormant accounts, freeing up licenses, or ensuring compliance with security policies, this functionality empowers administrators to maintain a lean and secure Salesforce environment.`;


  public static examples = ["$ sfdx hardis:org:diagnose:unusedusers", "$ sfdx hardis:org:diagnose:unusedusers --days 365"];

  protected static flagsConfig = {
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
    }),
    days: flags.number({
      char: "t",
      description: "Number of days to extract from today (included)",
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
  protected static requiresProject = false;

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected lastNdays: number;
  protected unusedUsers = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.outputFile = this.flags.outputfile || null;
    this.lastNdays = this.flags.days;
    this.debugMode = this.flags.debug || false;
    this.outputFile = this.flags.outputfile || null;

    // If manual mode and days not sent as parameter, prompt user
    if (!isCI && !this.lastNdays) {
      const lastNdaysResponse = await prompts({
        type: "select",
        name: "days",
        message: "Please select the period to detect inactive active users.",
        choices: [
          { title: `7 days`, value: 7 },
          { title: `30 days`, value: 30 },
          { title: `90 days`, value: 90 },
          { title: `6 months (180 days)`, value: 180 },
          { title: `1 year (365 days)`, value: 365 },
          { title: `2 years (730 days)`, value: 730 }
        ],
      });
      this.lastNdays = lastNdaysResponse.days;
    }

    const conn = this.org.getConnection();
    uxLog(this, c.cyan(`Extracting active users who haven't logged in for a while on ${conn.instanceUrl} ...`));

    // Retrieve the list of users who haven't logged in for a while
    this.unusedUsers = await this.listUnusedUsersWithSfdcLicense(conn);

    // Generate output CSV file
    if (this.unusedUsers.length > 0) {
      this.outputFile = await generateReportPath("unused-users", this.outputFile);
      this.outputFilesRes = await generateCsvFile(this.unusedUsers, this.outputFile);
    }

    // Manage notifications
    await this.manageNotifications();

    const userSummaryInfo = this.unusedUsers.length == 1 ? 'user has' : 'users have'
    let msg = `No unused users have been found`;
    let summary;
    if(this.unusedUsers.length == 0){
      summary = `All users have logged in to ${conn.instanceUrl} within the last ${this.lastNdays} days!`;
    } else {
      this.statusCode = 1;
      msg = `${this.unusedUsers.length} unused ${userSummaryInfo} been found`;
      summary = `${this.unusedUsers.length} active ${userSummaryInfo} not logged in to ${conn.instanceUrl} in the last ${this.lastNdays} days!`;
    }

    if ((this.argv || []).includes("unusedusers")) {
      process.exitCode = this.statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: this.statusCode,
      message: msg,
      summary: summary,
      unusedUsers: this.unusedUsers,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes.xlsxFile,
    };
  }

  private async listUnusedUsersWithSfdcLicense(conn) {
    const whereConstraint = `WHERE IsActive = true AND LastLoginDate != LAST_N_DAYS:${this.lastNdays} AND LastLoginDate != NULL AND Profile.UserLicense.LicenseDefinitionKey = 'SFDC' `;
    const unusedUsersQuery =
      `SELECT Id, Username, LastLoginDate, IsActive, Profile.UserLicense.LicenseDefinitionKey ` +
      `FROM User ` +
      whereConstraint +
      `ORDER BY LastLoginDate DESC`;
    uxLog(this, c.grey("Query: " + c.italic(unusedUsersQuery)));
    const unusedUsersQueryRes = await bulkQuery(unusedUsersQuery, conn);

    return unusedUsersQueryRes.records;
  }

  private async manageNotifications() {
    if (this.unusedUsers.length > 0) {
      let notifDetailText = ``;
      notifDetailText += "*Related users*:\n";
      for (const user of this.unusedUsers) {
        notifDetailText += `• ${user}\n`;
      }

      const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
      const notifButtons = await getNotificationButtons();
      globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
      NotifProvider.postNotifications({
        type: "UNUSED_USERS",
        text: `${this.unusedUsers.length} active users have not logged in to ${orgMarkdown} within the last ${this.lastNdays} days.`,
        attachments: [{ text: notifDetailText }],
        buttons: notifButtons,
        severity: "warning",
        attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      });
    }
    return [];
  }
}