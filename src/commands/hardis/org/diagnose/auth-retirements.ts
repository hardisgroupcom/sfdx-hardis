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
import { diagnoseAuthRetirements, SOAP_LOGIN_INACTIVITY_DAYS } from '../../../../common/utils/authRetirementsDiagnoseUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { SENSITIVE_VALUES_KEY } from '../../../../common/utils/anonymizeUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseAuthRetirements extends SfCommand<any> {
  public static title = 'Diagnose Salesforce authentication retirements';

  public static description = `
## Command Behavior

**Finds the integrations of an org that a Salesforce authentication change will break, before Salesforce turns the old method off.**

Salesforce retires several authentication methods between November 2026 and Summer '27. This monitoring command runs one check per change and sends a single \`AUTH_RETIREMENTS\` notification. Each finding gives the deadline, the user or app concerned, the last time it was seen, and what to do.

| Check | Salesforce change | Production date |
|---|---|---|
| Refresh tokens idle for 30 days | Refresh tokens unused for 30 days expire (\`invalid_grant\`) | Since November 4, 2026 (sandboxes: October 21, 2026) |
| OAuth device flow | Only allowed on local External Client Apps with a localhost callback | November 30, 2026 |
| Use Any API Auth permission for SOAP login() | Every SOAP \`login()\` caller needs the permission (\`INSUFFICIENT_ACCESS\` otherwise) | December 1, 2026 |
| Security token for SOAP login() from wide IP ranges | A trusted IP range wider than /8 (IPv4) or /29 (IPv6) no longer spares the security token | January 31, 2027 (sandboxes: December 15, 2026) |
| SOAP login() turned off after 6 months without use | Salesforce turns \`login()\` off in orgs where nobody called it in 6 months | January 31, 2027 (sandboxes: December 15, 2026) |
| OAuth username-password and user-agent flows | Both flows are retired | February 20, 2027 |
| Salesforce Connect cross-org legacy authentication | Cross-org data sources must use a Named Credential | Spring '27 |
| SOAP login() retirement | SOAP \`login()\` is retired in API versions 31.0 to 64.0 | Summer '27 |

Severity of a finding:

- **error** when the deadline has passed or is less than 60 days away
- **warning** when the deadline is further away, and for refresh tokens of API only users about to expire
- **info** for facts worth knowing that need no action, and for checks that cannot run on the org (missing object or permission)

Idle refresh tokens are only reported one by one for **API only users** (users with the API Only User permission), which run the integrations. The tokens of other users are counted per app, as people log in again anyway.

Users listed in the project config key \`monitoringAuthRetirementsIgnoreUsers\` or the env var \`MONITORING_AUTH_RETIREMENTS_IGNORE_USERS\` (comma-separated) are skipped, for example an integration already being fixed.

Calls to retired API versions are detected by [hardis:org:diagnose:legacyapi](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/legacyapi/), and the Connected Apps to move to External Client Apps are listed by [hardis:org:diagnose:unsecure-connected-apps](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/unsecure-connected-apps/).

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-auth-retirements/) and can output Grafana, Slack and MsTeams Notifications.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:auth-retirements --agent --target-org myorg@example.com
\`\`\`

In agent mode the command is fully non-interactive (it never prompts); the flag exists for consistency with the rest of the monitoring suite.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation:

- **LoginHistory:** a single Bulk query reads the logins of the last \`--lookback-days\` days (default and maximum 180, the LoginHistory retention) whose \`LoginSubType\` is a SOAP API login, \`OAuth Device\`, \`OAuth Username-Password\` or an \`OAuth User-Agent\` flow. \`Application\`, \`ApiVersion\` and \`Status\` cannot be filtered in SOQL, so the logins are grouped in memory. Only successful logins count as usage; failed ones are shown in the details, as they reveal the \`INSUFFICIENT_ACCESS\` errors after enforcement.
- **Use Any API Auth:** a describe confirms \`PermissionSet.PermissionsUseAnyApiAuth\` exists, then \`PermissionSetAssignment\` is queried in chunks of 200 users, which covers profiles, permission sets and permission set groups.
- **OAuthToken:** every token is read (Bulk, page by page past the 2500 tokens limit). The idle time is the time since \`LastUsedDate\` (\`CreatedDate\` when never used). API only users come from \`PermissionSetAssignment\` on \`PermissionsApiUserOnly\`.
- **Trusted IP ranges:** \`SecuritySettings.Metadata.networkAccess.ipRanges\` (Tooling API). Profile login IP ranges cannot be read with SOQL and are not taken into account.
- **Username-password and user-agent flows:** \`OauthOidcSettings.Metadata\` (Tooling API) tells if both flows are already blocked in the org.
- **Salesforce Connect:** \`ExternalDataSource\` records of type \`SfdcOrg\` without \`NamedCredentialId\`.
- **Dates:** all the Salesforce dates are in one table of \`authRetirementsDiagnoseUtils.ts\`. \`Organization.IsSandbox\` picks the sandbox date when Salesforce gives one.
- **Report:** one CSV / XLSX (\`auth-retirements-<date>\`) with a row per finding, its deadline and the link to the Salesforce article. Usernames and IP addresses follow the anonymization settings.
- **Metrics:** \`IdleRefreshTokensExpiringSoon\`, \`DeviceFlowUsers\`, \`SoapLoginUsersMissingPermission\`, \`SoapLoginUsersNeedingToken\`, \`UsernamePasswordFlowUsers\`, \`SfConnectLegacyDataSources\`, \`SoapLoginUsers\`. A check that cannot run on the org sends no metric.
</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:auth-retirements',
    '$ sf hardis:org:diagnose:auth-retirements --target-org myorg@example.com',
    '$ sf hardis:org:diagnose:auth-retirements --lookback-days 90 --idle-warning-days 15',
    "$ sf hardis:org:diagnose:auth-retirements --ignore-users 'integration@x.com'",
    '$ sf hardis:org:diagnose:auth-retirements --agent',
  ];

  public static flags: any = {
    'lookback-days': Flags.integer({
      description: `Number of days of LoginHistory to scan for SOAP login() and OAuth logins (maximum ${SOAP_LOGIN_INACTIVITY_DAYS}, the LoginHistory retention).`,
      default: SOAP_LOGIN_INACTIVITY_DAYS,
      min: 1,
      max: SOAP_LOGIN_INACTIVITY_DAYS,
    }),
    'idle-warning-days': Flags.integer({
      description: 'Number of idle days from which the refresh token of an API only user is reported as about to expire (they expire after 30 days).',
      default: 20,
      min: 1,
      max: 29,
    }),
    'ignore-users': Flags.string({
      description:
        'Comma-separated list of usernames to skip (merged with monitoringAuthRetirementsIgnoreUsers config and MONITORING_AUTH_RETIREMENTS_IGNORE_USERS env var).',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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

  protected outputFile;
  protected outputFilesRes: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseAuthRetirements);
    this.outputFile = flags.outputfile || null;
    const conn: Connection = flags['target-org'].getConnection();

    const config = await getConfig('project');
    const ignoreUsers = Array.from(
      new Set<string>([
        ...(flags['ignore-users'] ? flags['ignore-users'].split(',').map((u: string) => u.trim()).filter(Boolean) : []),
        ...(getEnvVarList('MONITORING_AUTH_RETIREMENTS_IGNORE_USERS') || []),
        ...(config.monitoringAuthRetirementsIgnoreUsers || []),
      ])
    );
    if (ignoreUsers.length > 0) {
      uxLog('action', this, c.yellow(t('authRetirementsIgnoreListInUse', { count: ignoreUsers.length })));
      for (const user of ignoreUsers) {
        uxLog('log', this, `- ${user}`);
      }
    }

    uxLog('action', this, c.cyan(t('authRetirementsAnalyzing', { days: flags['lookback-days'] })));
    const result = await diagnoseAuthRetirements({
      conn,
      lookbackDays: flags['lookback-days'],
      idleWarningDays: flags['idle-warning-days'],
      ignoreUsers,
    });

    // Findings of every check, the most severe first
    const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
    const findingRows = result.reportRows
      .filter((row) => row.Severity !== 'success')
      .sort((a, b) => order[a.Severity] - order[b.Severity]);
    if (findingRows.length > 0) {
      uxLog('action', this, c.cyan(t('authRetirementsFindingsHeader', { count: findingRows.length })));
      uxLogTable(
        this,
        findingRows.slice(0, 20).map((row) => ({
          Check: row.Check,
          Severity: row.Severity,
          Deadline: row.Deadline,
          Item: row.Item,
          Details: row.Details,
          // Keep the sensitive-values marker so uxLogTable anonymization can mask usernames and IPs
          ...(SENSITIVE_VALUES_KEY in (row as any) ? { [SENSITIVE_VALUES_KEY]: (row as any)[SENSITIVE_VALUES_KEY] } : {}),
        }))
      );
      if (findingRows.length > 20) {
        uxLog('log', this, c.grey(t('authRetirementsSeeReportForMore', { count: findingRows.length - 20 })));
      }
    }

    // Report file: one row per finding, plus one row per check without finding
    this.outputFile = await generateReportPath('auth-retirements', this.outputFile);
    this.outputFilesRes = await generateCsvFile(result.reportRows, this.outputFile, {
      fileTitle: t('authRetirementsReportFileTitle'),
    });

    // Summary: one line per check
    uxLog('action', this, c.cyan(t('authRetirementsSummaryHeader')));
    const severityIcon: Record<string, string> = { success: '✅', info: 'ℹ️', warning: '⚠️', error: '❌' };
    uxLogTable(
      this,
      result.checks.map((ck) => ({
        Check: ck.title,
        Severity: `${severityIcon[ck.status] || ''} ${ck.status}`.trim(),
        Deadline: ck.deadline,
        Detail: ck.detail,
      }))
    );
    if (result.severity === 'log') {
      uxLog('success', this, c.green(t('authRetirementsSummaryOk')));
    } else if (result.severity === 'warning') {
      uxLog('warning', this, c.yellow(t('authRetirementsSummaryWarning')));
    } else {
      uxLog('error', this, c.red(t('authRetirementsSummaryError')));
    }

    // Notification: one line per check to act on, the details are in the attached report
    const failingChecks = result.checks.filter((ck) => ck.status === 'error' || ck.status === 'warning');
    const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifSeverity: NotifSeverity = result.severity;
    const notifText = t('authRetirementsNotificationText', { count: failingChecks.length, orgMarkdown });
    let notifDetailText = '';
    for (const ck of failingChecks) {
      notifDetailText += `${severityIcon[ck.status]} **${ck.title}** (${ck.deadline}): ${ck.detail}\n`;
    }
    if (failingChecks.length === 0) {
      notifDetailText = t('authRetirementsSummaryOk');
    }
    await setConnectionVariables(conn);
    await NotifProvider.postNotifications({
      type: 'AUTH_RETIREMENTS',
      text: notifText,
      attachments: [{ text: notifDetailText }],
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: findingRows,
      data: { metric: failingChecks.length },
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
        deadline: ck.deadline,
        detail: ck.detail,
        metric: ck.metric,
      })),
      outputString: notifText,
    } as any;
  }
}
