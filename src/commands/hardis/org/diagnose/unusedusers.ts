/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { bulkQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { CONSTANTS } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUnusedUsers extends SfCommand<any> {
  public static title = 'Detect unused Users in Salesforce';

  public static description = `Efficient user management is vital in Salesforce to ensure resources are optimized and costs are controlled. However, inactive or unused user accounts can often go unnoticed, leading to wasted licenses and potential security risks. This tool addresses this challenge by enabling administrators to identify users who haven't logged in within a specified period.

By analyzing user login activity and last login timestamps, this feature highlights inactive user accounts, allowing administrators to take appropriate action. Whether it's deactivating dormant accounts, freeing up licenses, or ensuring compliance with security policies, this functionality empowers administrators to maintain a lean and secure Salesforce environment.

licensetypes values are the following:

- all-crm: SFDC,AUL,AUL1,AULL_IGHT

- all-paying: SFDC,AUL,AUL1,AULL_IGHT,PID_Customer_Community,PID_Customer_Community_Login,PID_Partner_Community,PID_Partner_Community_Login

Note: You can see the full list of available license identifiers in [Salesforce Documentation](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_userlicense.htm)

Use --returnactiveusers to revert the command and retrieve active users that has logged in during the period.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-inactive-users/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:org:diagnose:unusedusers',
    '$ sf hardis:org:diagnose:unusedusers --days 365',
    '$ sf hardis:org:diagnose:unusedusers --days 60 --licensetypes all-crm',
    '$ sf hardis:org:diagnose:unusedusers --days 60 --licenseidentifiers SFDC,AUL,AUL1',
    '$ sf hardis:org:diagnose:unusedusers --days 60 --licensetypes all-crm --returnactiveusers',
  ];

  //Comment default values to test the prompts
  public static flags: any = {
    outputfile: Flags.string({
      char: 'o',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    days: Flags.integer({
      char: 't',
      description:
        'Extracts the users that have been inactive for the amount of days specified. In CI, default is 180 days',
    }),
    licensetypes: Flags.string({
      char: 'l',
      options: ['all', 'all-crm', 'all-paying'],
      description: 'Type of licenses to check. If set, do not use licenseidentifiers option. In CI, default is all-crm',
    }),
    licenseidentifiers: Flags.string({
      char: 'i',
      description:
        'Comma-separated list of license identifiers, in case licensetypes is not used.. Identifiers available at https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_userlicense.htm',
    }),
    returnactiveusers: Flags.boolean({
      default: false,
      description: 'Inverts the command by returning the active users',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected licenseTypesCorrespondances = {
    all: 'all',
    'all-crm': 'SFDC,AUL,AUL1,AULL_IGHT',
    'all-paying':
      'SFDC,AUL,AUL1,AULL_IGHT,PID_Customer_Community,PID_Customer_Community_Login,PID_Partner_Community,PID_Partner_Community_Login',
  };

  protected returnActiveUsers = false;
  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected lastNdays: number | null;
  protected licenseTypes: string | null;
  protected licenseIdentifiers: string | null;
  protected users: any[] = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUnusedUsers);
    this.debugMode = flags.debug || false;
    this.returnActiveUsers = flags.returnactiveusers ?? false;
    this.outputFile = flags.outputfile || null;
    this.lastNdays = flags.days || null;
    this.licenseIdentifiers = flags.licenseidentifiers || null;
    this.licenseTypes = flags.licensetypes || null;

    // Calculate lastNdays to use
    await this.defineNumberOfInactiveDays();
    // Calculate license identifiers from input parameters or default values
    await this.defineLicenseIdentifiers();

    // Retrieve the list of users who haven't logged in for a while
    const conn = flags['target-org'].getConnection();
    uxLog(
      this,
      c.cyan(
        this.returnActiveUsers
          ? `Extracting active users on ${conn.instanceUrl} ...`
          : `Extracting active users who haven't logged in for a while on ${conn.instanceUrl} ...`
      )
    );
    this.users = await this.listUsersFromLicenses(conn);

    // Generate output CSV file
    if (this.users.length > 0) {
      this.outputFile = await generateReportPath(
        this.returnActiveUsers ? 'active-users' : 'unused-users',
        this.outputFile
      );
      this.outputFilesRes = await generateCsvFile(this.users, this.outputFile);
    }

    let summary;
    if (this.returnActiveUsers) {
      // Active users mode
      summary = `${this.users.length} users have logged in ${conn.instanceUrl} in the last ${this.lastNdays} days`;
    } else {
      // Inactive users mode
      const userSummaryInfo = this.users.length == 1 ? 'user has' : 'users have';
      summary = `No unused users have been found`;
      if (this.users.length === 0) {
        summary = `All users have logged in to ${conn.instanceUrl} within the last ${this.lastNdays} days!`;
      } else {
        this.statusCode = 1;
        summary = `${this.users.length} active ${userSummaryInfo} not logged in to ${conn.instanceUrl} in the last ${this.lastNdays} days!`;
      }

      if ((this.argv || []).includes('unusedusers')) {
        process.exitCode = this.statusCode;
      }
    }

    // Manage notifications
    await this.manageNotifications(this.users);

    if (this.users.length > 0 && !this.returnActiveUsers) {
      uxLog(this, c.yellow(summary));
    } else {
      uxLog(this, c.green(summary));
    }

    // Return an object to be displayed with --json
    return {
      status: this.statusCode,
      summary: summary,
      users: this.users,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes.xlsxFile,
    };
  }

  private async defineLicenseIdentifiers() {
    if (!this.licenseIdentifiers) {
      // Ask user if interactive mode
      if (!this.licenseTypes && !isCI) {
        const licenseTypesResponse = await prompts({
          type: 'select',
          name: 'licensetypes',
          message: 'Please select the type of licenses you want to detect ',
          choices: [
            { value: 'all', title: 'All licenses types' },
            { value: `all-crm`, title: 'Salesforce Licenses' },
            { value: `all-paying`, title: 'Salesforce Licences + Experience + Other paying' },
          ],
        });
        this.licenseTypes = licenseTypesResponse.licensetypes;
      } else if (!this.licenseTypes) {
        this.licenseTypes = 'all-crm';
      }
      // Get licenseIdentifiers from licenseType
      this.licenseIdentifiers = this.licenseTypesCorrespondances[this.licenseTypes || ''];
    }
  }

  private async defineNumberOfInactiveDays() {
    if (!this.lastNdays) {
      if (!isCI) {
        // If manual mode and days not sent as parameter, prompt user
        const lastNdaysResponse = await prompts({
          type: 'select',
          name: 'days',
          message: 'Please select the period to detect users.',
          choices: [
            { title: `1 day`, value: 1 },
            { title: `2 days`, value: 2 },
            { title: `3 days`, value: 3 },
            { title: `7 days`, value: 7 },
            { title: `30 days`, value: 30 },
            { title: `60 days`, value: 60 },
            { title: `3 months (90 days)`, value: 90 },
            { title: `6 months (180 days)`, value: 180 },
            { title: `1 year (365 days)`, value: 365 },
            { title: `2 years (730 days)`, value: 730 },
          ],
        });
        this.lastNdays = lastNdaysResponse.days;
      } else {
        this.lastNdays = this.returnActiveUsers ? 7 : 180;
      }
    }
  }

  private async listUsersFromLicenses(conn) {
    let whereConstraint = this.returnActiveUsers
      ? // Active users
      `WHERE IsActive = true AND (` +
      `(LastLoginDate >= LAST_N_DAYS:${this.lastNdays} AND LastLoginDate != NULL)` +
      `)`
      : // Inactive users
      `WHERE IsActive = true AND (` +
      `(LastLoginDate < LAST_N_DAYS:${this.lastNdays} AND LastLoginDate != NULL) OR ` +
      `(CreatedDate < LAST_N_DAYS:${this.lastNdays} AND LastLoginDate = NULL)` + // Check also for users never used
      `)`;
    // Add License constraint only if necessary
    if (this.licenseTypes !== 'all') {
      const licenseIdentifierValues = (this.licenseIdentifiers || '').split(',');
      const licenseIdentifierCondition = licenseIdentifierValues.map((value) => `'${value}'`).join(',');
      whereConstraint += ` AND Profile.UserLicense.LicenseDefinitionKey IN (${licenseIdentifierCondition})`;
    }
    // Build & call Bulk API Query
    const usersQuery =
      `SELECT Id, LastLoginDate, User.LastName, User.Firstname, Profile.UserLicense.Name, Profile.Name, Username, Profile.UserLicense.LicenseDefinitionKey, IsActive, CreatedDate ` +
      `FROM User ` +
      whereConstraint +
      ` ORDER BY LastLoginDate DESC`;
    const usersQueryRes = await bulkQuery(usersQuery, conn);
    return usersQueryRes.records;
  }

  private async manageNotifications(users: any[]) {
    const { flags } = await this.parse(DiagnoseUnusedUsers);
    // Build notification
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = this.returnActiveUsers
      ? `No active user has logged in in ${orgMarkdown}`
      : `No inactive user has been found in ${orgMarkdown}`;
    const notifDetailText = ``;
    let attachments: any[] = [];
    if (users.length > 0) {
      notifSeverity = this.returnActiveUsers ? 'log' : 'warning';
      notifText = this.returnActiveUsers
        ? `*${this.users.length}* active users have logged in to ${orgMarkdown} within the last ${this.lastNdays} days.`
        : `*${this.users.length}* active users have not logged in to ${orgMarkdown} within the last ${this.lastNdays} days.`;
      attachments = [{ text: notifDetailText }];
    }
    const metrics = this.returnActiveUsers ? { ActiveUsers: this.users.length } : { UnusedUsers: this.users.length };
    /* jscpd:ignore-start */
    // Send notifications
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: this.returnActiveUsers ? 'ACTIVE_USERS' : 'UNUSED_USERS',
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.users,
      data: { metric: this.users.length },
      metrics: metrics,
    });
    /* jscpd:ignore-end */
    return [];
  }
}
