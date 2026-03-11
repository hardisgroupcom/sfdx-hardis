/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { CONSTANTS, getEnvVar, getEnvVarList } from '../../../../config/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const DEFAULT_PERMSET_LIMITED_USERS_THRESHOLD = 5;

export default class DiagnoseUnderusedPermsets extends SfCommand<any> {
  public static title = 'Detect underused Permission Sets';

  public static description = `
## Command Behavior

**Detects Permission Sets and Permission Set Groups that are assigned to zero users or to a configurable low number of users.**

This command helps identify permission sets and permission set groups that may be candidates for cleanup or consolidation. It includes:
- **Permission Sets:** Custom permission sets (NamespacePrefix = null, LicenseId = null) not owned by profiles and not in groups. Excludes PSL-linked and managed package permission sets.
- **Permission Set Groups:** Custom groups (NamespacePrefix = null). Excludes managed package groups.

Key functionalities:

- **Zero-assignment detection:** Finds permission sets and groups with no assignments.
- **Low-usage detection:** Finds permission sets and groups assigned to \`PERMSET_LIMITED_USERS_THRESHOLD\` or fewer users (default: 5).
- **Configurable threshold:** Set \`PERMSET_LIMITED_USERS_THRESHOLD\` environment variable to override the default (e.g., \`10\`).
- **Ignore list:** Set \`UNDERUSED_PERMISSION_SETS_IGNORE\` to a comma-separated list of permission set or group names to exclude from results.
- **CSV Report Generation:** Generates a CSV file with all identified permission sets.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams).

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

- **SOQL Queries:** Uses four SOQL queries—permission sets (zero + limited) and permission set groups (zero + limited).
- **Exclusions:** Permission sets in groups are excluded (counted via group); PSL-linked and managed package items excluded.
- **Ignore list:** \`UNDERUSED_PERMISSION_SETS_IGNORE\` env var (comma-separated names) excludes matching permission sets and groups.
- **Report Generation:** Uses \`generateCsvFile\` to create the CSV report.
- **Notification Integration:** Integrates with \`NotifProvider\` for notifications.
</details>
`;

