/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import moment from 'moment';
import columnify from 'columnify';
import { CONSTANTS } from '../../../../config/index.js';
import sortArray from 'sort-array';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUnusedConnectedApps extends SfCommand<any> {
  public static title = 'Unused Connected Apps in an org';

  public static description = `Request objects ConnectedApp, LoginHistory and OAuthToken to find which connected apps might not be used anymore, and could be deleted for security / technical debt reasons.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-release-updates/) and can output Grafana, Slack and MsTeams Notifications.
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
    uxLog(this, c.cyan(`Extracting the whole list of Connected Apps from ${conn.instanceUrl} ...`));
    const allConnectedAppsQuery =
      `SELECT Name,CreatedBy.Name,CreatedDate,LastModifiedBy.Name,LastModifiedDate,OptionsAllowAdminApprovedUsersOnly FROM ConnectedApplication ORDER BY Name`;
    const allConnectedAppsQueryRes = await soqlQuery(allConnectedAppsQuery, conn);
    const allConnectedApps = allConnectedAppsQueryRes.records;

    // Collect all Connected Apps used in LoginHistory table
    uxLog(this, c.cyan(`Extracting all applications found in LoginHistory object from ${conn.instanceUrl} ...`));
    const allAppsInLoginHistoryQuery =
      `SELECT Application FROM LoginHistory GROUP BY Application ORDER BY Application`;
    const allAppsInLoginHistoryQueryRes = await soqlQuery(allAppsInLoginHistoryQuery, conn);
    const allAppsInLoginHistoryNames = allAppsInLoginHistoryQueryRes.records.map(loginHistory => loginHistory.Application);

    // Perform analysis
    uxLog(this, c.cyan(`Starting analysis...`));
    this.connectedAppResults = await Promise.all(allConnectedApps.map(async (connectedApp) => {
      return await this.analyzeConnectedApp(allAppsInLoginHistoryNames, connectedApp, conn);
    }));

    this.connectedAppResults = sortArray(this.connectedAppResults, { by: ['severity', 'Name'], order: ['desc', 'asc'] }) as any[];
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
      globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
      NotifProvider.postNotifications({
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
      uxLog(this, c.yellow(notifText + "\n" + columnify(connectedAppsLight)));

      // Generate output CSV file
      this.outputFile = await generateReportPath('connected-apps', this.outputFile);
      this.outputFilesRes = await generateCsvFile(this.connectedAppResults, this.outputFile);
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
    uxLog(this, c.grey(`Looking in OAuthToken for last usage of ${connectedApp.Name}...`));
    const oAuthTokenQuery = `SELECT AppName,User.Name,LastUsedDate FROM OAuthToken WHERE AppName='${connectedApp.Name.replace(/'/g, "\\'")}' ORDER BY LastUsedDate DESC LIMIT 1`;
    const oAuthTokenQueryRes = await soqlQuery(oAuthTokenQuery, conn);
    const latestOAuthToken = oAuthTokenQueryRes.records.length === 1 ? oAuthTokenQueryRes.records[0] : null;
    if (latestOAuthToken) {
      connectedApp.LastOAuthUsageDate = latestOAuthToken.LastUsedDate;
      connectedApp.LastOAuthUsageBy = latestOAuthToken.User.Name;
      const today = moment();
      const lastUsage = moment(connectedApp.LastOAuthUsageDate);
      if (today.diff(lastUsage, "months") < 6 && loginHistoryFound === false) {
        severity = 'log';
        reason = "OAuth Token < 6 months"
      }
      else {
        reason = loginHistoryFound === false ? "Not Found in Login History and OAuth Token > 6 months" : reason;
      }
    }
    else {
      reason = loginHistoryFound === false ? "Not Found in Login History or OAuth Token" : reason;
      connectedApp.LastOAuthUsageDate = '';
      connectedApp.LastOAuthUsageBy = '';
    }
    const severityIcon = getSeverityIcon(severity);
    connectedApp.CreatedBy = connectedApp.CreatedBy.Name;
    connectedApp.LastModifiedBy = connectedApp.LastModifiedBy.Name;
    connectedApp.loginHistoryFound = loginHistoryFound;
    connectedApp.severityReason = reason;
    delete connectedApp.attributes;
    return Object.assign({
      severityIcon: severityIcon,
      severity: severity,
    }, connectedApp);
  }
}
