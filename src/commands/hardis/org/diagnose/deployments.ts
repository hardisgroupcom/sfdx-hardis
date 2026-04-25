/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { t } from '../../../../common/utils/i18n.js';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import { prepareOrgNotificationContext } from '../../../../common/utils/orgNotificationContext.js';
import sortArray from 'sort-array';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

interface DeployRecord {
  Type: 'Deployment' | 'Validation';
  Id: string;
  Status: string;
  DeployedBy: string;
  CreatedDate: string;
  StartDate: string;
  CompletedDate: string;
  PendingMinutes: number;
  DurationMinutes: number;
}

function parseDatetime(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const parsed = Date.parse(dateStr);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function minutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  return (end.getTime() - start.getTime()) / 60000;
}

export default class DiagnoseDeployments extends SfCommand<any> {
  public static title = 'Analyze metadata deployments and validations';

  public static description = `Analyzes metadata deployments and validations by querying DeployRequest records via the Tooling API.

Tracks:

- Deployment/validation status (Succeeded, Failed, InProgress, Canceled)
- Pending time (CreatedDate to StartDate)
- Duration (StartDate to CompletedDate)
- Separation of deployments vs validations (CheckOnly)

Key functionalities:

- **Deployments vs validations:** Distinguishes actual deployments from validation-only (CheckOnly) runs.
- **Timing analysis:** Pending time (queue) and deployment/validation duration in minutes.
- **CSV report:** Generates a report of recent deployment/validation activity.
- **Notifications:** Sends to Grafana, Slack, MS Teams.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.


### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:deployments --agent --period daily --target-org myorg@example.com
\`\`\`

In agent mode:

- \`--period\` defaults to \`daily\` (last 24 hours) when not provided.
- All interactive prompts are skipped.`;

  public static examples = [
    '$ sf hardis:org:diagnose:deployments',
    '$ sf hardis:org:diagnose:deployments --period daily',
    '$ sf hardis:org:diagnose:deployments --period weekly',
    '$ sf hardis:org:diagnose:deployments --period all',
    '$ sf hardis:org:diagnose:deployments --agent',
  ];

