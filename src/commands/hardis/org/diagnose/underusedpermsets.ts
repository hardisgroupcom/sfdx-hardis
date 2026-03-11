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
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const DEFAULT_PERMSET_LIMITED_USERS_THRESHOLD = 5;

export default class DiagnoseUnderusedPermsets extends SfCommand<any> {
  public static title = 'Detect underused Permission Sets';

  public static description = `
## Command Behavior

**Detects Permission Sets that are assigned to zero users or to a configurable low number of users (excluding those in Permission Set Groups).**

This command helps identify permission sets that may be candidates for cleanup or consolidation. It focuses on custom permission sets (NamespacePrefix = null, LicenseId = null) that are not owned by profiles and not part of Permission Set Groups. Permission sets linked to Permission Set Licenses and managed package permission sets are excluded.

Key functionalities:

- **Zero-assignment detection:** Finds permission sets with no direct assignments and not in any Permission Set Group.
- **Low-usage detection:** Finds permission sets assigned to \`PERMSET_LIMITED_USERS_THRESHOLD\` or fewer users (default: 5).
- **Configurable threshold:** Set \`PERMSET_LIMITED_USERS_THRESHOLD\` environment variable to override the default (e.g., \`10\`).
- **CSV Report Generation:** Generates a CSV file with all identified permission sets.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams).

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

- **SOQL Queries:** Uses two SOQL queries—one for zero-assignment permission sets, one for low-usage (aggregate with HAVING).
- **Exclusions:** Excludes permission sets in PermissionSetGroupComponent (users get those via group assignment).
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
  protected threshold: number;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUnderusedPermsets);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    this.threshold = Number(getEnvVar('PERMSET_LIMITED_USERS_THRESHOLD') || DEFAULT_PERMSET_LIMITED_USERS_THRESHOLD);

    const conn = flags['target-org'].getConnection();

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
    this.zeroUserPermSets = (zeroUserRes.records || []).map((r: any) => ({
      Id: r.Id,
      Name: r.Name,
      UserCount: 0,
      Severity: 'error',
      SeverityIcon: getSeverityIcon('error'),
    }));

    // Query 2: Permission sets with <= threshold users (exclude those in groups)
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
          UserCount: userCount,
          Severity: 'warning',
          SeverityIcon: getSeverityIcon('warning'),
        };
      });

    const allResults = [...this.zeroUserPermSets, ...this.limitedUserPermSets];
    const totalCount = allResults.length;

    let msg = 'No underused permission sets found';
    let statusCode = 0;
    if (totalCount > 0) {
      statusCode = 1;
      msg = `Found ${totalCount} underused permission sets (${this.zeroUserPermSets.length} with 0 users, ${this.limitedUserPermSets.length} with 1–${this.threshold} users)`;
      uxLog("warning", this, c.yellow(msg));
    } else {
      uxLog("success", this, c.green(msg));
    }

    if (totalCount > 0) {
      uxLogTable(this, allResults);
      this.outputFile = await generateReportPath('underused-permission-sets', this.outputFile);
      this.outputFilesRes = await generateCsvFile(allResults, this.outputFile, {
        fileTitle: 'Underused Permission Sets',
      });
    }

    await this.manageNotifications(allResults, flags);

    if ((this.argv || []).includes('underusedpermsets')) {
      process.exitCode = statusCode;
    }

    return {
      status: statusCode,
      message: msg,
      zeroUserCount: this.zeroUserPermSets.length,
      limitedUserCount: this.limitedUserPermSets.length,
      totalCount,
      zeroUserPermSets: this.zeroUserPermSets,
      limitedUserPermSets: this.limitedUserPermSets,
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
      notifText = `${allResults.length} underused permission sets found in ${orgMarkdown}`;
      const zeroText =
        this.zeroUserPermSets.length > 0
          ? `*0 users:*\n${this.zeroUserPermSets.map((ps) => `• ${ps.Name}`).join('\n')}` : '';
      const limitedText =
        this.limitedUserPermSets.length > 0
          ? `*1–${this.threshold} users:*\n${this.limitedUserPermSets.map((ps) => `• ${ps.Name}: ${ps.UserCount} users`).join('\n')}`
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
      },
    });
  }
}
