/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import axios from "axios";
import * as fs from "fs-extra";
import * as c from "chalk";
import * as os from "os";
import * as ObjectsToCsv from "objects-to-csv";
import path = require("path");
import { createTempDir, execCommand, uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class LegacyApi extends SfdxCommand {
  public static title = "Check for legacy API use";

  public static description =
    "Checks if an org uses a deprecated API version\nMore info at https://help.salesforce.com/s/articleView?id=000351312&language=en_US&mode=1&type=1";

  public static examples = ["$ sfdx hardis:org:diagnose:legacyapi"];

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
    { apiFamily: ["SOAP", "REST", "BULK_API"], minApiVersion: 1.0, maxApiVersion: 6.0, severity: "ERROR" },
    { apiFamily: ["SOAP", "REST", "BULK_API"], minApiVersion: 7.0, maxApiVersion: 20.0, severity: "WARNING" },
    { apiFamily: ["SOAP", "REST", "BULK_API"], minApiVersion: 21.0, maxApiVersion: 30.0, severity: "INFO" },
  ]

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

    const limitConstraint = limit ? ` LIMIT ${limit}` : "";
    const conn = this.org.getConnection();

    // Get EventLogFile records with EventType = 'ApiTotalUsage'
    const logCountRes = await conn.query(`SELECT COUNT() FROM EventLogFile WHERE EventType = '${eventType}'`);
    if (logCountRes.totalSize === 0) {
      uxLog(this, c.green(`Found no EventLogFile entry of type ${eventType}.`));
      uxLog(this, c.green("This indicates that no legacy APIs were called during the log retention window."));
      return { status: 0 };
    }
    uxLog(this, "Found " + c.bold(logCountRes.totalSize) + ` ${eventType} EventLogFile entries.`);
    if (logCountRes.totalSize > limit) {
      uxLog(this,c.yellow(`There are more than ${limit} results, you may consider to increase limit using --limit argument`));
    }

    // Fetch EventLogFiles with ApiTotalUsage entries
    const eventLogRes: any = await conn.query(
      `SELECT LogFile FROM EventLogFile WHERE EventType = '${eventType}' ORDER BY CreatedDate DESC` + limitConstraint
    );

    // Collect legacy api calls from logs
    const allDeadApiCalls = [];
    const allSoonDeprecatedApiCalls = [];
    const allEndOfSupportApiCalls = [];
    for (const eventLogFile of eventLogRes.records) {
      const { deadApiCalls, soonDeprecatedApiCalls, endOfSupportApiCalls } = await this.collectDeprecatedApiCalls(eventLogFile.LogFile, conn);
      allDeadApiCalls.push(
        ...deadApiCalls.map((item) => {
          item.SFDX_HARDIS_SEVERITY = "ERROR";
          return item;
        })
      );
      allSoonDeprecatedApiCalls.push(
        ...soonDeprecatedApiCalls.map((item) => {
          item.SFDX_HARDIS_SEVERITY = "WARNING";
          return item;
        })
      );
      allEndOfSupportApiCalls.push(
        ...endOfSupportApiCalls.map((item) => {
          item.SFDX_HARDIS_SEVERITY = "INFO";
          return item;
        })
      );
    }

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
    const tmpDir = await createTempDir();
    const csvLogFile = path.join(tmpDir, "legacy-api-for-" + this.org.getUsername() + ".csv");
    const csv = new ObjectsToCsv(allDeadApiCalls.concat(allSoonDeprecatedApiCalls, allEndOfSupportApiCalls));
    await csv.toDisk(csvLogFile);
    uxLog(this, c.cyan(`Please see detailed log in ${c.bold(csvLogFile)}`));

    // Return an object to be displayed with --json
    return { status: statusCode, message: msg, csvLogFile: csvLogFile };
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
        if (legacyApiDescriptor.apiFamily.includes(apiFamily) && legacyApiDescriptor.minApiVersion <= apiVersion && legacyApiDescriptor.maxApiVersion >= apiVersion) {
          if (legacyApiDescriptor.severity === 'ERROR') {
            deadApiCalls.push(logEntry);
          }
          else if (legacyApiDescriptor.severity === "WARNING") {
            soonDeprecatedApiCalls.push(logEntry);
          }
          else {
            // severity === 'INFO'
            endOfSupportApiCalls.push(logEntry);
          }
          break;
        }
      }
    }
    return { deadApiCalls, soonDeprecatedApiCalls, endOfSupportApiCalls };
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
