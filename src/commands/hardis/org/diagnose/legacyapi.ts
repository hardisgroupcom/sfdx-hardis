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
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import { FileDownloader } from '../../../../common/utils/fileDownloader.js';
const dnsPromises = dns.promises;

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

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
  protected legacyApiDescriptors = [
    {
      apiFamily: ['SOAP', 'REST', 'BULK_API'],
      minApiVersion: 1.0,
      maxApiVersion: 6.0,
      severity: 'ERROR',
      deprecationRelease: 'Summer 21 - retirement of 1 to 6',
      errors: [] as any[],
    },
    {
      apiFamily: ['SOAP', 'REST', 'BULK_API'],
      minApiVersion: 7.0,
      maxApiVersion: 20.0,
      severity: 'ERROR',
      deprecationRelease: 'Summer 22 - retirement of 7 to 20',
      errors: [] as any[],
    },
    {
      apiFamily: ['SOAP', 'REST', 'BULK_API'],
      minApiVersion: 21.0,
      maxApiVersion: 30.0,
      severity: 'WARNING',
      deprecationRelease: 'Summer 25 - retirement of 21 to 30',
      errors: [] as any[],
    },
  ];

  protected allErrors: any[] = [];
  protected ipResultsSorted: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  /* jscpd:ignore-end */
  private tempDir: string;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(LegacyApi);
    this.debugMode = flags.debug || false;
    return await this.runJsForce(flags);
  }

  // Refactoring of Philippe Ozil's apex script with JsForce queries
  private async runJsForce(flags) {
    const eventType = flags.eventtype || 'ApiTotalUsage';
    const limit = flags.limit || 999;
    this.outputFile = flags.outputfile || null;

    const limitConstraint = limit ? ` LIMIT ${limit}` : '';
    const conn = flags['target-org'].getConnection();
    this.tempDir = await createTempDir();

    // Get EventLogFile records with EventType = 'ApiTotalUsage'
    const logCountQuery = `SELECT COUNT() FROM EventLogFile WHERE EventType = '${eventType}'`;
    const logCountRes = await soqlQuery(logCountQuery, conn);
    if (logCountRes.totalSize === 0) {
      uxLog(this, c.green(`Found no EventLogFile entry of type ${eventType}.`));
      uxLog(this, c.green('This indicates that no legacy APIs were called during the log retention window.'));
    } else {
      uxLog(this, c.grey('Found ' + c.bold(logCountRes.totalSize) + ` ${eventType} EventLogFile entries.`));
    }

    if (logCountRes.totalSize > limit) {
      uxLog(
        this,
        c.yellow(`There are more than ${limit} results, you may consider to increase limit using --limit argument`)
      );
    }

    // Fetch EventLogFiles with ApiTotalUsage entries
    const logCollectQuery =
      `SELECT LogFile FROM EventLogFile WHERE EventType = '${eventType}' ORDER BY LogDate DESC` + limitConstraint;
    uxLog(this, c.grey('Query: ' + c.italic(logCollectQuery)));
    const eventLogRes: any = await soqlQuery(logCollectQuery, conn);

    // Collect legacy api calls from logs
    uxLog(this, c.grey('Calling org API to get CSV content of each EventLogFile record, then parse and analyze it...'));
    for (const eventLogFile of eventLogRes.records) {
      await this.collectDeprecatedApiCalls(eventLogFile.LogFile, conn);
    }
    this.allErrors = [
      ...this.legacyApiDescriptors[0].errors,
      ...this.legacyApiDescriptors[1].errors,
      ...this.legacyApiDescriptors[2].errors,
    ];

    // Display summary
    uxLog(this, '');
    uxLog(this, c.cyan('Results:'));
    for (const descriptor of this.legacyApiDescriptors) {
      const colorMethod =
        descriptor.severity === 'ERROR' && descriptor.errors.length > 0
          ? c.red
          : descriptor.severity === 'WARNING' && descriptor.errors.length > 0
            ? c.yellow
            : c.green;
      uxLog(this, colorMethod(`- ${descriptor.deprecationRelease} : ${c.bold(descriptor.errors.length)}`));
    }
    uxLog(this, '');

    // Build command result
    let msg = 'No deprecated API call has been found in ApiTotalUsage logs';
    let statusCode = 0;
    if (
      this.legacyApiDescriptors.filter((descriptor) => descriptor.severity === 'ERROR' && descriptor.errors.length > 0)
        .length > 0
    ) {
      msg = 'Found legacy API versions calls in logs';
      statusCode = 1;
      uxLog(this, c.red(c.bold(msg)));
    } else if (
      this.legacyApiDescriptors.filter(
        (descriptor) => descriptor.severity === 'WARNING' && descriptor.errors.length > 0
      ).length > 0
    ) {
      msg = 'Found deprecated API versions calls in logs that will not be supported anymore in the future';
      statusCode = 0;
      uxLog(this, c.yellow(c.bold(msg)));
    } else {
      uxLog(this, c.green(msg));
    }

    // Generate main CSV file
    this.outputFile = await generateReportPath('legacy-api-calls', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.allErrors, this.outputFile);

    // Generate one summary file by severity
    const outputFileIps: any[] = [];
    for (const descriptor of this.legacyApiDescriptors) {
      const errors = descriptor.errors;
      if (errors.length > 0) {
        const outputFileIp = await this.generateSummaryLog(errors, descriptor.severity);
        outputFileIps.push(outputFileIp);
        // Trigger command to open CSV file in VsCode extension
        WebSocketClient.requestOpenFile(outputFileIp);
      }
    }

    // Debug or manage CSV file generation error
    if (this.debugMode || this.outputFile == null) {
      for (const descriptor of this.legacyApiDescriptors) {
        uxLog(this, c.grey(`- ${descriptor.deprecationRelease} : ${JSON.stringify(descriptor.errors.length)}`));
      }
    }

    let notifDetailText = '';
    for (const descriptor of this.legacyApiDescriptors) {
      if (descriptor.errors.length > 0) {
        notifDetailText += `• ${descriptor.severity}: API version calls found in logs: ${descriptor.errors.length} (${descriptor.deprecationRelease})\n`;
      }
    }

    notifDetailText += `
See article to solve issue before it's too late:
• EN: https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238
• FR: https://leblog.hardis-group.com/portfolio/versions-dapi-salesforce-decommissionnees-que-faire/`;

    // Build notifications
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No deprecated Salesforce API versions are used in ${orgMarkdown}`;
    if (this.allErrors.length > 0) {
      notifSeverity = 'error';
      notifText = `${this.allErrors.length} deprecated Salesforce API versions are used in ${orgMarkdown}`;
    }
    // Post notifications
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: 'LEGACY_API',
      text: notifText,
      attachments: [{ text: notifDetailText }],
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile, this.outputFilesRes.xlsxFile2] : [],
      logElements: this.allErrors,
      data: {
        metric: this.allErrors.length,
        legacyApiSummary: this.ipResultsSorted,
      },
      metrics: {
        LegacyApiCalls: this.allErrors.length,
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

  // GET csv log file and check for legacy API calls within
  private async collectDeprecatedApiCalls(logFileUrl: string, conn: any) {
    // Load icons
    const severityIconError = getSeverityIcon('error');
    const severityIconWarning = getSeverityIcon('warning');
    const severityIconInfo = getSeverityIcon('info');

    // Download file as stream, and process chuck by chuck
    uxLog(this, c.grey(`- processing ${logFileUrl}...`));
    const fetchUrl = `${conn.instanceUrl}${logFileUrl}`;
    const outputFile = path.join(this.tempDir, Math.random().toString(36).substring(7) + ".csv");
    const downloadResult = await new FileDownloader(fetchUrl, { conn: conn, outputFile: outputFile }).download();
    if (downloadResult.success) {
      uxLog(this, c.grey(`-- parsing downloaded CSV from ${outputFile} and check for deprecated calls...`));
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
    }
    else {
      uxLog(this, c.yellow(`Warning: Unable to process logs of ${logFileUrl}`));
    }
  }

  private async generateSummaryLog(errors, severity) {
    // Collect all ips and the number of calls
    const ipList = {};
    for (const eventLogRecord of errors) {
      if (eventLogRecord.CLIENT_IP) {
        const ipInfo = ipList[eventLogRecord.CLIENT_IP] || { count: 0 };
        ipInfo.count++;
        ipList[eventLogRecord.CLIENT_IP] = ipInfo;
      }
    }
    // Try to get hostname for ips
    const ipResults: any[] = [];
    for (const ip of Object.keys(ipList)) {
      const ipInfo = ipList[ip];
      let hostname;
      try {
        hostname = await dnsPromises.reverse(ip);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        hostname = 'unknown';
      }
      const ipResult = { CLIENT_IP: ip, CLIENT_HOSTNAME: hostname, SFDX_HARDIS_COUNT: ipInfo.count };
      ipResults.push(ipResult);
    }
    this.ipResultsSorted = sortArray(ipResults, {
      by: ['SFDX_HARDIS_COUNT'],
      order: ['desc'],
    });
    // Write output CSV with client api info
    const outputFileIps = this.outputFile.endsWith('.csv')
      ? this.outputFile.replace('.csv', '.api-clients-' + severity + '.csv')
      : this.outputFile + 'api-clients-' + severity + '.csv';
    const outputFileIpsRes = await generateCsvFile(this.ipResultsSorted, outputFileIps);
    if (outputFileIpsRes.xlsxFile) {
      this.outputFilesRes.xlsxFile2 = outputFileIpsRes.xlsxFile;
    }
    uxLog(this, c.italic(c.cyan(`Please see info about ${severity} API callers in ${c.bold(outputFileIps)}`)));
    return outputFileIps;
  }
}
