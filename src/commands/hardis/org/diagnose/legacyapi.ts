/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as fs from "fs-extra";
import * as c from "chalk";
import * as Papa from "papaparse";
import path = require("path");
import * as sortArray from "sort-array";
import { getCurrentGitBranch, isCI, uxLog } from "../../../../common/utils";
import * as dns from "dns";
import { canSendNotifications, sendNotification } from "../../../../common/utils/notifUtils";
import { soqlQuery } from "../../../../common/utils/apiUtils";
import { getReportDirectory } from "../../../../config";
import { WebSocketClient } from "../../../../common/websocketClient";
import { NotifProvider, UtilsNotifs } from "../../../../common/notifProvider";
import { GitProvider } from "../../../../common/gitProvider";
const dnsPromises = dns.promises;

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class LegacyApi extends SfdxCommand {
  public static title = "Check for legacy API use";

  public static description = `Checks if an org uses retired or someday retired API version\n

See article below

[![Handle Salesforce API versions Deprecation like a pro](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deprecated-api.jpg)](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)

`;

  public static examples = [
    "$ sfdx hardis:org:diagnose:legacyapi",
    "$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com",
    "$ sfdx hardis:org:diagnose:legacyapi --outputfile 'c:/path/to/folder/legacyapi.csv'",
    "$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com --outputfile ./tmp/legacyapi.csv",
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    eventtype: flags.string({
      char: "e",
      default: "ApiTotalUsage",
      description: "Type of EventLogFile event to analyze",
    }),
    limit: flags.number({
      char: "l",
      default: 999,
      description: "Number of latest EventLogFile events to analyze",
    }),
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;
  protected apexSCannerCodeUrl = "https://raw.githubusercontent.com/pozil/legacy-api-scanner/main/legacy-api-scanner.apex";
  protected legacyApiDescriptors = [
    {
      apiFamily: ["SOAP", "REST", "BULK_API"],
      minApiVersion: 1.0,
      maxApiVersion: 6.0,
      severity: "ERROR",
      deprecationRelease: "Summer 21 - retirement of 1 to 6  ",
    },
    {
      apiFamily: ["SOAP", "REST", "BULK_API"],
      minApiVersion: 7.0,
      maxApiVersion: 20.0,
      severity: "WARNING",
      deprecationRelease: "Summer 22 - retirement of 7 to 20 ",
    },
    {
      apiFamily: ["SOAP", "REST", "BULK_API"],
      minApiVersion: 21.0,
      maxApiVersion: 30.0,
      severity: "INFO",
      deprecationRelease: "Summer 23 - retirement of 21 to 30",
    },
  ];

  protected outputFile;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    return await this.runJsForce();
  }

  // Refactoring of Philippe Ozil's apex script with JsForce queries
  private async runJsForce() {
    const eventType = this.flags.eventtype || "ApiTotalUsage";
    const limit = this.flags.limit || 999;
    this.outputFile = this.flags.outputfile || null;

    const limitConstraint = limit ? ` LIMIT ${limit}` : "";
    const conn = this.org.getConnection();

    // Get EventLogFile records with EventType = 'ApiTotalUsage'
    const logCountQuery = `SELECT COUNT() FROM EventLogFile WHERE EventType = '${eventType}'`;
    const logCountRes = await soqlQuery(logCountQuery, conn);
    if (logCountRes.totalSize === 0) {
      uxLog(this, c.green(`Found no EventLogFile entry of type ${eventType}.`));
      uxLog(this, c.green("This indicates that no legacy APIs were called during the log retention window."));
      return { status: 0 };
    }
    uxLog(this, c.grey("Found " + c.bold(logCountRes.totalSize) + ` ${eventType} EventLogFile entries.`));
    if (logCountRes.totalSize > limit) {
      uxLog(this, c.yellow(`There are more than ${limit} results, you may consider to increase limit using --limit argument`));
    }

    // Fetch EventLogFiles with ApiTotalUsage entries
    const logCollectQuery = `SELECT LogFile FROM EventLogFile WHERE EventType = '${eventType}' ORDER BY CreatedDate DESC` + limitConstraint;
    uxLog(this, c.grey("Query: " + c.italic(logCollectQuery)));
    const eventLogRes: any = await soqlQuery(logCollectQuery, conn);

    // Collect legacy api calls from logs
    uxLog(this, c.grey("Calling org API to get CSV content of each EventLogFile record, then parse and analyze it..."));
    const allDeadApiCalls = [];
    const allSoonDeprecatedApiCalls = [];
    const allEndOfSupportApiCalls = [];
    for (const eventLogFile of eventLogRes.records) {
      const { deadApiCalls, soonDeprecatedApiCalls, endOfSupportApiCalls } = await this.collectDeprecatedApiCalls(eventLogFile.LogFile, conn);
      allDeadApiCalls.push(...deadApiCalls);
      allSoonDeprecatedApiCalls.push(...soonDeprecatedApiCalls);
      allEndOfSupportApiCalls.push(...endOfSupportApiCalls);
    }
    const allErrors = allDeadApiCalls.concat(allSoonDeprecatedApiCalls, allEndOfSupportApiCalls);

    // Display summary
    const deadColor = allDeadApiCalls.length === 0 ? c.green : c.red;
    const deprecatedColor = allSoonDeprecatedApiCalls.length === 0 ? c.green : c.red;
    const endOfSupportColor = allEndOfSupportApiCalls.length === 0 ? c.green : c.yellow;
    uxLog(this, "");
    uxLog(this, c.cyan("Results:"));
    uxLog(this, deadColor(`- ${this.legacyApiDescriptors[0].deprecationRelease} : ${c.bold(allDeadApiCalls.length)}`));
    uxLog(this, deprecatedColor(`- ${this.legacyApiDescriptors[1].deprecationRelease} : ${c.bold(allSoonDeprecatedApiCalls.length)}`));
    uxLog(this, endOfSupportColor(`- ${this.legacyApiDescriptors[2].deprecationRelease} : ${c.bold(allEndOfSupportApiCalls.length)}`));
    uxLog(this, "");

    // Build command result
    let msg = "No deprecated API call has been found in ApiTotalUsage logs";
    let statusCode = 0;
    if (allDeadApiCalls.length > 0 || allSoonDeprecatedApiCalls.length > 0) {
      msg = "Found legacy API versions calls in logs";
      statusCode = 1;
      uxLog(this, c.red(c.bold(msg)));
    } else if (allEndOfSupportApiCalls.length > 0) {
      msg = "Found API versions calls in logs that will not be supported anymore in the future";
      statusCode = 0;
      uxLog(this, c.yellow(c.bold(msg)));
    } else {
      uxLog(this, c.green(msg));
    }

    // Build output CSV file
    if (this.outputFile == null) {
      // Default file in system temp directory if --outputfile not provided
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, "legacy-api-for-" + this.org.getUsername() + ".csv");
    } else {
      // Ensure directories to provided --outputfile are existing
      await fs.ensureDir(path.dirname(this.outputFile));
    }
    try {
      const csvText = Papa.unparse(allErrors);
      await fs.writeFile(this.outputFile, csvText, "utf8");
      uxLog(this, c.italic(c.cyan(`Please see detailed log in ${c.bold(this.outputFile)}`)));
      // Trigger command to open CSV file in VsCode extension
      WebSocketClient.requestOpenFile(this.outputFile);
    } catch (e) {
      uxLog(this, c.yellow("Error while generating CSV log file:\n" + e.message + "\n" + e.stack));
      this.outputFile = null;
    }

    // Generate one summary file by severity
    const outputFileIps = [];
    for (const descriptor of this.legacyApiDescriptors) {
      const errors =
        descriptor.severity === "ERROR" ? allDeadApiCalls : descriptor.severity === "WARNING" ? allSoonDeprecatedApiCalls : allEndOfSupportApiCalls;
      if (errors.length > 0) {
        const outputFileIp = await this.generateSummaryLog(errors, descriptor.severity);
        outputFileIps.push(outputFileIp);
        // Trigger command to open CSV file in VsCode extension
        WebSocketClient.requestOpenFile(outputFileIp);
      }
    }

    // Debug or manage CSV file generation error
    if (this.debugMode || this.outputFile == null) {
      uxLog(this, c.grey(c.bold("Dead API version calls:") + JSON.stringify(allDeadApiCalls, null, 2)));
      uxLog(this, c.grey(c.bold("Deprecated API version calls:") + JSON.stringify(allSoonDeprecatedApiCalls, null, 2)));
      uxLog(this, c.grey(c.bold("End of support API version calls:") + JSON.stringify(allEndOfSupportApiCalls, null, 2)));
    }

    const notifDetailText = `- Dead API version calls found in logs           : ${allDeadApiCalls.length} (${this.legacyApiDescriptors[0].deprecationRelease})
    - Deprecated API version calls found in logs     : ${allSoonDeprecatedApiCalls.length} (${this.legacyApiDescriptors[1].deprecationRelease})
    - End of support API version calls found in logs : ${allEndOfSupportApiCalls.length} (${this.legacyApiDescriptors[2].deprecationRelease})
    
    See article to solve issue before it's too late:
    - EN: https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238
    - FR: https://leblog.hardis-group.com/portfolio/versions-dapi-salesforce-decommissionnees-que-faire/`;

    // Manage notifications
    if (allErrors.length > 0) {
      const branchName = process.env.CI_COMMIT_REF_NAME || (await getCurrentGitBranch({ formatted: true })) || "Missing CI_COMMIT_REF_NAME variable";
      const targetLabel = this.org?.getConnection()?.instanceUrl || branchName;
      const linkMarkdown = UtilsNotifs.markdownLink(targetLabel, targetLabel.replace("https://", "").replace(".my.salesforce.com", ""));
      const notifButtons = [];
      const jobUrl = await GitProvider.getJobUrl();
      if (jobUrl) {
        notifButtons.push({ text: "View Job", url: jobUrl });
      }
      NotifProvider.postNotifications({
        text: `Deprecated Salesforce API versions are used in ${linkMarkdown}`,
        attachments: [{ text: notifDetailText }],
        buttons: notifButtons,
        severity: "error",
      });
    }

    // Send notification if possible
    if (isCI && allErrors.length > 0 && (await canSendNotifications())) {
      const currentGitBranch = await getCurrentGitBranch();
      await sendNotification({
        title: `WARNING: Deprecated Salesforce API versions are used in ${currentGitBranch}`,
        text: notifDetailText,
        severity: "critical",
      });
    }

    if ((this.argv || []).includes("legacyapi")) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      csvLogFile: this.outputFile,
      outputFileIps: outputFileIps,
      allDeadApiCalls,
      allSoonDeprecatedApiCalls,
      allEndOfSupportApiCalls,
    };
  }

  // GET csv log file and check for legacy API calls within
  private async collectDeprecatedApiCalls(logFileUrl: string, conn: any) {
    const deadApiCalls = [];
    const soonDeprecatedApiCalls = [];
    const endOfSupportApiCalls = [];
    const logEntries = await conn.request(logFileUrl);
    for (const logEntry of logEntries) {
      const apiVersion = logEntry.API_VERSION ? parseFloat(logEntry.API_VERSION) : parseFloat("999.0");
      // const apiType = logEntry.API_TYPE || null ;
      const apiFamily = logEntry.API_FAMILY || null;

      for (const legacyApiDescriptor of this.legacyApiDescriptors) {
        if (
          legacyApiDescriptor.apiFamily.includes(apiFamily) &&
          legacyApiDescriptor.minApiVersion <= apiVersion &&
          legacyApiDescriptor.maxApiVersion >= apiVersion
        ) {
          logEntry.SFDX_HARDIS_DEPRECATION_RELEASE = legacyApiDescriptor.deprecationRelease;
          logEntry.SFDX_HARDIS_SEVERITY = legacyApiDescriptor.severity;
          if (legacyApiDescriptor.severity === "ERROR") {
            deadApiCalls.push(logEntry);
          } else if (legacyApiDescriptor.severity === "WARNING") {
            soonDeprecatedApiCalls.push(logEntry);
          } else {
            // severity === 'INFO'
            endOfSupportApiCalls.push(logEntry);
          }
          break;
        }
      }
    }
    return { deadApiCalls, soonDeprecatedApiCalls, endOfSupportApiCalls };
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
    const ipResults = [];
    for (const ip of Object.keys(ipList)) {
      const ipInfo = ipList[ip];
      let hostname;
      try {
        hostname = await dnsPromises.reverse(ip);
      } catch (e) {
        hostname = "unknown";
      }
      const ipResult = { CLIENT_IP: ip, CLIENT_HOSTNAME: hostname, SFDX_HARDIS_COUNT: ipInfo.count };
      ipResults.push(ipResult);
    }
    const ipResultsSorted = sortArray(ipResults, {
      by: ["SFDX_HARDIS_COUNT"],
      order: ["desc"],
    });
    // Write output CSV with client api info
    let outputFileIps = this.outputFile.endsWith(".csv")
      ? this.outputFile.replace(".csv", ".api-clients-" + severity + ".csv")
      : this.outputFile + "api-clients-" + severity + ".csv";
    try {
      const csvTextIps = Papa.unparse(ipResultsSorted);
      await fs.writeFile(outputFileIps, csvTextIps, "utf8");
      uxLog(this, c.italic(c.cyan(`Please see info about ${severity} API callers in ${c.bold(outputFileIps)}`)));
    } catch (e) {
      uxLog(this, c.yellow("Error while generating " + severity + " API callers log file:\n" + e.message + "\n" + e.stack));
      outputFileIps = null;
    }
    return outputFileIps;
  }
}
