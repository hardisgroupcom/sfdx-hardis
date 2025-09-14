/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, sortCrossPlatform, uxLog } from '../../../../common/utils/index.js';
import { bulkQuery } from '../../../../common/utils/apiUtils.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { CONSTANTS, getConfig } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseAuditTrail extends SfCommand<any> {
  public static title = 'Diagnose content of Setup Audit Trail';

  public static description = `Export Audit trail into a CSV file with selected criteria, and highlight suspect actions

Also detects updates of Custom Settings values (disable by defining \`SKIP_AUDIT_TRAIL_CUSTOM_SETTINGS=true\`)

Regular setup actions performed in major orgs are filtered.

- ""
  - createScratchOrg
  - changedsenderemail
  - deleteScratchOrg
  - loginasgrantedtopartnerbt
- Certificate and Key Management
  - insertCertificate
- Custom App Licenses
  - addeduserpackagelicense
  - granteduserpackagelicense
  - revokeduserpackagelicense
- Customer Portal
  - createdcustomersuccessuser
  - CSPUserDisabled
- Currency
  - updateddatedexchrate
- Data Management
  - queueMembership
- Email Administration
  - dkimRotationPreparationSuccessful
  - dkimRotationSuccessful
- External Objects
  - xdsEncryptedFieldChange
- Groups
  - groupMembership
- Holidays
  - holiday_insert
- Inbox mobile and legacy desktop apps
  - enableSIQUserNonEAC
  - siqUserAcceptedTOS
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
  - changedofflineuseroffon
  - changedprofileforuserstdtostd
  - changedprofileforuser
  - changedprofileforusercusttostd
  - changedprofileforuserstdtocust
  - changedroleforusertonone
  - changedroleforuser
  - changedroleforuserfromnone
  - changedUserAdminVerifiedStatusVerified
  - changedUserEmailVerifiedStatusUnverified
  - changedUserEmailVerifiedStatusVerified
  - changedknowledgeuseroffon
  - changedsfcontentuseroffon
  - changedsupportuseroffon
  - changedusername
  - changedUserPhoneNumber
  - changedUserPhoneVerifiedStatusUnverified
  - changedUserPhoneVerifiedStatusVerified
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
  - suNetworkAdminLogin
  - suNetworkAdminLogout
  - suOrgAdminLogin
  - suOrgAdminLogout
  - unfrozeuser
  - useremailchangesent
- Mobile Administration
  - assigneduserstomobileconfig
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

## Excel output example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-audittrail-excel.jpg)

## Local output example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-audittrail-local.jpg)

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-suspect-audit-trail/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:org:diagnose:audittrail',
    '$ sf hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com',
    '$ sf hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com,bertrand@titi.com',
    '$ sf hardis:org:diagnose:audittrail --lastndays 5',
  ];

  public static flags: any = {
    excludeusers: Flags.string({
      char: 'e',
      description: 'Comma-separated list of usernames to exclude',
    }),
    lastndays: Flags.integer({
      char: 't',
      description: 'Number of days to extract from today (included)',
    }),
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

  protected excludeUsers: any[] = [];
  protected lastNdays: number | undefined;
  protected allowedSectionsActions = {};
  protected debugMode = false;

  protected suspectRecords: any[] = [];
  protected suspectUsers: any[] = [];
  protected suspectUsersAndActions: any = {};
  protected suspectActions: any[] = [];
  protected severityIconLog = getSeverityIcon('log');
  protected severityIconWarning = getSeverityIcon('warning');

  protected auditTrailRecords: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseAuditTrail);
    this.debugMode = flags.debug || false;
    this.excludeUsers = flags.excludeusers ? flags.excludeusers.split(',') : [];
    this.lastNdays = flags.lastndays;
    this.outputFile = flags.outputfile || null;
    const config = await getConfig('branch');

    // If manual mode and lastndays not sent as parameter, prompt user
    await this.manageAuditTimeframe();

    // Initialize exceptions that will not be considered as suspect
    this.initializeAllowedSectionsActions();

    // Append custom sections & actions considered as not suspect
    if (config.monitoringAllowedSectionsActions) {
      this.allowedSectionsActions = Object.assign(this.allowedSectionsActions, config.monitoringAllowedSectionsActions);
    }

    const conn = flags['target-org'].getConnection();
    uxLog("action", this, c.cyan(`Extracting Setup Audit Trail and detect suspect actions in ${conn.instanceUrl} ...`));

    // Manage exclude users list
    const whereConstraint = this.manageExcludedUsers(config);

    // Fetch SetupAuditTrail records
    await this.queryAuditTrail(whereConstraint, conn);

    await this.handleCustomSettingsAudit(conn);

    // Summarize
    uxLog("action", this, c.cyan(`Results summary:`));
    let statusCode = 0;
    let msg = 'No suspect Setup Audit Trail records has been found';
    const suspectActionsWithCount: any[] = [];
    if (this.suspectRecords.length > 0) {
      statusCode = 1;
      msg = `${this.suspectRecords.length} suspect Setup Audit Trail records has been found`;
      this.suspectUsers = [...new Set(this.suspectUsers)];
      sortCrossPlatform(this.suspectUsers);
      const suspectActionsSummary: Record<string, number> = {};
      for (const suspectAction of this.suspectActions) {
        suspectActionsSummary[suspectAction] = (suspectActionsSummary[suspectAction] || 0) + 1;
      }
      for (const suspectAction of Object.keys(suspectActionsSummary)) {
        suspectActionsWithCount.push(`${suspectAction} (${suspectActionsSummary[suspectAction]})`);
      }
      sortCrossPlatform(suspectActionsWithCount);

      uxLog("other", this, 'Suspect records list');
      uxLog("other", this, JSON.stringify(this.suspectRecords, null, 2));

      let logMsg = '';
      logMsg += c.yellow(msg) + '\n\n';
      logMsg += c.yellow('Related users:') + '\n';
      for (const user of this.suspectUsers) {
        logMsg += c.yellow(`- ${user}` + ' (' + this.suspectUsersAndActions[user].actions.join(', ') + ")") + '\n';
      }
      logMsg += '\n' + c.yellow('Related actions:') + '\n';
      for (const action of suspectActionsWithCount) {
        logMsg += c.yellow(`- ${action}`) + '\n';
      }
      logMsg += '\n';
      uxLog("other", this, logMsg);
    } else {
      uxLog("success", this, c.green(msg));
    }

    // Generate output CSV file
    this.outputFile = await generateReportPath('audit-trail', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.auditTrailRecords, this.outputFile, { fileTitle: 'Suspect Actions' });

    // Manage notifications
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No suspect Setup Audit Trail records has been found in ${orgMarkdown}`;
    let notifAttachments: any[] = [];
    if (this.suspectRecords.length > 0) {
      notifSeverity = 'warning';
      notifText = `${this.suspectRecords.length} suspect Setup Audit Trail records have been found in ${orgMarkdown}`;
      let notifDetailText = ``;
      notifDetailText += '*Related users*:\n';
      for (const user of this.suspectUsers) {
        notifDetailText += `• ${user + " (" + this.suspectUsersAndActions[user].actions.join(', ') + ")"}\n`;
      }
      notifDetailText += '\n';
      notifDetailText += '*Related actions*:\n';
      for (const action of suspectActionsWithCount) {
        notifDetailText += `• ${action}\n`;
      }
      notifAttachments = [{ text: notifDetailText }];
    }

    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'AUDIT_TRAIL',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.auditTrailRecords,
      data: { metric: this.suspectRecords.length },
      metrics: {
        SuspectMetadataUpdates: this.suspectRecords.length,
      },
    });

    if ((this.argv || []).includes('audittrail')) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      suspectRecords: this.suspectRecords,
      suspectUsers: this.suspectUsers,
      csvLogFile: this.outputFile,
    };
  }

  private async queryAuditTrail(whereConstraint: string, conn: any) {
    const auditTrailQuery = `SELECT CreatedDate,CreatedBy.Username,CreatedBy.Name,Action,Section,Display,ResponsibleNamespacePrefix,DelegateUser ` +
      `FROM SetupAuditTrail ` +
      whereConstraint +
      `ORDER BY CreatedDate DESC`;
    const queryRes = await bulkQuery(auditTrailQuery, conn);
    this.auditTrailRecords = queryRes.records.map((record) => {
      const section = record?.Section || '';
      record.Suspect = false;
      record.severity = 'log';
      record.severityIcon = this.severityIconLog;
      // Unallowed actions
      if ((
        this.allowedSectionsActions[section] &&
        this.allowedSectionsActions[section].length > 0 &&
        !this.allowedSectionsActions[section].includes(record.Action)
      ) ||
        !this.allowedSectionsActions[section]) {
        record.Suspect = true;
        record.SuspectReason = `Manual config in unallowed section ${section} with action ${record.Action}`;
        record.severity = 'warning';
        record.severityIcon = this.severityIconWarning;
        this.suspectRecords.push(record);
        const suspectUserDisplayName = `${record['CreatedBy.Name']}`;
        this.suspectUsers.push(suspectUserDisplayName);
        const actionFullName = `${section} - ${record.Action}`;
        this.suspectActions.push(actionFullName);
        if (!this.suspectUsersAndActions[suspectUserDisplayName]) {
          this.suspectUsersAndActions[suspectUserDisplayName] = {
            name: record['CreatedBy.Name'],
            actions: [],
          };
        }
        const suspectUserActions = this.suspectUsersAndActions[suspectUserDisplayName].actions;
        if (!suspectUserActions.includes(record.Action)) {
          suspectUserActions.push(record.Action);
        }
        this.suspectUsersAndActions[suspectUserDisplayName].actions = suspectUserActions;
        return record;
      }
      return record;
    });
  }

  private async handleCustomSettingsAudit(conn: any) {
    if (process.env?.SKIP_AUDIT_TRAIL_CUSTOM_SETTINGS === "true") {
      uxLog("action", this, c.cyan(`Skipping Custom Settings modifications as SKIP_AUDIT_TRAIL_CUSTOM_SETTINGS=true has been found`));
      return;
    }
    // Add custom settings tracking
    uxLog("action", this, c.cyan(`List available custom settings...`));
    uxLog("log", this, c.grey(`(Define SKIP_AUDIT_TRAIL_CUSTOM_SETTINGS=true if you don't want them)`));
    const customSettingsQuery = `SELECT QualifiedApiName, Label FROM EntityDefinition 
                           WHERE IsCustomSetting = true`;
    const customSettingsResult = await soqlQuery(customSettingsQuery, conn);
    uxLog("action", this, c.cyan(`Analyze updates in ${customSettingsResult.records.length} Custom Settings...`));

    let whereConstraintCustomSetting = `WHERE LastModifiedDate = LAST_N_DAYS:${this.lastNdays}` + ` AND LastModifiedBy.Username != NULL `;
    if (this.excludeUsers.length > 0) {
      whereConstraintCustomSetting += `AND LastModifiedBy.Username NOT IN ('${this.excludeUsers.join("','")}') `;
    }
    // Get custom settings modifications
    const customSettingModifications: any[] = [];
    for (const cs of customSettingsResult.records) {
      try {
        const result = await soqlQuery(
          `SELECT Id, LastModifiedDate, LastModifiedBy.Name, LastModifiedBy.Username 
           FROM ${cs.QualifiedApiName} `
          + whereConstraintCustomSetting,
          conn
        );

        if (result.records.length > 0) {
          for (const record of result.records) {
            customSettingModifications.push({
              CreatedDate: record.LastModifiedDate,
              'CreatedBy.Name': record['LastModifiedBy']?.['Name'],
              'CreatedBy.Username': record['LastModifiedBy']?.['Username'],
              'LastModifiedBy.Name': record['LastModifiedBy']?.['Name'],
              'LastModifiedBy.Username': record['LastModifiedBy']?.['Username'],
              Action: `customSetting${cs.QualifiedApiName}`,
              Section: 'Custom Settings',
              Display: `Updated custom setting ${cs.Label} (${cs.QualifiedApiName})`,
              ResponsibleNamespacePrefix: null,
              DelegateUser: null,
              Suspect: true,
              severity: 'warning',
              severityIcon: getSeverityIcon('warning'),
              SuspectReason: `CustomSettingUpdate`
            });
          }
        }
      } catch (error) {
        uxLog("error", this, c.red(`Error querying Custom Setting ${cs.Label}: ${error}`));
        continue;
      }
    }
    // Add custom setting updates to audit trail records
    if (customSettingModifications.length > 0) {
      uxLog("warning", this, c.yellow(`Found ${customSettingModifications.length} Custom Setting updates`));
      this.auditTrailRecords.push(...customSettingModifications);

      // Add to suspect records
      for (const csUpdate of customSettingModifications) {
        this.suspectRecords.push(csUpdate);
        const suspectUserDisplayName = csUpdate['LastModifiedBy.Name'];
        this.suspectUsers.push(suspectUserDisplayName);
        const actionFullName = `${csUpdate.Section} - ${csUpdate.Display}`;
        this.suspectActions.push(actionFullName);

        if (!this.suspectUsersAndActions[suspectUserDisplayName]) {
          this.suspectUsersAndActions[suspectUserDisplayName] = {
            name: csUpdate['LastModifiedBy.Name'],
            actions: []
          };
        }
        if (!this.suspectUsersAndActions[suspectUserDisplayName].actions.includes(csUpdate.Action)) {
          this.suspectUsersAndActions[suspectUserDisplayName].actions.push(csUpdate.Action);
        }
      }
    }
  }

  private initializeAllowedSectionsActions() {
    this.allowedSectionsActions = {
      '': ['createScratchOrg', 'changedsenderemail', 'deleteScratchOrg', 'loginasgrantedtopartnerbt'],
      'Certificate and Key Management': ['insertCertificate'],
      'Custom App Licenses': [
        'addeduserpackagelicense',
        'granteduserpackagelicense',
        'revokeduserpackagelicense'
      ],
      'Customer Portal': [
        'createdcustomersuccessuser',
        'CSPUserDisabled'
      ],
      Currency: ['updateddatedexchrate'],
      'Data Management': ['queueMembership'],
      'Email Administration': ['dkimRotationSuccessful', 'dkimRotationPreparationSuccessful'],
      'External Objects': ['xdsEncryptedFieldChange'],
      Holidays: ['holiday_insert'],
      'Inbox mobile and legacy desktop apps': [
        'enableSIQUserNonEAC',
        'siqUserAcceptedTOS'
      ],
      Groups: ['groupMembership'],
      'Manage Territories': ['tm2_userAddedToTerritory', 'tm2_userRemovedFromTerritory'],
      'Manage Users': [
        'activateduser',
        'createduser',
        'changedcommunitynickname',
        'changedemail',
        'changedfederationid',
        'changedinteractionuseroffon',
        'changedinteractionuseronoff',
        'changedmarketinguseroffon',
        'changedmarketinguseronoff',
        'changedManager',
        "changedofflineuseroffon",
        'changedprofileforuser',
        'changedprofileforusercusttostd',
        'changedprofileforuserstdtocust',
        'changedroleforusertonone',
        'changedroleforuser',
        'changedroleforuserfromnone',
        'changedpassword',
        "changedprofileforuserstdtostd",
        'changedsfcontentuseroffon',
        'changedUserAdminVerifiedStatusVerified',
        'changedUserEmailVerifiedStatusUnverified',
        'changedUserEmailVerifiedStatusVerified',
        'changedknowledgeuseroffon',
        'changedsupportuseroffon',
        'changedusername',
        'changedUserPhoneNumber',
        'changedUserPhoneVerifiedStatusUnverified',
        'changedUserPhoneVerifiedStatusVerified',
        'deactivateduser',
        'deleteAuthenticatorPairing',
        'deleteTwoFactorInfo2',
        'deleteTwoFactorTempCode',
        'frozeuser',
        'insertAuthenticatorPairing',
        'insertTwoFactorInfo2',
        'insertTwoFactorTempCode',
        'lightningloginenroll',
        'PermSetAssign',
        'PermSetGroupAssign',
        'PermSetGroupUnassign',
        'PermSetLicenseAssign',
        'PermSetUnassign',
        'PermSetLicenseUnassign',
        'registeredUserPhoneNumber',
        'resetpassword',
        'suNetworkAdminLogin',
        'suNetworkAdminLogout',
        'suOrgAdminLogin',
        'suOrgAdminLogout',
        'unfrozeuser',
        'useremailchangesent',
      ],
      'Mobile Administration': ['assigneduserstomobileconfig'],
      'Reporting Snapshots': ['createdReportJob', 'deletedReportJob'],
      Sandboxes: ['DeleteSandbox'],
    };
  }

  private async manageAuditTimeframe() {
    if (!isCI && !this.lastNdays) {
      const lastNdaysResponse = await prompts({
        type: 'select',
        name: 'lastndays',
        message: 'Please select the number of days in the past from today you want to detect suspiscious setup activities',
        description: 'Choose the timeframe for analyzing audit trail records to detect suspicious administrative activities',
        placeholder: 'Select number of days',
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
  }

  private manageExcludedUsers(config: any) {
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
    uxLog("log", this, c.grey(`Excluded users are ${this.excludeUsers.join(',') || 'None'}`));
    uxLog(
      "log",
      this,
      c.grey(
        `Use argument --excludeusers or .sfdx-hardis.yml property monitoringExcludeUsernames to exclude more users`
      )
    );
    return whereConstraint;
  }
}
