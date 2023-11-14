/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as fs from "fs-extra";
import * as c from "chalk";
import * as Papa from "papaparse";
import path = require("path");
import { getCurrentGitBranch, uxLog } from "../../../../common/utils";
import { bulkQuery } from "../../../../common/utils/apiUtils";
import { getConfig, getReportDirectory } from "../../../../config";
import { WebSocketClient } from "../../../../common/websocketClient";
import { NotifProvider, UtilsNotifs } from "../../../../common/notifProvider";
import { GitProvider } from "../../../../common/gitProvider";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DiagnoseAuditTrail extends SfdxCommand {
  public static title = "Filtered extract content of Setup Audit Trail";

  public static description = `Export Audit trail into a CSV file with selected criteria, and highlight suspect actions`;

  public static examples = [
    "$ sfdx hardis:org:diagnose:audittrail"
  ];

  protected static flagsConfig = {
    excludeusers: flags.string({
      char: "e",
      description: "Comma-separated list of usernames to exclude",
    }),
    lastndays: flags.string({
      char: "t",
      description: "Number of days to extract from today (included)",
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

  protected excludeUsers = [];
  protected lastNdays = 1;
  protected allowedSectionsActions = {};
  protected debugMode = false;

  protected outputFile;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.excludeUsers = (this.flags.excludeusers || "").split(",");
    this.lastNdays = this.flags.lastndays || 1;
    this.allowedSectionsActions = {
      "Certificate and Key Management": [
        "insertCertificate"
      ],
      "Manage Users": [
        "createduser",
        "changedpassword",
        "changedUserEmailVerifiedStatusVerified",
        "PermSetAssign",
        "resetpassword"
      ]
    };
    this.outputFile = this.flags.outputfile || null;
    const conn = this.org.getConnection();

    uxLog(this, c.cyan(`Extracting Setup Audit Trail and detect suspect actions in ${conn.instanceUrl} ...`))

    // Manage exclude users list
    if (this.excludeUsers.length === 0) {
      const config = await getConfig("branch");
      if (config.targetUsername) {
        this.excludeUsers.push(config.targetUsername);
      }
    }
    let whereConstraint =
      `WHERE CreatedDate = LAST_N_DAYS:${this.lastNdays}` +
      ` AND CreatedBy.Username != NULL`;
    if (this.excludeUsers.length > 0) {
      whereConstraint += ` AND CreatedBy.Username NOT IN ('${this.excludeUsers.join("','")}') `;
    }

    // Fetch SetupAuditTrail records
    const auditTrailQuery =
      `SELECT CreatedDate,CreatedBy.Username,Action,Section,Display,ResponsibleNamespacePrefix,DelegateUser ` +
      `FROM SetupAuditTrail ` +
      whereConstraint +
      `ORDER BY CreatedDate DESC`;
    uxLog(this, c.grey("Query: " + c.italic(auditTrailQuery)));
    const queryRes = await bulkQuery(auditTrailQuery, conn);
    const suspectRecords = [];
    const auditTrailRecords = queryRes.records.map(record => {
      record.Suspect = false;
      // Unallowed actions
      if (
        (this.allowedSectionsActions[record.Section] && !this.allowedSectionsActions[record.Section].includes(record.Action))
        ||
        !this.allowedSectionsActions[record.Section]
      ) {
        record.Suspect = true;
        record.SuspectReason = `Manual config in unallowed section ${record.Section} with action ${record.Action}`;
        suspectRecords.push(record);
        return record;
      }
      return record;
    });

    let statusCode = 0;
    let msg = "No suspect Setup Audit Trail records has been found";
    if (suspectRecords.length > 0) {
      statusCode = 1;
      msg = `${suspectRecords.length} suspect Setup Audit Trail records has been found`;
      uxLog(this, c.red(msg));
    }
    else {
      uxLog(this, c.green(msg));
    }

    // Build output CSV file name
    if (this.outputFile == null) {
      // Default file in system temp directory if --outputfile not provided
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, "audit-trail-" + this.org.getUsername() + ".csv");
    } else {
      // Ensure directories to provided --outputfile are existing
      await fs.ensureDir(path.dirname(this.outputFile));
    }

    // Generate output CSV file
    try {
      const csvText = Papa.unparse(auditTrailRecords);
      await fs.writeFile(this.outputFile, csvText, "utf8");
      uxLog(this, c.italic(c.cyan(`Please see detailed log in ${c.bold(this.outputFile)}`)));
      // Trigger command to open CSV file in VsCode extension
      WebSocketClient.requestOpenFile(this.outputFile);
    } catch (e) {
      uxLog(this, c.yellow("Error while generating CSV log file:\n" + e.message + "\n" + e.stack));
      this.outputFile = null;
    }

    const notifDetailText = ``
    // Manage notifications
    if (suspectRecords.length > 0) {
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

    if ((this.argv || []).includes("audittrail")) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      csvLogFile: this.outputFile
    };
  }

}
