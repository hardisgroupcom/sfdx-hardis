/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { bulkQuery } from "../../../../common/utils/apiUtils";
import { getConfig } from "../../../../config";
import { NotifProvider, NotifSeverity } from "../../../../common/notifProvider";
import { prompts } from "../../../../common/utils/prompts";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from "../../../../common/utils/notifUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DiagnoseAuditTrail extends SfdxCommand {
  public static title = "Diagnose content of Setup Audit Trail";

  public static description = `Export Audit trail into a CSV file with selected criteria, and highlight suspect actions

Regular setup actions performed in major orgs are filtered.

- ""
  - createScratchOrg
  - changedsenderemail
  - deleteScratchOrg
  - loginasgrantedtopartnerbt
- Certificate and Key Management
  - insertCertificate
- Data Management
  - queueMembership
- Email Administration
  - dkimRotationPreparationSuccessful
  - dkimRotationSuccessful
- Groups
  - groupMembership
- Holidays
  - holiday_insert
- Inbox mobile and legacy desktop apps
  - enableSIQUserNonEAC
- Manage Users
  - activateduser
  - createduser
  - changedcommunitynickname
  - changedemail
  - changedfederationid
  - changedpassword
  - changedinteractionuseroffon
  - changedinteractionuseronoff
  - changedmarketinguseroffon
  - changedmarketinguseronoff
  - changedprofileforuser
  - changedprofileforusercusttostd
  - changedprofileforuserstdtocust
  - changedroleforusertonone
  - changedroleforuser
  - changedroleforuserfromnone
  - changedUserEmailVerifiedStatusUnverified
  - changedUserEmailVerifiedStatusVerified
  - changedUserPhoneNumber
  - changedUserPhoneVerifiedStatusUnverified
  - deactivateduser
  - deleteAuthenticatorPairing
  - deleteTwoFactorInfo2
  - deleteTwoFactorTempCode
  - frozeuser
  - insertAuthenticatorPairing
  - insertTwoFactorInfo2
  - insertTwoFactorTempCode
  - lightningloginenroll
  - PermSetAssign
  - PermSetGroupAssign
  - PermSetGroupUnassign
  - PermSetLicenseAssign
  - PermSetUnassign
  - PermSetLicenseUnassign
  - registeredUserPhoneNumber
  - resetpassword
  - suOrgAdminLogin
  - suOrgAdminLogout
  - useremailchangesent
- Reporting Snapshots
  - createdReportJob
  - deletedReportJob
- Sandboxes
  - DeleteSandbox

By default, deployment user defined in .sfdx-hardis.yml targetUsername property will be excluded.

You can define additional users to exclude in .sfdx-hardis.yml **monitoringExcludeUsernames** property.

You can also add more sections / actions considered as not suspect using property **monitoringAllowedSectionsActions**

Example:

\`\`\`yaml
monitoringExcludeUsernames:
  - deploymentuser@cloudity.com
  - marketingcloud@cloudity.com
  - integration-user@cloudity.com

monitoringAllowedSectionsActions:
  "Some section": [] // Will ignore all actions from such section
  "Some other section": ["actionType1","actionType2","actionType3"] // Will ignore only those 3 actions from section "Some other section". Other actions in the same section will be considered as suspect.
\`\`\`
  `;

  public static examples = [
    "$ sfdx hardis:org:diagnose:audittrail",
    "$ sfdx hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com",
    "$ sfdx hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com,bertrand@titi.com",
    "$ sfdx hardis:org:diagnose:audittrail --lastndays 5",
  ];

  protected static flagsConfig = {
    excludeusers: flags.string({
      char: "e",
      description: "Comma-separated list of usernames to exclude",
    }),
    lastndays: flags.number({
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
  protected lastNdays: number;
  protected allowedSectionsActions = {};
  protected debugMode = false;

  protected auditTrailRecords = [];
  protected outputFile;
  protected outputFilesRes: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.excludeUsers = this.flags.excludeusers ? this.flags.excludeusers.split(",") : [];
    this.lastNdays = this.flags.lastndays;
    this.outputFile = this.flags.outputfile || null;
    const config = await getConfig("branch");

    // If manual mode and lastndays not sent as parameter, prompt user
    if (!isCI && !this.lastNdays) {
      const lastNdaysResponse = await prompts({
        type: "select",
        name: "lastndays",
        message: "Please select the number of days in the past from today you want to detect suspiscious setup activities",
        choices: [
          { title: `1`, value: 1 },
          { title: `2`, value: 2 },
          { title: `3`, value: 3 },
          { title: `4`, value: 4 },
          { title: `5`, value: 5 },
          { title: `6`, value: 6 },
          { title: `7`, value: 7 },
          { title: `14`, value: 14 },
          { title: `30`, value: 30 },
          { title: `60`, value: 60 },
          { title: `90`, value: 90 },
          { title: `180`, value: 180 },
        ],
      });
      this.lastNdays = lastNdaysResponse.lastndays;
    } else {
      this.lastNdays = this.lastNdays || 1;
    }

    this.allowedSectionsActions = {
      "": ["createScratchOrg", "changedsenderemail", "deleteScratchOrg", "loginasgrantedtopartnerbt"],
      "Certificate and Key Management": ["insertCertificate"],
      "Data Management": ["queueMembership"],
      "Email Administration": ["dkimRotationSuccessful", "dkimRotationPreparationSuccessful"],
      Holidays: ["holiday_insert"],
      "Inbox mobile and legacy desktop apps": ["enableSIQUserNonEAC"],
      Groups: ["groupMembership"],
      "Manage Users": [
        "activateduser",
        "createduser",
        "changedcommunitynickname",
        "changedemail",
        "changedfederationid",
        "changedinteractionuseroffon",
        "changedinteractionuseronoff",
        "changedmarketinguseroffon",
        "changedmarketinguseronoff",
        "changedManager",
        "changedprofileforuser",
        "changedprofileforusercusttostd",
        "changedprofileforuserstdtocust",
        "changedroleforusertonone",
        "changedroleforuser",
        "changedroleforuserfromnone",
        "changedpassword",
        "changedUserEmailVerifiedStatusUnverified",
        "changedUserEmailVerifiedStatusVerified",
        "changedUserPhoneNumber",
        "changedUserPhoneVerifiedStatusUnverified",
        "deactivateduser",
        "deleteAuthenticatorPairing",
        "deleteTwoFactorInfo2",
        "deleteTwoFactorTempCode",
        "frozeuser",
        "insertAuthenticatorPairing",
        "insertTwoFactorInfo2",
        "insertTwoFactorTempCode",
        "lightningloginenroll",
        "PermSetAssign",
        "PermSetGroupAssign",
        "PermSetGroupUnassign",
        "PermSetLicenseAssign",
        "PermSetUnassign",
        "PermSetLicenseUnassign",
        "registeredUserPhoneNumber",
        "resetpassword",
        "suOrgAdminLogin",
        "suOrgAdminLogout",
        "useremailchangesent",
      ],
      "Reporting Snapshots": ["createdReportJob", "deletedReportJob"],
      Sandboxes: ["DeleteSandbox"],
    };

    // Append custom sections & actions considered as not suspect
    if (config.monitoringAllowedSectionsActions) {
      this.allowedSectionsActions = Object.assign(this.allowedSectionsActions, config.monitoringAllowedSectionsActions);
    }

    const conn = this.org.getConnection();
    uxLog(this, c.cyan(`Extracting Setup Audit Trail and detect suspect actions in ${conn.instanceUrl} ...`));

    // Manage exclude users list
    if (this.excludeUsers.length === 0) {
      if (config.targetUsername) {
        this.excludeUsers.push(config.targetUsername);
      }
      if (config.monitoringExcludeUsernames) {
        this.excludeUsers.push(...config.monitoringExcludeUsernames);
      }
    }
    let whereConstraint = `WHERE CreatedDate = LAST_N_DAYS:${this.lastNdays}` + ` AND CreatedBy.Username != NULL `;
    if (this.excludeUsers.length > 0) {
      whereConstraint += `AND CreatedBy.Username NOT IN ('${this.excludeUsers.join("','")}') `;
    }

    uxLog(this, c.cyan(`Excluded users are ${this.excludeUsers.join(",") || "None"}`));
    uxLog(this, c.cyan(`Use argument --excludeusers or .sfdx-hardis.yml property monitoringExcludeUsernames to exclude more users`));

    // Fetch SetupAuditTrail records
    const auditTrailQuery =
      `SELECT CreatedDate,CreatedBy.Username,CreatedBy.Name,Action,Section,Display,ResponsibleNamespacePrefix,DelegateUser ` +
      `FROM SetupAuditTrail ` +
      whereConstraint +
      `ORDER BY CreatedDate DESC`;
    uxLog(this, c.grey("Query: " + c.italic(auditTrailQuery)));
    const queryRes = await bulkQuery(auditTrailQuery, conn);
    const suspectRecords = [];
    let suspectUsers = [];
    const suspectActions = [];
    const severityIconLog = getSeverityIcon("log");
    const severityIconWarning = getSeverityIcon("warning");
    this.auditTrailRecords = queryRes.records.map((record) => {
      const section = record?.Section || "";
      record.Suspect = false;
      record.severity = 'log';
      record.severityIcon = severityIconLog;
      // Unallowed actions
      if (
        (this.allowedSectionsActions[section] && !this.allowedSectionsActions[section].includes(record.Action)) ||
        !this.allowedSectionsActions[section]
      ) {
        record.Suspect = true;
        record.SuspectReason = `Manual config in unallowed section ${section} with action ${record.Action}`;
        record.severity = 'warning';
        record.severityIcon = severityIconWarning;
        suspectRecords.push(record);
        suspectUsers.push(record["CreatedBy.Username"] + " - " + record["CreatedBy.Name"]);
        suspectActions.push(`${section} - ${record.Action}`);
        return record;
      }
      return record;
    });

    let statusCode = 0;
    let msg = "No suspect Setup Audit Trail records has been found";
    const suspectActionsWithCount = [];
    if (suspectRecords.length > 0) {
      statusCode = 1;
      uxLog(this, c.yellow("Suspect records list"));
      uxLog(this, JSON.stringify(suspectRecords, null, 2));
      msg = `${suspectRecords.length} suspect Setup Audit Trail records has been found`;
      uxLog(this, c.yellow(msg));
      suspectUsers = [...new Set(suspectUsers)];
      suspectUsers.sort();
      const suspectActionsSummary = {};
      for (const suspectAction of suspectActions) {
        suspectActionsSummary[suspectAction] = (suspectActionsSummary[suspectAction] || 0) + 1;
      }
      for (const suspectAction of Object.keys(suspectActionsSummary)) {
        suspectActionsWithCount.push(`${suspectAction} (${suspectActionsSummary[suspectAction]})`);
      }
      suspectActionsWithCount.sort();
      uxLog(this, "");
      uxLog(this, c.yellow("Related users:"));
      for (const user of suspectUsers) {
        uxLog(this, c.yellow(`- ${user}`));
      }
      uxLog(this, "");
      uxLog(this, c.yellow("Related actions:"));
      for (const action of suspectActionsWithCount) {
        uxLog(this, c.yellow(`- ${action}`));
      }
      uxLog(this, "");
    } else {
      uxLog(this, c.green(msg));
    }

    // Generate output CSV file
    this.outputFile = await generateReportPath("audit-trail", this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.auditTrailRecords, this.outputFile);

    // Manage notifications
    const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = "log";
    let notifText = `No suspect Setup Audit Trail records has been found in ${orgMarkdown}`;
    let notifAttachments = [];
    if (suspectRecords.length > 0) {
      notifSeverity = "warning";
      notifText = `${suspectRecords.length} suspect Setup Audit Trail records have been found in ${orgMarkdown}`;
      let notifDetailText = ``;
      notifDetailText += "*Related users*:\n";
      for (const user of suspectUsers) {
        notifDetailText += `• ${user}\n`;
      }
      notifDetailText += "\n";
      notifDetailText += "*Related actions*:\n";
      for (const action of suspectActionsWithCount) {
        notifDetailText += `• ${action}\n`;
      }
      notifAttachments = [{ text: notifDetailText }];
    }

    globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: "AUDIT_TRAIL",
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.auditTrailRecords,
      data: { metric: suspectRecords.length },
    });

    if ((this.argv || []).includes("audittrail")) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      suspectRecords: suspectRecords,
      suspectUsers: suspectUsers,
      csvLogFile: this.outputFile,
    };
  }
}
