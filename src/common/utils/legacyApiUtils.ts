import c from 'chalk';
import * as dns from 'dns';
import * as path from 'path';
import Papa from 'papaparse';
import fs from './fsUtils.js';
import sortArray from './sortArray.js';
import { createTempDir, uxLog } from './index.js';
import { getSeverityIcon } from './notifUtils.js';
import { soqlQuery } from './apiUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { generateCsvFile, generateReportPath, createXlsxFromCsv } from './filesUtils.js';
import { FileDownloader } from './fileDownloader.js';
import { t } from './i18n.js';
import { anonymizeRows, getChannelAnonymizationLevel } from './anonymizeUtils.js';

const dnsPromises = dns.promises;

export const LEGACY_API_ARTICLE_URL =
  'https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238';

export const LEGACY_API_NOTIFICATION_SAMPLE_LIMIT = 1000;

export type LegacyApiDescriptor = {
  apiFamily: string[];
  minApiVersion: number;
  maxApiVersion: number;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  deprecationRelease: string;
  apiResources?: string[];
};

// Runtime state of a descriptor during a collection, returned as is by hardis:org:diagnose:legacyapi --json
export type LegacyApiDescriptorState = LegacyApiDescriptor & {
  errors: any[];
  totalErrors: number;
  ipCounts: Record<string, { count: number; reasons: string[] }>;
};

export const LEGACY_API_DESCRIPTORS: readonly LegacyApiDescriptor[] = [
  {
    apiFamily: ['SOAP', 'REST', 'BULK_API'],
    minApiVersion: 1.0,
    maxApiVersion: 6.0,
    severity: 'ERROR',
    deprecationRelease: 'Summer 21 - retirement of 1 to 6',
  },
  {
    apiFamily: ['SOAP', 'REST', 'BULK_API'],
    minApiVersion: 7.0,
    maxApiVersion: 20.0,
    severity: 'ERROR',
    deprecationRelease: 'Summer 22 - retirement of 7 to 20',
  },
  {
    apiFamily: ['SOAP', 'REST', 'BULK_API'],
    minApiVersion: 21.0,
    maxApiVersion: 30.0,
    severity: 'ERROR',
    deprecationRelease: 'Summer 25 - retirement of 21 to 30',
  },
  {
    apiFamily: ['SOAP'],
    minApiVersion: 0.0,
    maxApiVersion: Number.POSITIVE_INFINITY,
    severity: 'WARNING',
    deprecationRelease: 'Summer 27 - retirement of SOAP login',
    apiResources: ['login'],
  },
  {
    apiFamily: ['SOAP', 'REST', 'BULK_API'],
    minApiVersion: 31.0,
    maxApiVersion: 40.0,
    severity: 'WARNING',
    deprecationRelease: 'Summer 28 - retirement of 31 to 40 (deprecated Summer 27)',
  },
];

export interface LegacyApiCallsCollectorOptions {
  conn: any;
  eventType: string;
  limit: number;
  // Forced path of the main CSV report, or null to build the default report path
  outputFile: string | null;
  debugMode: boolean;
  // Command instance used for uxLog / uxLogTable, or null
  commandThis: any;
  // Run as one step of another command (what-will-break): the log file steps go to the caller's progress block
  // instead of a new one, and no report file is opened
  partOfAnotherCommand?: boolean;
  // The calls report is the main report of the command: UIs show it before the API clients reports
  mainReport?: boolean;
  // Called once every log file is analyzed and the per-descriptor counts are displayed, before the report files are written
  onAnalysisComplete?: (descriptors: LegacyApiDescriptorResult[]) => void | Promise<void>;
}

export interface LegacyApiDescriptorResult {
  descriptor: LegacyApiDescriptor;
  totalErrors: number;
  // Number of distinct client IPs that made the matching calls
  ipCount: number;
}

