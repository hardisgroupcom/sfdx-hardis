/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { CONSTANTS, getConfig, getEnvVarList } from '../../../../config/index.js';
import {
  DEFAULT_PRIVILEGED_PERM_FIELDS,
  diagnoseMfa,
} from '../../../../common/utils/mfaDiagnoseUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseMfa extends SfCommand<any> {
  public static title = 'Diagnose MFA configuration';

  public static description = `
## Command Behavior

**Audits the org's Multi-Factor Authentication (MFA) configuration and reports gaps that violate the Salesforce MFA requirement.**

This monitoring command runs five independent checks against the target org and emits a single \`MFA_CONFIG\` notification with the consolidated findings.

Key checks:

- **Org-wide MFA enforcement.** Reads \`SecuritySettings.Metadata.sessionSettings\` via the Tooling API to inspect the \`enableMFADirectUILoginOptIn\` and \`skipSFAWhenMFADirectUILogin\` flags, and scans recent \`LoginHistory\` for at least one \`Status = 'Multi-factor required'\` event to detect platform-level enforcement. Weak identity methods (\`enableSMSIdentity\`, \`canConfirmIdentityBySmsOnly\`) downgrade the result to a warning.
- **Users with the MFA-bypass permission.** Queries Profiles and Permission Sets where \`PermissionsBypassMFAForUiLogins = true\` and lists every active Standard user assigned to them.
- **Privileged users coverage.** For users assigned to any Profile or Permission Set granting \`ModifyAllData\`, \`ViewAllData\`, \`CustomizeApplication\`, or \`AuthorApex\` (configurable), the report shows whether each privileged user also holds the MFA-bypass permission (error) or lacks the API MFA permission \`PermissionsTwoFactorApi\` (warning).
- **SSO presence.** Detects SAML SSO via \`singleSignOnSettings.enableSamlLogin\` in the same SecuritySettings metadata. When SSO is on the report adds an informational reminder to verify MFA at the IdP, which sfdx-hardis cannot introspect.
- **Non-MFA direct UI logins.** Scans \`LoginHistory\` over the configurable lookback window (default 30 days) for \`LoginType = 'Application'\` successes whose \`AuthMethodReference\` contains no strong-auth token (\`mfa\`, \`swk\`, \`fido\`, \`wia\`, \`hwk\`, \`face\`, \`fpt\`, \`otp\`). Records with a null \`AuthMethodReference\` are skipped (genuinely unknown), so this check only fires on confirmed non-MFA sessions.

The severity rollup is:

- **error** if org-wide MFA enforcement is missing, any privileged user has the bypass permission, or any non-MFA direct UI login was detected.
- **warning** if any other finding is present (non-privileged bypass user, privileged users missing API MFA, weak identity setting, or SSO is enabled without an asserted IdP MFA policy).
- **log** when every check passes.

Exclusions:

- Users listed in the project config key \`monitoringMfaIgnoreUsers\` or the env var \`MONITORING_MFA_IGNORE_USERS\` (comma-separated) are skipped from checks #2, #3 (only for ignore-overlapping cases) and #5.
- Users with \`UserType != 'Standard'\` (integration users, Chatter Only, etc.) are not flagged in any per-user check.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and produces Grafana, Slack, Microsoft Teams, Google Chat, and email notifications.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:mfa --agent --target-org myorg@example.com
\`\`\`

In agent mode the command is fully non-interactive (there is no prompt in the happy path); the flag exists for consistency with the rest of the monitoring suite.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation:

- Tooling API: \`SELECT Id, Metadata FROM SecuritySettings LIMIT 1\` to retrieve session and SSO settings.
- SOQL: \`PermissionSet\` and \`Profile\` filtered on \`PermissionsBypassMFAForUiLogins\`, \`PermissionsTwoFactorApi\`, and the configured privileged permission fields; \`PermissionSetAssignment\` joined with \`User\` to resolve assignees; \`User\` filtered by \`ProfileId\` for profile-based grants.
- SOQL: \`LoginHistory\` over \`LAST_N_DAYS:N\` with client-side filtering on \`Status\`, \`LoginType\` and \`AuthMethodReference\` because \`Status\` cannot be filtered in a WHERE clause.
- TwoFactorMethodsInfo is intentionally not queried: Salesforce does not allow runtime SOQL access to it from a CLI session, so per-user method registration cannot be introspected.
- Reports: a single CSV / XLSX (\`mfa-config-<date>\`) listing every check row and a per-check summary table in the console.

Reference: [Salesforce MFA Requirement](https://help.salesforce.com/s/articleView?id=005321563&type=1).
</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:mfa',
    '$ sf hardis:org:diagnose:mfa --target-org myorg@example.com',
    '$ sf hardis:org:diagnose:mfa --lookback-days 60',
    "$ sf hardis:org:diagnose:mfa --ignore-users 'integration@x.com,break-glass@x.com'",
    '$ sf hardis:org:diagnose:mfa --agent',
  ];

  public static flags: any = {
    'lookback-days': Flags.integer({
      description:
        'Number of days back to scan LoginHistory for non-MFA direct UI logins. Overrides monitoringMfaLoginHistoryLookbackDays from config.',
    }),
    'phishing-resistant-lookback-days': Flags.integer({
      description:
        'Number of days back to scan VerificationHistory for phishing-resistant MFA registration / usage per privileged user. Overrides monitoringMfaPhishingResistantLookbackDays from config (default: 180).',
    }),
    'ignore-users': Flags.string({
      description:
        'Comma-separated list of usernames to exclude from MFA checks (merged with monitoringMfaIgnoreUsers config and MONITORING_MFA_IGNORE_USERS env var).',
    }),
    'privileged-permissions': Flags.string({
      description:
        'Comma-separated list of PermissionSet/Profile permission API names that define a privileged user. Defaults to PermissionsModifyAllData,PermissionsViewAllData,PermissionsCustomizeApplication,PermissionsAuthorApex.',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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

  protected static triggerNotification = true;

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseMfa);
    this.debugMode = flags.debug || false;
    const conn: Connection = flags['target-org'].getConnection();

    const config = await getConfig('project');
    const lookbackDays =
      flags['lookback-days'] ?? config.monitoringMfaLoginHistoryLookbackDays ?? 30;
    const phishingResistantLookbackDays =
      flags['phishing-resistant-lookback-days'] ?? config.monitoringMfaPhishingResistantLookbackDays ?? 180;

    const ignoreFromFlag = flags['ignore-users']
      ? flags['ignore-users'].split(',').map((u: string) => u.trim()).filter(Boolean)
      : [];
    const ignoreFromEnv = getEnvVarList('MONITORING_MFA_IGNORE_USERS') || [];
    const ignoreFromConfig = config.monitoringMfaIgnoreUsers || [];
    const ignoreUsers = Array.from(
      new Set<string>([...ignoreFromFlag, ...ignoreFromEnv, ...ignoreFromConfig])
    );

    const privilegedPermFields = flags['privileged-permissions']
      ? flags['privileged-permissions'].split(',').map((p: string) => p.trim()).filter(Boolean)
      : DEFAULT_PRIVILEGED_PERM_FIELDS;

    if (ignoreUsers.length > 0) {
      uxLog('action', this, c.yellow(t('mfaIgnoreListInUse', { count: ignoreUsers.length })));
      for (const u of ignoreUsers) {
        uxLog('log', this, `- ${u}`);
      }
    }

    uxLog('action', this, c.cyan(t('mfaQueryingSecuritySettings')));
    uxLog('action', this, c.cyan(t('mfaQueryingPermissionEntities')));
    uxLog('action', this, c.cyan(t('mfaQueryingLoginHistory', { days: lookbackDays })));

    const result = await diagnoseMfa({
      conn,
      lookbackDays,
      phishingResistantLookbackDays,
      ignoreUsers,
      privilegedPermFields,
      debug: this.debugMode,
    });

    /* Per-check detail tables - only print rows that have a finding so the console stays readable */
    for (const ck of result.checks) {
      const findingRows = ck.rows.filter((r) => r.Severity !== 'success');
      if (findingRows.length === 0) continue;
      uxLog('action', this, c.cyan(`${ck.title} (${ck.status})`));
      uxLogTable(
        this,
        findingRows.map((r) => ({
          Item: r.Item,
          'What is wrong': r.Details,
          Recommendation: r.Recommendation,
        }))
      );
    }

    /* Generate report file from the unified-column rows - one row per finding */
    this.outputFile = await generateReportPath('mfa-config', this.outputFile);
    this.outputFilesRes = await generateCsvFile(result.reportRows, this.outputFile, {
      fileTitle: t('mfaConfigReportFileTitle'),
    });

    /* Summary section: per-check overview table, then Actions to take as plain lines */
    uxLog('action', this, c.cyan(t('mfaSummaryHeader')));
    const severityIcon: Record<string, string> = {
      success: '✅',
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
    };
    const summaryRows = result.checks.map((ck) => ({
      Check: ck.title,
      Severity: `${severityIcon[ck.status] || ''} ${ck.status}`.trim(),
      Detail: ck.detail,
      Findings: ck.metric,
    }));
    uxLogTable(this, summaryRows);

    if (result.actionItems.length === 0) {
      uxLog('success', this, c.green(t('mfaActionItemsNone')));
    } else {
      /* Sub-heading inside the Summary section - not a new "action" log so we don't break the section grouping */
      uxLog('log', this, c.cyan.bold(t('mfaActionItemsHeader')));
      for (const group of result.actionItems) {
        const sevLabel = t(
          group.severity === 'error'
            ? 'mfaSeverityError'
            : group.severity === 'warning'
              ? 'mfaSeverityWarning'
              : 'mfaSeverityInfo'
        );
        const colorFn =
          group.severity === 'error' ? c.red : group.severity === 'warning' ? c.yellow : c.cyan;
        const heads = group.items.map((it) => it.split(' - ')[0]);
        const preview = heads.slice(0, 5).join(', ');
        const more = heads.length > 5 ? `, +${heads.length - 5} ${t('mfaActionItemsMore')}` : '';
        uxLog('warning', this, colorFn(`[${sevLabel}] (${heads.length}) ${group.recommendation}`));
        uxLog('log', this, c.grey(`  ${t('mfaActionItemsAffected')}: ${preview}${more}`));
      }
      uxLog('log', this, c.grey(t('mfaActionItemsSeeCsv')));
    }

    /* Final summary line */
    if (result.severity === 'log') {
      uxLog('success', this, c.green(t('mfaSummaryOk')));
    } else if (result.severity === 'warning') {
      uxLog('warning', this, c.yellow(t('mfaSummaryWarning')));
    } else {
      uxLog('error', this, c.red(t('mfaSummaryError')));
    }

    /* Build notification */
    const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifSeverity: NotifSeverity = result.severity;

    const checksFailed = result.checks.filter(
      (ck) => ck.status === 'error' || ck.status === 'warning'
    ).length;
    const notifText = t('mfaNotificationText', {
      orgMarkdown,
      checksFailed,
      nonMfaLogins: result.metrics.NonMfaLogins,
      bypassUsers: result.metrics.MfaBypassUsers,
    });

    /*
     * Notification body is intentionally terse: one line per failing check, nothing more.
     * Passing checks are omitted (the headline already says "X check(s) flagged"). The full
     * recommendations, affected-user lists, and action items live in the attached XLSX report.
     */
    const notifIcon: Record<string, string> = { success: '✅', info: 'ℹ️', warning: '⚠️', error: '❌' };
    const failingChecks = result.checks.filter((ck) => ck.status === 'error' || ck.status === 'warning');
    let notifDetailText = '';
    for (const ck of failingChecks) {
      notifDetailText += `${notifIcon[ck.status] || ''} **${ck.title}**: ${ck.detail}\n`;
    }
    if (failingChecks.length === 0) {
      notifDetailText = t('mfaSummaryOk');
    }
    const notifAttachments = [{ text: notifDetailText }];

    await setConnectionVariables(conn);
    await NotifProvider.postNotifications({
      type: 'MFA_CONFIG',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: result.reportRows,
      data: { metric: checksFailed },
      metrics: result.metrics,
    });

    return {
      orgId: flags['target-org'].getOrgId(),
      severity: result.severity,
      metrics: result.metrics,
      checks: result.checks.map((ck) => ({
        key: ck.key,
        status: ck.status,
        title: ck.title,
        detail: ck.detail,
        metric: ck.metric,
      })),
      outputString: notifText,
    } as any;
  }
}
