/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execSfdxJson, uxLog } from '../../../../common/utils/index.js';
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MonitorLimits extends SfCommand<any> {
  public static title = 'Check org limits';

  public static description = `Check limits of a SF org and send notifications about limits are superior to 50%, 75% or 100%.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-org-limits/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = ['$ sf hardis:org:monitor:limits'];

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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  protected limitThresholdWarning = Number(getEnvVar('LIMIT_THRESHOLD_WARNING') || 50.0);
  protected limitThresholdError = Number(getEnvVar('LIMIT_THRESHOLD_WARNING') || 75.0);

  protected limitEntries: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MonitorLimits);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // List org limits
    uxLog(this, c.cyan(`Run the org limits list command ...`));
    const limitsCommandRes = await execSfdxJson(`sf org limits list`, this, {
      fail: true,
      output: true,
      debug: this.debugMode,
    });
    this.limitEntries = limitsCommandRes.result
      .filter((limit) => limit?.max > 0)
      .map((limit) => {
        limit.used = limit.max - limit.remaining;
        if (limit.max && limit.max > 0) {
          limit.percentUsed = parseFloat(((100 / limit.max) * limit.used).toFixed(2));
        } else {
          limit.percentUsed = 0.0;
        }
        limit.severity =
          limit.percentUsed > this.limitThresholdError
            ? 'error'
            : limit.percentUsed > this.limitThresholdWarning
              ? 'warning'
              : 'success';
        limit.severityIcon = getSeverityIcon(limit.severity);
        limit.label = limit.name.replace(/([A-Z])/g, ' $1');
        return limit;
      });

    console.table(this.limitEntries);

    this.outputFile = await generateReportPath('org-limits', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.limitEntries, this.outputFile);

    const limitsError = this.limitEntries.filter((limit) => limit.severity === 'error');
    const numberLimitsError = limitsError.length;
    const limitsWarning = this.limitEntries.filter((limit) => limit.severity === 'warning');
    const numberLimitsWarning = limitsWarning.length;

    // Build notifications
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No limit issues detected in ${orgMarkdown}`;
    const notifAttachments: MessageAttachment[] = [];

    // Dangerous limits has been found
    if (numberLimitsError > 0) {
      notifSeverity = 'error';
      notifText = `Limit severe alerts have been detected in ${orgMarkdown} (error: ${numberLimitsError}, warning: ${numberLimitsWarning})`;
      const errorText = `*Error Limits*\n${limitsError
        .map((limit) => {
          return `• ${limit.name}: *${limit.percentUsed}%* used (${limit.used}/${limit.max})`;
        })
        .join('\n')}`;
      notifAttachments.push({
        text: errorText,
      });
      uxLog(this, c.red(notifText + '\n' + errorText));
      process.exitCode = 1;
    }
    // Warning limits detected
    else if (numberLimitsWarning > 0) {
      notifSeverity = 'warning';
      notifText = `Limit warning alerts have been detected in ${orgMarkdown} (${numberLimitsWarning})`;
      const warningText = `*Warning Limits*\n${limitsWarning
        .map((limit) => {
          return `• ${limit.name}: *${limit.percentUsed}%* used (${limit.used}/${limit.max})`;
        })
        .join('\n')}`;
      notifAttachments.push({
        text: warningText,
      });
      uxLog(this, c.yellow(notifText + '\n' + warningText));
    } else {
      uxLog(this, c.green('No limit issue has been found'));
    }

    const limitEntriesMap = {};
    const limitMetricsMap = {};
    for (const limit of this.limitEntries) {
      limitEntriesMap[limit.name] = limit;
      limitMetricsMap[limit.name] = {
        value: limit.used,
        max: limit.max,
        percent: limit.percentUsed,
      };
    }

    // Post notifications
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'ORG_LIMITS',
      text: notifText,
      buttons: notifButtons,
      attachments: notifAttachments,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.limitEntries,
      data: { metric: numberLimitsWarning + numberLimitsError, limits: limitEntriesMap },
      metrics: limitMetricsMap,
    });

    return {
      outputString: 'Limits check on org ' + flags['target-org'].getConnection().instanceUrl,
      limitEntries: this.limitEntries,
    };
  }
}
