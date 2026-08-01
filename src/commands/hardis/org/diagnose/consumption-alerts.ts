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
  buildConsumptionAlertMetrics,
  ConsumptionAlertRow,
  formatConsumptionAlertLine,
  queryConsumptionAlerts,
  resolveAlertsSeverity,
} from '../../../../common/utils/consumptionAlertsUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseConsumptionAlerts extends SfCommand<any> {
  public static title = 'Check consumption utilization alerts';

  public static description = `
## Command Behavior

**Reports the consumption and license utilization alerts that Salesforce itself raised on the org.**

Salesforce raises utilization alerts when consumption of a billed product approaches or crosses a threshold, and when license usage nears its entitlement. These are the same alerts surfaced in Digital Wallet. Because Digital Wallet has no public API, this object is the only programmatic way to read them.

Key functionalities:

- **Active Alert Retrieval:** Lists every alert currently in an active state, most recent first.
- **Severity Assignment:** Any active alert raises a warning. An alert whose trigger value reached the full allowance raises an error.
- **CSV Report Generation:** Produces a report with the alert type, scope, trigger value, trigger type and timestamp.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) summarizing the active alerts.

Orgs whose edition does not expose utilization alerts are skipped silently, so the monitoring run never fails because of them.

This command complements \`sf hardis:org:diagnose:usage-entitlements\`: that command projects consumption from raw meters, while this one reports what Salesforce already decided was worth flagging.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-consumption-alerts/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query:** Reads \`TenantConsumptionAlert\` (labelled "Utilization Alert") filtered on active alerts and ordered by alert timestamp descending.
- **Graceful Degradation:** Catches the unsupported-object error so orgs without the object skip with a log-level message and exit code 0, rather than failing the monitoring run.
- **Severity Rule:** Alerts with a trigger value at or above 100 are treated as a breach of the full allowance and raise an error; any other active alert raises a warning.
- **Metrics:** Emits counts of active and critical alerts.
- **Exit Code Management:** Sets the process exit code to 1 when at least one alert is in an error state.
</details>


### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:consumption-alerts --agent --target-org myorg@example.com
\`\`\`

In agent mode, the command runs fully automatically with no interactive prompts.`;

  public static examples = [
    '$ sf hardis:org:diagnose:consumption-alerts',
    '$ sf hardis:org:diagnose:consumption-alerts --agent',
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

  protected alerts: ConsumptionAlertRow[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseConsumptionAlerts);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    const conn = flags['target-org'].getConnection();

    uxLog('action', this, c.cyan(t('checkingConsumptionUtilizationAlerts')));
    const queryResult = await queryConsumptionAlerts(conn);

    if (!queryResult.supported) {
      uxLog('log', this, c.grey(queryResult.reason || 'Utilization alerts are not available on this org'));
      return { outputString: 'Utilization alerts not available on org ' + conn.instanceUrl, alerts: [] };
    }

    this.alerts = queryResult.alerts;
    uxLogTable(this, this.alerts);

    this.outputFile = await generateReportPath('consumption-alerts', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.alerts, this.outputFile, {
      fileTitle: 'Consumption Utilization Alerts',
    });

    const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifSeverity: NotifSeverity = resolveAlertsSeverity(this.alerts);
    const notifAttachments: MessageAttachment[] = [];
    let notifText = `No active consumption alert in ${orgMarkdown}`;

    if (this.alerts.length > 0) {
      const criticalCount = this.alerts.filter((alert) => alert.severity === 'error').length;
      notifText = `Salesforce raised **${this.alerts.length}** consumption alert(s) in ${orgMarkdown}`;
      const alertsText = `**Active utilization alerts**\n${this.alerts.map(formatConsumptionAlertLine).join('\n')}`;
      notifAttachments.push({ text: alertsText });
      if (notifSeverity === 'error') {
        uxLog('error', this, c.red(notifText + '\n' + alertsText));
        process.exitCode = 1;
      } else {
        uxLog('warning', this, c.yellow(notifText + '\n' + alertsText));
      }
      if (criticalCount > 0) {
        notifText += ` (allowance reached: **${criticalCount}**)`;
      }
    } else {
      uxLog('success', this, c.green(t('noActiveConsumptionAlert')));
    }

    await setConnectionVariables(conn); // Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'CONSUMPTION_ALERTS',
      text: notifText,
      buttons: notifButtons,
      attachments: notifAttachments,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.alerts,
      data: { metric: this.alerts.length },
      metrics: buildConsumptionAlertMetrics(this.alerts),
    });

    return {
      outputString: 'Consumption alerts check on org ' + conn.instanceUrl,
      alerts: this.alerts,
    };
  }
}
