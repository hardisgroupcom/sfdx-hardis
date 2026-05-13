/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { CONSTANTS, getConfig, getEnvVar } from '../../../../config/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { AiProvider } from '../../../../common/aiProvider/index.js';
import { collectMonitoringNotifications } from '../../../../common/notifProvider/monitoringNotifWriter.js';
import { NotifProvider } from '../../../../common/notifProvider/index.js';
import { generateMonitoringAiSummary } from '../../../../common/utils/monitoringSummary.js';
import { generateMonitoringPptxReport } from '../../../../common/utils/monitoringPptxReport.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { resolveMonitoringCommands, shouldRunCommandNow } from '../../../../common/notifProvider/notificationConfig.js';
import type { MonitoringCommandEntry } from '../../../../common/notifProvider/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MonitorAll extends SfCommand<any> {
  public static title = 'Monitor org';

  public static monitoringCommandsDefault: MonitoringCommandEntry[] = [
    {
      key: 'AUDIT_TRAIL',
      title: 'Detect suspect setup actions in major org',
      command: 'sf hardis:org:diagnose:audittrail',
      frequency: 'daily',
    },
    {
      key: 'LEGACY_API',
      title: 'Detect calls to deprecated API versions',
      command: 'sf hardis:org:diagnose:legacyapi',
      frequency: 'daily',
    },
    {
      key: 'ORG_LIMITS',
      title: 'Detect if org limits are close to be reached',
      command: 'sf hardis:org:monitor:limits',
      frequency: 'daily',
    },
    {
      key: 'APEX_FLEX_QUEUE',
      title: 'Detect Apex flex queue backlog (AsyncApexJob Holding)',
      command: 'sf hardis:org:diagnose:flex-queue',
      frequency: 'daily',
    },
    {
      key: 'APEX_FLOW_ERRORS',
      title: 'Detect Apex and Flow errors',
      command: 'sf hardis:org:monitor:errors',
      frequency: 'daily',
    },
    {
      key: 'UNSECURED_CONNECTED_APPS',
      title: 'Detect unsecured Connected Apps in an org',
      command: 'sf hardis:org:diagnose:unsecure-connected-apps',
      frequency: 'daily',
    },
    {
      key: 'DEPLOYMENTS',
      title: 'Analyze metadata deployments and validations',
      command: 'sf hardis:org:diagnose:deployments --period weekly',
      frequency: 'daily',
    },
    {
      key: 'LICENSES',
      title: 'Extract licenses information',
      command: 'sf hardis:org:diagnose:licenses',
      frequency: 'weekly',
    },
    {
      key: 'LINT_ACCESS',
      title: 'Detect custom elements with no access rights defined in permission sets',
      command: 'sf hardis:lint:access',
      frequency: 'weekly',
    },
    {
      key: 'UNUSED_LICENSES',
      title: 'Detect permission set licenses that are assigned to users that do not need them',
      command: 'sf hardis:org:diagnose:unusedlicenses',
      frequency: 'weekly',
    },
    {
      key: 'UNUSED_USERS',
      title: 'Detect active users without recent logins (All licenses, 6 months)',
      command: 'sf hardis:org:diagnose:unusedusers --licensetypes all --days 180',
      frequency: 'weekly',
    },
    {
      key: 'UNUSED_USERS_CRM_6_MONTHS',
      title: 'Detect active users without recent logins (CRM, 6 months)',
      command: 'sf hardis:org:diagnose:unusedusers --licensetypes all-crm --days 180',
      frequency: 'weekly',
    },
    {
      key: 'UNUSED_USERS_EXPERIENCE_6_MONTHS',
      title: 'Detect active users without recent logins (Experience, 6 months)',
      command: 'sf hardis:org:diagnose:unusedusers --licensetypes experience --days 180',
      frequency: 'weekly',
    },
    {
      key: 'ACTIVE_USERS_CRM_WEEKLY',
      title: 'Detect active users with recent logins (CRM, 1 week)',
      command: 'sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes all-crm --days 7',
      frequency: 'weekly',
    },
    {
      key: 'ACTIVE_USERS_EXPERIENCE_MONTHLY',
      title: 'Detect active users with recent logins (Experience, 1 month)',
      command: 'sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes experience --days 30',
      frequency: 'weekly',
    },
    {
      key: 'ORG_INFO',
      title: 'Get org info + SF instance info + next major upgrade date',
      command: 'sf hardis:org:diagnose:instanceupgrade',
      frequency: 'weekly',
    },
    {
      key: 'RELEASE_UPDATES',
      title: 'Gather warnings about incoming and overdue Release Updates',
      command: 'sf hardis:org:diagnose:releaseupdates',
      frequency: 'weekly',
    },
    {
      key: 'ORG_HEALTH_CHECK',
      title: 'Run Salesforce Security Health Check',
      command: 'sf hardis:org:monitor:health-check',
      frequency: 'weekly',
    },
    {
      key: 'UNUSED_METADATAS',
      title: 'Detect custom labels and custom permissions that are not in use',
      command: 'sf hardis:lint:unusedmetadatas',
      frequency: 'weekly',
    },
    {
      key: 'UNUSED_APEX_CLASSES',
      title: 'Detect unused Apex classes in an org',
      command: 'sf hardis:org:diagnose:unused-apex-classes',
      frequency: 'weekly',
    },
    {
      key: 'APEX_API_VERSION',
      title: 'Detect Apex classes and triggers with deprecated API version',
      command: 'sf hardis:org:diagnose:apex-api-version',
      frequency: 'weekly',
    },
    {
      key: 'CONNECTED_APPS',
      title: 'Detect unused Connected Apps in an org',
      command: 'sf hardis:org:diagnose:unused-connected-apps',
      frequency: 'weekly',
    },
    {
      key: 'METADATA_STATUS',
      title: 'Detect inactive metadata',
      command: 'sf hardis:lint:metadatastatus',
      frequency: 'weekly',
    },
    {
      key: 'MISSING_ATTRIBUTES',
      title: 'Detect missing description on custom field',
      command: 'sf hardis:lint:missingattributes',
      frequency: 'weekly',
    },
    {
      key: 'UNDERUSED_PERMSETS',
      title: 'Detect underused permission sets',
      command: 'sf hardis:org:diagnose:underusedpermsets',
      frequency: 'weekly',
    },
    {
      key: 'MINIMAL_PERMSETS',
      title: 'Detect permission sets with minimal permissions in project',
      command: 'sf hardis:org:diagnose:minimalpermsets',
      frequency: 'weekly',
    },
  ];

  public static description = `Monitor org, generate reports and sends notifications

## Command Behavior

**Runs all monitoring commands on a Salesforce org, generates reports, and sends notifications.**

Key functionalities:

- **Monitoring commands:** Runs a [default list of monitoring commands](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/#monitoring-commands) (or custom ones defined in \`.sfdx-hardis.yml\`), each producing individual notifications.
- **Non-interactive execution:** Every monitoring sub-command is executed with \`--agent\`, enforcing non-interactive behavior (no user prompts).
- **AI-powered summary:** When an AI provider is configured, collects all monitoring notifications and generates a consolidated **executive summary** using AI, sent as a single notification.
- **Weekly PPTX report:** On weekly runs (Saturday by default, or when \`--force-all\` is passed, or when env var \`MONITORING_IGNORE_FREQUENCY=true\` is set), a **PowerPoint report** can be generated by a [coding agent](${CONSTANTS.DOC_URL_ROOT}/salesforce-deployment-agent-autofix/) (Claude, Codex, Gemini, or Copilot) and attached to the summary notification.
- **Report generation toggle (disabled by default):** Enable coding-agent PPTX generation with \`codingAgentGenerateReports: true\` or env var \`SFDX_HARDIS_CODING_AGENT_GENERATE_REPORTS=true\`. Requires \`codingAgent\` to be configured.
- **Frequency control:** Commands can run \`daily\`, \`weekly\`, \`biweekly\`, \`monthly\`, or \`off\`. Use \`frequencyDay\` (monday..sunday) to pick the firing day for weekly/biweekly, and \`frequencyDayOfMonth\` (1-31) for monthly. Use \`--force-all\` (or env var \`MONITORING_IGNORE_FREQUENCY=true\`) to force all commands to run regardless of their configured frequency.
- **Per-channel notification routing:** Each entry accepts a \`notifications\` block with severity thresholds per channel (\`messaging\`, \`email\`, \`api\`). User entries are merged by \`key\` onto the built-in defaults, so you can override only the fields you need.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/).

<details markdown="1">
<summary>Technical explanations</summary>

The command runs each monitoring sub-command sequentially with \`--agent\` and collects exit codes.

When an AI provider is available (\`AiProvider.isAiAvailable()\`), each sub-command's notifications are written to temporary JSON files via \`MONITORING_NOTIF_OUTPUT_DIR\`. After all commands complete, the notifications are collected, an AI summary is generated using the \`PROMPT_MONITORING_SUMMARY\` template, and a consolidated \`MONITORING_SUMMARY\` notification is sent.

On weekly runs, a PPTX report is generated by invoking a coding agent CLI with the \`PROMPT_MONITORING_PPTX_REPORT\` template. The agent writes a Node.js script using \`pptxgenjs\` to produce a structured 7-slide PowerPoint presentation. The PPTX file is attached to the summary notification.

Both prompt templates can be overridden by placing files in \`config/prompt-templates/\`.
</details>

You can enable coding-agent PPTX generation by defining **codingAgentGenerateReports: true** in \`.sfdx-hardis.yml\` or by setting env var **SFDX_HARDIS_CODING_AGENT_GENERATE_REPORTS=true**.

A [default list of monitoring commands](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/#monitoring-commands) is used. You can extend or override it via the **monitoringCommands** property in your .sfdx-hardis.yml file. User entries are **merged by key** onto the built-in defaults, so you can override one field (e.g. \`frequency\`) without redefining the whole entry. New keys are appended as custom commands. Set \`frequency: off\` on an entry to skip it entirely.

Example (override built-in defaults + add a custom command + tune routing):

\`\`\`yaml
monitoringCommands:
  - key: AUDIT_TRAIL
    frequency: weekly
    frequencyDay: monday
    notifications:
      messaging: warning
      email:
        threshold: error
        recipients:
          - security@company.com
        replaceRecipients: true
      api: log
  - key: LICENSES
    frequency: monthly
    frequencyDayOfMonth: 1
  - key: ORG_LIMITS
    frequency: off
  - key: MY_CUSTOM_REPORT
    title: My Custom command
    command: sf my:custom:command
    frequency: biweekly
\`\`\`

You can force a run of all commands regardless of their configured frequency by passing \`--force-all\` (or by setting env var \`MONITORING_IGNORE_FREQUENCY=true\`).

The default list of commands is the following:

${this.getDefaultCommandsMarkdown()}

`;

  public static examples = [
    '$ sf hardis:org:monitor:all',
    '$ sf hardis:org:monitor:all --target-org myorg@example.com',
    '$ sf hardis:org:monitor:all --force-all --agent',
    '$ sf hardis:org:monitor:all --target-org myorg@example.com --debug',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'force-all': Flags.boolean({
      default: false,
      description: 'Force all monitoring commands to run, regardless of their configured frequency',
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

  protected debugMode = false;

  /* jscpd:ignore-end */

  public static getDefaultCommandsMarkdown() {
    const mdLines = [
      "| Key | Description | Command | Frequency |",
      "| :---: | :---- | :---- | :-----: |",

    ];
    for (const cmd of MonitorAll.monitoringCommandsDefault) {
      if (!cmd.command) {
        continue;
      }
      const commandDocUrl = `${CONSTANTS.DOC_URL_ROOT}/${cmd.command.split(" ")[1].replaceAll(":", "/")}`;
      mdLines.push(`| [${cmd.key}](${commandDocUrl}) | ${cmd.title} | [${cmd.command}](${commandDocUrl}) | ${cmd.frequency} |`);
    }
    return mdLines.join("\n");
  }

  private static formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    const seconds = Math.floor(ms / 1000);
    const remainder = ms % 1000;
    if (seconds < 60) {
      return remainder > 0 ? `${seconds}.${Math.floor(remainder / 100)}s` : `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MonitorAll);
    this.debugMode = flags.debug || false;
    const forceAll = flags['force-all'] || getEnvVar('MONITORING_IGNORE_FREQUENCY') === 'true';

    const orgUrl = flags['target-org'].getConnection().instanceUrl;
    await setConnectionVariables(flags['target-org']?.getConnection(), true);// Required for some notifications providers like Email

    uxLog(
      "action",
      this,
      c.cyan(t('runningMonitoringScriptsForOrg', { orgAlias: c.bold(orgUrl) }))
    );

    const config = await getConfig('user');
    const commands = resolveMonitoringCommands(MonitorAll.monitoringCommandsDefault, config.monitoringCommands);
    const monitoringDisable =
      config.monitoringDisable ?? (process.env?.MONITORING_DISABLE ? process.env.MONITORING_DISABLE.split(',') : []);
    const codingAgentGenerateReports =
      getEnvVar('SFDX_HARDIS_CODING_AGENT_GENERATE_REPORTS') === 'true' ? true :
        getEnvVar('SFDX_HARDIS_CODING_AGENT_GENERATE_REPORTS') === 'false' ? false :
          config.codingAgentGenerateReports ?? false;

    // Check if AI is available for notification collection and summary
    const aiAvailable = await AiProvider.isAiAvailable();
    const notifDir = path.resolve('hardis-report', 'monitoring-notifs');
    // Always set up notification directory to collect sub-command notifications
    // (needed for PPTX report generation, regardless of AI availability)
    await fs.ensureDir(notifDir);
    // Remove any stale notification files from previous runs
    await fs.emptyDir(notifDir);
    process.env.MONITORING_NOTIF_OUTPUT_DIR = notifDir;

    let success = true;
    const commandsSummary: any[] = [];
    for (const command of commands) {
      if (!command.command) {
        // Routing-only entry (no command to run) -- skip silently
        continue;
      }
      if (monitoringDisable.includes(command.key)) {
        uxLog("log", this, c.grey(t('skippedCommandAccordingToCustomConfiguration', { command: c.bold(command.key) })));
        continue;
      }
      if (!forceAll) {
        const evaluation = shouldRunCommandNow(command);
        if (!evaluation.shouldRun && evaluation.reasonKey) {
          uxLog("log", this, c.grey(t(evaluation.reasonKey, { command: c.bold(command.key) })));
          continue;
        }
      }
      // Run command
      let commandStr = /(^|\s)--agent(\s|$)/.test(command.command)
        ? command.command
        : `${command.command} --agent`;
      if (/^sf hardis/.test(commandStr) && !/(^|\s)--skipauth(\s|$)/.test(commandStr)) {
        commandStr = `${commandStr} --skipauth`;
      }
      uxLog("action", this, c.cyan(t('runningMonitoringCommandKey', { command: c.bold(command.title), command1: c.bold(command.key) })));
      const startTime = Date.now();
      try {
        const execCommandResult = await execCommand(commandStr, this, { fail: false, output: true });
        const duration = Date.now() - startTime;
        if (execCommandResult.status === 0) {
          uxLog("success", this, c.green(t('commandHasBeenRunSuccessfully', { command: c.bold(command.title) })));
        } else {
          success = false;
          uxLog("warning", this, c.yellow(t('commandHasFailed', { command: c.bold(command.title) })));
        }
        commandsSummary.push({
          title: command.title,
          status: execCommandResult.status === 0 ? 'success' : 'failure',
          command: command.command,
          duration: MonitorAll.formatDuration(duration),
        });
      } catch (e) {
        // Handle unexpected failure
        const duration = Date.now() - startTime;
        success = false;
        uxLog("warning", this, c.yellow(t('commandHasFailed2', { command: c.bold(command.title), as: (e as Error).message })));
        commandsSummary.push({
          title: command.title,
          status: 'error',
          command: command.command,
          duration: MonitorAll.formatDuration(duration),
        });
      }
    }

    uxLog("action", this, c.cyan(t('summaryOfMonitoringScripts')));
    uxLogTable(this, commandsSummary);
    uxLog("log", this, c.grey(t('youCanCheckDetailsInReportsIn')));

    uxLog(
      "warning",
      this,
      c.yellow(t('toKnowMoreAboutMonitoring'))
    );

    // Generate AI-powered summary and optional PPTX report
    // Collect monitoring notifications from sub-commands
    let notifications: any[] = [];
    try {
      notifications = await collectMonitoringNotifications(notifDir);
    } catch (e) {
      uxLog("warning", this, c.yellow(t('monitoringAiSummaryFailed', { message: (e as Error).message })));
    }

    // Generate AI summary if available and there are notifications
    let aiSummary: string | null = null;
    if (aiAvailable && notifications.length > 0) {
      try {
        aiSummary = await generateMonitoringAiSummary(notifications, orgUrl);
      } catch (summaryErr) {
        uxLog("warning", this, c.yellow(t('monitoringAiSummaryFailed', { message: (summaryErr as Error).message })));
      }
    }

    // Generate PPTX on the weekly cadence using a coding agent - regardless of AI availability
    const isWeekly = new Date().getDay() === 6 || forceAll;
    if (isWeekly && codingAgentGenerateReports) {
      // codingAgent PPTX generation still anchored on the original Saturday cadence (or --force-all);
      // per-command frequency changes (biweekly/monthly) only affect command execution, not this report.
      try {
        const reportDir = path.resolve(config.reportDirectory || 'hardis-report');
        await fs.ensureDir(reportDir);
        const pptxPath = await generateMonitoringPptxReport(notifications, aiSummary, orgUrl, reportDir);
        if (pptxPath) {
          uxLog("success", this, c.green(t('monitoringPptxReportGenerated', { path: pptxPath })));
          WebSocketClient.sendReportFileMessage(pptxPath, t('monitoringPptxReport', { path: pptxPath }), "report");
        }
      } catch (pptxErr) {
        uxLog("warning", this, c.yellow(t('monitoringPptxReportFailed', { message: (pptxErr as Error).message })));
      }
    }

    // Send consolidated summary notification if there are notifications
    if (aiAvailable && notifications.length > 0) {
      try {
        const summaryText = aiSummary
          ? `${t('monitoringAiSummaryNotifTitle', { orgUrl })}\n\n${aiSummary}`
          : t('monitoringAiSummaryNoNotifications');

        const summaryNotif: any = {
          text: summaryText,
          type: 'MONITORING_SUMMARY' as const,
          severity: 'info' as const,
          logElements: [],
          metrics: {},
          data: { notificationCount: notifications.length },
        };

        // Send consolidated summary notification
        await NotifProvider.postNotifications(summaryNotif);
      } catch (summaryErr) {
        uxLog("warning", this, c.yellow(t('monitoringAiSummaryFailed', { message: (summaryErr as Error).message })));
      }
    } else if (aiAvailable && notifications.length === 0) {
      uxLog("log", this, c.grey(t('monitoringAiSummaryNoNotifications')));
    }

    delete process.env.MONITORING_NOTIF_OUTPUT_DIR;

    // Exit code is 1 if monitoring detected stuff
    if (success === false) {
      process.exitCode = 1;
    }
    return { outputString: 'Monitoring processed on org ' + orgUrl };
  }
}