  public static flags: any = {
    period: Flags.string({
      char: 'p',
      options: ['daily', 'weekly', 'all'],
      description: 'Time period to analyze: daily (last 24h), weekly (last 7 days), or all (no date filter). If not set, defaults to daily in CI or prompts for a number of days interactively.',
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
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected static triggerNotification = true;

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected deployRecords: DeployRecord[] = [];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseDeployments);
    const agentMode = flags.agent === true;
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    let period = flags.period as string | undefined;

    const conn = flags['target-org'].getConnection();

    let dateFilter: string | undefined;
    if (!period) {
      if (isCI || agentMode) {
        period = 'daily';
      } else {
        const promptRes = await prompts({
          type: 'number',
          name: 'value',
          message: t('selectAnalysisPeriodInDays'),
          description: t('selectAnalysisPeriodInDaysDescription'),
          initial: 7,
        });
        const days = Math.max(1, Math.floor(Number(promptRes.value) || 7));
        period = `${days} days`;
        dateFilter = ` AND CreatedDate = LAST_N_DAYS:${days}`;
      }
    }
    if (dateFilter === undefined) {
      dateFilter = period === 'daily' ? ' AND CreatedDate = LAST_N_DAYS:1' : period === 'weekly' ? ' AND CreatedDate = LAST_N_DAYS:7' : '';
    }
    uxLog("action", this, c.cyan(t("fetchingDeploymentAndValidationRecords", { period })));

    const query = `SELECT Status, StartDate, CreatedBy.Name, CreatedDate, CompletedDate, CheckOnly, Id FROM DeployRequest WHERE Status != 'InProgress'${dateFilter} ORDER BY CompletedDate DESC NULLS LAST`;
    let res: any;
    try {
      res = await soqlQueryTooling(query, conn);
    } catch (e: any) {
      uxLog("error", this, c.red(t("failedToQueryDeployRequest", { message: e?.message || e })));
      return { error: e?.message || String(e) } as AnyJson;
    }

    const records = res?.records || [];
    this.deployRecords = [];

    for (const rec of records) {
      const createdDate = parseDatetime(rec.CreatedDate);
      const startDate = parseDatetime(rec.StartDate);
      const completedDate = parseDatetime(rec.CompletedDate);

      const pendingMinutes = minutesBetween(createdDate, startDate);
      const durationMinutes = minutesBetween(startDate, completedDate);

      const isValidation = rec.CheckOnly === true;
      const deployedBy = rec.CreatedBy?.Name ?? rec.CreatedById ?? 'Unknown';

      this.deployRecords.push({
        Type: isValidation ? 'Validation' : 'Deployment',
        Status: rec.Status || 'Unknown',
        DeployedBy: deployedBy,
        CreatedDate: rec.CreatedDate || '',
        StartDate: rec.StartDate || '',
        CompletedDate: rec.CompletedDate || '',
        PendingMinutes: Math.round(pendingMinutes * 10) / 10,
        DurationMinutes: Math.round(durationMinutes * 10) / 10,
        Id: rec.Id || '',
      });
    }

    this.deployRecords = sortArray(this.deployRecords, {
      by: ['CompletedDate', 'CreatedDate'],
      order: ['desc', 'desc'],
    }) as DeployRecord[];

    const deployments = this.deployRecords.filter((r) => r.Type === 'Deployment');
    const validations = this.deployRecords.filter((r) => r.Type === 'Validation');
    const failedDeployments = deployments.filter((r) => r.Status === 'Failed');
    const failedValidations = validations.filter((r) => r.Status === 'Failed');
    const succeededDeployments = deployments.filter((r) => r.Status === 'Succeeded');
    const succeededValidations = validations.filter((r) => r.Status === 'Succeeded');

    const deploymentsWithDuration = deployments.filter((r) => r.DurationMinutes > 0);
    const validationsWithDuration = validations.filter((r) => r.DurationMinutes > 0);
    const avgDeploymentMinutes =
      deploymentsWithDuration.length > 0
        ? deploymentsWithDuration.reduce((s, r) => s + r.DurationMinutes, 0) / deploymentsWithDuration.length
        : 0;
    const avgValidationMinutes =
      validationsWithDuration.length > 0
        ? validationsWithDuration.reduce((s, r) => s + r.DurationMinutes, 0) / validationsWithDuration.length
        : 0;
    const deploymentsWithPending = deployments.filter((r) => r.PendingMinutes > 0);
    const validationsWithPending = validations.filter((r) => r.PendingMinutes > 0);
    const avgDeploymentPendingMinutes =
      deploymentsWithPending.length > 0
        ? deploymentsWithPending.reduce((s, r) => s + r.PendingMinutes, 0) / deploymentsWithPending.length
        : 0;
    const avgValidationPendingMinutes =
      validationsWithPending.length > 0
        ? validationsWithPending.reduce((s, r) => s + r.PendingMinutes, 0) / validationsWithPending.length
        : 0;

    const deploymentSuccessRate =
      deployments.length > 0 ? Math.round((succeededDeployments.length / deployments.length) * 100) : 0;
    const validationSuccessRate =
      validations.length > 0 ? Math.round((succeededValidations.length / validations.length) * 100) : 0;

    const roundedAvgDeploymentMinutes = Math.round(avgDeploymentMinutes * 10) / 10;
    const roundedAvgValidationMinutes = Math.round(avgValidationMinutes * 10) / 10;
    const roundedAvgDeploymentPendingMinutes = Math.round(avgDeploymentPendingMinutes * 10) / 10;
    const roundedAvgValidationPendingMinutes = Math.round(avgValidationPendingMinutes * 10) / 10;
    const deploymentSummaryBase = {
      period,
      deploymentsTotal: deployments.length,
      validationsTotal: validations.length,
      failedDeployments: failedDeployments.length,
      failedValidations: failedValidations.length,
      deploymentSuccessRate,
      validationSuccessRate,
      avgDeploymentMinutes: roundedAvgDeploymentMinutes,
      avgValidationMinutes: roundedAvgValidationMinutes,
    };

    uxLog("action", this, c.cyan(t("deploymentAndValidationSummary", { period })));
    uxLog("log", this, c.grey(t("deploymentsStats", { total: deployments.length, succeeded: succeededDeployments.length, failed: failedDeployments.length, successRate: deploymentSuccessRate, avgDuration: avgDeploymentMinutes.toFixed(1), avgPending: avgDeploymentPendingMinutes.toFixed(1) })));
    uxLog("log", this, c.grey(t("validationsStats", { total: validations.length, succeeded: succeededValidations.length, failed: failedValidations.length, successRate: validationSuccessRate, avgDuration: avgValidationMinutes.toFixed(1), avgPending: avgValidationPendingMinutes.toFixed(1) })));

    if (this.deployRecords.length > 0) {
      uxLogTable(this, this.deployRecords.slice(0, 15));
    }

    // Generate CSV report
    this.outputFile = await generateReportPath('deployments', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.deployRecords, this.outputFile, {
      fileTitle: 'Deployments & Validations',
    });

    // Notifications
    const { orgMarkdown, notifButtons } = await prepareOrgNotificationContext(flags['target-org']?.getConnection());
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `Deployment analysis (${period}) for ${orgMarkdown}: ${deployments.length} deployments (${deploymentSuccessRate}% success, avg ${avgDeploymentMinutes.toFixed(1)} min), ${validations.length} validations (${validationSuccessRate}% success, avg ${avgValidationMinutes.toFixed(1)} min)`;
    const notifAttachments: any[] = [];

    if (failedDeployments.length > 0 || failedValidations.length > 0) {
      notifSeverity = 'warning';
      notifText += ` (${failedDeployments.length} failed deployment(s), ${failedValidations.length} failed validation(s))`;
      const detailLines: string[] = [];
      failedDeployments.slice(0, 3).forEach((r) => {
        detailLines.push(`• Deployment ${r.Id}: ${r.DeployedBy} - ${r.Status}`);
      });
      failedValidations.slice(0, 3).forEach((r) => {
        detailLines.push(`• Validation ${r.Id}: ${r.DeployedBy} - ${r.Status}`);
      });
      if (detailLines.length > 0) {
        notifAttachments.push({ text: detailLines.join('\n') });
      }
    }
    notifText += '.';

    await NotifProvider.postNotifications({
      type: 'DEPLOYMENTS',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.deployRecords,
      data: {
        ...deploymentSummaryBase,
        avgDeploymentPendingMinutes: roundedAvgDeploymentPendingMinutes,
        avgValidationPendingMinutes: roundedAvgValidationPendingMinutes,
      },
      metrics: {
        deploymentsTotal: deployments.length,
        validationsTotal: validations.length,
        deploymentsSucceeded: succeededDeployments.length,
        deploymentsFailed: failedDeployments.length,
        validationsSucceeded: succeededValidations.length,
        validationsFailed: failedValidations.length,
        deploymentSuccessRate: deploymentSuccessRate,
        validationSuccessRate: validationSuccessRate,
        avgDeploymentMinutes: deploymentSummaryBase.avgDeploymentMinutes,
        avgValidationMinutes: deploymentSummaryBase.avgValidationMinutes,
      },
    });

    return { ...deploymentSummaryBase, outputFile: this.outputFile } as AnyJson;
  }
}
