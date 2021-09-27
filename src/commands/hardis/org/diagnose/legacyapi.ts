/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import axios from "axios";
import * as fs from "fs-extra";
import * as c from "chalk";
import * as os from "os";
import * as Papa from "papaparse";
import path = require("path");
import * as sortArray from "sort-array";
import { createTempDir, execCommand, uxLog } from "../../../../common/utils";
import * as dns from "dns";
const dnsPromises = dns.promises;

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class LegacyApi extends SfdxCommand {
  public static title = "Check for legacy API use";

  public static description = `Checks if an org uses a deprecated API version\n

Advanced command guide in this article: [https://nicolasvuillamy.medium.com/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238](https://nicolasvuillamy.medium.com/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)

- Salesforce will remove access to old API versions in the following releases
- An external application (ESB, ETL, Web Portal, Mobile application...) using a deprecated API version will receive errors as response, and this will probably break integrations business processes
- More info in [Salesforce Help](https://help.salesforce.com/s/articleView?id=000351312&language=en_US&mode=1&type=1) and in this [Salesforce blog post](https://t.co/uc2cobzmVi?amp=1)

| API versions | Salesforce deprecation release |
|:------------:|:------------------------------:|
| 7.0 to 20.0  |           Summer 21            |
| 21.0 to 30.0 |           Summer 22            |

- Run the command \`sfdx hardis:org:diagnose:legacyapi\`

![Legacy API result](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/legacy-api-result.png)

- If you see deprecated API calls, open the detailed CSV file and identify the sources of deprecated API calls
- You need to update your ecosystem external applications so they call a more recent version of APIS (52.0)
`;

  public static examples = [
    "$ sfdx hardis:org:diagnose:legacyapi",
    "$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com",
    "$ sfdx hardis:org:diagnose:legacyapi --outputfile 'c:/path/to/folder/legacyapi.csv'",
    "$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com --outputfile ./tmp/legacyapi.csv",
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    mode: flags.string({
      char: "m",
      default: "jsforce",
      description: "Detection mode: jsforce or apex",
    }),
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
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;
  protected apexSCannerCodeUrl = "https://raw.githubusercontent.com/pozil/legacy-api-scanner/main/legacy-api-scanner.apex";
  protected legacyApiDescriptors = [
    { apiFamily: ["SOAP", "REST", "BULK_API"], minApiVersion: 1.0, maxApiVersion: 6.0, severity: "ERROR", deprecationRelease: "Winter 19" },
    { apiFamily: ["SOAP", "REST", "BULK_API"], minApiVersion: 7.0, maxApiVersion: 20.0, severity: "WARNING", deprecationRelease: "Summer 21" },
    { apiFamily: ["SOAP", "REST", "BULK_API"], minApiVersion: 21.0, maxApiVersion: 30.0, severity: "INFO", deprecationRelease: "Summer 22" },
  ];

  protected outputFile;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const mode = this.flags.mode || "jsforce";
    this.debugMode = this.flags.debug || false;
    if (mode === "jsforce") {
      return await this.runJsForce();
    } else {
      return await this.runApex();
    }
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
    uxLog(this, c.grey("Query: " + c.italic(logCountQuery)));
    const logCountRes = await conn.query(logCountQuery);
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
    const eventLogRes: any = await conn.query(logCollectQuery);

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
    const endOfSupportColor = allEndOfSupportApiCalls.length === 0 ? c.green : c.red;
    uxLog(this, "");
    uxLog(this, c.cyan("Results:"));
    uxLog(
      this,
      deadColor(`- Dead API version calls           : ${c.bold(allDeadApiCalls.length)} (${this.legacyApiDescriptors[0].deprecationRelease})`)
    );
    uxLog(
      this,
      deprecatedColor(
        `- Deprecated API version calls     : ${c.bold(allSoonDeprecatedApiCalls.length)} (${this.legacyApiDescriptors[1].deprecationRelease})`
      )
    );
    uxLog(
      this,
      endOfSupportColor(
        `- End of support API version calls : ${c.bold(allEndOfSupportApiCalls.length)} (${this.legacyApiDescriptors[2].deprecationRelease})`
      )
    );
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
      const tmpDir = await createTempDir();
      this.outputFile = path.join(tmpDir, "legacy-api-for-" + this.org.getUsername() + ".csv");
    } else {
      // Ensure directories to provided --outputfile are existing
      await fs.ensureDir(path.dirname(this.outputFile));
    }
    try {
      const csvText = Papa.unparse(allErrors);
      await fs.writeFile(this.outputFile, csvText, "utf8");
      uxLog(this, c.italic(c.cyan(`Please see detailed log in ${c.bold(this.outputFile)}`)));
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
      }
    }

    // Debug or manage CSV file generation error
    if (this.debugMode || this.outputFile == null) {
      uxLog(this, c.grey(c.bold("Dead API version calls:") + JSON.stringify(allDeadApiCalls, null, 2)));
      uxLog(this, c.grey(c.bold("Deprecated API version calls:") + JSON.stringify(allSoonDeprecatedApiCalls, null, 2)));
      uxLog(this, c.grey(c.bold("End of support API version calls:") + JSON.stringify(allEndOfSupportApiCalls, null, 2)));
    }

    process.exitCode = statusCode;

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

  // Run using Philippe Ozil script as anonymous apex code (has limitations on the latest 99 ApiTotalUsage logs)
  private async runApex() {
    // Get Legacy API scanner apex code
    const tmpApexFile = path.join(os.tmpdir(), new Date().toJSON().slice(0, 10), "legacy-api-scanner.apex");
    if (!fs.existsSync(tmpApexFile)) {
      uxLog(this, c.grey("Downloaded latest legacy API scanner script from " + this.apexSCannerCodeUrl));
      await fs.ensureDir(path.dirname(tmpApexFile));
      const response = await axios({
        method: "get",
        url: this.apexSCannerCodeUrl,
        responseType: "stream",
      });
      response.data.pipe(fs.createWriteStream(tmpApexFile));
    }

    // Execute apex code
    const apexScriptCommand = `sfdx force:apex:execute -f "${tmpApexFile}" -u ${this.org.getUsername()}`;
    const apexScriptLog = await execCommand(apexScriptCommand, this, {
      fail: true,
      output: true,
      debug: this.debugMode,
    });

    let msg = "No deprecated API call has been found in the latest 99 ApiTotalUsage logs";
    let statusCode = 0;
    if (apexScriptLog.stdout.match(/USER_DEBUG .* Found legacy API versions in logs/gm)) {
      msg = "Found legacy API versions in logs";
      statusCode = 1;
      uxLog(this, c.red(c.bold(msg)));
    } else {
      uxLog(this, c.green(msg));
    }

    // Return an object to be displayed with --json
    return { status: statusCode, message: msg };
  }
}
