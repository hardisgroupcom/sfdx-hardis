/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { uxLog } from "../../../../common/utils";
import { soqlQuery } from "../../../../common/utils/apiUtils";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";
import { NotifProvider } from "../../../../common/notifProvider";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DiagnoseUnusedUsers extends SfdxCommand {
  public static title = "List licenses subscribed and used in a Salesforce org";

  public static description = `Mostly used for monitoring (Grafana) but you can also use it manually :)`;

  public static examples = ["$ sfdx hardis:org:diagnose:licenses"];

  //Comment default values to test the prompts
  protected static flagsConfig = {
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
    }),
    usedonly: flags.boolean({
      char: "u",
      default: false,
      description: "Filter to have only used licenses",
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

  protected usedOnly = false;
  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected licenses: any = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.usedOnly = this.flags.usedonly || false;
    this.debugMode = this.flags.debug || false;
    this.outputFile = this.flags.outputfile || null;

    // Retrieve the list of users who haven't logged in for a while
    const conn = this.org.getConnection();
    uxLog(this, c.cyan(`Extracting Licenses from ${conn.instanceUrl} ...` + this.usedOnly ? "(used only)" : ""));

    const licensesByKey = {};
    const usedLicenses = [];

    // Query User Licenses
    const userLicenseQuery =
      `Select MasterLabel, Name, TotalLicenses, UsedLicenses ` +
      `FROM UserLicense ` +
      `WHERE Status='Active' AND TotalLicenses > 0 ` +
      `ORDER BY MasterLabel`;
    const userLicenseQueryRes = await soqlQuery(userLicenseQuery, conn);
    const userLicenses = userLicenseQueryRes.records.map((userLicense) => {
      const userLicenseInfo = Object.assign({}, userLicense);
      delete userLicenseInfo.Id;
      delete userLicenseInfo.attributes;
      userLicenseInfo.type = "UserLicense";
      licensesByKey[userLicenseInfo.MasterLabel] = userLicenseInfo.TotalLicenses;
      if (userLicenseInfo.UsedLicenses > 0) {
        usedLicenses.push(userLicenseInfo.MasterLabel);
      }
      return userLicenseInfo;
    });
    this.licenses.push(...userLicenses);

    // Query Permission Set Licenses
    let pslQuery =
      `SELECT MasterLabel, PermissionSetLicenseKey, TotalLicenses, UsedLicenses ` +
      `FROM PermissionSetLicense ` +
      `WHERE Status='Active' AND TotalLicenses > 0 `;
    if (this.usedOnly) {
      pslQuery += `AND UsedLicenses > 0 `;
    }
    pslQuery += `ORDER BY MasterLabel`;
    const pslQueryRes = await soqlQuery(pslQuery, conn);
    const pslLicenses = pslQueryRes.records.map((psl) => {
      const pslInfo = Object.assign({}, psl);
      pslInfo.Name = pslInfo.PermissionSetLicenseKey;
      delete pslInfo.Id;
      delete pslInfo.attributes;
      delete pslInfo.PermissionSetLicenseKey;
      pslInfo.type = "PermissionSetLicense";
      licensesByKey[pslInfo.MasterLabel] = pslInfo.TotalLicenses;
      if (pslInfo.UsedLicenses > 0) {
        usedLicenses.push(pslInfo.MasterLabel);
      }
      return pslInfo;
    });
    this.licenses.push(...pslLicenses);

    usedLicenses.sort();
    console.table(this.licenses);
    uxLog(this, c.cyan("Used licenses: " + usedLicenses.join(", ")));

    // Generate output CSV file
    this.outputFile = await generateReportPath("licenses", this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.licenses, this.outputFile);

    globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: "LICENSES",
      text: "",
      severity: "log",
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.licenses,
      data: {
        activeLicenses: Object.keys(licensesByKey).sort(),
        usedLicenses: usedLicenses,
        licenses: licensesByKey,
      },
      metrics: {},
    });

    // Return an object to be displayed with --json
    return {
      status: 0,
      licenses: this.licenses,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes.xlsxFile,
    };
  }
}
