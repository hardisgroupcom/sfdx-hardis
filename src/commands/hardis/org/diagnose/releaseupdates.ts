/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { bulkQuery } from '../../../../common/utils/apiUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import moment from 'moment';
import columnify from 'columnify';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseReleaseUpdates extends SfCommand<any> {
  public static title = 'Check Release Updates of an org';

  public static description = `Export Release Updates into a CSV file with selected criteria, and highlight Release Updates that should be checked.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-release-updates/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:org:diagnose:releaseupdates',
  ];

  public static flags: any = {
    outputfile: Flags.string({
      char: 'o',
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

  protected releaseUpdatesRecords: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseReleaseUpdates);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    const conn = flags['target-org'].getConnection();
    uxLog(this, c.cyan(`Extracting Release Updates and checks to perform in ${conn.instanceUrl} ...`));

    // Fetch ReleaseUpdate records
    const releaseUpdatesQuery =
      `SELECT StepStage,Status,Category,DurableId,Title,DueDate,Description,Release,ReleaseLabel,ReleaseDate,ApiVersion, HasNewSteps,IsReleased,SupportsRevoke,DeveloperName ` +
      `FROM ReleaseUpdate ` +
      `WHERE StepStage IN ('Upcoming','OverDue') AND Status IN ('Invocable','Revocable','Nascent')` +
      `ORDER BY DueDate DESC`;
    const queryRes = await bulkQuery(releaseUpdatesQuery, conn);
    const severityIconWarning = getSeverityIcon('warning');
    const severityIconError = getSeverityIcon('error');
    this.releaseUpdatesRecords = queryRes.records.map((record) => {
      record.severityIcon = record.StepStage === 'OverDue' ? severityIconError : severityIconWarning;
      return record;
    });

    // Process result
    if (this.releaseUpdatesRecords.length > 0) {
      // Generate output CSV file
      this.outputFile = await generateReportPath('release-updates', this.outputFile);
      this.outputFilesRes = await generateCsvFile(this.releaseUpdatesRecords, this.outputFile);

      // Build notification
      const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
      const notifButtons = await getNotificationButtons();
      const notifSeverity: NotifSeverity = 'warning';
      const notifText = `${this.releaseUpdatesRecords.length} Release Updates to check have been found in ${orgMarkdown}`
      let notifDetailText = '';
      for (const releaseUpdate of this.releaseUpdatesRecords) {
        notifDetailText += `• ${releaseUpdate.Title} (${releaseUpdate.StepStage},${releaseUpdate.Status},${releaseUpdate.Category}), due for ${moment(releaseUpdate.DueDate)}\n`;
      }
      const notifAttachments = [{ text: notifDetailText }];
      // Post notif
      globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
      NotifProvider.postNotifications({
        type: 'AUDIT_TRAIL',
        text: notifText,
        attachments: notifAttachments,
        buttons: notifButtons,
        severity: notifSeverity,
        attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
        logElements: this.releaseUpdatesRecords,
        data: { metric: this.releaseUpdatesRecords.length },
        metrics: {
          ReleaseUpdates: this.releaseUpdatesRecords.length,
        },
      });

      // Display output
      const releaseUpdatesLight = this.releaseUpdatesRecords.map(releaseUpdate => {
        return {
          Title: releaseUpdate.Title,
          StepStage: releaseUpdate.StepStage,
          Status: releaseUpdate.Status,
          Category: releaseUpdate.Category,
          DueDate: moment(releaseUpdate.DueDate)
        }
      })
      uxLog(this, c.yellow(notifText + "\n" + columnify(releaseUpdatesLight)));
    }
    else {
      uxLog(this, c.green("No release updates has been found"));
    }

    // Return an object to be displayed with --json
    return {
      status: this.releaseUpdatesRecords.length > 0 ? 1 : 0,
      suspectRecords: this.releaseUpdatesRecords,
      csvLogFile: this.outputFile,
    };
  }
}
