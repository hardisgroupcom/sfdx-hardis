/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { git, isGitRepo, uxLog } from '../../../../common/utils/index.js';
import { soqlQuery, soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import moment from 'moment';
import columnify from 'columnify';
import sortArray from 'sort-array';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUnusedApexClasses extends SfCommand<any> {
  public static title = 'Detect unused Apex classes in an org';

  public static description = `List all async Apex classes (Batch,Queueable,Schedulable) that has not been called for more than 365 days.
  
The result class list probably can be removed from the project, and that will improve your test classes performances :)

The number of unused day is overridable using --days option. 

The command uses queries on AsyncApexJob and CronTrigger technical tables to build the result.

Apex Classes CreatedBy and CreatedOn fields are calculated from MIN(date from git, date from org)

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-unused-apex-classes/) and can output Grafana, Slack and MsTeams Notifications.

![](${CONSTANTS.DOC_URL_ROOT}/assets/images/screenshot-monitoring-unused-apex-grafana.jpg)
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
    const { flags } = await this.parse(DiagnoseUnusedApexClasses);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    this.lastNdays = Number(flags.days || 365);

    // Calculate lastNdays to use
    const conn = flags['target-org'].getConnection();

    // Retrieve the list of Apex class that are BatchApex, ScheduledApex or Queueable
    await this.listAsyncApexClasses(conn);

    // Find latest AsyncJob for each class
    const latestJobs = await this.findLatestApexJobsForEachClass(conn);

    const jobTriggers = await this.findCronTriggers(conn);

    // Aggregate results
    this.matchClassesWithJobs(latestJobs, jobTriggers);

    // Build result text
    const summary = this.displaySummaryOutput();

    // Generate output CSV file
    this.outputFile = await generateReportPath('unused-apex-classes', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.asyncClassList, this.outputFile);

    // Exit code
    if ((this.argv || []).includes('unused-apex-classes')) {
      process.exitCode = this.statusCode;
    }

    // Manage notifications
    await this.manageNotifications();

    // Return an object to be displayed with --json
    return {
      status: this.statusCode,
      summary: summary,
      asyncClassList: this.asyncClassList,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes.xlsxFile,
    };
  }

  private async findCronTriggers(conn: any) {
    const cronTriggersQuery = `SELECT Id, CronJobDetail.JobType, CronJobDetail.Name, State, NextFireTime FROM CronTrigger  WHERE State IN ('WAITING', 'ACQUIRED', 'EXECUTING', 'PAUSED', 'BLOCKED', 'PAUSED_BLOCKED')`;
    const cronTriggersResult = await soqlQuery(cronTriggersQuery, conn);
    return cronTriggersResult.records;
  }

  private displaySummaryOutput() {
    let summary = `All async apex classes have been called during the latest ${this.lastNdays} days.`;
    if (this.unusedNumber > 0) {
      summary = `${this.unusedNumber} apex classes might not be used anymore.
Note: Salesforce does not provide all info to be 100% sure that a class is not used, so double-check before deleting them :)`
        ;
      const summaryClasses = this.asyncClassList.map(apexClass => {
        return {
          severity: `${apexClass.severityIcon}`,
          name: apexClass.Name,
          AsyncType: apexClass.AsyncType,
          latestJobDate: apexClass.latestJobDate ? moment(apexClass.latestJobDate).format('YYYY-MM-DD hh:mm') : "Not found",
          latestJobRunDays: apexClass.latestJobRunDays,
          nextJobDate: apexClass.nextJobDate ? moment(apexClass.nextJobDate).format('YYYY-MM-DD hh:mm') : "None",
          queued: apexClass.queued,
          classCreatedOn: moment(apexClass.ClassCreatedDate).format('YYYY-MM-DD'),
          classCreatedBy: apexClass.ClassCreatedBy
        };
      });
      uxLog(this, c.yellow("\n" + columnify(summaryClasses)));
    }

    if (this.unusedNumber > 0) {
      uxLog(this, c.yellow(summary));
    } else {
      uxLog(this, c.green(summary));
    }
    return summary;
  }

  private matchClassesWithJobs(latestJobsAll: any[], cronTriggers: any[]) {
    this.asyncClassList = this.asyncClassList.map(apexClass => {
      const futureJobs = cronTriggers.filter(cronJob => apexClass.Name === cronJob.CronJobDetail.Name);
      apexClass.nextJobDate = "";
      apexClass.queued = false;
      if (futureJobs.length > 0) {
        apexClass.nextJobDate = futureJobs[0].NextFireTime;
      }
      const relatedJobs = latestJobsAll.filter(job => job.ApexClassId === apexClass.Id);
      if (relatedJobs.length === 0) {
        apexClass.latestJobDate = "";
        apexClass.latestJobRunDays = 99999;
        if (apexClass.nextJobDate === "") {
          apexClass.severity = "warning";
          this.unusedNumber++;
        }
      }
      else {
        const queuedJobs = relatedJobs.filter(job => job.Status === "Queued");
        if (queuedJobs.length > 0) {
          apexClass.queued = true;
        }
        apexClass.latestJobDate = relatedJobs[0].expr0;
        const today = moment();
        apexClass.latestJobRunDays = today.diff(apexClass.latestJobDate, 'days');
        if (apexClass.latestJobRunDays > this.lastNdays && apexClass.nextJobDate === "" && apexClass.queued === false) {
          apexClass.severity = "warning";
          this.unusedNumber++;
        }
        else {
          apexClass.severity = "info";
        }
      }
      apexClass.severityIcon = getSeverityIcon(apexClass.severity);
      delete apexClass.Id;
      return apexClass;
    });
    this.asyncClassList = sortArray(this.asyncClassList, { by: ['latestJobRunDays', 'Name'], order: ['desc', 'asc'] }) as any[];
    if (this.unusedNumber > 0) {
      this.statusCode = 1;
    }
  }

  private async findLatestApexJobsForEachClass(conn: any) {
    const classIds = this.asyncClassList.map(apexClass => apexClass.Id);
    const query = `SELECT ApexClassId, Status, MAX(CreatedDate)` +
      ` FROM AsyncApexJob` +
      ` WHERE JobType IN ('BatchApex', 'ScheduledApex', 'Queueable') AND ApexClassId IN ('${classIds.join("','")}') GROUP BY ApexClassId, Status`;
    const latestJobQueryRes = await soqlQuery(query, conn);
    const latestJobs = latestJobQueryRes.records;
    return latestJobs;
  }

  private async listAsyncApexClasses(conn: any) {
    const classListRes = await soqlQueryTooling("SELECT Id, Name, Body FROM ApexClass WHERE ManageableState ='unmanaged' ORDER BY Name ASC", conn);
    const allClassList: any[] = classListRes.records || [];
    for (const classItem of allClassList) {
      if (classItem.Body.includes("implements Database.Batchable")) {
        this.asyncClassList.push({ Id: classItem.Id, Name: classItem.Name, AsyncType: "Database.Batchable" });
      }
      else if (classItem.Body.includes("implements Queueable")) {
        this.asyncClassList.push({ Id: classItem.Id, Name: classItem.Name, AsyncType: "Queueable" });
      }
      else if (classItem.Body.includes("implements Schedulable")) {
        this.asyncClassList.push({ Id: classItem.Id, Name: classItem.Name, AsyncType: "Schedulable" });
      }
    }
    const classIds = this.asyncClassList.map(apexClass => apexClass.Id);
    const classDtlRes = await soqlQueryTooling(`SELECT Id, Name, CreatedDate, CreatedBy.Name FROM ApexClass WHERE Id IN ('${classIds.join("','")}')`, conn);
    const classDtlResRecords: any[] = classDtlRes.records || [];
    const isRepo = isGitRepo();
    this.asyncClassList = await Promise.all(this.asyncClassList.map(async (cls) => {
      const matchingClass = classDtlResRecords.filter(classDtl => classDtl.Id === cls.Id)[0];
      // Use date & user found in org by default
      cls.ClassCreatedDate = moment(matchingClass.CreatedDate).format('YYYY-MM-DD');
      cls.ClassCreatedBy = `${matchingClass.CreatedBy.Name} (org)`;
      // If file found in git, and if git date is lower than org date, use git date and user
      if (isRepo) {
        const gitInstance = git({ output: false, displayCommand: false });
        const fileMetadata = await MetadataUtils.findMetaFileFromTypeAndName("ApexClass", cls.Name);
        if (fileMetadata) {
          const log = await gitInstance.log({
            file: fileMetadata,
            '--diff-filter': 'A', // Filter to include only commits that added the file
            '--max-count': 1,     // Limit to the first commit
          });
          if (log && log.all.length === 1) {
            const orgCreatedDate = moment(cls.ClassCreatedDate);
            const gitCreatedDate = moment(log.all[0].date);
            // Use date from git only if it is before date from org
            if (gitCreatedDate.isBefore(orgCreatedDate)) {
              cls.ClassCreatedDate = moment(log.all[0].date).format('YYYY-MM-DD');
              cls.ClassCreatedBy = `${log.all[0].author_name} (git)`;
            }
          }
        }
      }
      return cls;
    }))
  }

  private async manageNotifications() {
    const { flags } = await this.parse(DiagnoseUnusedApexClasses);
    // Build notification
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `All async apex classes of org ${orgMarkdown} have been called during the latest ${this.lastNdays} days.`;
    let attachments: any[] = [];
    if (this.unusedNumber > 0) {
      notifSeverity = 'warning';
      notifText = `${this.unusedNumber} apex classes might not be used anymore.`;
      const notifDetailText = this.asyncClassList
        .filter(apexClass => ["warning", "error"].includes(apexClass.severity))
        .map(apexClass => {
          if (apexClass.nextJobDate) {
            return `• *${apexClass.Name}*: Will run on ${moment(apexClass.nextJobDate.format('YYYY-MM-DD hh:mm'))}`
          }
          else if (apexClass.queued) {
            return `• *${apexClass.Name}*: A future job is queued`
          }
          else if (apexClass.latestJobRunDays < 99999) {
            return `• *${apexClass.Name}*: ${apexClass.latestJobRunDays} days (created on ${moment(apexClass.ClassCreatedDate).format('YYYY-MM-DD')} by ${apexClass.ClassCreatedBy})`
          }
          else {
            return `• *${apexClass.Name}*: No past or future job found (created on ${moment(apexClass.ClassCreatedDate).format('YYYY-MM-DD')} by ${apexClass.ClassCreatedBy})`
          }
        }).join("\n");
      attachments = [{ text: notifDetailText }];
    }
    /* jscpd:ignore-start */
    // Send notifications
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    await NotifProvider.postNotifications({
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
