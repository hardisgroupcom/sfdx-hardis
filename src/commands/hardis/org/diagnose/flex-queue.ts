/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { prepareOrgNotificationContext } from '../../../../common/utils/orgNotificationContext.js';
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/** Salesforce flex queue holds at most this many async Apex jobs in Holding status. */
export const APEX_FLEX_QUEUE_MAX_JOBS = 100;

const DEFAULT_HOLDING_THRESHOLD = 90;

const HOLDING_JOBS_SOQL =
  "SELECT Id, ApexClassId, ApexClass.Name, JobType, CreatedDate FROM AsyncApexJob WHERE Status = 'Holding' ORDER BY CreatedDate ASC";

export default class DiagnoseFlexQueue extends SfCommand<any> {
  public static title = 'Monitor Apex flex queue (AsyncApexJob Holding)';

  public static description = `Counts **AsyncApexJob** records with **Status = 'Holding'** (Apex flex queue), including **ApexClass.Name**, **JobType**, and **CreatedDate** for each job. The org can hold at most **${APEX_FLEX_QUEUE_MAX_JOBS}** such jobs; when the queue is full, new queueable/batch work can fail or stall.

- **Alert:** when the count is **greater than or equal to** \`--threshold\` (default **${DEFAULT_HOLDING_THRESHOLD}**), or from env **APEX_FLEX_QUEUE_THRESHOLD**.
- **Severity:** **error** when count reaches **${APEX_FLEX_QUEUE_MAX_JOBS}** (queue full); **warning** when count is at or above the threshold but below the max.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.


### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:flex-queue --agent --target-org myorg@example.com
\`\`\`

In agent mode, the command runs fully automatically. The \`--threshold\` defaults to 90 (or \`APEX_FLEX_QUEUE_THRESHOLD\` env var) when not provided.`;

  public static examples = [
    '$ sf hardis:org:diagnose:flex-queue',
    '$ sf hardis:org:diagnose:flex-queue --threshold 95',
    '$ sf hardis:org:diagnose:flex-queue --outputfile ./reports/flex-queue-holding.csv',
    '$ sf hardis:org:diagnose:flex-queue --agent',
  ];

  public static flags: any = {
    threshold: Flags.integer({
      char: 't',
      description: `Alert when Holding job count >= this value (1–${APEX_FLEX_QUEUE_MAX_JOBS}). Overrides APEX_FLEX_QUEUE_THRESHOLD env var (default: ${DEFAULT_HOLDING_THRESHOLD}).`,
      min: 1,
      max: APEX_FLEX_QUEUE_MAX_JOBS,
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

  protected static triggerNotification = true;

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseFlexQueue);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;

    const parsedEnv = parseInt(getEnvVar('APEX_FLEX_QUEUE_THRESHOLD') || String(DEFAULT_HOLDING_THRESHOLD), 10);
    const threshold =
      flags.threshold ??
      (Number.isFinite(parsedEnv) ? parsedEnv : DEFAULT_HOLDING_THRESHOLD);

    if (!Number.isFinite(threshold) || threshold < 1 || threshold > APEX_FLEX_QUEUE_MAX_JOBS) {
      throw new Error(
        `Invalid APEX_FLEX_QUEUE_THRESHOLD or --threshold: must be an integer between 1 and ${APEX_FLEX_QUEUE_MAX_JOBS}`
      );
    }

    const conn = flags['target-org'].getConnection();

    uxLog('action', this, c.cyan(`Querying AsyncApexJob records in Holding status (flex queue)...`));

    const queryRes = await soqlQuery(HOLDING_JOBS_SOQL, conn);
    const records = (queryRes.records || []) as any[];

    const rows: {
      Id: string;
      ApexClassId: string;
      ApexClassName: string;
      JobType: string;
      CreatedDate: string;
      severity: string;
      severityIcon: string;
    }[] = records.map((job) => ({
      Id: job.Id,
      ApexClassId: job.ApexClassId,
      ApexClassName: job.ApexClass?.Name ?? '',
      JobType: job.JobType ?? '',
      CreatedDate: job.CreatedDate ?? '',
      severity: 'success',
      severityIcon: getSeverityIcon('success'),
    }));

    const count = rows.length;

    uxLog('action', this, c.cyan('Results'));
    uxLog(
      'log',
      this,
      c.grey(
        `${count} job(s) in Holding status (flex queue max ${APEX_FLEX_QUEUE_MAX_JOBS}, alert threshold ${threshold})`
      )
    );

    let notifSeverity: NotifSeverity = 'log';
    let alertMessage = '';

    if (count >= APEX_FLEX_QUEUE_MAX_JOBS) {
      this.statusCode = 1;
      notifSeverity = 'error';
      alertMessage = `Apex flex queue is full (${count}/${APEX_FLEX_QUEUE_MAX_JOBS} Holding jobs).`;
      rows.forEach((r) => {
        r.severity = 'error';
        r.severityIcon = getSeverityIcon('error');
      });
      uxLog('error', this, c.red(alertMessage));
    } else if (count >= threshold) {
      this.statusCode = 1;
      notifSeverity = 'warning';
      alertMessage = `Apex flex queue is near capacity: ${count} Holding jobs (threshold ${threshold}, max ${APEX_FLEX_QUEUE_MAX_JOBS}).`;
      rows.forEach((r) => {
        r.severity = 'warning';
        r.severityIcon = getSeverityIcon('warning');
      });
      uxLog('warning', this, c.yellow(alertMessage));
    } else {
      uxLog(
        'success',
        this,
        c.green(`Holding job count ${count} is below threshold ${threshold} (max ${APEX_FLEX_QUEUE_MAX_JOBS}).`)
      );
    }

    if (rows.length > 0) {
      uxLogTable(this, rows);
    }

    this.outputFile = await generateReportPath('flex-queue-holding', this.outputFile);
    this.outputFilesRes = await generateCsvFile(rows, this.outputFile, {
      fileTitle: 'Apex flex queue (Holding)',
    });

    const { orgMarkdown, notifButtons } = await prepareOrgNotificationContext(flags['target-org']?.getConnection());
    let notifText = `Apex flex queue OK in ${orgMarkdown}: ${count} Holding job(s) (threshold ${threshold}).`;
    const notifAttachments: any[] = [];

    if (this.statusCode === 1) {
      notifText = `${alertMessage} ${orgMarkdown}`;
      const sample = rows
        .slice(0, 15)
        .map((r) => {
          const label = r.ApexClassName || r.ApexClassId || r.Id;
          return `• ${label} (${r.JobType || 'n/a'}) — ${r.CreatedDate || 'n/a'}`;
        })
        .join('\n');
      notifAttachments.push({
        text: rows.length > 15 ? `${sample}\n... and ${rows.length - 15} more (see report)` : sample || '(see report)',
      });
    }

    await NotifProvider.postNotifications({
      type: 'APEX_FLEX_QUEUE',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: rows,
      data: {
        metric: count,
        threshold,
        maxJobs: APEX_FLEX_QUEUE_MAX_JOBS,
        alert: this.statusCode === 1,
      },
      metrics: {
        apexFlexQueueHoldingCount: count,
        apexFlexQueueThreshold: threshold,
        apexFlexQueueMaxJobs: APEX_FLEX_QUEUE_MAX_JOBS,
      },
    });

    if (this.statusCode !== 0) {
      process.exitCode = this.statusCode;
    }

    return {
      status: this.statusCode,
      holdingCount: count,
      threshold,
      maxJobs: APEX_FLEX_QUEUE_MAX_JOBS,
      outputFile: this.outputFile,
    };
  }
}