export interface LegacyApiClientsFile {
  severity: string;
  // Range of API versions whose callers the file lists
  minApiVersion: number;
  maxApiVersion: number;
  csvFile: string;
  xlsxFile?: string;
}

export interface LegacyApiCallsResult {
  // Number of EventLogFile records of the event type found in the org
  eventLogFilesInOrg: number;
  // Number of EventLogFile records downloaded and analyzed (bounded by limit)
  eventLogFilesCount: number;
  descriptors: LegacyApiDescriptorResult[];
  // Runtime state of every descriptor, in LEGACY_API_DESCRIPTORS order
  descriptorStates: LegacyApiDescriptorState[];
  // Sum of the matching calls of every descriptor (LegacyApiCalls metric)
  totalErrors: number;
  hasBlockingErrors: boolean;
  hasWarningsOnly: boolean;
  // Path of the main CSV report, always written (empty when no calls matched)
  outputFile: string;
  csvRowsCount: number;
  // Main report, null when no calls matched
  csvFile: string | null;
  xlsxFile: string | null;
  // One file by severity with matching calls, in LEGACY_API_DESCRIPTORS order
  apiClientsFiles: LegacyApiClientsFile[];
  // CSV paths of apiClientsFiles
  outputFileIps: string[];
  // Rows of the api clients files, with their severity
  ipResults: any[];
  // First matching log entries, up to notificationSampleLimit
  notificationSample: any[];
  notificationSampleLimit: number;
  notificationSampleTruncated: boolean;
}

// Refactoring of Philippe Ozil's apex script with JsForce queries
export class LegacyApiCallsCollector {
  private readonly conn: any;
  private readonly eventType: string;
  private readonly limit: number;
  private readonly forcedOutputFile: string | null;
  private readonly debugMode: boolean;
  private readonly commandThis: any;
  private readonly partOfAnotherCommand: boolean;
  private readonly mainReport: boolean;
  private readonly onAnalysisComplete?: (descriptors: LegacyApiDescriptorResult[]) => void | Promise<void>;

  private descriptors: LegacyApiDescriptorState[] = [];
  private outputFile = '';
  private tempDir = '';
  private csvHeaderWritten = false;
  private csvColumns: string[] | null = null;
  private csvPreviousChunkEndedWithNewline = true;
  private totalCsvRows = 0;
  private notificationSample: any[] = [];
  private notificationSampleTruncated = false;
  private ipResultsSorted: any[] = [];
  private apiClientsFiles: LegacyApiClientsFile[] = [];
  private xlsxFile: string | null = null;

  constructor(options: LegacyApiCallsCollectorOptions) {
    this.conn = options.conn;
    this.eventType = options.eventType || 'ApiTotalUsage';
    this.limit = options.limit || 999;
    this.forcedOutputFile = options.outputFile || null;
    this.debugMode = options.debugMode || false;
    this.commandThis = options.commandThis ?? null;
    this.partOfAnotherCommand = options.partOfAnotherCommand === true;
    this.mainReport = options.mainReport === true;
    this.onAnalysisComplete = options.onAnalysisComplete;
  }

