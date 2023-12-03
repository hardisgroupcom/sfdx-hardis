/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { bulkQuery, bulkQueryChunksIn, bulkUpdate } from "../../../../common/utils/apiUtils";
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

  protected static additionalPermissionSetsToAlwaysGet = [
    "Sales_User"
  ];

  protected static permSetsPermSetLicenses = [
    { permSet: "Sales_User", permSetLicense: "SalesUserPsl" }
  ]

  protected static profilesPermissionSetLicenses = [
    { profile: "Salesforce API Only", permSetLicense: "SalesforceAPIIntegrationPsl" }
  ]

  protected static alwaysExcludeForActiveUsersPermissionSetLicenses = [
    "IdentityConnect"
  ]

  protected debugMode = false;
  protected outputFile;
  protected permissionSetLicenseAssignmentsActive = [];
  protected permissionSetLicenses = [];
  protected unusedPermissionSetLicenseAssignments = []
  protected permissionSets = [];
  protected permissionSetsGroupMembers = []
  protected permissionSetAssignments = [];
  protected permissionSetGroupAssignments = [];
  protected allPermissionSetAssignments = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.outputFile = this.flags.outputfile || null;

    const conn = this.org.getConnection();

    // List Permission Set Licenses Assignments
    this.permissionSetLicenseAssignmentsActive = await this.listAllPermissionSetLicenseAssignments(conn);

    // List related Permission Set Licenses
    this.permissionSetLicenses = await this.listRelatedPermissionSetLicenses(conn);

    if (this.permissionSetLicenses.length > 0) {
      // List related Permission sets
      const psLicensesIds = this.permissionSetLicenses.map(psl => psl.Id);
      this.permissionSets = await this.listRelatedPermissionSets(psLicensesIds, conn);

      // List Permission Set Groups Components linked to related PermissionSets
      const permissionSetsIds = this.permissionSets.map(psl => psl.Id);
      this.permissionSetsGroupMembers = await this.listRelatedPermissionSetGroupsComponents(permissionSetsIds, conn);

      // List related Permission Set Group Members (Permission sets)
      this.permissionSetGroupAssignments = await this.listRelatedPermissionSetAssignmentsToGroups(conn);

      // List related Permission Set Assignments
      this.permissionSetAssignments = await this.listRelatedPermissionSetAssignmentsToPs(permissionSetsIds, conn);
    }

    // Append assignments to Permission Sets & Permission Set Groups
    this.allPermissionSetAssignments = this.permissionSetGroupAssignments.concat(this.permissionSetAssignments);

    // Browse Permission Sets License assignments
    for (const psla of this.permissionSetLicenseAssignmentsActive) {
      const pslaUsername = psla["Assignee.Username"];
      // Find related Permission Set assignments
      const foundMatchingPsAssignments = this.allPermissionSetAssignments.filter(psa => {
        if (psa["Assignee.Username"] === pslaUsername) {
          if (psa.licenseIds.includes(psla.PermissionSetLicenseId)) {
            return true;
          }
          else if (DiagnoseUnusedLicenses.permSetsPermSetLicenses.some(psPsl => {
            if (psa["PermissionSet.Name"] === psPsl.permSet && psla["PermissionSetLicense.DeveloperName"] === psPsl.permSetLicense) {
              return true;
            }
            return false;
          })) {
            return true
          }
        }
        return false;
      })

      // Handle special cases of Profiles that assigns Permission set licenses when selected on a user
      const isProfileRelatedPSLA = DiagnoseUnusedLicenses.profilesPermissionSetLicenses.some(profilePsl => {
        return psla["Assignee.Profile.Name"].startsWith(profilePsl.profile) &&
          psla["PermissionSetLicense.DeveloperName"] === profilePsl.permSetLicense
      });
      const isExcluded = DiagnoseUnusedLicenses.alwaysExcludeForActiveUsersPermissionSetLicenses.includes(psla["PermissionSetLicense.DeveloperName"]);
      if (foundMatchingPsAssignments.length === 0 && !isProfileRelatedPSLA && !isExcluded) {
        this.unusedPermissionSetLicenseAssignments.push({
          Id: psla.Id,
          PermissionsSetLicense: psla["PermissionSetLicense.MasterLabel"],
          User: psla["Assignee.Username"],
          Reason: "Related PS assignment not found"
        });
      }
    }

    // Build summary
    const summary = {};
    for (const unusedPsla of this.unusedPermissionSetLicenseAssignments) {
      summary[unusedPsla.PermissionsSetLicense] = summary[unusedPsla.PermissionsSetLicense] || 0;
      summary[unusedPsla.PermissionsSetLicense]++;
    }

    // Create results
    let msg = `No unused permission set license assignment has been found`;
    if (this.unusedPermissionSetLicenseAssignments.length > 0) {
      this.statusCode = 1;
      msg = `${this.unusedPermissionSetLicenseAssignments.length} unused Permission Set License Assignments have been found`
      uxLog(this, c.red(msg));
      for (const pslMasterLabel of Object.keys(summary).sort()) {
        const psl = this.getPermissionSetLicenseByMasterLabel(pslMasterLabel);
        uxLog(this, c.red(`- ${pslMasterLabel}: ${summary[pslMasterLabel]} (${psl.UsedLicenses} used on ${psl.TotalLicenses} available)`));
      }
    }
    else {
      uxLog(this, c.green(msg));
    }

    // Generate output CSV file
    if (this.unusedPermissionSetLicenseAssignments.length > 0) {
      this.outputFile = await generateReportPath("unused-ps-license-assignments", this.outputFile);
      await generateCsvFile(this.unusedPermissionSetLicenseAssignments, this.outputFile);
    }

    // Manage notifications
    await this.manageNotifications(this.unusedPermissionSetLicenseAssignments, summary);

    // Propose to delete
    await this.managePermissionSetLicenseAssignmentsDeletion(conn);

    if ((this.argv || []).includes("unusedlicenses")) {
      process.exitCode = this.statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: this.statusCode,
      message: msg,
      summary: summary,
      unusedPermissionSetLicenseAssignments: this.unusedPermissionSetLicenseAssignments,
      csvLogFile: this.outputFile,
    };
  }

  private async listAllPermissionSetLicenseAssignments(conn: any) {
    uxLog(this, c.cyan(`Extracting all active Permission Sets Licenses Assignments...`));
    const pslaQueryRes = await bulkQuery(`
    SELECT Id,PermissionSetLicenseId, PermissionSetLicense.DeveloperName, PermissionSetLicense.MasterLabel, AssigneeId, Assignee.Username, Assignee.IsActive, Assignee.Profile.Name
    FROM PermissionSetLicenseAssign
    WHERE Assignee.IsActive=true
    ORDER BY PermissionSetLicense.MasterLabel, Assignee.Username`
      , conn);
    return pslaQueryRes.records;
  }

  private async listRelatedPermissionSetLicenses(conn: any) {
    const relatedPermissionSetLicenses = this.permissionSetLicenseAssignmentsActive.map(psla => {
      return {
        Id: psla.PermissionSetLicenseId,
        DeveloperName: psla["PermissionSetLicense.DeveloperName"],
        MasterLabel: psla["PermissionSetLicense.MasterLabel"]
      }
    }).filter(
      (value, index, self) =>
        index === self.findIndex((t) => (t.Id === value.Id && t.MasterLabel === value.MasterLabel)
        )
    );
    const psLicensesIds = relatedPermissionSetLicenses.map(psl => psl.Id);
    if (relatedPermissionSetLicenses.length > 0) {
      uxLog(this, c.cyan(`Extracting related Permission Sets Licenses...`));
      const pslQueryRes = await bulkQueryChunksIn(
        `SELECT Id,DeveloperName,MasterLabel,UsedLicenses,TotalLicenses
         FROM PermissionSetLicense
         WHERE Id in ({{IN}})`,
        conn,
        psLicensesIds);
      return pslQueryRes.records;
    }
    return [];
  }

  private async listRelatedPermissionSets(psLicensesIds: string[], conn) {
    uxLog(this, c.cyan(`Extracting related Permission Sets...`));
    const psQueryRes = await bulkQueryChunksIn(
      `SELECT Id,Label,Name,LicenseId
       FROM PermissionSet
       WHERE LicenseId in ({{IN}})`,
      conn,
      psLicensesIds);
    const psQueryAdditionalRes = await bulkQueryChunksIn(
      `SELECT Id,Label,Name,LicenseId
       FROM PermissionSet
       WHERE Name in ({{IN}})`,
      conn,
      DiagnoseUnusedLicenses.additionalPermissionSetsToAlwaysGet);
    return psQueryRes.records.concat(psQueryAdditionalRes.records);
  }

  private async listRelatedPermissionSetGroupsComponents(permissionSetsIds: string[], conn) {
    uxLog(this, c.cyan(`Extracting related Permission Sets Group Components...`));
    const psgcQueryRes = await bulkQueryChunksIn(
      `SELECT Id,PermissionSetId,PermissionSetGroupId,PermissionSet.LicenseId,PermissionSet.Name,PermissionSetGroup.DeveloperName
         FROM PermissionSetGroupComponent
         WHERE PermissionSetId in ({{IN}})`,
      conn,
      permissionSetsIds);
    return psgcQueryRes.records;
  }

  private async listRelatedPermissionSetAssignmentsToGroups(conn) {
    const permissionSetsGroupIds = [...new Set(this.permissionSetsGroupMembers.map(psgc => psgc.PermissionSetGroupId))];
    if (permissionSetsGroupIds.length > 0) {
      uxLog(this, c.cyan(`Extracting related Permission Set Group Assignments...`));
      const psgaQueryRes = await bulkQueryChunksIn(
        `SELECT Id,Assignee.Username,PermissionSetGroupId,PermissionSetGroup.DeveloperName
           FROM PermissionSetAssignment
           WHERE PermissionSetGroupId in ({{IN}})`,
        conn,
        permissionSetsGroupIds
      );
      // Add related licenses in licenseIds for each PS Assignment
      psgaQueryRes.records = psgaQueryRes.records.map(psga => {
        psga.licenseIds = [];
        for (const psgm of this.permissionSetsGroupMembers) {
          if (psgm.PermissionSetGroupId === psga.PermissionSetGroupId) {
            if (psgm["PermissionSet.LicenseId"]) {
              psga.licenseIds.push(psgm["PermissionSet.LicenseId"]);
            }
          }
        }
        return psga;
      });
      return psgaQueryRes.records;
    }
  }


  private async listRelatedPermissionSetAssignmentsToPs(permissionSetsIds: string[], conn) {
    uxLog(this, c.cyan(`Extracting related Permission Sets Assignments...`));
    const psaQueryRes = await bulkQueryChunksIn(
      `SELECT Id,Assignee.Username,PermissionSetId,PermissionSet.LicenseId,PermissionSet.Name
       FROM PermissionSetAssignment
       WHERE PermissionSetId in ({{IN}})`,
      conn, permissionSetsIds);
    // Add related license in licenseIds for each PS Assignment
    psaQueryRes.records = psaQueryRes.records.map(psa => {
      psa.licenseIds = [];
      if (psa["PermissionSet.LicenseId"]) {
        psa.licenseIds.push(psa["PermissionSet.LicenseId"]);
      }
      return psa;
    });
    return psaQueryRes.records;
  }

  private async manageNotifications(unusedPermissionSetLicenseAssignments: any[], summary: any) {
    if (unusedPermissionSetLicenseAssignments.length > 0) {
      let notifDetailText = ``;
      for (const pslMasterLabel of Object.keys(summary).sort()) {
        const psl = this.getPermissionSetLicenseByMasterLabel(pslMasterLabel);
        notifDetailText += `• ${pslMasterLabel}: ${summary[pslMasterLabel]} (${psl.UsedLicenses} used on ${psl.TotalLicenses} available)\n`;
      }

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
  }

  private async managePermissionSetLicenseAssignmentsDeletion(conn) {
    if (!isCI && this.unusedPermissionSetLicenseAssignments.length) {
      const confirmRes = await prompts({
        type: "select",
        message: "Do you want to delete unused Permission Set License Assignments ?",
        choices: [
          { title: `Yes, delete the ${this.unusedPermissionSetLicenseAssignments.length} useless Permission Set License Assignments !`, value: "all" },
          { title: "No" }
        ]
      });
      if (confirmRes.value === "all") {
        const pslaToDelete = this.unusedPermissionSetLicenseAssignments.map(psla => {
          return { Id: psla.Id };
        });
        const deleteRes = await bulkUpdate("PermissionSetLicenseAssign", "delete", pslaToDelete, conn);
        const deleteSuccessNb = deleteRes.successRecordsNb;
        const deleteErrorNb = deleteRes.errorRecordsNb;
        if (deleteErrorNb > 0) {
          uxLog(this, c.yellow(`Warning: ${c.red(c.bold(deleteErrorNb))} assignments has not been deleted (bulk API errors)`));
          this.statusCode = 1;
        }
        else {
          this.statusCode = 0;
        }
        // Build results summary
        uxLog(this, c.green(`${c.bold(deleteSuccessNb)} assignments has been deleted.`));
      }
    }
    return this.statusCode;
  }

  private getPermissionSetLicenseByMasterLabel(masterLabel: string) {
    const pslList = this.permissionSetLicenses.filter(psl => psl.MasterLabel === masterLabel);
    if (pslList.length === 1) {
      return pslList[0];
    }
    throw new SfdxError(`Unable to find Permission Set License with MasterLabel ${masterLabel}`);
  }
}
