/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import sortArray from 'sort-array';
import { createTempDir, uxLog } from '../../../../common/utils/index.js';
import * as dns from 'dns';
import Papa from 'papaparse';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { generateCsvFile, generateReportPath, createXlsxFromCsv } from '../../../../common/utils/filesUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import { FileDownloader } from '../../../../common/utils/fileDownloader.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
const dnsPromises = dns.promises;

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

type LegacyApiDescriptor = {
  apiFamily: string[];
  minApiVersion: number;
  maxApiVersion: number;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  deprecationRelease: string;
  errors: any[];
  totalErrors: number;
  ipCounts: Record<string, number>;
};

export default class LegacyApi extends SfCommand<any> {
  public static title = 'Check for legacy API use';

  public static description = `Checks if an org uses retired or someday retired API version\n

See article below

[![Handle Salesforce API versions Deprecation like a pro](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deprecated-api.jpg)](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-deprecated-api-calls/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:org:diagnose:legacyapi',
    '$ sf hardis:org:diagnose:legacyapi -u hardis@myclient.com',
    "$ sf hardis:org:diagnose:legacyapi --outputfile 'c:/path/to/folder/legacyapi.csv'",
    '$ sf hardis:org:diagnose:legacyapi -u hardis@myclient.com --outputfile ./tmp/legacyapi.csv',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    eventtype: Flags.string({
      char: 'e',
      default: 'ApiTotalUsage',
      description: 'Type of EventLogFile event to analyze',
    }),
    limit: Flags.integer({
      char: 'l',
      default: 999,
      description: 'Number of latest EventLogFile events to analyze',
    }),
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
  protected apexSCannerCodeUrl =
    'https://raw.githubusercontent.com/pozil/legacy-api-scanner/main/legacy-api-scanner.apex';
  protected legacyApiDescriptors: LegacyApiDescriptor[] = [
    {
      apiFamily: ['SOAP', 'REST', 'BULK_API'],
      minApiVersion: 1.0,
      maxApiVersion: 6.0,
      severity: 'ERROR',
      deprecationRelease: 'Summer 21 - retirement of 1 to 6',
      errors: [] as any[],
      totalErrors: 0,
      ipCounts: {},
    },
    {
      apiFamily: ['SOAP', 'REST', 'BULK_API'],
      minApiVersion: 7.0,
      maxApiVersion: 20.0,
      severity: 'ERROR',
      deprecationRelease: 'Summer 22 - retirement of 7 to 20',
      errors: [] as any[],
      totalErrors: 0,
      ipCounts: {},
    },
    {
      apiFamily: ['SOAP', 'REST', 'BULK_API'],
      minApiVersion: 21.0,
      maxApiVersion: 30.0,
      severity: 'WARNING',
      deprecationRelease: 'Summer 25 - retirement of 21 to 30',
      errors: [] as any[],
      totalErrors: 0,
      ipCounts: {},
    },
  ];

  protected allErrors: any[] = [];
  protected ipResultsSorted: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  /* jscpd:ignore-end */
  private tempDir: string;
  private csvHeaderWritten = false;
  private csvColumns: string[] | null = null;
  private csvPreviousChunkEndedWithNewline = true;
  private totalCsvRows = 0;
  private readonly notificationSampleLimit = 1000;
  private notificationSampleTruncated = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(LegacyApi);
    this.debugMode = flags.debug || false;
    return await this.runJsForce(flags);
  }

  // Refactoring of Philippe Ozil's apex script with JsForce queries
  private async runJsForce(flags) {
    const eventType = flags.eventtype || 'ApiTotalUsage';
    const limit = flags.limit || 999;
    const conn = flags['target-org'].getConnection();
    this.outputFile = await generateReportPath('legacy-api-calls', flags.outputfile || null);
    await fs.remove(this.outputFile).catch(() => undefined);
    this.resetCsvState();

    const limitConstraint = limit ? ` LIMIT ${limit}` : '';
    this.tempDir = await createTempDir();

    // Get EventLogFile records with EventType = 'ApiTotalUsage'
    const logCountQuery = `SELECT COUNT() FROM EventLogFile WHERE EventType = '${eventType}'`;
    const logCountRes = await soqlQuery(logCountQuery, conn);
    if (logCountRes.totalSize === 0) {
      uxLog("success", this, c.green(`Found no EventLogFile entry of type ${eventType}.`));
      uxLog("success", this, c.green('This indicates that no legacy APIs were called during the log retention window.'));
    } else {
      uxLog("log", this, c.grey('Found ' + c.bold(logCountRes.totalSize) + ` ${eventType} EventLogFile entries.`));
    }

    if (logCountRes.totalSize > limit) {
      uxLog(
        "warning",
        this,
        c.yellow(`There are more than ${limit} results, you may consider to increase limit using --limit argument`)
      );
    }

    // Fetch EventLogFiles with ApiTotalUsage entries
    const logCollectQuery =
      `SELECT LogFile FROM EventLogFile WHERE EventType = '${eventType}' ORDER BY LogDate DESC` + limitConstraint;
    const eventLogRes: any = await soqlQuery(logCollectQuery, conn);

    // Collect legacy api calls from logs
    uxLog("action", this, c.cyan('Calling org API to get CSV content of each EventLogFile record, then parse and analyze it...'));
    for (const eventLogFile of eventLogRes.records) {
      await this.collectDeprecatedApiCalls(eventLogFile.LogFile, conn);
    }
    await this.flushDescriptorErrors();

    // Display summary
    uxLog("other", this, '');
    uxLog("action", this, c.cyan('Results:'));
    for (const descriptor of this.legacyApiDescriptors) {
      const errorCount = descriptor.totalErrors;
      const colorMethod =
        descriptor.severity === 'ERROR' && errorCount > 0
          ? c.red
          : descriptor.severity === 'WARNING' && errorCount > 0
            ? c.yellow
            : c.green;
      uxLog("other", this, colorMethod(`- ${descriptor.deprecationRelease} : ${c.bold(errorCount)}`));
    }
    uxLog("other", this, '');

    // Build command result
    let msg = 'No deprecated API call has been found in ApiTotalUsage logs';
    let statusCode = 0;
    const hasBlockingErrors = this.legacyApiDescriptors.some(
      (descriptor) => descriptor.severity === 'ERROR' && descriptor.totalErrors > 0
    );
    const hasWarningsOnly = this.legacyApiDescriptors.some(
      (descriptor) => descriptor.severity === 'WARNING' && descriptor.totalErrors > 0
    );
    if (hasBlockingErrors) {
      msg = 'Found legacy API versions calls in logs';
      statusCode = 1;
      uxLog("error", this, c.red(c.bold(msg)));
    } else if (hasWarningsOnly) {
      msg = 'Found deprecated API versions calls in logs that will not be supported anymore in the future';
      statusCode = 0;
      uxLog("warning", this, c.yellow(c.bold(msg)));
    } else {
      uxLog("success", this, c.green(msg));
    }

    // Generate main CSV file
    await this.finalizeCsvOutput();

    // Generate one summary file by severity
    const outputFileIps: any[] = [];
    for (const descriptor of this.legacyApiDescriptors) {
      if (descriptor.totalErrors > 0) {
        const outputFileIp = await this.generateSummaryLog(descriptor.ipCounts, descriptor.severity);
        if (outputFileIp) {
          outputFileIps.push(outputFileIp);
        }
        // Trigger command to open CSV file in VS Code extension
        if (outputFileIp) {
          WebSocketClient.requestOpenFile(outputFileIp);
        }
      }
    }

    // Debug or manage CSV file generation error
    if (this.debugMode || this.outputFile == null) {
      for (const descriptor of this.legacyApiDescriptors) {
        uxLog("log", this, c.grey(`- ${descriptor.deprecationRelease} : ${JSON.stringify(descriptor.totalErrors)}`));
      }
    }

    let notifDetailText = '';
    for (const descriptor of this.legacyApiDescriptors) {
      if (descriptor.totalErrors > 0) {
        notifDetailText += `• ${descriptor.severity}: API version calls found in logs: ${descriptor.totalErrors} (${descriptor.deprecationRelease})\n`;
      }
    }

    notifDetailText += `
See article to solve issue before it's too late:
• EN: https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238
• FR: https://leblog.hardis-group.com/portfolio/versions-dapi-salesforce-decommissionnees-que-faire/`;