  public async collect(): Promise<LegacyApiCallsResult> {
    this.outputFile = await generateReportPath('legacy-api-calls', this.forcedOutputFile as string);
    await fs.remove(this.outputFile).catch(() => undefined);
    this.resetState();

    const limitConstraint = this.limit ? ` LIMIT ${this.limit}` : '';
    this.tempDir = await createTempDir();

    // Get EventLogFile records with EventType = 'ApiTotalUsage'
    uxLog("action", this.commandThis, c.cyan(t('queryingOrgForEventlogfileEntriesOfType', { eventType: this.eventType })));
    const logCountQuery = `SELECT COUNT() FROM EventLogFile WHERE EventType = '${this.eventType}'`;
    const logCountRes = await soqlQuery(logCountQuery, this.conn);
    if (logCountRes.totalSize === 0) {
      uxLog("success", this.commandThis, c.green(t('foundNoEventlogfileEntryOfType', { eventType: this.eventType })));
      uxLog("success", this.commandThis, c.green(t('thisIndicatesThatNoLegacyApisWere')));
    } else {
      uxLog("log", this.commandThis, c.grey(t('found') + c.bold(logCountRes.totalSize) + ` ${this.eventType} EventLogFile entries.`));
    }

    if (logCountRes.totalSize > this.limit) {
      uxLog(
        "warning",
        this.commandThis,
        c.yellow(t('tooManyResultsIncreaseLimit'))
      );
    }

    // Fetch EventLogFiles with ApiTotalUsage entries
    const logCollectQuery =
      `SELECT LogFile FROM EventLogFile WHERE EventType = '${this.eventType}' ORDER BY LogDate DESC` + limitConstraint;
    const eventLogRes: any = await soqlQuery(logCollectQuery, this.conn);

    // Collect legacy api calls from logs
    const ownProgress = !this.partOfAnotherCommand;
    if (ownProgress) {
      WebSocketClient.sendProgressStartMessage(t('downloadingAndAnalyzingLogFiles'), eventLogRes.records.length);
    }
    let counter = 0;
    for (const eventLogFile of eventLogRes.records) {
      await this.collectDeprecatedApiCalls(eventLogFile.LogFile);
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, eventLogRes.records.length);
    }
    if (ownProgress) {
      WebSocketClient.sendProgressEndMessage();
    }
    await this.flushDescriptorErrors();

    // Display summary
    this.displayDescriptorCounts();
    const descriptorResults = this.buildDescriptorResults();
    if (this.onAnalysisComplete) {
      await this.onAnalysisComplete(descriptorResults);
    }

    // Generate main CSV file
    await this.finalizeCsvOutput();

    // Generate one summary file by severity
    const outputFileIps: string[] = [];
    for (const descriptor of this.descriptors) {
      if (descriptor.totalErrors > 0) {
        const outputFileIp = await this.generateSummaryLog(descriptor);
        if (outputFileIp) {
          outputFileIps.push(outputFileIp);
        }
        // Trigger command to open CSV file in VS Code extension
        if (outputFileIp && !this.partOfAnotherCommand) {
          WebSocketClient.requestOpenFile(outputFileIp);
        }
      }
    }

    // Debug or manage CSV file generation error
    if (this.debugMode || this.outputFile == null) {
      for (const descriptor of this.descriptors) {
        uxLog("log", this.commandThis, c.grey(`- ${descriptor.deprecationRelease} : ${JSON.stringify(descriptor.totalErrors)}`));
      }
    }

