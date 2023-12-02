/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { bulkQuery, bulkUpdate } from "../../../../common/utils/apiUtils";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";
import { NotifProvider } from "../../../../common/notifProvider";
import { getNotificationButtons, getOrgMarkdown } from "../../../../common/utils/notifUtils";
import { prompts } from "../../../../common/utils/prompts";


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
    uxLog(this, c.cyan(`Extracting all active Permission Sets Licenses Assignments...`));
    const permissionSetLicenseAssignmentsActive = [];
    const pslaQueryRes = await bulkQuery(`
    SELECT Id,PermissionSetLicenseId, PermissionSetLicense.DeveloperName, PermissionSetLicense.MasterLabel, AssigneeId, Assignee.Username, Assignee.IsActive, Assignee.Profile.Name
    FROM PermissionSetLicenseAssign
    WHERE Assignee.IsActive=true
    ORDER BY PermissionSetLicense.MasterLabel, Assignee.Username`
      , conn);
    permissionSetLicenseAssignmentsActive.push(...pslaQueryRes.records);

    // List related Permission Set Licenses
    const relatedPermissionSetLicenses = permissionSetLicenseAssignmentsActive.map(psla => {
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
    const psLicensesIdsStr = "'" + relatedPermissionSetLicenses.map(psl => psl.Id).join("','") + "'";
    const permissionSetLicenses = [];
    if (relatedPermissionSetLicenses.length > 0) {
      uxLog(this, c.cyan(`Extracting related Permission Sets Licenses...`));
      const pslQueryRes = await bulkQuery(
        `SELECT Id,DeveloperName,MasterLabel 
       FROM PermissionSetLicense
       WHERE Id in (${psLicensesIdsStr})`,
        conn);
      permissionSetLicenses.push(...pslQueryRes.records);
    }

    // List related Permission sets
    const psLicensesIdsStr2 = "'" + permissionSetLicenses.map(psl => psl.Id).join("','") + "'";
    const permissionSets = [];
    const permissionSetAssignments = [];
    const permissionSetGroupAssignments = [];
    if (permissionSetLicenses.length > 0) {
      uxLog(this, c.cyan(`Extracting related Permission Sets...`));
      const psQueryRes = await bulkQuery(
        `SELECT Id,Label,Name,LicenseId
       FROM PermissionSet
       WHERE LicenseId in (${psLicensesIdsStr2})`,
        conn);
      permissionSets.push(...psQueryRes.records);

      const permissionSetsIdsStr = "'" + permissionSets.map(psl => psl.Id).join("','") + "'";

      // List Permission Set Groups Components linked to related PermissionSets
      const permissionSetsGroupMembers = [];
      uxLog(this, c.cyan(`Extracting related Permission Sets Group Components...`));
      const psgcQueryRes = await bulkQuery(
        `SELECT Id,PermissionSetId,PermissionSetGroupId,PermissionSet.LicenseId
         FROM PermissionSetGroupComponent
         WHERE PermissionSetId in (${permissionSetsIdsStr})`,
        conn);
      permissionSetsGroupMembers.push(...psgcQueryRes.records);

      // List related Permission Set Group Members (Permission sets)
      const permissionSetsGroupIds = [...new Set(permissionSetsGroupMembers.map(psgc => psgc.PermissionSetGroupId))];
      const permissionSetGroupIdsStr = "'" + permissionSetsGroupIds.join("','") + "'";
      if (permissionSetsGroupIds.length > 0) {
        uxLog(this, c.cyan(`Extracting related Permission Set Group Assignments...`));
        const psgaQueryRes = await bulkQuery(
          `SELECT Id,Assignee.Username,PermissionSetGroupId
           FROM PermissionSetAssignment
           WHERE PermissionSetGroupId in (${permissionSetGroupIdsStr})`,
          conn);
        // Add related licenses in licenseIds for each PS Assignment
        psgaQueryRes.records = psgaQueryRes.records.map(psga => {
          psga.licenseIds = [];
          for (const psgm of permissionSetsGroupMembers) {
            if (psgm.PermissionSetGroupId === psga.PermissionSetGroupId) {
              if (psgm["PermissionSet.LicenseId"]) {
                psga.licenseIds.push(psgm["PermissionSet.LicenseId"])
              }
            }
          }
          return psga;
        })
        permissionSetGroupAssignments.push(...psgaQueryRes.records);
      }

      // List related Permission Set Assignments
      uxLog(this, c.cyan(`Extracting related Permission Sets Assignments...`));
      const psaQueryRes = await bulkQuery(
        `SELECT Id,Assignee.Username,PermissionSetId,PermissionSet.LicenseId
       FROM PermissionSetAssignment
       WHERE PermissionSetId in (${permissionSetsIdsStr})`,
        conn);
      // Add related license in licenseIds for each PS Assignment
      psaQueryRes.records = psaQueryRes.records.map(psa => {
        psa.licenseIds = [];
        if (psa["PermissionSet.LicenseId"]) {
          psa.licenseIds.push(psa["PermissionSet.LicenseId"]);
        }
        return psa;
      })
      permissionSetAssignments.push(...psaQueryRes.records);
    }

    // Append assignments to Permission Sets & Permission Set Groups
    const allPermissionSetAssignments = permissionSetGroupAssignments.concat(permissionSetAssignments);

    // Browse Permission Sets License assignments
    for (const psla of permissionSetLicenseAssignmentsActive) {
      const pslaUsername = psla["Assignee.Username"];
      // Find related Permission Set assignments
      const foundMatchingPsAssignments = allPermissionSetAssignments.filter(psa => {
        if (psa["Assignee.Username"] === pslaUsername && psa.licenseIds.includes(psla.PermissionSetLicenseId)) {
          return true;
        }
        return false;
      });
      // Handle special cases of Profiles that assigns Permission set licenses when selected on a user
      const isProfileRelatedPSLA =
        psla["Assignee.Profile.Name"].includes("Salesforce API Only") &&
        psla["PermissionSetLicense.DeveloperName"] === "SalesforceAPIIntegrationPsl";
      if (foundMatchingPsAssignments.length === 0 && !isProfileRelatedPSLA) {
        unusedPermissionSetLicenseAssignments.push({
          Id: psla.Id,
          PermissionsSetLicense: psla["PermissionSetLicense.MasterLabel"],
          User: psla["Assignee.Username"],
          Reason: "Related PS assignment not found"
        });
      }
    }

    // Build summary
    const summary = {};
    for (const unusedPsla of unusedPermissionSetLicenseAssignments) {
      summary[unusedPsla.PermissionsSetLicense] = summary[unusedPsla.PermissionsSetLicense] || 0;
      summary[unusedPsla.PermissionsSetLicense]++;
    }

    // Create results
    let statusCode = 0;
    let msg = `No unused permission set license assignment has been found`;
    if (unusedPermissionSetLicenseAssignments.length > 0) {
      statusCode = 1;
      msg = `${unusedPermissionSetLicenseAssignments.length} unused Permission Set License Assignments have been found`
      uxLog(this, c.red(msg));
      for (const pslName of Object.keys(summary).sort()) {
        uxLog(this, c.red(`- ${pslName}: ${summary[pslName]}`));
      }
    }
    else {
      uxLog(this, c.green(msg));
    }

    // Generate output CSV file
    if (unusedPermissionSetLicenseAssignments.length > 0) {
      this.outputFile = await generateReportPath("unused-ps-license-assignments", this.outputFile);
      await generateCsvFile(unusedPermissionSetLicenseAssignments, this.outputFile);
    }

    // Manage notifications
    if (unusedPermissionSetLicenseAssignments.length > 0) {
      let notifDetailText = ``;
      notifDetailText += "Permission set licenses that you can spare:\n";
      for (const pslName of Object.keys(summary).sort()) {
        notifDetailText += `• ${pslName}: ${summary[pslName]}\n`;
      }
      notifDetailText += "\n";
      notifDetailText += "_See details in job artifacts_";

      const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
      const notifButtons = await getNotificationButtons();
      NotifProvider.postNotifications({
        type: "UNUSED_LICENSES",
        text: `${unusedPermissionSetLicenseAssignments.length} unused Permission Set Licenses Assignments have been found in ${orgMarkdown}`,
        attachments: [{ text: notifDetailText }],
        buttons: notifButtons,
        severity: "warning",
      });
    }

    // Propose to delete
    if (!isCI && unusedPermissionSetLicenseAssignments.length) {
      const confirmRes = await prompts({
        type: "select",
        message: "Do you want to delete unused Permission Set License Assignments ?",
        choices: [
          { title: `Yes, delete the ${unusedPermissionSetLicenseAssignments.length} useless Permission Set License Assignments !`, value: "all" },
          { title: "No" }
        ]
      });
      if (confirmRes.value === "all") {
        const pslaToDelete = unusedPermissionSetLicenseAssignments.map(psla => {
          return { Id: psla.Id }
        });
        const deleteRes = await bulkUpdate("PermissionSetLicenseAssign", "delete", pslaToDelete, conn);
        const deleteSuccessNb = deleteRes.successRecordsNb;
        const deleteErrorNb = deleteRes.errorRecordsNb;
        if (deleteErrorNb > 0) {
          uxLog(this, c.yellow(`Warning: ${c.red(c.bold(deleteErrorNb))} assignments has not been deleted (bulk API errors)`));
        }
        else {
          statusCode = 0;
        }
        // Build results summary
        uxLog(this, c.green(`${c.bold(deleteSuccessNb)} assignments has been deleted.`));
      }
    }

    if ((this.argv || []).includes("unusedlicenses")) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      summary: summary,
      unusedPermissionSetLicenseAssignments: unusedPermissionSetLicenseAssignments,
      csvLogFile: this.outputFile,
    };
  }
}
