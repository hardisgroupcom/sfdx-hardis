/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { bulkQuery } from "../../../../common/utils/apiUtils";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";
import { NotifProvider, NotifSeverity } from "../../../../common/notifProvider";
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

By analyzing user login activity and last login timestamps, this feature highlights inactive user accounts, allowing administrators to take appropriate action. Whether it's deactivating dormant accounts, freeing up licenses, or ensuring compliance with security policies, this functionality empowers administrators to maintain a lean and secure Salesforce environment.

licensetypes values are the following:

- all-crm: SFDC,AUL,AUL1,AULL_IGHT

- all-paying: SFDC,AUL,AUL1,AULL_IGHT,PID_Customer_Community,PID_Customer_Community_Login,PID_Partner_Community,PID_Partner_Community_Login

Note: You can see the full list of available license identifiers in [Salesforce Documentation](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_userlicense.htm)
`;


  public static examples = [
    "$ sfdx hardis:org:diagnose:unusedusers",
    "$ sfdx hardis:org:diagnose:unusedusers --days 365",
    "$ sfdx hardis:org:diagnose:unusedusers --days 60 --licensetypes all-crm",
    "$ sfdx hardis:org:diagnose:unusedusers --days 60 --licenseidentifiers SFDC,AUL,AUL1"
  ];

  //Comment default values to test the prompts
  protected static flagsConfig = {
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
    }),
    days: flags.number({
      char: "t",
      default: 100,
      description: "Extracts the users that have been inactive for the amount of days specified.",
    }),
    licensetypes: flags.enum({
      char: "l",
      options: ["all", "all-crm", "all-paying"],
      description: "Type of licenses to check. If set, do not use licenseidentifiers option",
    }),
    licenseidentifiers: flags.string({
      char: "i",
      description: "Comma-separated list of license identifiers, in case licensetypes is not used.. Identifiers available at https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_userlicense.htm",
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

  protected licenseTypesCorrespondances = {
    'all': 'all',
    'all-crm': 'SFDC,AUL,AUL1,AULL_IGHT',
    'all-paying': 'SFDC,AUL,AUL1,AULL_IGHT,PID_Customer_Community,PID_Customer_Community_Login,PID_Partner_Community,PID_Partner_Community_Login'
  }


  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected lastNdays: number;
  protected licenseTypes: string;
  protected licenseIdentifiers: string;
  protected unusedUsers = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.outputFile = this.flags.outputfile || null;
    this.lastNdays = this.flags.days || null;
    this.licenseIdentifiers = this.flags.licenseidentifiers || null;
    this.licenseTypes = this.flags.licensetypes;

    // Calculate lastNdays to use
    await this.defineNumberOfInactiveDays();
    // Calculate license identifiers from input parameters or default values
    await this.defineLicenseIdentifiers();

    // Retrieve the list of users who haven't logged in for a while
    const conn = this.org.getConnection();
    uxLog(this, c.cyan(`Extracting active users who haven't logged in for a while on ${conn.instanceUrl} ...`));
    this.unusedUsers = await this.listUnusedUsersWithSfdcLicense(conn);

    // Generate output CSV file
    if (this.unusedUsers.length > 0) {
      this.outputFile = await generateReportPath("unused-users", this.outputFile);
      this.outputFilesRes = await generateCsvFile(this.unusedUsers, this.outputFile);
    }

    const userSummaryInfo = this.unusedUsers.length == 1 ? 'user has' : 'users have'
    let summary = `No unused users have been found`;
    if (this.unusedUsers.length === 0) {
      summary = `All users have logged in to ${conn.instanceUrl} within the last ${this.lastNdays} days!`;
    } else {
      this.statusCode = 1;
      summary = `${this.unusedUsers.length} active ${userSummaryInfo} not logged in to ${conn.instanceUrl} in the last ${this.lastNdays} days!`;
    }

    if ((this.argv || []).includes("unusedusers")) {
      process.exitCode = this.statusCode;
    }

    // Manage notifications
    await this.manageNotifications(this.unusedUsers);

    if (this.unusedUsers.length > 0) {
      uxLog(this, c.yellow(summary));
      console.table(this.unusedUsers);
    }
    else {
      uxLog(this, c.green(summary));
    }

    // Return an object to be displayed with --json
    return {
      status: this.statusCode,
      summary: summary,
      unusedUsers: this.unusedUsers,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes.xlsxFile,
    };
  }

  private async defineLicenseIdentifiers() {
    if (!this.licenseIdentifiers) {
      // Ask user if interactive mode
      if (!this.licenseTypes && !isCI) {
        const licenseTypesResponse = await prompts({
          type: "select",
          name: "licensetypes",
          message: "Please select the period to detect inactive active users.",
          choices: [
            { title: 'all', value: 'all' },
            { title: `all-crm`, value: 'SFDC,AUL,AUL1,AULL_IGHT' },
            { title: `all-paying`, value: 'SFDC,AUL,AUL1,AULL_IGHT,PID_Customer_Community,PID_Customer_Community_Login,PID_Partner_Community,PID_Partner_Community_Login' },
          ],
        });
        this.licenseTypes = licenseTypesResponse.licensetypes;
      }
      else {
        this.licenseTypes = "all-crm";
      }
      // Get licenseIdentifiers from licenseType
      this.licenseIdentifiers = this.licenseTypesCorrespondances[this.licenseTypes];
    }
  }

  private async defineNumberOfInactiveDays() {
    if (!this.lastNdays) {
      if (!isCI) {
        // If manual mode and days not sent as parameter, prompt user
        const lastNdaysResponse = await prompts({
          type: "select",
          name: "days",
          message: "Please select the period to detect inactive active users.",
          choices: [
            { title: `7 days`, value: 7 },
            { title: `30 days`, value: 30 },
            { title: `60 days`, value: 60 },
            { title: `3 months (90 days)`, value: 90 },
            { title: `6 months (180 days)`, value: 180 },
            { title: `1 year (365 days)`, value: 365 },
            { title: `2 years (730 days)`, value: 730 }
          ],
        });
        this.lastNdays = lastNdaysResponse.days;
      }
      else {
        this.lastNdays = 90;
      }
    }
  }

  private async listUnusedUsersWithSfdcLicense(conn) {
    let whereConstraint = `WHERE IsActive = true AND (` +
      `(LastLoginDate != LAST_N_DAYS:${this.lastNdays} AND LastLoginDate != NULL) OR ` +
      `(CreatedDate != LAST_N_DAYS:${this.lastNdays} AND LastLoginDate == NULL)` + // Check also for users never used
      `)`;
    // Add License constraint only if necessary
    if (this.licenseTypes !== 'all') {
      const licenseTypeValues = this.licenseTypes.split(',');
      const licenseTypeCondition = licenseTypeValues.map(value => `'${value}'`).join(',');
      whereConstraint += ` AND Profile.UserLicense.LicenseDefinitionKey IN (${licenseTypeCondition})`;
    }
    // Build & call Bulk API Query
    const unusedUsersQuery =
      `SELECT Id, User.Firstname, User.LastName, Profile.Name, Username, LastLoginDate, IsActive, Profile.UserLicense.LicenseDefinitionKey ` +
      `FROM User ` +
      whereConstraint +
      ` ORDER BY LastLoginDate DESC`;
    const unusedUsersQueryRes = await bulkQuery(unusedUsersQuery, conn);
    return unusedUsersQueryRes.records;
  }

  private async manageNotifications(unusedUsers: any[]) {
    // Build notification
    const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = "log";
    let notifText = `No unused Permission Set Licenses Assignments has been found in ${orgMarkdown}`;
    const notifDetailText = ``;
    let attachments = [];
    if (unusedUsers.length > 0) {
      notifSeverity = "warning";
      notifText = `${this.unusedUsers.length} active users have not logged in to ${orgMarkdown} within the last ${this.lastNdays} days.`;
      attachments = [{ text: notifDetailText }];
    }
    // Send notifications
    globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: "UNUSED_LICENSES",
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.unusedUsers,
      data: { metric: this.unusedUsers.length },
      metrics: {
        UnusedUsers: this.unusedUsers.length,
      },
    });
    return [];
  }
}