    return {
      eventLogFilesInOrg: logCountRes.totalSize,
      eventLogFilesCount: eventLogRes.records.length,
      descriptors: descriptorResults,
      descriptorStates: this.descriptors,
      totalErrors: this.getTotalErrors(),
      hasBlockingErrors: this.descriptors.some((descriptor) => descriptor.severity === 'ERROR' && descriptor.totalErrors > 0),
      hasWarningsOnly: this.descriptors.some((descriptor) => descriptor.severity === 'WARNING' && descriptor.totalErrors > 0),
      outputFile: this.outputFile,
      csvRowsCount: this.totalCsvRows,
      csvFile: this.totalCsvRows > 0 ? this.outputFile : null,
      xlsxFile: this.xlsxFile,
      apiClientsFiles: this.apiClientsFiles,
      outputFileIps: outputFileIps,
      ipResults: this.ipResultsSorted,
      notificationSample: this.notificationSample,
      notificationSampleLimit: LEGACY_API_NOTIFICATION_SAMPLE_LIMIT,
      notificationSampleTruncated: this.notificationSampleTruncated,
    };
  }

  private resetState() {
    this.csvHeaderWritten = false;
    this.csvColumns = null;
    this.csvPreviousChunkEndedWithNewline = true;
    this.totalCsvRows = 0;
    this.notificationSample = [];
    this.notificationSampleTruncated = false;
    this.ipResultsSorted = [];
    this.apiClientsFiles = [];
    this.xlsxFile = null;
    // Same key order as before the extraction, so that --json output stays identical
    this.descriptors = LEGACY_API_DESCRIPTORS.map((descriptor) => {
      const state: LegacyApiDescriptorState = {
        apiFamily: [...descriptor.apiFamily],
        minApiVersion: descriptor.minApiVersion,
        maxApiVersion: descriptor.maxApiVersion,
        severity: descriptor.severity,
        deprecationRelease: descriptor.deprecationRelease,
        errors: [],
        totalErrors: 0,
        ipCounts: {},
      };
      if (descriptor.apiResources) {
        state.apiResources = [...descriptor.apiResources];
      }
      return state;
    });
  }

  // GET csv log file and check for legacy API calls within
  private async collectDeprecatedApiCalls(logFileUrl: string) {
    // Load icons
    const severityIconError = getSeverityIcon('error');
    const severityIconWarning = getSeverityIcon('warning');
    const severityIconInfo = getSeverityIcon('info');

    // Download file as stream, and process chuck by chuck
    uxLog("log", this.commandThis, c.grey(t('downloading', { logFileUrl })));
    const fetchUrl = `${this.conn.instanceUrl}${logFileUrl}`;
    const outputFile = path.join(this.tempDir, Math.random().toString(36).substring(7) + ".csv");
    const downloadResult = await new FileDownloader(fetchUrl, { conn: this.conn, outputFile: outputFile }).download();
    if (downloadResult.success) {
      uxLog("log", this.commandThis, c.grey(t('parsingDownloadedCsvFromAndCheckFor', { outputFile })));
      const outputFileStream = fs.createReadStream(outputFile, { encoding: 'utf8' });
      await new Promise((resolve, reject) => {
        Papa.parse(outputFileStream, {
          header: true,
          worker: true,
          chunk: (results) => {
            // Look in check the entries that match a deprecation description
            for (const logEntry of results.data as any[]) {
              const apiVersion = this.parseApiVersion(logEntry.API_VERSION);
              const apiFamily = (logEntry.API_FAMILY || '').toUpperCase();
              const apiResource = (logEntry.API_RESOURCE || '').toLowerCase();
              for (const legacyApiDescriptor of this.descriptors) {
                if (
                  !this.matchesApiFamily(legacyApiDescriptor, apiFamily) ||
                  !this.matchesApiVersion(legacyApiDescriptor, apiVersion) ||
                  !this.matchesApiResource(legacyApiDescriptor, apiResource)
                ) {
                  continue;
                }
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
      uxLog("warning", this.commandThis, c.yellow(t('warningUnableToProcessLogsOf', { logFileUrl })));
    }
  }

  private parseApiVersion(rawValue: string | number | undefined): number {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return Number.POSITIVE_INFINITY;
    }
    if (typeof rawValue === 'number') {
      return Number.isFinite(rawValue) ? rawValue : Number.POSITIVE_INFINITY;
    }
    const parsed = parseFloat(rawValue);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }

  private matchesApiFamily(descriptor: LegacyApiDescriptor, apiFamily: string): boolean {
    if (!apiFamily) {
      return false;
    }
    return descriptor.apiFamily.some((family) => family.toUpperCase() === apiFamily);
  }

  private matchesApiVersion(descriptor: LegacyApiDescriptor, apiVersion: number): boolean {
    return apiVersion >= descriptor.minApiVersion && apiVersion <= descriptor.maxApiVersion;
  }

  private matchesApiResource(descriptor: LegacyApiDescriptor, apiResource: string): boolean {
    if (!descriptor.apiResources || descriptor.apiResources.length === 0) {
      return true;
    }
    if (!apiResource) {
      return false;
    }
    return descriptor.apiResources.some((resource) => resource.toLowerCase() === apiResource);
  }

  private async flushDescriptorErrors() {
    for (const descriptor of this.descriptors) {
      if (!descriptor.errors || descriptor.errors.length === 0) {
        continue;
      }
      const descriptorErrors = descriptor.errors;
      descriptor.totalErrors += descriptorErrors.length;
      this.captureNotificationSample(descriptorErrors);
      this.updateIpCounts(descriptor, descriptorErrors);
      await this.appendRowsToCsv(descriptorErrors);
      descriptor.errors = [];
    }
  }

  private captureNotificationSample(entries: any[]) {
    if (!entries || entries.length === 0) {
      return;
    }
    for (const entry of entries) {
      if (this.notificationSample.length < LEGACY_API_NOTIFICATION_SAMPLE_LIMIT) {
        this.notificationSample.push(entry);
      } else {
        this.notificationSampleTruncated = true;
        break;
      }
    }
  }

  private updateIpCounts(descriptor: LegacyApiDescriptorState, errors: any[]) {
    if (!errors || errors.length === 0) {
      return;
    }
    for (const eventLogRecord of errors) {
      if (!eventLogRecord || !eventLogRecord.CLIENT_IP) {
        continue;
      }
      const ip = eventLogRecord.CLIENT_IP;
      if (!descriptor.ipCounts[ip]) {
        descriptor.ipCounts[ip] = { count: 0, reasons: [] };
      }
      descriptor.ipCounts[ip].count += 1;
      const reason = this.buildFlagReason(descriptor, eventLogRecord);
      if (!descriptor.ipCounts[ip].reasons.includes(reason)) {
        descriptor.ipCounts[ip].reasons.push(reason);
      }
    }
  }

  private buildFlagReason(descriptor: LegacyApiDescriptor, eventLogRecord: any): string {
    const apiFamily = (eventLogRecord.API_FAMILY || '').toUpperCase() || 'API';
    const apiResource = (eventLogRecord.API_RESOURCE || '').toLowerCase();
    const apiVersionRaw = eventLogRecord.API_VERSION;
    if (descriptor.apiResources && descriptor.apiResources.length > 0 && apiResource) {
      return `${apiFamily} ${apiResource}`;
    }
    if (apiVersionRaw !== undefined && apiVersionRaw !== null && apiVersionRaw !== '') {
      return `${apiFamily} API v${apiVersionRaw}`;
    }
    return `${apiFamily} API`;
  }

  private async appendRowsToCsv(rows: any[]) {
    if (!rows || rows.length === 0) {
      return;
    }
    if (!this.outputFile) {
      throw new Error('Output file path is not initialized');
    }
    // This streamed writer bypasses generateCsvFile, so it must apply the same anonymization:
    // the CSV / XLSX carries USER_ID and CLIENT_IP values and ends up as CI artifact and email attachment
    rows = anonymizeRows(rows, await getChannelAnonymizationLevel('files'));
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

  private displayDescriptorCounts() {
    uxLog("action", this.commandThis, c.cyan(t('resultsOfLegacyApiCallsAnalysis')));
    const logLines: string[] = [];
    for (const descriptor of this.descriptors) {
      const errorCount = descriptor.totalErrors;
      const colorMethod =
        descriptor.severity === 'ERROR' && errorCount > 0
          ? c.red
          : descriptor.severity === 'WARNING' && errorCount > 0
            ? c.yellow
            : c.green;
      const line = colorMethod(`- ${descriptor.deprecationRelease} : ${c.bold(errorCount)}`);
      logLines.push(line);
    }
    uxLog("log", this.commandThis, logLines.join('\n'));
  }

  private buildDescriptorResults(): LegacyApiDescriptorResult[] {
    return this.descriptors.map((state, index) => ({
      descriptor: LEGACY_API_DESCRIPTORS[index],
      totalErrors: state.totalErrors,
      ipCount: Object.keys(state.ipCounts || {}).length,
    }));
  }

  private async finalizeCsvOutput() {
    if (!this.outputFile) {
      return;
    }
    if (!(await fs.pathExists(this.outputFile))) {
      await fs.ensureDir(path.dirname(this.outputFile));
      await fs.writeFile(this.outputFile, '', 'utf8');
    }
    uxLog("action", this.commandThis, c.cyan(c.italic(t('pleaseSeeDetailedCsvLogIn2', { outputFile: c.bold(this.outputFile) }))));
    if (!WebSocketClient.isAliveWithLwcUI() && !this.partOfAnotherCommand) {
      WebSocketClient.requestOpenFile(this.outputFile);
    }
    WebSocketClient.sendReportFileMessage(this.outputFile, t('legacyApiCallsCsv'), 'report', undefined, { main: this.mainReport });
    if (this.totalCsvRows > 0) {
      const result: any = {};
      await createXlsxFromCsv(this.outputFile, { fileTitle: 'Legacy API Calls', mainReport: this.mainReport }, result);
      if (result.xlsxFile) {
        this.xlsxFile = result.xlsxFile;
      }
    } else {
      uxLog("other", this.commandThis, c.grey(t('noXlsFileGeneratedAsIsEmpty2', { outputFile: this.outputFile })));
    }
  }

  // One API clients file per range of API versions: several ranges share a severity, and each one has its own callers
  private async generateSummaryLog(descriptor: LegacyApiDescriptorState): Promise<string | null> {
    const { ipCounts, severity } = descriptor;
    const range = `v${descriptor.minApiVersion}-${descriptor.maxApiVersion}`;
    if (!ipCounts || Object.keys(ipCounts).length === 0) {
      return null;
    }
    // Try to get hostname for ips
    const ipResults: any[] = [];
    for (const ip of Object.keys(ipCounts)) {
      const { count, reasons } = ipCounts[ip];
      let hostname: string | string[] = 'unknown';
      try {
        hostname = await dnsPromises.reverse(ip);
      } catch (e) {
        hostname = 'unknown';
        uxLog("other", this.commandThis, c.grey(t('unableToResolveHostnameForIp', { ip, val: e })));
      }
      const formattedHostname = Array.isArray(hostname) ? hostname.join(', ') : hostname;
      const formattedReasons = [...reasons].sort().join(', ');
      const ipResult = {
        CLIENT_IP: ip,
        CLIENT_HOSTNAME: formattedHostname,
        SFDX_HARDIS_COUNT: count,
        SFDX_HARDIS_REASON: formattedReasons,
      };
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
      ? this.outputFile.replace('.csv', `.api-clients-${severity}-${range}.csv`)
      : this.outputFile + `api-clients-${severity}-${range}.csv`;
    const outputFileIpsRes = await generateCsvFile(sortedIpResults, outputFileIps, {
      fileTitle: `Legacy API Clients - ${severity} - API ${descriptor.minApiVersion} to ${descriptor.maxApiVersion}`,
    });
    const apiClientsFile: LegacyApiClientsFile = {
      severity,
      minApiVersion: descriptor.minApiVersion,
      maxApiVersion: descriptor.maxApiVersion,
      csvFile: outputFileIps,
    };
    if (outputFileIpsRes.xlsxFile) {
      apiClientsFile.xlsxFile = outputFileIpsRes.xlsxFile;
    }
    this.apiClientsFiles.push(apiClientsFile);
    uxLog("log", this.commandThis, c.italic(c.cyan(t('pleaseSeeInfoAboutApiCallersIn', { severity, outputFileIps: c.bold(outputFileIps) }))));
    return outputFileIps;
  }

  private getTotalErrors(): number {
    return this.descriptors.reduce((sum, descriptor) => sum + descriptor.totalErrors, 0);
  }
}
