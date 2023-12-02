/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { uxLog } from "../../../../common/utils";
import { bulkQuery } from "../../../../common/utils/apiUtils";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";


// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DiagnoseUnusedLicenses extends SfdxCommand {
  public static title = "Detect unused Permission Set Licenses";

  public static description = `When you assign a Permission Set to a user, and that this Permission Set is related to a Permission Set License, a Permission Set License Assignment is automatically created for the user.

  But when you unassign this Permission Set from the user, **the Permission Set License Assignment is not deleted**.

  This leads that you can be **charged for Permission Set Licenses that are not used** !

  This command detects such useless Permission Set Licenses Assignments and suggests to delete them.

  Many thanks to [Vincent Finet](https://www.linkedin.com/in/vincentfinet/) for the inspiration during his great speaker session at [French Touch Dreamin '23](https://frenchtouchdreamin.com/), and his kind agreement for reusing such inspiration in this command :)
  `;

  public static examples = [
    "$ sfdx hardis:org:diagnose:unusedlicenses",
    "$ sfdx hardis:org:diagnose:unusedlicenses --fix"
  ];

  protected static flagsConfig = {
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

  protected outputFile;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.outputFile = this.flags.outputfile || null;

    const conn = this.org.getConnection();
    const unusedPermissionSetLicenseAssignments = [];

    // List Permission Set Licenses Assignments
    uxLog(this, c.cyan(`Extracting all Permission Sets Licenses Assignments...`));
    const pslaQueryRes = await bulkQuery(`
    SELECT Id,PermissionSetLicenseId, PermissionSetLicense.DeveloperName,PermissionSetLicense.MasterLabel, AssigneeId, Assignee.Username, Assignee.IsActive
    FROM PermissionSetLicenseAssign
    ORDER BY Assignee.Username`
      , conn);
    const permissionSetLicenseAssignments = pslaQueryRes.records;

    // Extract assignments to deactivated users
    const permissionSetLicenseAssignmentsActiveUsers = permissionSetLicenseAssignments.filter(psla => {
      if (psla["Assignee.IsActive"] === false) {
        unusedPermissionSetLicenseAssignments.push({
          Id: psla.Id,
          PermissionsSetLicense: psla["PermissionSetLicense.MasterLabel"],
          User: psla["Assignee.Username"],
          Reason: "Inactive user"
        });
        return false;
      }
      return true;
    });
    const numberPslaRelatedToInactiveUser = unusedPermissionSetLicenseAssignments.length;

    // List related Permission Set Licences
    const relatedPermissionSetLicenses = permissionSetLicenseAssignmentsActiveUsers.map(psla => {
      return {
        Id: psla.PermissionSetLicenseId,
        DeveloperName: psla["PermissionSetLicense.DeveloperName"],
        MasterLabel: psla["PermissionSetLicense.MasterLabel"]
      }
    }).filter(
      (value, index, self) =>
        index === self.findIndex((t) => (t.Id === value.Id)
        )
    );
    const psLicencesIdsStr = "'" + relatedPermissionSetLicenses.map(psl => psl.Id).join("','") + "'";
    uxLog(this, c.cyan(`Extracting all Permission Sets Licenses...`));
    const pslQueryRes = await bulkQuery(
      `SELECT Id,DeveloperName,MasterLabel 
       FROM PermissionSetLicense
       WHERE Id in (${psLicencesIdsStr})`,
      conn);
    const permissionSetLicenses = pslQueryRes.records;

    // List related Permission sets
    const psLicencesIdsStr2 = "'" + permissionSetLicenses.map(psl => psl.Id).join("','") + "'";
    uxLog(this, c.cyan(`Extracting related Permission Sets...`));
    const psQueryRes = await bulkQuery(
      `SELECT Id,Label,Name,LicenseId
       FROM PermissionSet
       WHERE LicenseId in (${psLicencesIdsStr2})`,
      conn);
    const permissionSets = psQueryRes.records;

    // List related Permission Set Assignments
    const permissionSetsIdsStr = "'" + permissionSets.map(psl => psl.Id).join("','") + "'";
    uxLog(this, c.cyan(`Extracting related Permission Sets Assignments...`));
    const psaQueryRes = await bulkQuery(
      `SELECT Id,Assignee.Username,PermissionSetId FROM PermissionSetAssignment
       WHERE PermissionSetId in (${permissionSetsIdsStr})`,
      conn);
    const permissionSetAssignments = psaQueryRes.records;

    // Browse Permission Sets License assignments
    for (const psla of permissionSetLicenseAssignmentsActiveUsers) {
      let matchingPsaFound = false;
      const pslaUsername = psla["Assignee.Username"];
      // Find related Permission Set assignements
      const foundMatchingPsAssignments = permissionSetAssignments.filter(psa => {
        if (psa["Assignee.Username"] === pslaUsername) {
          // Select Permission sets matching the Permission Set Licenses
          const psMatchingLicenses = permissionSets.filter(ps => ps.LicenseId === psla.relatedPermissionSetLicenses);
          if (psMatchingLicenses.length > 0) {
            matchingPsaFound = true;
          }
        }
        return matchingPsaFound;
      });
      if (foundMatchingPsAssignments.length === 0) {
        unusedPermissionSetLicenseAssignments.push({
          Id: psla.Id,
          PermissionsSetLicense: psla["PermissionSetLicense.MasterLabel"],
          User: psla["Assignee.Username"],
          Reason: "Related PS assignment not found"
        });
      }
    }

    // Create results
    const statusCode = 0;
    let msg = `No unused permission set license assignment has been found`;
    if (unusedPermissionSetLicenseAssignments.length > 0) {
      msg = `${unusedPermissionSetLicenseAssignments.length} unused Permission Set License Assignments have been found (including ${numberPslaRelatedToInactiveUser} related to inactive users)`
      uxLog(this, c.red(msg));
    }
    else {
      uxLog(this, c.green(msg));
    }

    // Generate output CSV file
    this.outputFile = await generateReportPath("unused-ps-license-assignments", this.outputFile);
    await generateCsvFile(unusedPermissionSetLicenseAssignments, this.outputFile);

    /*
    // Manage notifications
    if (suspectRecords.length > 0) {
      let notifDetailText = ``;
      notifDetailText += "Related users:\n";
      for (const user of suspectUsers) {
        notifDetailText += `• ${user}\n`;
      }
      notifDetailText += "\n";
      notifDetailText += "Related actions:\n";
      for (const action of suspectActions) {
        notifDetailText += `• ${action}\n`;
      }
      notifDetailText += "\n";
      notifDetailText += "_See details in job artifacts_";
 
      const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
      const notifButtons = await getNotificationButtons();
      NotifProvider.postNotifications({
        type: "UNUSED_LICENSES",
        text: `${suspectRecords.length} suspect Setup Audit Trail records has been found in ${orgMarkdown}`,
        attachments: [{ text: notifDetailText }],
        buttons: notifButtons,
        severity: "warning",
      });
    }
*/
    if ((this.argv || []).includes("unusedlicenses")) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      unusedPermissionSetLicenseAssignments: unusedPermissionSetLicenseAssignments,
      csvLogFile: this.outputFile,
    };
  }
}
