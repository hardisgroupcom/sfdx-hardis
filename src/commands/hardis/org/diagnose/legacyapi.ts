/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { CONSTANTS } from '../../../../config/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { LEGACY_API_ARTICLE_URL, LegacyApiCallsCollector } from '../../../../common/utils/legacyApiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class LegacyApi extends SfCommand<any> {
  public static title = 'Check for legacy API use';

  public static description = `## DEPRECATED

This command is deprecated: use [hardis:org:diagnose:what-will-break](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/what-will-break/), which checks the legacy API calls together with everything else that will break after a dated Salesforce change.

Checks if an org uses retired or someday retired API version\n

See article below

[![Handle Salesforce API versions Deprecation like a pro](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deprecated-api.jpg)](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-deprecated-api-calls/) and can output Grafana, Slack and MsTeams Notifications.


### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:legacyapi --agent --target-org myorg@example.com
\`\`\`

In agent mode, the command runs fully automatically with no interactive prompts.`;

  public static examples = [
    '$ sf hardis:org:diagnose:legacyapi',
    '$ sf hardis:org:diagnose:legacyapi -u hardis@myclient.com',
    "$ sf hardis:org:diagnose:legacyapi --outputfile 'c:/path/to/folder/legacyapi.csv'",
    '$ sf hardis:org:diagnose:legacyapi -u hardis@myclient.com --outputfile ./tmp/legacyapi.csv',
    '$ sf hardis:org:diagnose:legacyapi --agent',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    eventtype: Flags.string({
      char: 'e',
      default: 'ApiTotalUsage',
      description: 'Type of EventLogFile event to analyze',
    }),
    limit: Flags.integer({
      char: 'l',
      default: 999,
      description: 'Number of latest EventLogFile events to analyze',
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

  public static requiresProject = false;

  protected debugMode = false;
  protected articleTextLegacyApi = `See article to solve issue before it's too late: ${LEGACY_API_ARTICLE_URL}`;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    uxLog("warning", this, c.yellow(t('whatWillBreakDeprecatedCommand', { command: 'sf hardis:org:diagnose:what-will-break' })));
    const { flags } = await this.parse(LegacyApi);
    this.debugMode = flags.debug || false;
    return await this.runJsForce(flags);
  }

  private async runJsForce(flags) {
    const conn = flags['target-org'].getConnection();

    // Collect legacy api calls from EventLogFile records
    let msg = t('noDeprecatedApiCallFound');
    let statusCode = 0;
    const collector = new LegacyApiCallsCollector({
      conn: conn,
      eventType: flags.eventtype || 'ApiTotalUsage',
      limit: flags.limit || 999,
      outputFile: flags.outputfile || null,
      debugMode: this.debugMode,
      commandThis: this,
      mainReport: true,
      // Build command result before the report files are written, to keep the same output order
      onAnalysisComplete: (descriptors) => {
        const hasBlockingErrors = descriptors.some(
          (descriptorResult) => descriptorResult.descriptor.severity === 'ERROR' && descriptorResult.totalErrors > 0
        );
        const hasWarningsOnly = descriptors.some(
          (descriptorResult) => descriptorResult.descriptor.severity === 'WARNING' && descriptorResult.totalErrors > 0
        );
        if (hasBlockingErrors) {
          msg = t('foundLegacyApiCallsInLogs');
          statusCode = 1;
          uxLog("error", this, c.red(c.bold(msg)));
        } else if (hasWarningsOnly) {
          msg = t('foundDeprecatedApiCallsFuture');
          statusCode = 0;
          uxLog("warning", this, c.yellow(c.bold(msg)));
        } else {
          uxLog("success", this, c.green(msg));
        }
      },
    });
    const result = await collector.collect();

    let notifDetailText = '';
    for (const descriptorResult of result.descriptors) {
      if (descriptorResult.totalErrors > 0) {
        notifDetailText += `- **${descriptorResult.descriptor.severity}**: API version calls found in logs: **${descriptorResult.totalErrors}** (${descriptorResult.descriptor.deprecationRelease})\n`;
      }
    }

    notifDetailText += "\n" + this.articleTextLegacyApi;
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(LEGACY_API_ARTICLE_URL, t('articleEn'), 'docUrl');
    }
    if (result.notificationSampleTruncated) {
      notifDetailText += `
  Only the first ${result.notificationSampleLimit} log entries are attached to this notification.`;
    }

    // Build notifications
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const totalErrorsFound = result.totalErrors;
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No deprecated Salesforce API versions are used in ${orgMarkdown}`;
    if (totalErrorsFound > 0) {
      notifSeverity = 'error';
      notifText = `**${totalErrorsFound}** deprecated Salesforce API versions are used in ${orgMarkdown}`;
    }
    // Last api clients XLSX file generated, as before the extraction of the collector
    const lastApiClientsXlsxFile = [...result.apiClientsFiles].reverse().find((apiClientsFile) => apiClientsFile.xlsxFile)?.xlsxFile;
    // Post notifications
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'LEGACY_API',
      text: notifText,
      attachments: [{ text: notifDetailText }],
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: result.xlsxFile ? [result.xlsxFile, lastApiClientsXlsxFile as string] : [],
      logElements: result.notificationSample,
      data: {
        metric: totalErrorsFound,
        legacyApiSummary: result.ipResults,
      },
      metrics: {
        LegacyApiCalls: totalErrorsFound,
      },
    });
    uxLog("log", this, c.grey(notifDetailText));

    if ((this.argv || []).includes('legacyapi')) {
      process.exitCode = statusCode;
    }

    // Return an object to be displayed with --json
    return {
      status: statusCode,
      message: msg,
      csvLogFile: result.outputFile,
      outputFileIps: result.outputFileIps,
      legacyApiResults: result.descriptorStates,
    };
  }
}
