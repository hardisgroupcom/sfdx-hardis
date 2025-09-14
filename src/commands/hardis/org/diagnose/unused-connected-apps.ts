/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from "path";
import { createTempDir, execCommand, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import moment from 'moment';
import { CONSTANTS } from '../../../../config/index.js';
import sortArray from 'sort-array';
import { createBlankSfdxProject } from '../../../../common/utils/projectUtils.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUnusedConnectedApps extends SfCommand<any> {
  public static title = 'Unused Connected Apps in an org';

  public static allowedInactiveConnectedApps = [
    "Ant Migration Tool",
    "Chatter Desktop",
    "Chatter Mobile for BlackBerry",
    "Force.com IDE",
    "OIQ_Integration",
    "Salesforce CLI",
    "Salesforce Files",
    "Salesforce Mobile Dashboards",
    "Salesforce Touch",
    "Salesforce for Outlook",
    "SalesforceA",
    "SalesforceA for Android",
    "SalesforceA for iOS",
    "SalesforceDX Namespace Registry",
    "SalesforceIQ"
  ]

  public static description = `
## Command Behavior

**Identifies and reports on potentially unused Connected Apps in a Salesforce org, suggesting candidates for deletion or deactivation.**

This command helps improve org security and reduce technical debt by pinpointing Connected Apps that are no longer actively used. Connected Apps can pose security risks if left unmonitored, and cleaning them up contributes to a healthier Salesforce environment.

Key functionalities:

- **Connected App Data Collection:** Gathers information about all Connected Apps in the org, including creation and last modified dates, and associated users.
- **Usage Analysis:** Analyzes \`LoginHistory\` and \`OAuthToken\` records to determine the last usage date of each Connected App.
- **Inactivity Detection:** Flags Connected Apps as potentially unused if they have no recent login history or OAuth token usage.
- **Accessibility Check:** Examines Connected App metadata to identify if they are accessible (e.g., if they require admin approval and have no profiles or permission sets assigned).
- **Ignored Apps:** Automatically ignores a predefined list of common Salesforce Connected Apps (e.g., \`Salesforce CLI\`, \`Salesforce Mobile Dashboards\`). You can extend this list by defining the \`ALLOWED_INACTIVE_CONNECTED_APPS\` environment variable.
- **CSV Report Generation:** Generates a CSV file containing details of all analyzed Connected Apps, including their usage status, last usage date, and reasons for being flagged as potentially unused.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with a summary of potentially unused Connected Apps.

**Default Ignored Connected Apps:**

- ${this.allowedInactiveConnectedApps.join("\n- ")}

You can add more ignored apps by defining a comma-separated list of names in the \`ALLOWED_INACTIVE_CONNECTED_APPS\` environment variable.

_Example: 
ALLOWED_INACTIVE_CONNECTED_APPS=My App 1,My App 2, My App 3_

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-unused-connected-apps/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce SOQL Queries:** It performs SOQL queries against \`ConnectedApplication\`, \`LoginHistory\`, and \`OAuthToken\` objects to gather comprehensive data about Connected Apps and their usage.
- **Temporary SFDX Project:** It creates a temporary SFDX project to retrieve Connected App metadata, allowing for local parsing and analysis of their XML files.
- **Metadata Parsing:** It parses the \`connectedApp-meta.xml\` files to check for \`isAdminApproved\` and the presence of \`profileName\` or \`permissionsetName\` to determine accessibility.
- **Data Correlation:** It correlates data from various Salesforce objects to build a complete picture of each Connected App's usage and status.
- **Date Calculation:** Uses \`moment\` to calculate the time since the last OAuth token usage.
- **Report Generation:** It uses \`generateCsvFile\` to create the CSV report of unused Connected Apps.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications, including attachments of the generated CSV report and metrics for monitoring dashboards.
- **File System Operations:** Uses \`fs-extra\` for creating and removing temporary directories and files.
- **Environment Variable Reading:** Reads the \`ALLOWED_INACTIVE_CONNECTED_APPS\` environment variable to customize the list of ignored Connected Apps.
</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:unused-connected-apps',
  ];

  public static flags: any = {
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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

  public static requiresProject = false;

  protected debugMode = false;

  protected tmpSfdxProjectPath: string;
  protected connectedAppResults: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUnusedConnectedApps);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    const conn = flags['target-org'].getConnection();

    // Collect all Connected Apps
    uxLog("action", this, c.cyan(`Extracting the whole list of Connected Apps from ${conn.instanceUrl} ...`));
    const allConnectedAppsQuery =
      `SELECT Name,CreatedBy.Name,CreatedDate,LastModifiedBy.Name,LastModifiedDate,OptionsAllowAdminApprovedUsersOnly FROM ConnectedApplication ORDER BY Name`;
    const allConnectedAppsQueryRes = await soqlQuery(allConnectedAppsQuery, conn);
    const allConnectedApps = allConnectedAppsQueryRes.records;

    // Collect all Connected Apps metadata in a blank project
    const tmpDirForSfdxProject = await createTempDir();
    this.tmpSfdxProjectPath = await createBlankSfdxProject(tmpDirForSfdxProject);
    uxLog("action", this, c.cyan(`Retrieve ConnectedApp Metadatas from ${conn.instanceUrl} ...`));
    await execCommand(
      `sf project retrieve start -m ConnectedApp --target-org ${conn.username}`,
      this,
      { cwd: this.tmpSfdxProjectPath, fail: true, output: true });

    // Collect all Connected Apps used in LoginHistory table
    uxLog("action", this, c.cyan(`Extracting all applications found in LoginHistory object from ${conn.instanceUrl} ...`));
    const allAppsInLoginHistoryQuery =
      `SELECT Application FROM LoginHistory GROUP BY Application ORDER BY Application`;
    const allAppsInLoginHistoryQueryRes = await soqlQuery(allAppsInLoginHistoryQuery, conn);
    const allAppsInLoginHistoryNames = allAppsInLoginHistoryQueryRes.records.map(loginHistory => loginHistory.Application);

    // Perform analysis
    uxLog("action", this, c.cyan(`Starting analysis...`));
    this.connectedAppResults = await Promise.all(allConnectedApps.map(async (connectedApp) => {
      return await this.analyzeConnectedApp(allAppsInLoginHistoryNames, connectedApp, conn);
    }));

    uxLog("log", this, c.grey(`Analysis complete. Deleting temporary project files...`));
    await fs.rm(tmpDirForSfdxProject, { recursive: true });

    this.connectedAppResults = sortArray(this.connectedAppResults,
      {
        by: ['severity', 'Name'],
        order: ['severity', 'asc'],
        customOrders: {
          severity: ["critical", "error", "warning", "info", "success", "log"]
        }
      }) as any[];
    const numberWarnings = this.connectedAppResults.filter(app => app.severity === "warning").length;

    // Process result
    if (this.connectedAppResults.length > 0) {

      // Build notification
      const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
      const notifButtons = await getNotificationButtons();
      const notifSeverity: NotifSeverity = numberWarnings > 0 ? 'warning' : 'log';
      const notifText = `${numberWarnings} Connected Apps to check have been found in ${orgMarkdown}`
      let notifDetailText = '';
      for (const connectedApp of this.connectedAppResults.filter(app => app.severity === "warning")) {
        notifDetailText += `• *${connectedApp.Name}*\n`;
      }
      const notifAttachments = [{ text: notifDetailText }];
      // Post notif
      await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
      await NotifProvider.postNotifications({
        type: 'CONNECTED_APPS',
        text: notifText,
        attachments: notifAttachments,
        buttons: notifButtons,
        severity: notifSeverity,
        attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
        logElements: this.connectedAppResults,
        data: { metric: numberWarnings },
        metrics: {
          ConnectedApps: numberWarnings,
        },
      });

      // Display output
      const connectedAppsLight = this.connectedAppResults.filter(app => app.severity === "warning").map(connectedApp => {
        return {
          SeverityIcon: connectedApp.severityIcon,
          ConnectedApp: connectedApp.Name,
          AppLastModifiedDate: moment(connectedApp.LastModifiedDate).format('ll'),
          AppLastModifiedBy: connectedApp.LastModifiedBy,
          LastOAuthUsageDate: connectedApp.LastOAuthUsageDate ? moment(connectedApp.LastOAuthUsageDate).format('ll') : '',
          LastOAuthUsageBy: connectedApp.LastOAuthUsageDate,
          SeverityReason: connectedApp.severityReason,
        }
      })
      uxLog("action", this, c.cyan(`Found ${c.bold(numberWarnings)} Connected Apps to check.`));
      uxLogTable(this, connectedAppsLight);

      // Generate output CSV file
      this.outputFile = await generateReportPath('connected-apps', this.outputFile);
      this.outputFilesRes = await generateCsvFile(this.connectedAppResults, this.outputFile, { fileTitle: 'Connected Apps Analysis' });
    }

    // Return an object to be displayed with --json
    return {
      status: numberWarnings > 0 ? 1 : 0,
      allConnectedAppResults: this.connectedAppResults,
      csvLogFile: this.outputFile,
    };
  }

  private async analyzeConnectedApp(allAppsInLoginHistoryNames: any, connectedApp: any, conn: any) {
    let loginHistoryFound = true;
    let reason = "Found in Login History"
    let severity: NotifSeverity = !allAppsInLoginHistoryNames.includes(connectedApp.Name) ? 'warning' : 'log';
    if (severity === "warning") {
      loginHistoryFound = false;
      reason = "Not Found in Login History";
    }
    // Check OAuthToken
    ({ severity, reason } = await this.checkOAuthToken(connectedApp, conn, loginHistoryFound, severity, reason));

    // If OAuthToken < 6 months found, check on the metadata if the app is not available
    if (severity === "warning") {
      ({ severity, reason } = await this.checkNotAccessible(connectedApp, severity, reason));
    }

    // Check if app name is in allowedInactiveConnectedApps
    const additionalIgnoredConnectedApps = process.env?.ALLOWED_INACTIVE_CONNECTED_APPS ? process.env?.ALLOWED_INACTIVE_CONNECTED_APPS.split(",") : [];
    const allowedInactiveConnectedApps = DiagnoseUnusedConnectedApps.allowedInactiveConnectedApps.concat(additionalIgnoredConnectedApps);
    if (severity === "warning" && allowedInactiveConnectedApps.includes(connectedApp.Name)) {
      severity = "info";
      reason = "Member of ignored connected apps"
    }

    // Build result
    const severityIcon = getSeverityIcon(severity);
    connectedApp.CreatedBy = connectedApp?.CreatedBy?.Name || 'Not set';
    connectedApp.LastModifiedBy = connectedApp?.LastModifiedBy?.Name || 'Not set';
    connectedApp.loginHistoryFound = loginHistoryFound;
    connectedApp.severityReason = reason;
    delete connectedApp.attributes;
    return Object.assign({
      severityIcon: severityIcon,
      severity: severity,
    }, connectedApp);
  }

  private async checkOAuthToken(connectedApp: any, conn: any, loginHistoryFound: boolean, severity: NotifSeverity, reason: string) {
    uxLog("log", this, c.grey(`Looking in OAuthToken for last usage of ${connectedApp.Name}...`));
    const oAuthTokenQuery = `SELECT AppName,User.Name,LastUsedDate FROM OAuthToken WHERE AppName='${connectedApp.Name.replace(/'/g, "\\'")}' ORDER BY LastUsedDate DESC LIMIT 1`;
    const oAuthTokenQueryRes = await soqlQuery(oAuthTokenQuery, conn);
    const latestOAuthToken = oAuthTokenQueryRes.records.length === 1 ? oAuthTokenQueryRes.records[0] : null;
    if (latestOAuthToken && latestOAuthToken.LastUsedDate) {
      connectedApp.LastOAuthUsageDate = latestOAuthToken.LastUsedDate;
      connectedApp.LastOAuthUsageBy = latestOAuthToken?.User?.Name || 'Not set';
      const today = moment();
      const lastUsage = moment(connectedApp.LastOAuthUsageDate);
      if (today.diff(lastUsage, "months") < 6 && loginHistoryFound === false) {
        severity = 'log';
        reason = "OAuth Token < 6 months";
      }
      else {
        reason = loginHistoryFound === false ? "Not Found in Login History and OAuth Token > 6 months" : reason;
      }
    }
    else {
      reason = loginHistoryFound === false ? "Not Found in Login History or used OAuth Token" : reason;
      connectedApp.LastOAuthUsageDate = '';
      connectedApp.LastOAuthUsageBy = '';
    }
    return { severity, reason };
  }

  private async checkNotAccessible(connectedApp: any, severity: NotifSeverity, reason: string) {
    const connectedAppMdFile = path.join(
      this.tmpSfdxProjectPath,
      "force-app",
      "main",
      "default",
      "connectedApps",
      `${connectedApp.Name}.connectedApp-meta.xml`);
    if (fs.existsSync(connectedAppMdFile)) {
      const connectedAppXml = await parseXmlFile(connectedAppMdFile);
      if (connectedAppXml?.ConnectedApp?.oauthConfig[0]?.isAdminApproved[0] === "true" &&
        (!this.hasProfiles(connectedAppXml)) &&
        (!this.hasPermissionSets((connectedAppXml)))) {
        severity = "info";
        reason = "Not accessible (Admin pre-auth + no profiles and PS)";
      }
    }
    return { severity, reason };
  }

  private hasProfiles(connectedAppXml: any) {
    return connectedAppXml?.ConnectedApp?.profileName?.length > 0
  }

  private hasPermissionSets(connectedAppXml: any) {
    return connectedAppXml?.ConnectedApp?.permissionsetName?.length > 0
  }
}