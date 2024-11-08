/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { bulkQuery, soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import moment from 'moment';
import columnify from 'columnify';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DianoseUnusedApexClasses extends SfCommand<any> {
  public static title = 'Detect unused Apex classes in an org';

  public static description = `List all async Apex classes (Batch,Queuable,Schedulable) that has not been called for more than 365 days.
  
The result class list probably can be removed from the project, and that will improve your test classes capabilities :)

The number of unused day is overriddable using --days option. 

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-unused-apex-classes/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:org:diagnose:unused-apex-classes',
    '$ sf hardis:org:diagnose:unused-apex-classes --days 700'
  ];

  //Comment default values to test the prompts
  public static flags: any = {
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    days: Flags.integer({
      char: 't',
      description:
        'Extracts the users that have been inactive for the amount of days specified. In CI, default is 180 days',
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

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected lastNdays: number;
  protected asyncClassList: any[] = [];
  protected unusedNumber: number = 0;
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DianoseUnusedApexClasses);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    this.lastNdays = Number(flags.days || 365);

    // Calculate lastNdays to use

    const conn = flags['target-org'].getConnection();

    // Retrieve the list of Apex classs that are BatchApex, ScheduledApex or Queueable
    await this.listAsyncApexClasses(conn);

    // Find latest AsyncJob for each class
    const classIds = this.asyncClassList.map(apexClass => apexClass.Id);
    const query = `SELECT ApexClassId, Status, MAX(CreatedDate)` +
      ` FROM AsyncApexJob` +
      ` WHERE JobType IN ('BatchApex', 'ScheduledApex', 'Queueable') AND ApexClassId IN ('${classIds.join("','")}') GROUP BY ApexClassId, Status`;
    const latestJobQueryRes = await bulkQuery(query, conn);
    const latestJobs = latestJobQueryRes.records;

    // Aggregate results
    this.asyncClassList = this.asyncClassList.map(apexClass => {
      const latestJob = latestJobs.filter(job => job.ApexClassId === apexClass.Id);
      if (latestJob.length === 0) {
        apexClass.latestJobDate = null;
        apexClass.latestJobRunDays = 99999;
        apexClass.severity = "error";
        this.unusedNumber++;
        this.statusCode = 1;
      }
      else {
        apexClass.latestJobDate = latestJob[0].CreatedDate;
        const today = moment();
        apexClass.latestJobRunDays = today.diff(apexClass.latestJobDate, 'days');
        if (apexClass.latestJobRunDays > this.lastNdays) {
          apexClass.severity = "error";
          this.unusedNumber++;
          this.statusCode = 1;
        }
        else {
          apexClass.severity = "info";
        }
      }
      apexClass.severityIcon = getSeverityIcon(apexClass.severity);
      return apexClass;
    })

    // Generate output CSV file
    this.outputFile = await generateReportPath('unused-apex-classes', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.asyncClassList, this.outputFile);

    // Build result text
    let summary = `All async apex classes have been called during the latest ${this.lastNdays} days.`;
    if (this.unusedNumber > 0) {
      summary = `${this.unusedNumber} apex classes might be not used anymore.`;
      const summaryClasses = this.asyncClassList.map(apexClass => {
        return {
          name: apexClass.Name,
          latestJobRunDays: apexClass.latestJobRunDays,
          severityIcon: apexClass.severityIcon,
          severity: apexClass.severity
        }
      });
      uxLog(this, c.white("\n" + columnify(summaryClasses)));
    }

    if ((this.argv || []).includes('unused-apex-classes')) {
      process.exitCode = this.statusCode;
    }

    // Manage notifications
    await this.manageNotifications();

    if (this.unusedNumber > 0) {
      uxLog(this, c.yellow(summary));
    } else {
      uxLog(this, c.green(summary));
    }

    // Return an object to be displayed with --json
    return {
      status: this.statusCode,
      summary: summary,
      asyncClassList: this.asyncClassList,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes.xlsxFile,
    };
  }

  private async listAsyncApexClasses(conn: any) {
    const classListRes = await soqlQueryTooling("SELECT Id, Name, Body FROM ApexClass WHERE ManageableState ='unmanaged'", conn);
    const allClassList: any[] = classListRes.records || [];

    for (const classItem of allClassList) {
      if (classItem.Body.includes("implements Database.Batchable")) {
        this.asyncClassList.push({ class: classItem.Name, asyncType: "Database.Batchable" });
      }
      else if (classItem.Body.includes("implements Queueable")) {
        this.asyncClassList.push({ class: classItem.Name, asyncType: "Queuable" });
      }
      else if (classItem.Body.includes("implements Schedulable")) {
        this.asyncClassList.push({ class: classItem.Name, asyncType: "Schedulable" });
      }
    }
  }

  private async manageNotifications() {
    const { flags } = await this.parse(DianoseUnusedApexClasses);
    // Build notification
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `All async apex classes of org ${orgMarkdown} have been called during the latest ${this.lastNdays} days.`;
    let attachments: any[] = [];
    if (this.unusedNumber > 0) {
      notifSeverity = 'warning';
      notifText = `${this.unusedNumber} apex classes might be not used anymore.`;
      const notifDetailText = this.asyncClassList
        .filter(apexClass => ["warning", "error"].includes(apexClass.severity))
        .map(apexClass => {
          return `• *${apexClass.Name}*: ${apexClass.latestJobRunDays} days`
        }).join("\n");
      attachments = [{ text: notifDetailText }];
    }
    /* jscpd:ignore-start */
    // Send notifications
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: 'UNUSED_APEX_CLASSES',
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.asyncClassList,
      data: { metric: this.unusedNumber },
      metrics: { unusedApexClasses: this.unusedNumber },
    });
    /* jscpd:ignore-end */
    return [];
  }
}