    if (this.notificationSampleTruncated) {
      notifDetailText += `
  Only the first ${this.notificationSampleLimit} log entries are attached to this notification.`;
    }

    // Build notifications
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const totalErrorsFound = this.getTotalErrors();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No deprecated Salesforce API versions are used in ${orgMarkdown}`;
    if (totalErrorsFound > 0) {
      notifSeverity = 'error';
      notifText = `${totalErrorsFound} deprecated Salesforce API versions are used in ${orgMarkdown}`;
    }
    // Post notifications
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'LEGACY_API',
      text: notifText,
      attachments: [{ text: notifDetailText }],
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile, this.outputFilesRes.xlsxFile2] : [],
      logElements: this.allErrors,
      data: {
        metric: totalErrorsFound,
        legacyApiSummary: this.ipResultsSorted,
      },
      metrics: {
        LegacyApiCalls: totalErrorsFound,
      },
    });

    if ((this.argv || []).includes('legacyapi')) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      csvLogFile: this.outputFile,
      outputFileIps: outputFileIps,
      legacyApiResults: this.legacyApiDescriptors,
    };
  }

  private resetCsvState() {
    this.csvHeaderWritten = false;
    this.csvColumns = null;
    this.csvPreviousChunkEndedWithNewline = true;
    this.totalCsvRows = 0;
    this.allErrors = [];
    this.ipResultsSorted = [];
    this.notificationSampleTruncated = false;
    this.outputFilesRes = {};
    for (const descriptor of this.legacyApiDescriptors) {
      descriptor.errors = [];
      descriptor.totalErrors = 0;
      descriptor.ipCounts = {};
    }
  }

  private getTotalErrors(): number {
    return this.legacyApiDescriptors.reduce((sum, descriptor) => sum + descriptor.totalErrors, 0);
  }

  private captureNotificationSample(entries: any[]) {
    if (!entries || entries.length === 0) {
      return;
    }
    for (const entry of entries) {
      if (this.allErrors.length < this.notificationSampleLimit) {
        this.allErrors.push(entry);
      } else {
        this.notificationSampleTruncated = true;
        break;
      }
    }
  }

  private updateIpCounts(descriptor: LegacyApiDescriptor, errors: any[]) {
    if (!errors || errors.length === 0) {
      return;
    }
    for (const eventLogRecord of errors) {
      if (!eventLogRecord || !eventLogRecord.CLIENT_IP) {
        continue;
      }
      descriptor.ipCounts[eventLogRecord.CLIENT_IP] = (descriptor.ipCounts[eventLogRecord.CLIENT_IP] || 0) + 1;
    }
  }

  private ensureCsvColumns(rows: any[]) {
    if (this.csvColumns && this.csvColumns.length > 0) {
      return;
    }
    const columnSet = new Set<string>();
    for (const row of rows) {
      if (!row) {
        continue;
      }
      Object.keys(row).forEach((key) => columnSet.add(key));
    }
    this.csvColumns = Array.from(columnSet);
  }

  private async appendRowsToCsv(rows: any[]) {
    if (!rows || rows.length === 0) {
      return;
    }
    if (!this.outputFile) {
      throw new Error('Output file path is not initialized');
    }
    this.ensureCsvColumns(rows);
    if (!this.csvColumns || this.csvColumns.length === 0) {
      return;
    }
    const csvString = Papa.unparse(rows, {
      header: !this.csvHeaderWritten,
      columns: this.csvColumns,
    });
    if (!this.csvHeaderWritten) {
      await fs.writeFile(this.outputFile, csvString, 'utf8');
      this.csvHeaderWritten = true;
    } else if (csvString.length > 0) {
      const prefix = this.csvPreviousChunkEndedWithNewline ? '' : '\n';
      await fs.appendFile(this.outputFile, prefix + csvString, 'utf8');
    }
    this.csvPreviousChunkEndedWithNewline = csvString.endsWith('\n');
    this.totalCsvRows += rows.length;
  }

  private async flushDescriptorErrors() {
    for (const descriptor of this.legacyApiDescriptors) {
      if (!descriptor.errors || descriptor.errors.length === 0) {
        continue;
      }
      descriptor.totalErrors += descriptor.errors.length;
      this.captureNotificationSample(descriptor.errors);
      this.updateIpCounts(descriptor, descriptor.errors);
      await this.appendRowsToCsv(descriptor.errors);
      descriptor.errors = [];
    }
  }

  private async finalizeCsvOutput() {
    if (!this.outputFile) {
      return;
    }
    if (!(await fs.pathExists(this.outputFile))) {
      await fs.ensureDir(path.dirname(this.outputFile));
      await fs.writeFile(this.outputFile, '', 'utf8');
    }
    uxLog("action", this, c.cyan(c.italic(`Please see detailed CSV log in ${c.bold(this.outputFile)}`)));
    this.outputFilesRes.csvFile = this.outputFile;
    if (!WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.requestOpenFile(this.outputFile);
    }
    WebSocketClient.sendReportFileMessage(this.outputFile, 'Legacy API Calls (CSV)', 'report');
    if (this.totalCsvRows > 0) {
      const result: any = {};
      await createXlsxFromCsv(this.outputFile, { fileTitle: 'Legacy API Calls' }, result);
      if (result.xlsxFile) {
        this.outputFilesRes.xlsxFile = result.xlsxFile;
      }
    } else {
      uxLog("other", this, c.grey(`No XLS file generated as ${this.outputFile} is empty`));
    }
  }

  // GET csv log file and check for legacy API calls within
  private async collectDeprecatedApiCalls(logFileUrl: string, conn: any) {
    // Load icons
    const severityIconError = getSeverityIcon('error');
    const severityIconWarning = getSeverityIcon('warning');
    const severityIconInfo = getSeverityIcon('info');

    // Download file as stream, and process chuck by chuck
    uxLog("log", this, c.grey(`- processing ${logFileUrl}...`));
    const fetchUrl = `${conn.instanceUrl}${logFileUrl}`;
    const outputFile = path.join(this.tempDir, Math.random().toString(36).substring(7) + ".csv");
    const downloadResult = await new FileDownloader(fetchUrl, { conn: conn, outputFile: outputFile }).download();
    if (downloadResult.success) {
      uxLog("log", this, c.grey(`-- parsing downloaded CSV from ${outputFile} and check for deprecated calls...`));
      const outputFileStream = fs.createReadStream(outputFile, { encoding: 'utf8' });
      await new Promise((resolve, reject) => {
        Papa.parse(outputFileStream, {
          header: true,
          worker: true,
          chunk: (results) => {
            // Look in check the entries that match a deprecation description
            for (const logEntry of results.data as any[]) {
              const apiVersion = logEntry.API_VERSION ? parseFloat(logEntry.API_VERSION) : parseFloat('999.0');
              const apiFamily = logEntry.API_FAMILY || null;
              for (const legacyApiDescriptor of this.legacyApiDescriptors) {
                if (
                  legacyApiDescriptor.apiFamily.includes(apiFamily) &&
                  legacyApiDescriptor.minApiVersion <= apiVersion &&
                  legacyApiDescriptor.maxApiVersion >= apiVersion
                ) {
                  logEntry.SFDX_HARDIS_DEPRECATION_RELEASE = legacyApiDescriptor.deprecationRelease;
                  logEntry.SFDX_HARDIS_SEVERITY = legacyApiDescriptor.severity;
                  if (legacyApiDescriptor.severity === 'ERROR') {
                    logEntry.severity = 'error';
                    logEntry.severityIcon = severityIconError;
                  } else if (legacyApiDescriptor.severity === 'WARNING') {
                    logEntry.severity = 'warning';
                    logEntry.severityIcon = severityIconWarning;
                  } else {
                    // severity === 'INFO'
                    logEntry.severity = 'info';
                    logEntry.severityIcon = severityIconInfo;
                  }
                  legacyApiDescriptor.errors.push(logEntry);
                  break;
                }
              }
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
      await this.flushDescriptorErrors();
      await fs.remove(outputFile).catch(() => undefined);
    }
    else {
      uxLog("warning", this, c.yellow(`Warning: Unable to process logs of ${logFileUrl}`));
    }
  }

  private async generateSummaryLog(ipCounts: Record<string, number>, severity: string) {
    if (!ipCounts || Object.keys(ipCounts).length === 0) {
      return null;
    }
    // Try to get hostname for ips
    const ipResults: any[] = [];
    for (const ip of Object.keys(ipCounts)) {
      const count = ipCounts[ip];
      let hostname: string | string[] = 'unknown';
      try {
        hostname = await dnsPromises.reverse(ip);
      } catch (e) {
        hostname = 'unknown';
      }
      const formattedHostname = Array.isArray(hostname) ? hostname.join(', ') : hostname;
      const ipResult = { CLIENT_IP: ip, CLIENT_HOSTNAME: formattedHostname, SFDX_HARDIS_COUNT: count };
      ipResults.push(ipResult);
    }
    const sortedIpResults = sortArray(ipResults, {
      by: ['SFDX_HARDIS_COUNT'],
      order: ['desc'],
    });
    this.ipResultsSorted = [
      ...this.ipResultsSorted,
      ...sortedIpResults.map((entry) => ({ ...entry, severity })),
    ];
    // Write output CSV with client api info
    const outputFileIps = this.outputFile.endsWith('.csv')
      ? this.outputFile.replace('.csv', '.api-clients-' + severity + '.csv')
      : this.outputFile + 'api-clients-' + severity + '.csv';
    const outputFileIpsRes = await generateCsvFile(sortedIpResults, outputFileIps, {
      fileTitle: `Legacy API Clients - ${severity}`,
    });
    if (outputFileIpsRes.xlsxFile) {
      this.outputFilesRes.xlsxFile2 = outputFileIpsRes.xlsxFile;
    }
    uxLog("other", this, c.italic(c.cyan(`Please see info about ${severity} API callers in ${c.bold(outputFileIps)}`)));
    return outputFileIps;
  }
}
