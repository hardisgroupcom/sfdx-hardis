/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { CONSTANTS, getConfig, getEnvVarList } from '../../../../config/index.js';
import {
  getDefaultWhatWillBreakChecks,
  getWhatWillBreakCheckTitle,
  getWhatWillBreakFamilyTitle,
  parseWhatWillBreakChecks,
  runWhatWillBreak,
  WHAT_WILL_BREAK_CHECK_KEYS,
  WHAT_WILL_BREAK_CHECKS,
  writeWhatWillBreakReports,
} from '../../../../common/whatWillBreak/index.js';
import { getDeadlineLabel, WHAT_WILL_BREAK_DEADLINES } from '../../../../common/whatWillBreak/whatWillBreakDeadlines.js';
import { SOAP_LOGIN_INACTIVITY_DAYS } from '../../../../common/whatWillBreak/authChecks.js';
import { WhatWillBreakCheckKey } from '../../../../common/whatWillBreak/whatWillBreakTypes.js';
import { t } from '../../../../common/utils/i18n.js';
import { SENSITIVE_VALUES_KEY, stripSensitiveValues } from '../../../../common/utils/anonymizeUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseWhatWillBreak extends SfCommand<any> {
  public static title = 'What will break after dated Salesforce changes';

  public static description = `
## Command Behavior

**Tells what will break in an org because of a dated Salesforce change, when, and what to do before it breaks.**

The command starts with a list of every check, all selected: keep the ones to run. It then writes a main report with one row per thing that will break (an integration and its user, a Connected App, a data source, a range of API versions, a release update), and one row per check that found nothing, so a clean org gets a report that says so. A check with more than 20 findings lists the first 20, and a last row points to its detail report.

| Main report column | Content |
|---|---|
| Status | Error (the date has passed or is less than 60 days away), Warning, Info, Not checked (with the reason) or OK |
| What will break | What fails, for which app, user or data source, and when. On an OK row, what was checked. |
| Date | When it breaks: a day, "Enforced since", or a Salesforce release such as "Summer '28 (2028-06)" |
| What to do | The steps that fix this item and keep it from breaking again, or the report file that lists them |
| Salesforce announcement | The official Salesforce page of the change |
| How to fix | The [How to fix](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-what-will-break/#how-to-fix) section of the check, with the steps |
| Detail report | The report of the check, with every item it found |

| Check | Salesforce change | Production date |
|---|---|---|
| Refresh tokens idle for 30 days | Refresh tokens unused for 30 days expire (\`invalid_grant\`) | Since November 4, 2026 (sandboxes: October 21, 2026) |
| Integrations using their refresh token less than every 30 days | A monthly or quarterly sync loses its token between two runs | Since November 4, 2026 (sandboxes: October 21, 2026) |
| OAuth device flow | Only allowed on local External Client Apps with a localhost callback | November 30, 2026 |
| Use Any API Auth permission for SOAP login() | Every SOAP \`login()\` caller needs the permission (\`INSUFFICIENT_ACCESS\` otherwise) | December 1, 2026 |
| Security token for SOAP login() from wide IP ranges | A trusted IP range wider than /8 (IPv4) or /29 (IPv6) no longer spares the security token | January 31, 2027 (sandboxes: December 15, 2026) |
| SOAP login() turned off after 6 months without use | Salesforce turns \`login()\` off in orgs where nobody called it in 6 months | January 31, 2027 (sandboxes: December 15, 2026) |
| OAuth username-password and user-agent flows | Both flows are retired | February 20, 2027 |
| Salesforce Connect cross-org legacy authentication | Cross-org data sources must use a Named Credential | Spring '27 |
| SOAP login() retirement | SOAP \`login()\` is retired in API versions 31.0 to 64.0 | Summer '27 |
| Connected Apps to move to External Client Apps | Connected Apps are no longer supported | Summer '27 |
| Calls to retired API versions | API versions 30.0 and older are retired, 31.0 to 40.0 are retired in Summer '28 | Summer '25 and Summer '28 |
| Release updates due | Each release update is enforced on its due date | The due date of each release update |

Each check that found something also writes its own report. The legacy API check keeps the files of [hardis:org:diagnose:legacyapi](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/legacyapi/), including one file of API clients (IP addresses) per range of API versions.

Idle refresh tokens are only reported one by one for **API only users**, which run the integrations: the tokens of other users are counted per app. The refresh token use check covers every user, except in Salesforce's own end-user apps (mobile, Outlook, Authenticator...).

Users listed in the project config key \`monitoringWhatWillBreakIgnoreUsers\` or the env var \`MONITORING_WHAT_WILL_BREAK_IGNORE_USERS\` (comma-separated) are skipped, for example an integration already being fixed.

This command replaces [hardis:org:diagnose:legacyapi](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/legacyapi/) and [hardis:org:diagnose:releaseupdates](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/releaseupdates/), which are deprecated. It is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-what-will-break/) and can output Grafana, Slack and MsTeams Notifications. When \`LEGACY_API\` or \`RELEASE_UPDATES\` is turned off in the monitoring config (\`monitoringDisable\`, or frequency \`off\`), the matching check is not run by default.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:what-will-break --agent --target-org myorg@example.com
sf hardis:org:diagnose:what-will-break --agent --checks idleRefreshTokens,refreshTokenCadence,legacyApiVersions
\`\`\`

In agent mode, and in CI, the list of checks is not shown: \`--checks\` picks them (comma-separated keys: ${WHAT_WILL_BREAK_CHECK_KEYS.join(', ')}), and all of them run when it is not given.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation:

- **LoginHistory:** a single aggregate SOQL query (grouped by user, login type, app, API version, IP address and status) reads the logins of the last \`--lookback-days\` days (default and maximum 180, the LoginHistory retention) whose \`LoginSubType\` is a SOAP API login, \`OAuth Device\`, \`OAuth Username-Password\` or an \`OAuth User-Agent\` flow. \`Application\`, \`ApiVersion\` and \`Status\` cannot be filtered in SOQL but can be grouped. The Bulk API does not support \`LoginHistory\`. When the aggregate query fails or returns 2000 groups, the raw logins are read instead.
- **Refresh token use:** the \`OAuth Refresh Token\` logins are grouped by user, app, status and day (\`DAY_ONLY(LoginTime)\`), 20 users per query, a chunk being split in two when it reaches the 2000 groups limit. A user and app whose longest gap between two days of use is 30 days or more is reported, and so is one used on a single day (as information while that day is less than 30 days ago). Past 2000 user and app pairs, the users are grouped alone, then every active user is read.
- **Use Any API Auth:** a describe confirms \`PermissionSet.PermissionsUseAnyApiAuth\` exists, then \`PermissionSetAssignment\` is queried in chunks of 200 users, which covers profiles, permission sets and permission set groups.
- **OAuthToken:** every token is read (Bulk, page by page past the 2500 tokens limit). The idle time is the time since \`LastUsedDate\` (\`CreatedDate\` when never used). API only users come from \`PermissionSetAssignment\` on \`PermissionsApiUserOnly\`.
- **Trusted IP ranges:** \`SecuritySettings.Metadata.networkAccess.ipRanges\` (Tooling API). Profile login IP ranges cannot be read with SOQL and are not taken into account.
- **Username-password and user-agent flows:** \`OauthOidcSettings.Metadata\` (Tooling API) tells if both flows are already blocked in the org.
- **Salesforce Connect:** \`ExternalDataSource\` records of type \`SfdcOrg\` without \`NamedCredentialId\`.
- **Connected Apps:** the same usage list as [hardis:org:diagnose:unsecure-connected-apps](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/unsecure-connected-apps/). A Connected App the org owns (its \`ConnectedApp\` metadata), used in the last 90 days, must be moved.
- **API versions:** the \`ApiTotalUsage\` event log files, analyzed like [hardis:org:diagnose:legacyapi](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/legacyapi/). SOAP \`login()\` calls stay in its detail report: the SOAP login() retirement check covers them.
- **Release updates:** Tooling API \`ReleaseUpdate\` records in stage \`Upcoming\` or \`OverDue\`. Each one links to the Release Updates Setup page of the org, where its Salesforce article opens.
- **Dates:** all the Salesforce dates are in one table of \`whatWillBreakDeadlines.ts\`. \`Organization.IsSandbox\` picks the sandbox date when Salesforce gives one. When the org cannot be reached, the command fails instead of reporting the checks as not run.
- **Reports:** the main CSV / XLSX (\`what-will-break-<date>\`), then one report per check that found something (\`what-will-break-<check>-<date>\`). Usernames and IP addresses follow the anonymization settings.
- **Metrics:** \`IdleRefreshTokensExpiringSoon\`, \`IntegrationsRefreshingTooRarely\`, \`DeviceFlowUsers\`, \`SoapLoginUsersMissingPermission\`, \`SoapLoginUsersNeedingToken\`, \`UsernamePasswordFlowUsers\`, \`SfConnectLegacyDataSources\`, \`SoapLoginUsers\`, \`ConnectedAppsToMigrate\`, \`LegacyApiCalls\`, \`ReleaseUpdates\`. A check that is not selected, or cannot run on the org, sends no metric.
</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:what-will-break',
    '$ sf hardis:org:diagnose:what-will-break --target-org myorg@example.com',
    '$ sf hardis:org:diagnose:what-will-break --checks legacyApiVersions,releaseUpdates',
    '$ sf hardis:org:diagnose:what-will-break --lookback-days 90 --idle-warning-days 15',
    "$ sf hardis:org:diagnose:what-will-break --ignore-users 'integration@x.com'",
    '$ sf hardis:org:diagnose:what-will-break --agent',
  ];

  public static flags: any = {
    checks: Flags.string({
      description: `Comma-separated keys of the checks to run, without the list of checks being shown. Available: ${WHAT_WILL_BREAK_CHECK_KEYS.join(', ')}.`,
    }),
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
        'Comma-separated list of usernames to skip (merged with monitoringWhatWillBreakIgnoreUsers config and MONITORING_WHAT_WILL_BREAK_IGNORE_USERS env var).',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of the main report file. Must end with .csv',
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
    const { flags } = await this.parse(DiagnoseWhatWillBreak);
    const agentMode = flags.agent === true;
    this.outputFile = flags.outputfile || null;
    const conn: Connection = flags['target-org'].getConnection();
    // The user layer merges the branch file: a monitoring repository has one branch per org, with its own settings
    const config = await getConfig('user');

    const checks = await this.selectChecks(flags.checks, config, agentMode);
    if (checks.length === 0) {
      uxLog('warning', this, c.yellow(t('whatWillBreakNoCheckSelected')));
      return { orgId: flags['target-org'].getOrgId(), checks: [], rows: [], outputString: t('whatWillBreakNoCheckSelected') };
    }
    const ignoreUsers = Array.from(
      new Set<string>([
        ...(flags['ignore-users'] ? flags['ignore-users'].split(',').map((u: string) => u.trim()).filter(Boolean) : []),
        ...(getEnvVarList('MONITORING_WHAT_WILL_BREAK_IGNORE_USERS') || []),
        ...(config.monitoringWhatWillBreakIgnoreUsers || []),
      ])
    );
    if (ignoreUsers.length > 0) {
      uxLog('log', this, c.grey(t('authRetirementsIgnoreListInUse', { count: ignoreUsers.length })));
      for (const user of ignoreUsers) {
        uxLog('log', this, c.grey(`- ${user}`));
      }
    }

    uxLog('action', this, c.cyan(t('whatWillBreakChecking', { count: checks.length })));
    const result = await runWhatWillBreak({
      conn,
      checks,
      lookbackDays: flags['lookback-days'],
      idleWarningDays: flags['idle-warning-days'],
      ignoreUsers,
      commandThis: this,
      debugMode: flags.debug === true,
    });

    // Reports of the checks, then the main report
    const { mainRows, reportFiles } = await writeWhatWillBreakReports(result);
    this.outputFile = await generateReportPath('what-will-break', this.outputFile);
    this.outputFilesRes = await generateCsvFile(mainRows, this.outputFile, { fileTitle: t('whatWillBreakReportFileTitle'), mainReport: true });

    // Summary: the main report, what will break first
    uxLog('action', this, c.cyan(t('whatWillBreakSummaryHeader')));
    uxLogTable(
      this,
      mainRows.slice(0, 20).map((row) => ({
        Status: row.Status,
        Check: row.Check,
        'What will break': row['What will break'],
        Date: row.Date,
        'How to fix': row.Severity === 'success' ? '' : row['How to fix'],
      }))
    );
    if (mainRows.length > 20) {
      uxLog('log', this, c.grey(t('authRetirementsSeeReportForMore', { count: mainRows.length - 20 })));
    }
    // "Nothing will break" only when every check could run: a check that did not run proves nothing
    const notCheckedCount = result.checks.filter((check) => check.notChecked === true).length;
    const allClearText =
      notCheckedCount > 0 ? t('whatWillBreakSummaryNotChecked', { count: notCheckedCount }) : t('whatWillBreakAllGood');
    if (result.severity === 'log' && notCheckedCount > 0) {
      uxLog('warning', this, c.yellow(allClearText));
    } else if (result.severity === 'log') {
      uxLog('success', this, c.green(allClearText));
    } else if (result.severity === 'warning') {
      uxLog('warning', this, c.yellow(t('whatWillBreakSummaryWarning')));
    } else {
      // Not an error log line: finding what will break is the expected result of a run, and an error line shows the run as failed in VS Code
      uxLog('warning', this, c.yellow(t('whatWillBreakSummaryError')));
    }

    // Notification: one line per thing to act on, the details are in the attached main report
    const failingRows = mainRows.filter((row) => row.Severity === 'error' || row.Severity === 'warning');
    const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifSeverity: NotifSeverity = result.severity;
    // Findings of every check: the main report lists at most 20 of them per check
    const findingCount = result.checks
      .flatMap((check) => check.rows)
      .filter((row) => row.Severity === 'error' || row.Severity === 'warning').length;
    const notifText = t('whatWillBreakNotificationText', { count: findingCount, orgMarkdown });
    // A finding that names a user or an IP address is counted in one line per check: the message is not anonymized, the attached report is
    const notifLines: { row: (typeof failingRows)[number]; count: number }[] = [];
    for (const row of failingRows) {
      const grouped = (row as any)[SENSITIVE_VALUES_KEY] ? notifLines.find((line) => line.count > 0 && line.row.CheckKey === row.CheckKey) : undefined;
      if (grouped) {
        grouped.count++;
      } else {
        notifLines.push({ row, count: (row as any)[SENSITIVE_VALUES_KEY] ? 1 : 0 });
      }
    }
    let notifDetailText = '';
    for (const { row, count } of notifLines) {
      const howToFix = `[${t('authRetirementsHowToFix')}](${row['How to fix']})`;
      const what = count > 0 ? t('whatWillBreakNotifFindings', { count }) : row['What will break'];
      notifDetailText += `${row.Status.split(' ')[0]} **${row.Check}** (${row.Date}): ${what} - ${howToFix}\n`;
    }
    if (failingRows.length === 0) {
      notifDetailText = allClearText;
    }
    await setConnectionVariables(conn);
    await NotifProvider.postNotifications({
      type: 'WHAT_WILL_BREAK',
      text: notifText,
      attachments: [{ text: notifDetailText }],
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: mainRows,
      data: { metric: findingCount },
      metrics: result.metrics,
    });

    return {
      orgId: flags['target-org'].getOrgId(),
      severity: result.severity,
      metrics: result.metrics,
      checks: result.checks.map((check) => ({
        key: check.key,
        family: WHAT_WILL_BREAK_CHECKS.find((definition) => definition.key === check.key)?.family,
        status: check.status,
        title: check.title,
        deadline: check.deadline,
        detail: check.detail,
        howToFixUrl: check.howToFixUrl,
        announcementUrl: WHAT_WILL_BREAK_DEADLINES[check.key].articleUrl,
        notChecked: check.notChecked === true,
        metric: check.metric,
        reportFiles: reportFiles[check.key] || [],
      })),
      rows: stripSensitiveValues(mainRows),
      outputFiles: { main: this.outputFilesRes, perCheck: reportFiles },
      outputString: notifText,
    } as any;
  }

  // The checks to run: --checks, else the list of checks shown to the user, else every check the monitoring config does not turn off
  private async selectChecks(checksFlag: string | undefined, config: any, agentMode: boolean): Promise<WhatWillBreakCheckKey[]> {
    if (checksFlag) {
      return parseWhatWillBreakChecks(checksFlag);
    }
    const defaultChecks = getDefaultWhatWillBreakChecks(config);
    if (isCI || agentMode) {
      return defaultChecks;
    }
    const today = new Date();
    const checksRes = await prompts({
      type: 'multiselect',
      name: 'value',
      message: t('whatWillBreakSelectChecks'),
      description: t('whatWillBreakSelectChecksDescription'),
      choices: WHAT_WILL_BREAK_CHECKS.map((check) => ({
        title: `${getWhatWillBreakFamilyTitle(check.family)}: ${getWhatWillBreakCheckTitle(check.key)}`,
        description: getDeadlineLabel(check.key, false, today),
        value: check.key,
      })),
      initial: defaultChecks,
    });
    const selected: WhatWillBreakCheckKey[] = checksRes.value || [];
    uxLog('action', this, c.cyan(t('whatWillBreakChecksSelected', { count: selected.length })));
    return WHAT_WILL_BREAK_CHECK_KEYS.filter((key) => selected.includes(key));
  }
}
