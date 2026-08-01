/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { resolveDateFilterOptions } from '../../../../common/utils/agentforceQueryUtils.js';
import {
  AiUsageResult,
  buildAiUsageMetrics,
  collectAiUsage,
  formatAiUsageLine,
} from '../../../../common/utils/aiUsageUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseAiUsage extends SfCommand<any> {
  public static title = 'Check Agentforce and Data 360 credit usage';

  public static description = `
## Command Behavior

**Breaks down Agentforce and Data 360 credit consumption by agent and action.**

Agentforce actions and Data 360 operations are billed in Flex Credits. This command reads the consumption models Salesforce publishes in Data 360 and reports where the credits went, so a runaway agent or an expensive action shows up before the invoice does.

Key functionalities:

- **Consumption Breakdown:** Aggregates credits consumed and event counts per agent, action, usage type and metered flag.
- **Data 360 Credits:** Reports Data 360 credit consumption alongside Agentforce usage.
- **Date Windowing:** Restricts the analysis to a recent period, 30 days by default.
- **CSV Report Generation:** Produces a report of the aggregated consumption rows.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with the credit totals and the top consumers.

**This command requires Data 360 (Data Cloud) with an Agentforce or Data 360 consumption model provisioned.** On any other org it logs why it cannot run, sends no notification, and exits successfully, so it is safe to schedule across a whole fleet.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-ai-usage/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Availability Probe:** Lists Data 360 data model objects before querying anything. Two distinct skip paths are handled: Data Cloud not provisioned on the org, and Data Cloud provisioned without any consumption model. Neither is treated as a failure.
- **Model Discovery:** Consumption model names ship with a paid SKU and are not hardcoded. Known names are matched against the live listing first, then a name pattern is used as a fallback so a Salesforce rename does not silently break the command.
- **Column Discovery:** Columns are read from the schema the Data 360 query API returns rather than assumed, then mapped onto the roles the report needs (agent, action, credits, metered flag, usage type, timestamp).
- **Graceful Aggregation:** When no credits column can be identified, the command returns raw rows instead of inventing an aggregation.
- **Metrics:** Emits total, metered and unmetered credit totals, action counts and Data 360 credit totals. Per-agent detail stays in the report and notification body, never in metric labels.
</details>


### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:ai-usage --agent --target-org myorg@example.com
\`\`\`

In agent mode, the command runs fully automatically with no interactive prompts. The analysis window defaults to the last 30 days unless \`--days\` is provided.`;

  public static examples = [
    '$ sf hardis:org:diagnose:ai-usage',
    '$ sf hardis:org:diagnose:ai-usage --days 7',
    '$ sf hardis:org:diagnose:ai-usage --agent',
  ];

  public static flags: any = {
    days: Flags.integer({
      default: 30,
      description: 'Number of days to analyze',
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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation. Uses default values and skips prompts.',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = true;

  protected static triggerNotification = true;

  protected usageResult: AiUsageResult | null = null;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseAiUsage);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    const conn = flags['target-org'].getConnection();

    uxLog('action', this, c.cyan(t('checkingAgentforceCreditUsage')));
    const filters = resolveDateFilterOptions({ lastNDaysInput: flags.days });
    this.usageResult = await collectAiUsage(conn, filters);

    // Most orgs have no Data 360 consumption model: skip quietly instead of failing the run.
    if (!this.usageResult.available) {
      uxLog('log', this, c.grey(this.usageResult.reason || 'Data 360 credit usage is not available on this org'));
      return { outputString: 'AI usage not available on org ' + conn.instanceUrl, aiRows: [] };
    }

    if (this.usageResult.degraded) {
      uxLog('warning', this, c.yellow(t('aiUsageCreditColumnNotIdentified')));
    }

    // Say it out loud when the detail listing is capped: the totals stay exact, but the
    // per-agent breakdown below is not the whole picture.
    if (this.usageResult.truncatedRows) {
      uxLog(
        'warning',
        this,
        c.yellow(t('aiUsageDetailRowsTruncated', { count: this.usageResult.truncatedRows }))
      );
    }

    uxLogTable(this, this.usageResult.aiRows);

    this.outputFile = await generateReportPath('ai-usage', this.outputFile);
    const reportRows = this.usageResult.aiRows.length
      ? this.usageResult.aiRows
      : this.usageResult.dataCreditRows;
    this.outputFilesRes = await generateCsvFile(reportRows, this.outputFile, {
      fileTitle: 'Agentforce and Data 360 Credit Usage',
    });

    const metrics = buildAiUsageMetrics(this.usageResult);
    const creditsThreshold = Number(getEnvVar('AI_USAGE_CREDITS_THRESHOLD') || 0);
    const totalCredits = metrics.AiUsageCreditsTotal + metrics.DataCloudCreditsTotal;

    const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifAttachments: MessageAttachment[] = [];
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `**${totalCredits}** credits consumed over the last ${flags.days} days in ${orgMarkdown}`;

    const topConsumers = this.usageResult.aiRows.slice(0, 10);
    if (topConsumers.length > 0) {
      notifAttachments.push({
        text: `**Top consumers**\n${topConsumers.map(formatAiUsageLine).join('\n')}`,
      });
    }

    if (creditsThreshold > 0 && totalCredits > creditsThreshold) {
      notifSeverity = 'warning';
      notifText = `Credit consumption exceeded the configured threshold in ${orgMarkdown}: **${totalCredits}** credits over the last ${flags.days} days (threshold: **${creditsThreshold}**)`;
      uxLog('warning', this, c.yellow(notifText));
    } else {
      uxLog('success', this, c.green(notifText));
    }

    await setConnectionVariables(conn); // Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'AI_USAGE',
      text: notifText,
      buttons: notifButtons,
      attachments: notifAttachments,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: reportRows,
      data: {
        metric: totalCredits,
        aiModel: this.usageResult.aiModel,
        dataCreditModel: this.usageResult.dataCreditModel,
      },
      metrics: metrics,
    });

    return {
      outputString: 'Agentforce and Data 360 credit usage check on org ' + conn.instanceUrl,
      aiRows: this.usageResult.aiRows,
    };
  }
}
