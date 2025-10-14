/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { bulkQuery, bulkQueryChunksIn, bulkUpdate } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { CONSTANTS } from '../../../../config/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUnusedLicenses extends SfCommand<any> {
  public static title = 'Detect unused Permission Set Licenses (beta)';

  public static description = `
## Command Behavior

**Detects and suggests the deletion of unused Permission Set License Assignments in a Salesforce org.**

When a Permission Set (PS) linked to a Permission Set License (PSL) is assigned to a user, a Permission Set License Assignment (PSLA) is automatically created. However, when that PS is unassigned from the user, the PSLA is *not* automatically deleted. This can lead to organizations being charged for unused PSLAs, representing a hidden cost and technical debt.

This command identifies such useless PSLAs and provides options to delete them, helping to optimize license usage and reduce unnecessary expenses.

Key functionalities:

- **PSLA Detection:** Queries the Salesforce org to find all active PSLAs.
- **Usage Verification:** Correlates PSLAs with actual Permission Set Assignments and Permission Set Group Assignments to determine if the underlying Permission Sets are still assigned to the user.
- **Special Case Handling:** Accounts for specific scenarios where profiles might implicitly assign PSLAs (e.g., \`Salesforce API Only\` profile assigning \`SalesforceAPIIntegrationPsl\`) and allows for always excluding certain PSLAs from the unused check.
- **Reporting:** Generates a CSV report of all identified unused PSLAs, including the user and the associated Permission Set License.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with a summary of unused PSLAs.
- **Interactive Deletion:** In non-CI environments, it offers an interactive prompt to bulk delete the identified unused PSLAs.

Many thanks to [Vincent Finet](https://www.linkedin.com/in/vincentfinet/) for the inspiration during his great speaker session at [French Touch Dreamin '23](https://frenchtouchdreamin.com/), and his kind agreement for reusing such inspiration in this command 😊

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-unused-licenses/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves extensive querying of Salesforce objects and data correlation:

- **SOQL Queries (Bulk API):** It uses \`bulkQuery\` and \`bulkQueryChunksIn\` to efficiently retrieve large volumes of data from \`PermissionSetLicenseAssign\`, \`PermissionSetLicense\`, \`PermissionSet\`, \`PermissionSetGroupComponent\`, and \`PermissionSetAssignment\` objects.
- **Data Correlation:** It meticulously correlates data across these objects to determine if a \`PermissionSetLicenseAssign\` record has a corresponding active assignment to a Permission Set or Permission Set Group for the same user.
- **Filtering Logic:** It applies complex filtering logic to exclude PSLAs that are genuinely in use or are part of predefined exceptions (e.g., \`alwaysExcludeForActiveUsersPermissionSetLicenses\`).
- **Bulk Deletion:** If the user opts to delete unused PSLAs, it uses \`bulkUpdate\` with the \`delete\` operation to efficiently remove multiple records.
- **Report Generation:** It uses \`generateCsvFile\` to create the CSV report of unused PSLAs.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications, including attachments of the generated CSV report and metrics for monitoring dashboards.
- **User Interaction:** Uses \`prompts\` for interactive confirmation before performing deletion operations.
</details>
`;

  public static examples = ['$ sf hardis:org:diagnose:unusedlicenses', '$ sf hardis:org:diagnose:unusedlicenses --fix'];

  public static flags: any = {
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

  protected static additionalPermissionSetsToAlwaysGet = ['Sales_User'];

  protected static permSetsPermSetLicenses = [{ permSet: 'Sales_User', permSetLicense: 'SalesUserPsl' }];

  protected static profilesPermissionSetLicenses = [
    { profile: 'Salesforce API Only', permSetLicense: 'SalesforceAPIIntegrationPsl' },
  ];

  protected static alwaysExcludeForActiveUsersPermissionSetLicenses = ['IdentityConnect'];

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected permissionSetLicenseAssignmentsActive: any[] = [];
  protected permissionSetLicenses: any[] = [];
  protected unusedPermissionSetLicenseAssignments: any[] = [];
  protected permissionSets: any[] = [];
  protected permissionSetsGroupMembers: any[] = [];
  protected permissionSetAssignments: any[] = [];
  protected permissionSetGroupAssignments: any[] = [];
  protected allPermissionSetAssignments: any[] = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUnusedLicenses);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;

    const conn = flags['target-org'].getConnection();

    // List Permission Set Licenses Assignments
    this.permissionSetLicenseAssignmentsActive = await this.listAllPermissionSetLicenseAssignments(conn);

    // List related Permission Set Licenses
    this.permissionSetLicenses = await this.listRelatedPermissionSetLicenses(conn);

    if (this.permissionSetLicenses.length > 0) {
      // List related Permission sets
      const psLicensesIds = this.permissionSetLicenses.map((psl) => psl.Id);
      this.permissionSets = await this.listRelatedPermissionSets(psLicensesIds, conn);

      // List Permission Set Groups Components linked to related PermissionSets
      const permissionSetsIds = this.permissionSets.map((psl) => psl.Id);
      this.permissionSetsGroupMembers = await this.listRelatedPermissionSetGroupsComponents(permissionSetsIds, conn);

      // List related Permission Set Group Members (Permission sets)
      this.permissionSetGroupAssignments = await this.listRelatedPermissionSetAssignmentsToGroups(conn);

      // List related Permission Set Assignments
      this.permissionSetAssignments = await this.listRelatedPermissionSetAssignmentsToPs(permissionSetsIds, conn);
    }

    // Append assignments to Permission Sets & Permission Set Groups
    this.allPermissionSetAssignments = this.permissionSetGroupAssignments.concat(this.permissionSetAssignments);

    // Browse Permission Sets License assignments
    const severityIconWarning = getSeverityIcon('warning');
    for (const psla of this.permissionSetLicenseAssignmentsActive) {
      const pslaUsername = psla['Assignee.Username'];
      // Find related Permission Set assignments
      const foundMatchingPsAssignments = this.allPermissionSetAssignments.filter((psa) => {
        if (psa['Assignee.Username'] === pslaUsername) {
          if (psa.licenseIds.includes(psla.PermissionSetLicenseId)) {
            return true;
          } else if (
            DiagnoseUnusedLicenses.permSetsPermSetLicenses.some((psPsl) => {
              if (
                psa['PermissionSet.Name'] === psPsl.permSet &&
                psla['PermissionSetLicense.DeveloperName'] === psPsl.permSetLicense
              ) {
                return true;
              }
              return false;
            })
          ) {
            return true;
          }
        }
        return false;
      });

      // Handle special cases of Profiles that assigns Permission set licenses when selected on a user
      const isProfileRelatedPSLA = DiagnoseUnusedLicenses.profilesPermissionSetLicenses.some((profilePsl) => {
        return (
          psla['Assignee.Profile.Name'].startsWith(profilePsl.profile) &&
          psla['PermissionSetLicense.DeveloperName'] === profilePsl.permSetLicense
        );
      });
      const isExcluded = DiagnoseUnusedLicenses.alwaysExcludeForActiveUsersPermissionSetLicenses.includes(
        psla['PermissionSetLicense.DeveloperName']
      );
      if (foundMatchingPsAssignments.length === 0 && !isProfileRelatedPSLA && !isExcluded) {
        this.unusedPermissionSetLicenseAssignments.push({
          Id: psla.Id,
          PermissionsSetLicense: psla['PermissionSetLicense.MasterLabel'],
          User: psla['Assignee.Username'],
          Reason: 'Related PS assignment not found',
          severity: 'warning',
          severityIcon: severityIconWarning,
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
      const pslMasterLabels = Object.keys(summary).sort().map((pslMasterLabel) => {
        return "- " + this.getPermissionSetLicenseByMasterLabel(pslMasterLabel).MasterLabel;
      }).join('\n');
      msg = `Unused Permission Set License Assignments:\n${pslMasterLabels}`;
      uxLog("warning", this, c.yellow(msg));
    } else {
      uxLog("success", this, c.green(msg));
    }

    // Generate output CSV file
    if (this.unusedPermissionSetLicenseAssignments.length > 0) {
      uxLogTable(this, this.unusedPermissionSetLicenseAssignments);
      this.outputFile = await generateReportPath('unused-ps-license-assignments', this.outputFile);
      this.outputFilesRes = await generateCsvFile(this.unusedPermissionSetLicenseAssignments, this.outputFile, { fileTitle: "Unused PSL assignments" });
    }

    // Manage notifications
    await this.manageNotifications(this.unusedPermissionSetLicenseAssignments, summary, flags);

    // Propose to delete
    await this.managePermissionSetLicenseAssignmentsDeletion(conn);

    if ((this.argv || []).includes('unusedlicenses')) {
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
    uxLog("action", this, c.cyan(`Extracting all active Permission Sets Licenses Assignments...`));
    const pslaQueryRes = await bulkQuery(
      `
    SELECT Id,PermissionSetLicenseId, PermissionSetLicense.DeveloperName, PermissionSetLicense.MasterLabel, AssigneeId, Assignee.Username, Assignee.IsActive, Assignee.Profile.Name
    FROM PermissionSetLicenseAssign
    WHERE Assignee.IsActive=true
    ORDER BY PermissionSetLicense.MasterLabel, Assignee.Username`,
      conn
    );
    return pslaQueryRes.records;
  }

  private async listRelatedPermissionSetLicenses(conn: any) {
    const relatedPermissionSetLicenses = this.permissionSetLicenseAssignmentsActive
      .map((psla) => {
        return {
          Id: psla.PermissionSetLicenseId,
          DeveloperName: psla['PermissionSetLicense.DeveloperName'],
          MasterLabel: psla['PermissionSetLicense.MasterLabel'],
        };
      })
      .filter(
        (value, index, self) =>
          index === self.findIndex((t) => t.Id === value.Id && t.MasterLabel === value.MasterLabel)
      );
    const psLicensesIds = relatedPermissionSetLicenses.map((psl) => psl.Id);
    if (relatedPermissionSetLicenses.length > 0) {
      uxLog("action", this, c.cyan(`Extracting related Permission Sets Licenses...`));
      const pslQueryRes = await bulkQueryChunksIn(
        `SELECT Id,DeveloperName,MasterLabel,UsedLicenses,TotalLicenses
         FROM PermissionSetLicense
         WHERE Id in ({{IN}})`,
        conn,
        psLicensesIds
      );
      return pslQueryRes.records;
    }
    return [];
  }

  private async listRelatedPermissionSets(psLicensesIds: string[], conn) {
    uxLog("action", this, c.cyan(`Extracting related Permission Sets...`));
    const psQueryRes = await bulkQueryChunksIn(
      `SELECT Id,Label,Name,LicenseId
       FROM PermissionSet
       WHERE LicenseId in ({{IN}})`,
      conn,
      psLicensesIds
    );
    const psQueryAdditionalRes = await bulkQueryChunksIn(
      `SELECT Id,Label,Name,LicenseId
       FROM PermissionSet
       WHERE Name in ({{IN}})`,
      conn,
      DiagnoseUnusedLicenses.additionalPermissionSetsToAlwaysGet
    );
    return psQueryRes.records.concat(psQueryAdditionalRes.records);
  }

  private async listRelatedPermissionSetGroupsComponents(permissionSetsIds: string[], conn) {
    uxLog("action", this, c.cyan(`Extracting related Permission Sets Group Components...`));
    const psgcQueryRes = await bulkQueryChunksIn(
      `SELECT Id,PermissionSetId,PermissionSetGroupId,PermissionSet.LicenseId,PermissionSet.Name,PermissionSetGroup.DeveloperName
         FROM PermissionSetGroupComponent
         WHERE PermissionSetId in ({{IN}})`,
      conn,
      permissionSetsIds
    );
    return psgcQueryRes.records;
  }

  private async listRelatedPermissionSetAssignmentsToGroups(conn) {
    const permissionSetsGroupIds = [
      ...new Set(this.permissionSetsGroupMembers.map((psgc) => psgc.PermissionSetGroupId)),
    ];
    if (permissionSetsGroupIds.length > 0) {
      uxLog("action", this, c.cyan(`Extracting related Permission Set Group Assignments...`));
      const psgaQueryRes = await bulkQueryChunksIn(
        `SELECT Id,Assignee.Username,PermissionSetGroupId,PermissionSetGroup.DeveloperName
           FROM PermissionSetAssignment
           WHERE PermissionSetGroupId in ({{IN}})`,
        conn,
        permissionSetsGroupIds
      );
      // Add related licenses in licenseIds for each PS Assignment
      psgaQueryRes.records = psgaQueryRes.records.map((psga) => {
        psga.licenseIds = [];
        for (const psgm of this.permissionSetsGroupMembers) {
          if (psgm.PermissionSetGroupId === psga.PermissionSetGroupId) {
            if (psgm['PermissionSet.LicenseId']) {
              psga.licenseIds.push(psgm['PermissionSet.LicenseId']);
            }
          }
        }
        return psga;
      });
      return psgaQueryRes.records;
    }
    return [];
  }

  private async listRelatedPermissionSetAssignmentsToPs(permissionSetsIds: string[], conn) {
    uxLog("action", this, c.cyan(`Extracting related Permission Sets Assignments...`));
    const psaQueryRes = await bulkQueryChunksIn(
      `SELECT Id,Assignee.Username,PermissionSetId,PermissionSet.LicenseId,PermissionSet.Name
       FROM PermissionSetAssignment
       WHERE PermissionSetId in ({{IN}})`,
      conn,
      permissionSetsIds
    );
    // Add related license in licenseIds for each PS Assignment
    psaQueryRes.records = psaQueryRes.records.map((psa) => {
      psa.licenseIds = [];
      if (psa['PermissionSet.LicenseId']) {
        psa.licenseIds.push(psa['PermissionSet.LicenseId']);
      }
      return psa;
    });
    return psaQueryRes.records;
  }

  private async manageNotifications(unusedPermissionSetLicenseAssignments: any[], summary: any, flags) {
    // Build notification
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No unused Permission Set Licenses Assignments has been found in ${orgMarkdown}`;
    let notifDetailText = ``;
    let attachments: any[] = [];
    if (unusedPermissionSetLicenseAssignments.length > 0) {
      notifSeverity = 'warning';
      notifText = `${unusedPermissionSetLicenseAssignments.length} unused Permission Set Licenses Assignments have been found in ${orgMarkdown}`;
      for (const pslMasterLabel of Object.keys(summary).sort()) {
        const psl = this.getPermissionSetLicenseByMasterLabel(pslMasterLabel);
        notifDetailText += `• ${pslMasterLabel}: ${summary[pslMasterLabel]} (${psl.UsedLicenses} used on ${psl.TotalLicenses} available)\n`;
      }
      attachments = [{ text: notifDetailText }];
    }
    // Send notifications
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'UNUSED_LICENSES',
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.unusedPermissionSetLicenseAssignments,
      data: { metric: this.unusedPermissionSetLicenseAssignments.length },
      metrics: {
        UnusedPermissionSetLicenses: this.unusedPermissionSetLicenseAssignments.length,
      },
    });
    return [];
  }

  private async managePermissionSetLicenseAssignmentsDeletion(conn) {
    if (!isCI && this.unusedPermissionSetLicenseAssignments.length) {
      const confirmRes = await prompts({
        type: 'select',
        message: 'Do you want to delete unused Permission Set License Assignments ?',
        description: 'Remove permission set license assignments that are not being used, freeing up licenses for other users',
        placeholder: 'Select an option',
        choices: [
          {
            title: `Yes, delete the ${this.unusedPermissionSetLicenseAssignments.length} useless Permission Set License Assignments !`,
            value: 'all',
          },
          { title: 'No' },
        ],
      });
      if (confirmRes.value === 'all') {
        const pslaToDelete = this.unusedPermissionSetLicenseAssignments.map((psla) => {
          return { Id: psla.Id };
        });
        const deleteRes = await bulkUpdate('PermissionSetLicenseAssign', 'delete', pslaToDelete, conn);
        const deleteSuccessNb = deleteRes.successfulResults.length;
        const deleteErrorNb = deleteRes.failedResults.length;
        uxLog("action", this, "Deletions Summary");
        if (deleteErrorNb > 0) {
          uxLog(
            "warning",
            this,
            c.yellow(`Warning: ${c.red(c.bold(deleteErrorNb))} assignments has not been deleted (bulk API errors)`)
          );
          uxLogTable(this, deleteRes.failedResults);
          this.outputFile = await generateReportPath('failed-delete-ps-license-assignments', this.outputFile);
          this.outputFilesRes = await generateCsvFile(deleteRes.failedResults, this.outputFile, { fileTitle: "Failed PSL assignments deletions" });
          this.statusCode = 1;
        } else {
          this.statusCode = 0;
        }
        // Build results summary
        uxLog("success", this, c.green(`${c.bold(deleteSuccessNb)} assignments has been deleted.`));
        if (deleteSuccessNb) {
          uxLogTable(this, deleteRes.successfulResults);
          this.outputFile = await generateReportPath('deleted-ps-license-assignments', this.outputFile);
          this.outputFilesRes = await generateCsvFile(this.unusedPermissionSetLicenseAssignments, this.outputFile, { fileTitle: "Deleted PSL assignments" });
        }
      }
    }
    return this.statusCode;
  }

  private getPermissionSetLicenseByMasterLabel(masterLabel: string) {
    const pslList = this.permissionSetLicenses.filter((psl) => psl.MasterLabel === masterLabel);
    if (pslList.length === 1) {
      return pslList[0];
    }
    throw new SfError(`Unable to find Permission Set License with MasterLabel ${masterLabel}`);
  }
}
