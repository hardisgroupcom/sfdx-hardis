/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { CONSTANTS } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  buildUsageEntitlementMetrics,
  buildUsageEntitlementRow,
  formatUsageEntitlementLine,
  logUsageEntitlementSummary,
  queryUsageEntitlements,
  resolveUsageEntitlementsConfig,
  sortUsageEntitlementRows,
  UsageEntitlementRow,
} from '../../../../common/utils/usageEntitlementsUtils.js';
import { formatCost, resolveUsageCostConfig, sumEstimatedCosts } from '../../../../common/utils/usageCostUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUsageEntitlements extends SfCommand<any> {
  public static title = 'Check usage-based entitlements';

  public static description = `
## Command Behavior

**Monitors Salesforce usage-based entitlements and warns when consumption is on track to exceed the allowance before the period ends.**

Usage-based entitlements are the consumption meters Salesforce bills on: Einstein Requests, Flex Credits, Data 360 credits, Salesforce Messaging, monthly API calls, Experience Cloud logins, storage add-ons, and whatever else the org purchased. They are visible in Setup > Company Information > Usage-Based Entitlements. This is a different concern from \`sf hardis:org:monitor:limits\`, which tracks daily and hourly throttling limits.

Key functionalities:

- **Entitlement Retrieval:** Queries every usage-based entitlement declared on the org.
- **Period Derivation:** Salesforce rarely populates an end date, so the current billing window is derived from the entitlement start date and its frequency (daily, weekly, fortnightly, monthly, quarterly, yearly).
- **Consumption Projection:** Compares the share of the allowance consumed against the share of the period elapsed, and projects consumption at period end. A resource at 60% consumption when only 30% of the period has passed projects to 200%, and is flagged even though a flat percentage rule would stay silent.
- **Threshold-Based Alerting:** Warns above 120% projected consumption and errors above 150%, both configurable. Flat consumption thresholds act as a floor so a nearly exhausted allowance still alerts late in the period.
- **Already-Exceeded Detection:** An allowance consumed past 100% is reported as critical and listed separately from the forecasts. Everything below that level is a prediction; above it the allowance is already spent and overage is accruing.
- **Per-Resource Configuration:** Thresholds can be tightened, loosened or muted per resource in \`.sfdx-hardis.yml\`.
- **CSV Report Generation:** Produces a report with consumption, allowance, period boundaries, elapsed share, projection and severity for every entitlement.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) summarizing entitlements at risk.

Resources for which Salesforce reports no consumption data are listed in the report but never alert, and never emit metrics.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-usage-entitlements/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query:** Reads \`TenantUsageEntitlement\`. The query deliberately omits \`ORDER BY\`: \`MasterLabel\` is neither sortable nor filterable and Salesforce rejects such queries. Sorting happens client-side once projections are computed.
- **Resource Identity:** \`ResourceGroupKey\` is the constant \`(tenant)\` on every row and cannot identify a resource, so the \`Setting\` field (for example \`setting/force.com/orgValue.MaxCdpProfiles\`) is used as the stable key. Its trailing token is accepted as a shorthand in configuration.
- **Period Arithmetic:** Windows are rolled forward from \`StartDate\` in UTC using calendar-month arithmetic for monthly, quarterly and yearly frequencies, with clamping to the last day of shorter months.
- **Projection Guards:** A projection is only computed once at least 5% of the period has elapsed and at least 10% of the allowance is consumed, so early-period noise cannot raise false alarms.
- **Configuration Resolution:** Reads the \`usageEntitlements\` block via \`getConfig\`, then lets \`USAGE_PROJECTION_THRESHOLD_WARNING\`, \`USAGE_PROJECTION_THRESHOLD_ERROR\`, \`LIMIT_THRESHOLD_WARNING\` and \`LIMIT_THRESHOLD_ERROR\` environment variables override it.
- **Metrics:** Emits per-resource consumption and projection metrics prefixed with \`UsageEnt_\`, plus counts of entitlements at risk, metered and total.
- **Exit Code Management:** Sets the process exit code to 1 when any entitlement is in an error state.
</details>


### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:usage-entitlements --agent --target-org myorg@example.com
\`\`\`

In agent mode, the command runs fully automatically with no interactive prompts.`;

  public static examples = [
    '$ sf hardis:org:diagnose:usage-entitlements',
    '$ sf hardis:org:diagnose:usage-entitlements --agent',
  ];

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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation. Uses default values and skips prompts.',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = true;

  protected static triggerNotification = true;

  protected entitlementRows: UsageEntitlementRow[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUsageEntitlements);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    const conn = flags['target-org'].getConnection();

    uxLog('action', this, c.cyan(t('checkingUsageBasedEntitlements')));
    const config = await resolveUsageEntitlementsConfig();
    const costConfig = await resolveUsageCostConfig();
    const records = await queryUsageEntitlements(conn);

    const now = new Date();
    this.entitlementRows = sortUsageEntitlementRows(
      records.map((record: any) => buildUsageEntitlementRow(record, config, now, costConfig))
    );

    uxLogTable(this, this.entitlementRows);
    logUsageEntitlementSummary(this, this.entitlementRows);

    this.outputFile = await generateReportPath('usage-entitlements', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.entitlementRows, this.outputFile, {
      fileTitle: 'Usage-Based Entitlements',
    });

    // "Already over the allowance" is a different message from "on track to exceed it": the
    // first is money being spent right now, the second is a forecast. Real orgs carry both at
    // once, so they are reported as separate blocks rather than merged into one count.
    const overRows = this.entitlementRows.filter((row) => row.severity === 'critical');
    const errorRows = this.entitlementRows.filter((row) => row.severity === 'error');
    const warningRows = this.entitlementRows.filter((row) => row.severity === 'warning');

    const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No usage-based entitlement is at risk in ${orgMarkdown}`;
    const notifAttachments: MessageAttachment[] = [];

    if (overRows.length > 0) {
      notifAttachments.push({
        text: `**Allowance already exceeded**\n${overRows.map(formatUsageEntitlementLine).join('\n')}`,
      });
    }
    if (errorRows.length > 0 || warningRows.length > 0) {
      const forecastRows = [...errorRows, ...warningRows];
      notifAttachments.push({
        text: `**On track to exceed the allowance**\n${forecastRows.map(formatUsageEntitlementLine).join('\n')}`,
      });
    }

    // Cost is reporting only: severity keeps coming from what Salesforce reports, never from
    // rates typed into a config file, so a stale rate can neither invent nor mute an alert.
    const estimatedCost = sumEstimatedCosts(this.entitlementRows.map((row) => row.estimatedCost));
    const costSuffix =
      estimatedCost !== null
        ? `. Estimated overage: **${formatCost(estimatedCost, costConfig)}**`
        : '';

    if (overRows.length > 0) {
      notifSeverity = 'critical';
      notifText = `**${overRows.length}** usage-based entitlement(s) already exceed their allowance in ${orgMarkdown}`;
      if (errorRows.length + warningRows.length > 0) {
        notifText += ` (**${errorRows.length + warningRows.length}** more on track to)`;
      }
      notifText += costSuffix;
      uxLog('error', this, c.red(notifText));
      process.exitCode = 1;
    } else if (errorRows.length > 0) {
      notifSeverity = 'error';
      notifText = `Usage-based entitlements are projected to be exceeded in ${orgMarkdown} (error: **${errorRows.length}**, warning: **${warningRows.length}**)${costSuffix}`;
      uxLog('error', this, c.red(notifText));
      process.exitCode = 1;
    } else if (warningRows.length > 0) {
      notifSeverity = 'warning';
      notifText = `Usage-based entitlements are consumed faster than expected in ${orgMarkdown} (**${warningRows.length}**)${costSuffix}`;
      uxLog('warning', this, c.yellow(notifText));
    } else {
      uxLog('success', this, c.green(t('noUsageEntitlementAtRisk')));
    }

    const entitlementsMap = {};
    for (const row of this.entitlementRows) {
      entitlementsMap[row.settingKey] = row;
    }

    await setConnectionVariables(conn); // Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'USAGE_ENTITLEMENTS',
      text: notifText,
      buttons: notifButtons,
      attachments: notifAttachments,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.entitlementRows,
      data: {
        metric: overRows.length + errorRows.length + warningRows.length,
        entitlements: entitlementsMap,
      },
      metrics: buildUsageEntitlementMetrics(this.entitlementRows),
    });

    return {
      outputString: 'Usage-based entitlements check on org ' + conn.instanceUrl,
      entitlementRows: this.entitlementRows,
    };
  }
}
