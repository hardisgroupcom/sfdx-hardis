/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class UnsecuredConnectedApps extends SfCommand<any> {
  public static title = 'Detect Unsecured Connected Apps';

  public static description = `
## Command Behavior

**Detects unsecured Connected Apps in a Salesforce org and generates detailed reports for security analysis.**

This command is a critical security diagnostic tool that helps administrators identify Connected Apps that may pose security risks due to improper configuration. It provides comprehensive analysis of OAuth tokens and Connected App security settings to ensure proper access control.

Key functionalities:

- **OAuth Token Analysis:** Queries all OAuth tokens in the org using SOQL to retrieve comprehensive token information including app names, users, authorization status, and usage statistics.
- **Security Status Assessment:** Evaluates each Connected App's security configuration by checking the \`IsUsingAdminAuthorization\` flag to determine if admin pre-approval is required.
- **Unsecured App Detection:** Identifies Connected Apps that allow users to authorize themselves without admin approval, which can pose security risks.
- **Detailed Reporting:** Generates two comprehensive CSV reports:
  - **OAuth Tokens Report:** Lists all OAuth tokens with security status, user information, and usage data
  - **Connected Apps Summary:** Aggregates unsecured Connected Apps with counts of associated OAuth tokens
- **Visual Indicators:** Uses status icons (❌ for unsecured, ✅ for secured) to provide immediate visual feedback on security status.
- **Security Recommendations:** Provides actionable guidance on how to secure Connected Apps through proper configuration.
- **Notifications:** Sends alerts to configured channels (Grafana, Slack, MS Teams) with security findings and attached reports.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-org-security/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query Execution:** Executes a comprehensive SOQL query on the \`OauthToken\` object, joining with \`AppMenuItem\` and \`User\` objects to gather complete security context.
- **Security Analysis Logic:** Analyzes the \`AppMenuItem.IsUsingAdminAuthorization\` field to determine if a Connected App requires admin pre-approval for user authorization.
- **Data Transformation:** Processes raw SOQL results to add security status indicators and reorganize data for optimal reporting and analysis.
- **Aggregation Processing:** Groups OAuth tokens by Connected App name to provide summary statistics and identify the most problematic applications.
- **Report Generation:** Uses \`generateCsvFile\` to create structured CSV reports with proper formatting and metadata for easy analysis and sharing.
- **Notification Integration:** Integrates with the \`NotifProvider\` to send security alerts with detailed metrics, including the number of unsecured Connected Apps and associated OAuth tokens.
- **File Management:** Generates multiple output formats (CSV, XLSX) and manages file paths using \`generateReportPath\` for consistent report organization.
- **Connection Management:** Uses \`setConnectionVariables\` to ensure proper authentication context for notification providers that require org connection details.
</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:unsecured-connected-apps',
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

  protected connectedAppResults: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected outputFileConnectedApps;
  protected outputFilesResConnectedApps: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(UnsecuredConnectedApps);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    const conn = flags['target-org'].getConnection();

    // Collect all Connected Apps
    uxLog("action", this, c.cyan(`Listing all OAuth Tokens from ${conn.instanceUrl} ...`));
    const allOAuthTokenQuery =
      `SELECT AppName , AppMenuItem.IsUsingAdminAuthorization, LastUsedDate, CreatedDate, User.Name ,UseCount FROM OauthToken ORDER BY AppName ASC`;
    const allOAuthTokenQueryRes = await soqlQuery(allOAuthTokenQuery, conn);
    const allOAuthTokens = allOAuthTokenQueryRes.records;

    const allOAuthTokensWithStatus = allOAuthTokens.map(app => {
      const toAdd: any = {
        AppName: app.AppName,
        User: app.User ? app.User.Name : 'N/A',
        IsUsingAdminAuthorization: app.AppMenuItem ? app.AppMenuItem.IsUsingAdminAuthorization : "N/A"
      };
      if (app.AppMenuItem && app.AppMenuItem.IsUsingAdminAuthorization === false) {
        toAdd.statusIcon = '❌';
        toAdd.status = 'Unsecured';
      } else {
        toAdd.statusIcon = '✅';
        toAdd.status = 'Secured'
      }
      delete app.attributes;
      delete app.AppMenuItem;
      delete app.User;
      return Object.assign(toAdd, app);
    });

    // Generate output CSV file
    this.outputFile = await generateReportPath('unusecured-oauth-tokens', this.outputFile);
    this.outputFilesRes = await generateCsvFile(allOAuthTokensWithStatus, this.outputFile, { fileTitle: "Unsecured OAuth Tokens" });

    const unsecuredOAuthTokens = allOAuthTokensWithStatus.filter(app => app.status === 'Unsecured');

    // Display results
    uxLog("action", this, `${unsecuredOAuthTokens.length} unsecured OAuth Tokens found.`);
    uxLogTable(this, unsecuredOAuthTokens);

    const uniqueUnsecuredAppNamesAndTokenNumber: { [key: string]: number } = {};
    for (const app of unsecuredOAuthTokens) {
      if (uniqueUnsecuredAppNamesAndTokenNumber[app.AppName]) {
        uniqueUnsecuredAppNamesAndTokenNumber[app.AppName]++;
      }
      else {
        uniqueUnsecuredAppNamesAndTokenNumber[app.AppName] = 1;
      }
    }
    const uniqueUnsecuredAppNames = Object.keys(uniqueUnsecuredAppNamesAndTokenNumber);
    const uniqueUnsecureConnectedAppsWithTokens = uniqueUnsecuredAppNames.map(appName => {
      return {
        AppName: appName,
        NumberOfUnsecuredOAuthTokens: uniqueUnsecuredAppNamesAndTokenNumber[appName]
      }
    });
    this.outputFileConnectedApps = await generateReportPath('unusecured-connected-apps', this.outputFileConnectedApps);
    this.outputFilesResConnectedApps = await generateCsvFile(uniqueUnsecureConnectedAppsWithTokens, this.outputFileConnectedApps, { fileTitle: "Unsecured Connected Apps" });
    if (uniqueUnsecuredAppNames.length > 0) {
      uxLog("action", this, c.cyan(`${uniqueUnsecuredAppNames.length} unsecured Connected Apps found.`));
      uxLogTable(this, uniqueUnsecureConnectedAppsWithTokens);
      uxLog("warning", this, `You need to either block or secure these Connected Apps.
- To block a connected app, click on "Block"
- To secure a connected app, install it, set it as "Admin Users are pre-approved" then select profiles/permission sets allowed to access it`);
    }

    // Build notification
    const numberWarnings = uniqueUnsecuredAppNames.length;
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifSeverity: NotifSeverity = numberWarnings > 0 ? 'warning' : 'log';
    const notifText = `${numberWarnings} Unsecured connected Apps have been found in ${orgMarkdown}`
    let notifDetailText = '';
    for (const connectedApp of uniqueUnsecureConnectedAppsWithTokens) {
      notifDetailText += `• *${connectedApp.AppName}* (${connectedApp.NumberOfUnsecuredOAuthTokens} OAuth Tokens)\n`;
    }
    const notifAttachments = [{ text: notifDetailText }];
    // Post notif
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'UNSECURED_CONNECTED_APPS',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFileConnectedApps.xlsxFile ? [this.outputFileConnectedApps.xlsxFile] : [],
      logElements: uniqueUnsecureConnectedAppsWithTokens,
      data: { metric: numberWarnings },
      metrics: {
        UnsecuredConnectedApps: numberWarnings,
      },
    });

    // Display link to Setup UI if there are issues
    if (numberWarnings > 0) {
      const OAuthUsageSetupUrl = `${conn.instanceUrl}/lightning/setup/ConnectedAppsUsage/home`;
      WebSocketClient.sendReportFileMessage(OAuthUsageSetupUrl, 'Review OAuth Connected Apps', "actionUrl");
    }

    return {
      status: numberWarnings === 0 ? 'success' : 'warning',
      allOAuthTokensWithStatus: allOAuthTokensWithStatus,
      unsecuredOAuthTokens: unsecuredOAuthTokens,
      unsecuredConnectedApps: uniqueUnsecuredAppNames as AnyJson[],
    }
  }
}