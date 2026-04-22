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
import { WebSocketClient } from '../../../../common/websocketClient.js';
import type { NotifMessage } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { soqlQuery, soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { FileDownloader } from '../../../../common/utils/fileDownloader.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MonitorErrors extends SfCommand<any> {
  private static readonly maxProcessedErrors = 10000;
  private static readonly unifiedErrorColumns = [
    'Source',
    'Status',
    'JobType',
    'Operation',
    'Exception',
    'StackTrace',
    'ErrorStep',
    'StartTime',
    'RecordId',
    'UserName',
    'UserEmail',
  ];

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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = true;
  protected static triggerNotification = true;

  protected debugMode = false;
  protected agentMode = false;
  protected days = 1;

  protected apexErrors: any[] = [];
  protected flowErrors: any[] = [];
  protected apexErrorsTotalCount = 0;
  protected flowErrorsTotalCount = 0;

  protected apexOutputFilesRes: any = {};
  protected flowOutputFilesRes: any = {};
  protected aggregatedOutputFilesRes: any = {};
  protected tempDir = '';

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MonitorErrors);
    this.agentMode = flags.agent === true;
    this.debugMode = flags.debug || false;
    this.days = await this.resolveDays(flags.days);

    const conn = flags['target-org'].getConnection();

    await this.collectApexErrors(conn);
    await this.collectFlowErrors(conn);
    this.unifyErrorOutputs();

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
    const totalErrors = this.apexErrorsTotalCount + this.flowErrorsTotalCount;
    const apexSummaryCount = `${this.apexErrorsTotalCount}${this.apexErrorsTotalCount > this.apexErrors.length ? t('monitorErrorsTruncatedSuffix', { max: MonitorErrors.maxProcessedErrors }) : ''}`;
    const flowSummaryCount = `${this.flowErrorsTotalCount}${this.flowErrorsTotalCount > this.flowErrors.length ? t('monitorErrorsTruncatedSuffix', { max: MonitorErrors.maxProcessedErrors }) : ''}`;
    const summaryMsg = t('monitorErrorsSummaryMessage', {
      apexCount: apexSummaryCount,
      flowCount: flowSummaryCount,
    });
    if (totalErrors > 0) {
      uxLog('warning', this, c.yellow(summaryMsg));
    } else {
      uxLog('success', this, c.green(summaryMsg));
    }

    if (this.apexErrorsTotalCount > 0 || this.flowErrorsTotalCount > 0) {
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
    if (isCI || this.agentMode) {
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
    const apexLogErrors = (apexLogResult.records || []).map((record: any) => {
      return {
        Source: 'ApexLog',
        Status: record.Status,
        JobType: null,
        Operation: record.Operation,
        Exception: record.Request,
        StackTrace: null,
        ErrorStep: null,
        StartTime: record.StartTime,
        RecordId: record.Id,
        UserName: record.LogUser?.Name,
        UserEmail: record.LogUser?.Email,
      };
    });

    let asyncApexErrors: any[] = [];
    if (!apexUnexpectedExceptionResult.isAvailable) {
      asyncApexErrors = await this.collectAsyncApexJobErrors(conn);
    }

    this.apexErrors = apexLogErrors.concat(apexUnexpectedExceptionResult.records, asyncApexErrors).sort((a, b) => {
      const dateA = Date.parse(a.StartTime || '');
      const dateB = Date.parse(b.StartTime || '');
      const safeA = Number.isNaN(dateA) ? 0 : dateA;
      const safeB = Number.isNaN(dateB) ? 0 : dateB;
      return safeB - safeA;
    });
    await this.resolveEventLogUsernames(conn);
    this.apexErrors = this.deduplicateByRecordId(this.apexErrors);
    this.apexErrorsTotalCount = this.apexErrors.length;
    if (this.apexErrors.length > MonitorErrors.maxProcessedErrors) {
      this.apexErrors = this.apexErrors.slice(0, MonitorErrors.maxProcessedErrors);
    }

    if (this.apexErrorsTotalCount === 0) {
      uxLog('success', this, c.green(t('noApexErrorsFoundInLastDays', { days: this.days })));
    } else {
      uxLog('warning', this, c.yellow(t('apexErrorsFound', { count: this.apexErrorsTotalCount, days: this.days })));
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
      WebSocketClient.sendProgressStartMessage(t('monitorErrorsParsingEventLogFiles'), eventLogRes.records.length);
      let counter = 0;
      for (const eventLogFile of eventLogRes.records) {
        const parsedRows = await this.parseEventLogFile(eventLogFile, conn);
        for (const row of parsedRows) {
          records.push(row);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, eventLogRes.records.length);
      }
      WebSocketClient.sendProgressEndMessage();
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
          for (const row of results.data as any[]) {
            rows.push(row);
          }
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

    return rows
      .filter((row) => row && Object.keys(row).length > 0)
      .map((row, index) => {
        const timestamp = row.TIMESTAMP || row.TIMESTAMP_DERIVED || `${eventLogFile.LogDate}T00:00:00.000Z`;
        const operation = row.APEX_ENTITY_NAME || t('monitorErrorsUnknown');
        const request = row.EXCEPTION_MESSAGE || row.EXCEPTION_TYPE || t('monitorErrorsErrorFallback');
        return {
          Source: 'EventLogFile:ApexUnexpectedException',
          Status: 'Failed',
          JobType: null,
          Operation: operation,
          Exception: request,
          StackTrace: row.STACK_TRACE || null,
          ErrorStep: null,
          StartTime: timestamp,
          RecordId: row.REQUEST_ID || `${eventLogFile.Id}-${index}`,
          UserName: null,
          UserEmail: null,
          UserId: row.USER_ID || row.USER_ID_DERIVED || null,
        };
      });
  }

  protected async collectAsyncApexJobErrors(conn): Promise<any[]> {
    const asyncApexJobQuery =
      `SELECT Id, CreatedDate, CompletedDate, Status, JobType, NumberOfErrors, ExtendedStatus, ` +
      `ApexClass.Name, MethodName, CreatedBy.Username, CreatedBy.Email FROM AsyncApexJob ` +
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
        Exception: record.ExtendedStatus,
        StackTrace: null,
        ErrorStep: null,
        StartTime: record.CompletedDate || record.CreatedDate,
        RecordId: record.Id,
        UserName: record.CreatedBy?.Username,
        UserEmail: record.CreatedBy?.Email,
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

    this.flowErrors = (flowResult.records || []).map((record: any) => {
      return {
        Source: 'FlowInterview',
        InterviewStatus: record.InterviewStatus,
        Status: record.InterviewStatus,
        JobType: null,
        Operation: record.InterviewLabel,
        Exception: record.Error,
        StackTrace: null,
        ErrorStep: record.CurrentElement,
        StartTime: record.CreatedDate,
        RecordId: record.Id,
        UserName: record.CreatedBy?.Username,
        UserEmail: record.CreatedBy?.Email,
      };
    });
    this.flowErrors = this.deduplicateByRecordId(this.flowErrors);
    this.flowErrorsTotalCount = this.flowErrors.length;
    if (this.flowErrors.length > MonitorErrors.maxProcessedErrors) {
      this.flowErrors = this.flowErrors.slice(0, MonitorErrors.maxProcessedErrors);
    }

    if (this.flowErrorsTotalCount === 0) {
      uxLog('success', this, c.green(t('noFlowErrorsFoundInLastDays', { days: this.days })));
    } else {
      uxLog('warning', this, c.yellow(t('flowErrorsFound', { count: this.flowErrorsTotalCount, days: this.days })));
      uxLogTable(this, this.flowErrors);
    }
  }

  protected async generateReports(): Promise<void> {
    uxLog('action', this, c.cyan(t('generatingErrorReports')));

    const apexReportPath = await generateReportPath('monitor-apex-errors', '');
    this.apexOutputFilesRes = await generateCsvFile(this.apexErrors, apexReportPath, {
      fileTitle: t('monitorErrorsApexReportTitle'),
    });

    const flowReportPath = await generateReportPath('monitor-flow-errors', '');
    this.flowOutputFilesRes = await generateCsvFile(this.flowErrors, flowReportPath, {
      fileTitle: t('monitorErrorsFlowReportTitle'),
    });

    const aggregatedReportPath = await generateReportPath('monitor-errors-summary', '');
    this.aggregatedOutputFilesRes = await generateCsvFile(this.buildAggregatedErrors(), aggregatedReportPath, {
      fileTitle: t('monitorErrorsAggregatedReportTitle'),
    });
  }

  protected buildAggregatedErrors(): any[] {
    const countMap = new Map<string, number>();

    for (const record of this.apexErrors) {
      const operation = (record.Operation ?? '').trim();
      const key = `Apex\0${operation}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    for (const record of this.flowErrors) {
      const rawOperation = (record.Operation ?? '').trim();
      const operation = rawOperation.replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}.*$/, '').trim();
      const key = `Flow\0${operation}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    return Array.from(countMap.entries())
      .map(([key, count]) => {
        const separatorIdx = key.indexOf('\0');
        return {
          Type: key.substring(0, separatorIdx),
          Operation: key.substring(separatorIdx + 1),
          'Number of errors': count,
        };
      })
      .sort((a, b) => b['Number of errors'] - a['Number of errors']);
  }

  protected removeAlwaysNullColumns(records: any[]): any[] {
    if (!records || records.length === 0) {
      return records;
    }

    const keys = Object.keys(records[0] || {});
    const keysToKeep = keys.filter((key) => {
      return records.some((record) => record?.[key] !== null && record?.[key] !== undefined);
    });

    return records.map((record) => {
      const trimmedRecord: any = {};
      for (const key of keysToKeep) {
        trimmedRecord[key] = record[key];
      }
      return trimmedRecord;
    });
  }

  /* jscpd:ignore-start */
  private collectKeys(records: any[], keySet: Set<string>, nonEmptyKeys: Set<string>): void {
    for (const record of records) {
      for (const key of Object.keys(record || {})) {
        keySet.add(key);
        if (record?.[key] !== null && record?.[key] !== undefined) {
          nonEmptyKeys.add(key);
        }
      }
    }
  }
  /* jscpd:ignore-end */

  protected unifyErrorOutputs(): void {
    if (this.apexErrors.length === 0 && this.flowErrors.length === 0) {
      return;
    }

    // Collect all keys and check which ones have values in a single pass
    const keySet = new Set<string>();
    const nonEmptyKeys = new Set<string>();

    this.collectKeys(this.apexErrors, keySet, nonEmptyKeys);
    this.collectKeys(this.flowErrors, keySet, nonEmptyKeys);

    const nonEmptyKeysArray = Array.from(nonEmptyKeys);
    const orderedKeys = [
      ...MonitorErrors.unifiedErrorColumns,
      ...nonEmptyKeysArray.filter((key) => !MonitorErrors.unifiedErrorColumns.includes(key)),
    ];

    this.apexErrors = this.projectColumns(this.apexErrors, orderedKeys);
    this.flowErrors = this.projectColumns(this.flowErrors, orderedKeys);
  }

  protected projectColumns(records: any[], orderedKeys: string[]): any[] {
    return records.map((record) => {
      const projected: any = {};
      for (const key of orderedKeys) {
        projected[key] = record[key] ?? null;
      }
      return projected;
    });
  }

  protected deduplicateByRecordId(records: any[]): any[] {
    if (!records || records.length === 0) {
      return records;
    }

    const deduplicated: any[] = [];
    const seenRecordIds = new Set<string>();
    for (const record of records) {
      const recordId = record?.RecordId;
      if (typeof recordId === 'string' && recordId.length > 0) {
        if (seenRecordIds.has(recordId)) {
          continue;
        }
        seenRecordIds.add(recordId);
      }
      deduplicated.push(record);
    }
    return deduplicated;
  }

  protected async resolveEventLogUsernames(conn): Promise<void> {
    // Collect unique user IDs from EventLogFile records
    const userIdSet = new Set<string>();
    const eventLogRowIndices: number[] = [];

    for (let i = 0; i < this.apexErrors.length; i++) {
      const row = this.apexErrors[i];
      if (row?.Source === 'EventLogFile:ApexUnexpectedException') {
        eventLogRowIndices.push(i);
        const userId = row?.UserId;
        if (typeof userId === 'string' && userId.length >= 15) {
          userIdSet.add(userId);
        }
      }
    }

    if (userIdSet.size === 0) {
      return;
    }

    // Query usernames
    const userIds = Array.from(userIdSet);
    const usernamesById = new Map<string, string>();
    const userQuery = `SELECT Id, Username FROM User WHERE Id IN ('${userIds.join("','")}')`;
    const usersRes = await soqlQuery(userQuery, conn);
    for (const user of usersRes.records || []) {
      if (user?.Id && user?.Username) {
        usernamesById.set(user.Id, user.Username);
      }
    }

    // Update records with usernames
    for (const idx of eventLogRowIndices) {
      const row = this.apexErrors[idx];
      if (row.UserId && usernamesById.has(row.UserId)) {
        row.UserName = usernamesById.get(row.UserId);
      }
      delete row.UserId;
    }
  }

  protected buildApexNotification(orgMarkdown: string, notifButtons: any[]): NotifMessage {
    const count = this.apexErrorsTotalCount;
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
    const count = this.flowErrorsTotalCount;
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
      const userName = entry.UserName ? ` (${entry.UserName})` : '';
      return `• ${entry.StartTime} - ${entry.Operation || entry.Exception || t('monitorErrorsUnknown')}${userName}`;
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
      const label = entry.Operation ? ` ${entry.Operation}` : '';
      return `• ${entry.StartTime} - ${label || t('monitorErrorsUnknown')} - ${entry.ErrorStep || t('monitorErrorsErrorFallback')
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