  public static examples = ['$ sf hardis:org:diagnose:underusedpermsets'];

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

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected zeroUserPermSets: any[] = [];
  protected limitedUserPermSets: any[] = [];
  protected zeroUserPermSetGroups: any[] = [];
  protected limitedUserPermSetGroups: any[] = [];
  protected threshold: number;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUnderusedPermsets);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    this.threshold = Number(getEnvVar('PERMSET_LIMITED_USERS_THRESHOLD') || DEFAULT_PERMSET_LIMITED_USERS_THRESHOLD);
    const ignoreList = getEnvVarList('UNDERUSED_PERMISSION_SETS_IGNORE') || [];
    const ignoreSet = new Set(ignoreList.map((n) => n.trim().toLowerCase()).filter(Boolean));

    const conn = flags['target-org'].getConnection();

    const isIgnored = (name: string) => ignoreSet.size > 0 && ignoreSet.has((name || '').trim().toLowerCase());

    // Query 1: Permission sets with 0 users
    uxLog("action", this, c.cyan('Querying permission sets with zero assignments...'));
    const zeroUserQuery = `
      SELECT Id, Name
      FROM PermissionSet
      WHERE Id NOT IN (
        SELECT PermissionSetId
        FROM PermissionSetAssignment
      )
      AND Id NOT IN (
        SELECT PermissionSetId
        FROM PermissionSetGroupComponent
      )
      AND NamespacePrefix = null
      AND IsOwnedByProfile = false
      AND LicenseId = null
    `;
    const zeroUserRes = await soqlQuery(zeroUserQuery.trim(), conn);
    this.zeroUserPermSets = (zeroUserRes.records || [])
      .map((r: any) => ({
        Id: r.Id,
        Name: r.Name,
        Type: 'PermissionSet',
        UserCount: 0,
        Severity: 'error',
        SeverityIcon: getSeverityIcon('error'),
      }))
      .filter((r) => !isIgnored(r.Name));

    // Query 2: Permission Set Groups with 0 users
    uxLog("action", this, c.cyan('Querying permission set groups with zero assignments...'));
    const zeroUserGroupQuery = `
      SELECT Id, DeveloperName, MasterLabel
      FROM PermissionSetGroup
      WHERE Id NOT IN (
        SELECT PermissionSetGroupId
        FROM PermissionSetAssignment
        WHERE PermissionSetGroupId != null
      )
      AND NamespacePrefix = null
    `;
    const zeroUserGroupRes = await soqlQuery(zeroUserGroupQuery.trim(), conn);
    this.zeroUserPermSetGroups = (zeroUserGroupRes.records || [])
      .map((r: any) => ({
        Id: r.Id,
        Name: r.MasterLabel ?? r.DeveloperName ?? r.Id,
        Type: 'PermissionSetGroup',
        UserCount: 0,
        Severity: 'error',
        SeverityIcon: getSeverityIcon('error'),
      }))
      .filter((r) => !isIgnored(r.Name));

    // Query 3: Permission sets with <= threshold users (exclude those in groups)
    uxLog("action", this, c.cyan(`Querying permission sets with ${this.threshold} or fewer users...`));
    const limitedUserQuery = `
      SELECT PermissionSet.Id, PermissionSet.Name, COUNT(Id) userCount
      FROM PermissionSetAssignment
      WHERE PermissionSetId NOT IN (
        SELECT PermissionSetId
        FROM PermissionSetGroupComponent
      )
      AND PermissionSet.NamespacePrefix = null
      AND PermissionSet.LicenseId = null
      GROUP BY PermissionSet.Id, PermissionSet.Name
      HAVING COUNT(Id) <= ${this.threshold}
    `;
    const limitedUserRes = await soqlQuery(limitedUserQuery.trim(), conn);
    const limitedRecords = limitedUserRes.records || [];
    // Filter out zero-user results (already in first query) and aggregate
    // AggregateResult may use Id, PermissionSet.Id, or expr0 for grouped fields
    this.limitedUserPermSets = limitedRecords
      .filter((r: any) => (r.userCount ?? r.expr0 ?? 0) > 0)
      .map((r: any) => {
        const id = r.Id ?? r['PermissionSet.Id'];
        const name = r.Name ?? r['PermissionSet.Name'];
        const userCount = r.userCount ?? r.expr0 ?? 0;
        return {
          Id: id,
          Name: name,
          Type: 'PermissionSet',
          UserCount: userCount,
          Severity: 'warning',
          SeverityIcon: getSeverityIcon('warning'),
        };
      })
      .filter((r) => !isIgnored(r.Name));

    // Query 4: Permission Set Groups with <= threshold users
    uxLog("action", this, c.cyan(`Querying permission set groups with ${this.threshold} or fewer users...`));
    const limitedUserGroupQuery = `
      SELECT PermissionSetGroup.Id, PermissionSetGroup.DeveloperName, PermissionSetGroup.MasterLabel, COUNT(Id) userCount
      FROM PermissionSetAssignment
      WHERE PermissionSetGroupId != null
      AND PermissionSetGroup.NamespacePrefix = null
      GROUP BY PermissionSetGroup.Id, PermissionSetGroup.DeveloperName, PermissionSetGroup.MasterLabel
      HAVING COUNT(Id) <= ${this.threshold}
    `;
    const limitedUserGroupRes = await soqlQuery(limitedUserGroupQuery.trim(), conn);
    const limitedGroupRecords = limitedUserGroupRes.records || [];
    this.limitedUserPermSetGroups = limitedGroupRecords
      .filter((r: any) => (r.userCount ?? r.expr0 ?? 0) > 0)
      .map((r: any) => {
        const id = r.Id ?? r['PermissionSetGroup.Id'];
        const name = r.MasterLabel ?? r['PermissionSetGroup.MasterLabel'] ?? r.DeveloperName ?? r['PermissionSetGroup.DeveloperName'] ?? id;
        const userCount = r.userCount ?? r.expr0 ?? 0;
        return {
          Id: id,
          Name: name,
          Type: 'PermissionSetGroup',
          UserCount: userCount,
          Severity: 'warning',
          SeverityIcon: getSeverityIcon('warning'),
        };
      })
      .filter((r) => !isIgnored(r.Name));

    const allResults = [
      ...this.zeroUserPermSets,
      ...this.limitedUserPermSets,
      ...this.zeroUserPermSetGroups,
      ...this.limitedUserPermSetGroups,
    ];
    const totalCount = allResults.length;

    let msg = 'No underused permission sets found';
    let statusCode = 0;
    if (totalCount > 0) {
      statusCode = 1;
      const zeroTotal = this.zeroUserPermSets.length + this.zeroUserPermSetGroups.length;
      const limitedTotal = this.limitedUserPermSets.length + this.limitedUserPermSetGroups.length;
      msg = `Found ${totalCount} underused permission sets/groups (${zeroTotal} with 0 users, ${limitedTotal} with 1-${this.threshold} users)`;
    }

    if (totalCount > 0) {
      uxLogTable(this, allResults);
      this.outputFile = await generateReportPath('underused-permission-sets', this.outputFile);
      this.outputFilesRes = await generateCsvFile(allResults, this.outputFile, {
        fileTitle: 'Underused Permission Sets',
      });
    }

    await this.manageNotifications(allResults, flags);

    // Summary
    uxLog("action", this, c.bold(c.cyan('Underused Permission Sets Summary')));
    const summaryRows = [
      {
        Type: 'Permission Sets',
        'Zero users (error)': this.zeroUserPermSets.length,
        [`≤${this.threshold} users (warning)`]: this.limitedUserPermSets.length,
        Total: this.zeroUserPermSets.length + this.limitedUserPermSets.length,
      },
      {
        Type: 'Permission Set Groups',
        'Zero users (error)': this.zeroUserPermSetGroups.length,
        [`≤${this.threshold} users (warning)`]: this.limitedUserPermSetGroups.length,
        Total: this.zeroUserPermSetGroups.length + this.limitedUserPermSetGroups.length,
      },
      {
        Type: 'TOTAL',
        'Zero users (error)': this.zeroUserPermSets.length + this.zeroUserPermSetGroups.length,
        [`≤${this.threshold} users (warning)`]: this.limitedUserPermSets.length + this.limitedUserPermSetGroups.length,
        Total: totalCount,
      },
    ];
    uxLogTable(this, summaryRows);
    if (totalCount > 0) {
      uxLog("warning", this, c.yellow(msg));
    } else {
      uxLog("success", this, c.green(msg));
    }

    if ((this.argv || []).includes('underusedpermsets')) {
      process.exitCode = statusCode;
    }

    return {
      status: statusCode,
      message: msg,
      zeroUserCount: this.zeroUserPermSets.length + this.zeroUserPermSetGroups.length,
      limitedUserCount: this.limitedUserPermSets.length + this.limitedUserPermSetGroups.length,
      totalCount,
      zeroUserPermSets: this.zeroUserPermSets,
      limitedUserPermSets: this.limitedUserPermSets,
      zeroUserPermSetGroups: this.zeroUserPermSetGroups,
      limitedUserPermSetGroups: this.limitedUserPermSetGroups,
      csvLogFile: this.outputFile,
    };
  }

  private async manageNotifications(allResults: any[], flags: any) {
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No underused permission sets found in ${orgMarkdown}`;
    const attachments: any[] = [];

    if (allResults.length > 0) {
      notifSeverity = 'warning';
      notifText = `${allResults.length} underused permission sets/groups found in ${orgMarkdown}`;
      const zeroItems = [...this.zeroUserPermSets, ...this.zeroUserPermSetGroups];
      const limitedItems = [...this.limitedUserPermSets, ...this.limitedUserPermSetGroups];
      const zeroText =
        zeroItems.length > 0
          ? `*0 users:*\n${zeroItems.map((ps) => `• ${ps.Name} (${ps.Type})`).join('\n')}` : '';
      const limitedText =
        limitedItems.length > 0
          ? `*1-${this.threshold} users:*\n${limitedItems.map((ps) => `• ${ps.Name} (${ps.Type}): ${ps.UserCount} users`).join('\n')}`
          : '';
      attachments.push({
        text: [zeroText, limitedText].filter(Boolean).join('\n\n'),
      });
    }

    await setConnectionVariables(flags['target-org']?.getConnection());
    await NotifProvider.postNotifications({
      type: 'UNDERUSED_PERMSETS',
      text: notifText,
      attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: allResults,
      data: { metric: allResults.length },
      metrics: {
        UnderusedPermissionSets: allResults.length,
        ZeroUserPermissionSets: this.zeroUserPermSets.length,
        LimitedUserPermissionSets: this.limitedUserPermSets.length,
        ZeroUserPermissionSetGroups: this.zeroUserPermSetGroups.length,
        LimitedUserPermissionSetGroups: this.limitedUserPermSetGroups.length,
      },
    });
  }
}
