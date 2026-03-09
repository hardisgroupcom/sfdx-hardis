/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import Papa from 'papaparse';
import { createTempDir, isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import type { NotifMessage } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { soqlQuery, soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { FileDownloader } from '../../../../common/utils/fileDownloader.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MonitorErrors extends SfCommand<any> {
  public static title = 'Monitor Apex and Flow errors';

  public static description = `
## Command Behavior

**Collects Apex and Flow crash logs from the last N days, exports CSV/XLSX reports, and posts notifications.**

Key functionalities:

- **Apex errors:** Queries failed Apex logs from the Tooling API and failed async Apex jobs from the standard API.
- **Flow errors:** Queries failed Flow interviews from the standard REST API.
- **Report generation:** Exports both datasets to CSV/XLSX for monitoring pipelines.
- **Notifications:** Sends notifications with summary metrics and file attachments.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = ['$ sf hardis:org:monitor:errors'];

  public static flags: any = {
    days: Flags.integer({
      char: 'n',
      description: t('monitorErrorsDaysFlagDescription'),
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

  public static requiresProject = true;
  protected static triggerNotification = true;

  protected debugMode = false;
  protected days = 1;

  protected apexErrors: any[] = [];
  protected flowErrors: any[] = [];

  protected apexOutputFilesRes: any = {};
  protected flowOutputFilesRes: any = {};
  protected tempDir = '';

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MonitorErrors);
    this.debugMode = flags.debug || false;
    this.days = await this.resolveDays(flags.days);

    const conn = flags['target-org'].getConnection();

    await this.collectApexErrors(conn);
    await this.collectFlowErrors(conn);

    await this.generateReports();

    await setConnectionVariables(conn);
    const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
    const notifButtons = await getNotificationButtons();

    await NotifProvider.postNotifications(
      this.buildApexNotification(orgMarkdown, notifButtons)
    );
    await NotifProvider.postNotifications(
      this.buildFlowNotification(orgMarkdown, notifButtons)
    );

    uxLog('action', this, c.cyan(t('monitorErrorsSummaryTitle')));
    const totalErrors = this.apexErrors.length + this.flowErrors.length;
    const summaryMsg = t('monitorErrorsSummaryMessage', {
      apexCount: this.apexErrors.length,
      flowCount: this.flowErrors.length,
    });
    if (totalErrors > 0) {
      uxLog('warning', this, c.yellow(summaryMsg));
    } else {
      uxLog('success', this, c.green(summaryMsg));
    }

    if (this.apexErrors.length > 0 || this.flowErrors.length > 0) {
      process.exitCode = 1;
    }

    return {
      outputString: t('monitorErrorsExecutedOnOrg', { org: conn.instanceUrl }),
      days: this.days,
      apexErrors: this.apexErrors,
      flowErrors: this.flowErrors,
    };
  }

  protected async resolveDays(inputDays?: number): Promise<number> {
    if (Number.isFinite(inputDays) && (inputDays as number) > 0) {
      return Math.floor(inputDays as number);
    }
    if (isCI) {
      return 1;
    }
    const promptRes = await prompts({
      type: 'number',
      name: 'value',
      message: c.cyanBright(t('monitorErrorsDaysPrompt')),
      description: t('monitorErrorsDaysDescription'),
      initial: 1,
    });
    const parsed = Number(promptRes.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    return 1;
  }

  protected async collectApexErrors(conn): Promise<void> {
    uxLog('action', this, c.cyan(t('retrievingApexErrorsForLastDays', { days: this.days })));
    const apexLogQuery =
      `SELECT Id, StartTime, Status, Operation, Request, LogLength, DurationMilliseconds, ` +
      `LogUser.Name, LogUser.Email FROM ApexLog ` +
      `WHERE Status = 'Failed' AND StartTime = LAST_N_DAYS:${this.days} ` +
      `ORDER BY StartTime DESC`;
    const apexLogResult = await soqlQueryTooling(apexLogQuery, conn);
    const apexUnexpectedExceptionResult = await this.collectApexUnexpectedExceptionsFromEventLogs(conn);
    const errorIcon = getSeverityIcon('error');
    const apexLogErrors = (apexLogResult.records || []).map((record: any) => {
      return {
        Source: 'ApexLog',
        Status: record.Status,
        JobType: null,
        Operation: record.Operation,
        Request: record.Request,
        SeverityIcon: errorIcon,
        Severity: 'error',
        Id: record.Id,
        StartTime: record.StartTime,
        DurationMs: record.DurationMilliseconds,
        LogLength: record.LogLength,
        LogUserName: record.LogUser?.Name,
        LogUserEmail: record.LogUser?.Email,
      };
    });

    let asyncApexErrors: any[] = [];
    if (!apexUnexpectedExceptionResult.isAvailable) {
      asyncApexErrors = await this.collectAsyncApexJobErrors(conn, errorIcon);
    }

    this.apexErrors = [...apexLogErrors, ...apexUnexpectedExceptionResult.records, ...asyncApexErrors].sort((a, b) => {
      const dateA = Date.parse(a.StartTime || '');
      const dateB = Date.parse(b.StartTime || '');
      const safeA = Number.isNaN(dateA) ? 0 : dateA;
      const safeB = Number.isNaN(dateB) ? 0 : dateB;
      return safeB - safeA;
    });

    if (this.apexErrors.length === 0) {
      uxLog('success', this, c.green(t('noApexErrorsFoundInLastDays', { days: this.days })));
    } else {
      uxLog('warning', this, c.yellow(t('apexErrorsFound', { count: this.apexErrors.length, days: this.days })));
      uxLogTable(this, this.apexErrors);
    }
  }

  protected async collectApexUnexpectedExceptionsFromEventLogs(conn): Promise<{ isAvailable: boolean; records: any[] }> {
    const eventType = 'ApexUnexpectedException';
    try {
      uxLog('log', this, c.grey(t('queryingOrgForEventlogfileEntriesOfType', { eventType })));
      const eventLogQuery =
        `SELECT Id, LogFile, LogDate FROM EventLogFile ` +
        `WHERE EventType = '${eventType}' AND LogDate = LAST_N_DAYS:${this.days} ` +
        `ORDER BY LogDate DESC`;
      const eventLogRes: any = await soqlQuery(eventLogQuery, conn);
      uxLog('log', this, c.grey(t('eventLogFileEntriesCount', { count: eventLogRes.records.length })));
      if (eventLogRes.records.length === 0) {
        uxLog('log', this, c.grey(t('foundNoEventlogfileEntryOfType', { eventType })));
        return { isAvailable: true, records: [] };
      }

      const records: any[] = [];
      this.tempDir = this.tempDir || await createTempDir();
      for (const eventLogFile of eventLogRes.records) {
        const parsedRows = await this.parseEventLogFile(eventLogFile, conn);
        records.push(...parsedRows);
      }
      return { isAvailable: true, records };
    } catch (e) {
      uxLog('log', this, c.grey(String(e)));
      return { isAvailable: false, records: [] };
    }
  }

  protected async parseEventLogFile(eventLogFile: any, conn): Promise<any[]> {
    const fetchUrl = `${conn.instanceUrl}${eventLogFile.LogFile}`;
    const outputFile = path.join(this.tempDir, `${Math.random().toString(36).substring(7)}.csv`);
    const downloadResult = await new FileDownloader(fetchUrl, { conn, outputFile }).download();
    if (!downloadResult.success) {
      return [];
    }

    const rows: any[] = [];
    const outputFileStream = fs.createReadStream(outputFile, { encoding: 'utf8' });
    await new Promise((resolve, reject) => {
      Papa.parse(outputFileStream, {
        header: true,
        worker: true,
        chunk: (results) => {
          rows.push(...(results.data as any[]));
        },
        complete: function () {
          resolve(true);
        },
        error: function (error) {
          reject(error);
        },
      });
    });
    await fs.remove(outputFile).catch(() => undefined);

    const errorIcon = getSeverityIcon('error');
    return rows
      .filter((row) => row && Object.keys(row).length > 0)
      .map((row, index) => {
        const timestamp =
          row.TIMESTAMP || row.REQUEST_TIMESTAMP || row.EVENT_TIMESTAMP || row.LOGIN_TIMESTAMP || `${eventLogFile.LogDate}T00:00:00.000Z`;
        const operation =
          row.ENTRY_POINT || row.REQUEST_URI || row.URI || row.OPERATION || row.EVENT_TYPE || t('monitorErrorsUnknown');
        const request =
          row.EXCEPTION_MESSAGE || row.ERROR_MESSAGE || row.STATUS || row.REQUEST_ID || t('monitorErrorsErrorFallback');
        return {
          Source: 'EventLogFile:ApexUnexpectedException',
          Status: row.STATUS || 'Failed',
          JobType: null,
          Operation: operation,
          Request: request,
          SeverityIcon: errorIcon,
          Severity: 'error',
          Id: row.REQUEST_ID || `${eventLogFile.Id}-${index}`,
          StartTime: timestamp,
          DurationMs: row.RUN_TIME || null,
          LogLength: null,
          LogUserName: row.USER_NAME || row.USER_ID || null,
          LogUserEmail: row.USER_EMAIL || null,
        };
      });
  }

  protected async collectAsyncApexJobErrors(conn, errorIcon: string): Promise<any[]> {
    const asyncApexJobQuery =
      `SELECT Id, CreatedDate, CompletedDate, Status, JobType, NumberOfErrors, ExtendedStatus, ` +
      `ApexClass.Name, MethodName FROM AsyncApexJob ` +
      `WHERE Status IN ('Failed', 'Aborted') AND CreatedDate = LAST_N_DAYS:${this.days} ` +
      `ORDER BY CreatedDate DESC`;
    const asyncApexJobResult = await soqlQuery(asyncApexJobQuery, conn);
    return (asyncApexJobResult.records || []).map((record: any) => {
      const apexClassName = record.ApexClass?.Name;
      const methodName = record.MethodName;
      const operation =
        apexClassName && methodName
          ? `${apexClassName}.${methodName}`
          : apexClassName || methodName || record.JobType || t('monitorErrorsUnknown');
      return {
        Source: 'AsyncApexJob',
        Status: record.Status,
        JobType: record.JobType,
        Operation: operation,
        Request: record.ExtendedStatus,
        SeverityIcon: errorIcon,
        Severity: 'error',
        Id: record.Id,
        StartTime: record.CompletedDate || record.CreatedDate,
        DurationMs: null,
        LogLength: null,
        LogUserName: null,
        LogUserEmail: null,
        NumberOfErrors: record.NumberOfErrors,
      };
    });
  }

  protected async collectFlowErrors(conn): Promise<void> {
    uxLog('action', this, c.cyan(t('retrievingFlowErrorsForLastDays', { days: this.days })));
    const flowQuery =
      `SELECT Id, CreatedDate, InterviewStatus, InterviewLabel, CreatedById, CreatedBy.Name, CreatedBy.Username, ` +
      `CreatedBy.Email, CurrentElement, Error ` +
      `FROM FlowInterview ` +
      `WHERE InterviewStatus = 'Error' AND CreatedDate = LAST_N_DAYS:${this.days} ` +
      `ORDER BY CreatedDate DESC`;
    const flowResult = await soqlQuery(flowQuery, conn);

    const errorIcon = getSeverityIcon('error');
    this.flowErrors = (flowResult.records || []).map((record: any) => {
      return {
        InterviewStatus: record.InterviewStatus,
        InterviewLabel: record.InterviewLabel,
        ErrorStep: record.CurrentElement,
        ErrorMessage: record.Error,
        CreatedByUsername: record.CreatedBy?.Username,
        SeverityIcon: errorIcon,
        Severity: 'error',
        Id: record.Id,
        CreatedDate: record.CreatedDate,
        CreatedById: record.CreatedById,
        CreatedByName: record.CreatedBy?.Name,
        CreatedByEmail: record.CreatedBy?.Email,
      };
    });

    if (this.flowErrors.length === 0) {
      uxLog('success', this, c.green(t('noFlowErrorsFoundInLastDays', { days: this.days })));
    } else {
      uxLog('warning', this, c.yellow(t('flowErrorsFound', { count: this.flowErrors.length, days: this.days })));
      uxLogTable(this, this.flowErrors);
    }
  }

  protected async generateReports(): Promise<void> {
    const apexReportPath = await generateReportPath('monitor-apex-errors', '');
    this.apexOutputFilesRes = await generateCsvFile(this.apexErrors, apexReportPath, {
      fileTitle: t('monitorErrorsApexReportTitle'),
    });

    const flowReportPath = await generateReportPath('monitor-flow-errors', '');
    this.flowOutputFilesRes = await generateCsvFile(this.flowErrors, flowReportPath, {
      fileTitle: t('monitorErrorsFlowReportTitle'),
    });
  }

  protected buildApexNotification(orgMarkdown: string, notifButtons: any[]): NotifMessage {
    const count = this.apexErrors.length;
    const notifSeverity: NotifSeverity = count > 0 ? 'error' : 'success';
    const notifText =
      count > 0
        ? t('monitorErrorsApexDetected', { org: orgMarkdown, count, days: this.days })
        : t('monitorErrorsApexNone', { org: orgMarkdown, days: this.days });

    return {
      type: 'FLOW_ERROR',
      text: notifText,
      buttons: notifButtons,
      attachments: this.buildApexAttachments(),
      severity: notifSeverity,
      attachedFiles: this.apexOutputFilesRes.xlsxFile ? [this.apexOutputFilesRes.xlsxFile] : [],
      logElements: this.apexErrors,
      metrics: {
        ApexErrors: count,
      },
      data: {
        metric: count,
        apexErrors: count,
      },
    };
  }

  protected buildFlowNotification(orgMarkdown: string, notifButtons: any[]): NotifMessage {
    const count = this.flowErrors.length;
    const notifSeverity: NotifSeverity = count > 0 ? 'error' : 'success';
    const notifText =
      count > 0
        ? t('monitorErrorsFlowDetected', { org: orgMarkdown, count, days: this.days })
        : t('monitorErrorsFlowNone', { org: orgMarkdown, days: this.days });

    return {
      type: 'APEX_ERROR',
      text: notifText,
      buttons: notifButtons,
      attachments: this.buildFlowAttachments(),
      severity: notifSeverity,
      attachedFiles: this.flowOutputFilesRes.xlsxFile ? [this.flowOutputFilesRes.xlsxFile] : [],
      logElements: this.flowErrors,
      metrics: {
        FlowErrors: count,
      },
      data: {
        metric: count,
        flowErrors: count,
      },
    };
  }

  protected buildApexAttachments(): MessageAttachment[] {
    if (this.apexErrors.length === 0) {
      return [];
    }
    const maxItems = 10;
    const lines = this.apexErrors.slice(0, maxItems).map((entry) => {
      const userName = entry.LogUserName ? ` (${entry.LogUserName})` : '';
      return `• ${entry.StartTime} - ${entry.Operation || entry.Request || t('monitorErrorsUnknown')}${userName}`;
    });
    const remaining = this.apexErrors.length - maxItems;
    if (remaining > 0) {
      lines.push(t('monitorErrorsMoreItems', { count: remaining }));
    }
    return [
      {
        title: t('monitorErrorsApexSampleTitle'),
        text: lines.join('\n'),
      },
    ];
  }

  protected buildFlowAttachments(): MessageAttachment[] {
    if (this.flowErrors.length === 0) {
      return [];
    }
    const maxItems = 10;
    const lines = this.flowErrors.slice(0, maxItems).map((entry) => {
      const label = entry.InterviewLabel ? ` ${entry.InterviewLabel}` : '';
      return `• ${entry.CreatedDate} - ${label || entry.FlowVersionId || t('monitorErrorsUnknown')} - ${entry.ErrorStep || t('monitorErrorsErrorFallback')
        }`;
    });
    const remaining = this.flowErrors.length - maxItems;
    if (remaining > 0) {
      lines.push(t('monitorErrorsMoreItems', { count: remaining }));
    }
    return [
      {
        title: t('monitorErrorsFlowSampleTitle'),
        text: lines.join('\n'),
      },
    ];
  }
}
