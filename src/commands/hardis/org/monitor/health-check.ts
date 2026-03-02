/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson, JsonMap } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';
import { NotifMessage, NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import sortArray from 'sort-array';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const parseNumberWithDefault = (value: any, defaultValue: number): number => {
  const parsed = value != null ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

interface RiskCounts extends JsonMap {
  high: number;
  medium: number;
  meets: number;
}

interface SecurityHealthCheckRisk extends JsonMap {
  Id?: string;
  RiskType?: 'HIGH_RISK' | 'MEDIUM_RISK' | 'MEETS_STANDARD';
  Setting?: string;
  SettingGroup?: string;
  SettingRiskCategory?: string;
  OrgValue?: string | number | null;
  OrgValueRaw?: string | number | null;
  StandardValue?: string | number | null;
  StandardValueRaw?: string | number | null;
}

interface MonitorHealthCheckResult extends JsonMap {
  outputString: string;
  score: number | null;
  riskCounts: RiskCounts;
  risks: SecurityHealthCheckRisk[];
}

export default class MonitorHealthCheck extends SfCommand<any> {
  public static title = 'Check org security health';

  public static description = `
## Command Behavior

**Retrieves the Salesforce Security Health Check score together with every risk indicator, then exports the dataset for monitoring dashboards.**

Key functionalities:

- **Score Retrieval:** Queries the Tooling API [SecurityHealthCheck](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_securityhealthcheck.htm) object to capture the org score.
- **Risk Indicators:** Fetches all [SecurityHealthCheckRisks](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_securityhealthcheckrisks.htm) entries (high, medium, informational, meets standard) to highlight deviations from the Salesforce baseline.
- **Excel-Ready Report:** Builds a CSV/XLSX file that mixes the global score, risk counts, and the detailed indicator list so the data can be consumed in monitoring branches.
- **Grafana / Chat Notifications:** Sends results (score metric, sample risks, XLSX attachment) through the \`NotifProvider\` so Grafana, Slack, MS Teams, Email, or API endpoints can react automatically.
- **Customizable Thresholds:** Env vars \`HEALTH_CHECK_THRESHOLD_WARNING\` (default 80) and \`HEALTH_CHECK_THRESHOLD_ERROR\` (default 60) control when the score escalates to warning or error.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.

### Excel report example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-health-check-excel.jpg)

### Grafana example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-health-check-grafana.jpg)

### Slack example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-health-check-slack.jpg)

<details markdown="1">
<summary>Technical explanations</summary>

- **Tooling API usage:** Executes \`SELECT Id, DurableId, CustomBaselineId, Score, CreatedDate FROM SecurityHealthCheck ORDER BY CreatedDate DESC LIMIT 1\` to locate the latest score, then fetches all \`SecurityHealthCheckRisks\` via the associated Id.
- **Data shaping:** Normalizes every risk with labels, categories, org/baseline values, and severity icons so that Grafana-friendly metrics and Excel exports are straightforward.
- **Notifications:** Relies on \`NotifProvider\` to broadcast the score metric, top risky settings, and the XLSX attachment. Grafana pipelines reuse \`data.metric\` (score) and \`metrics\` (risk counters) fields.
- **Exit codes:** Sets \`process.exitCode = 1\` whenever an error severity is detected to help CI pipelines fail fast when the security score drops below expectations.
</details>
`;

  public static examples = ['$ sf hardis:org:monitor:health-check'];

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

  public static requiresProject = true;
  protected static triggerNotification = true;

  protected warningScoreThreshold = parseNumberWithDefault(getEnvVar('HEALTH_CHECK_THRESHOLD_WARNING'), 80);
  protected errorScoreThreshold = parseNumberWithDefault(getEnvVar('HEALTH_CHECK_THRESHOLD_ERROR'), 60);

  protected healthCheckSummary: any = null;
  protected healthCheckRisks: SecurityHealthCheckRisk[] = [];
  protected reportRows: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MonitorHealthCheck);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    const conn = flags['target-org'].getConnection();

    uxLog('action', this, c.cyan(t('retrieveLatestSecurityHealthCheckScore')));
    const scoreQuery = `SELECT Id, DurableId, CustomBaselineId, Score FROM SecurityHealthCheck LIMIT 1`;
    const scoreResult = await soqlQueryTooling(scoreQuery, conn);
    if (!scoreResult.records || scoreResult.records.length === 0) {
      throw new SfError('No SecurityHealthCheck record found for this org. You need "View Setup and Configuration" permissions.');
    }
    this.healthCheckSummary = scoreResult.records[0];
    const scoreValue = this.parseScore(this.healthCheckSummary?.Score);
    const scoreSeverity = this.getScoreSeverity(scoreValue);
    const scoreText = scoreValue != null ? `${scoreValue.toFixed(2)}%` : 'Not available';

    uxLog('action', this, c.cyan(t('retrieveSecurityHealthCheckIndicators')));
    const risksQuery = `SELECT Id, DurableId, RiskType, Setting, SettingGroup, SettingRiskCategory, OrgValue, StandardValue FROM SecurityHealthCheckRisks ORDER BY RiskType, Setting`;
    const risksResult = await soqlQueryTooling(risksQuery, conn);
    const riskRecords = (risksResult.records || []) as SecurityHealthCheckRisk[];
    this.healthCheckRisks = riskRecords.filter((risk) => risk.Id === this.healthCheckSummary.Id);


    const riskCounts = this.getRiskCounts();
    const riskSummaryRows = [
      {
        Category: 'Score',
        Value: scoreText,
        severity: scoreSeverity,
        severityIcon: getSeverityIcon(scoreSeverity),
      },
      {
        Category: 'Error severity settings',
        Value: riskCounts.high,
        severity: riskCounts.high > 0 ? 'error' : 'success',
        severityIcon: getSeverityIcon(riskCounts.high > 0 ? 'error' : 'success'),
      },
      {
        Category: 'Warning severity settings',
        Value: riskCounts.medium,
        severity: riskCounts.medium > 0 ? 'warning' : 'success',
        severityIcon: getSeverityIcon(riskCounts.medium > 0 ? 'warning' : 'success'),
      },
      {
        Category: 'Meets standard indicators',
        Value: riskCounts.meets,
        severity: 'info',
        severityIcon: getSeverityIcon('info'),
      },
    ];
    uxLogTable(this, riskSummaryRows);

    type UxLogLevel = 'error' | 'warning' | 'success' | 'log' | 'action' | 'table' | 'other';
    const uxSeverityLevel: UxLogLevel =
      scoreSeverity === 'error' ? 'error' : scoreSeverity === 'warning' ? 'warning' : scoreSeverity === 'success' ? 'success' : 'other';
    const severityColor = scoreSeverity === 'error' ? c.red : scoreSeverity === 'warning' ? c.yellow : scoreSeverity === 'success' ? c.green : c.cyan;
    uxLog(uxSeverityLevel, this, severityColor(t('securityHealthCheckScore', { score: scoreText })));

    if (riskCounts.high === 0 && riskCounts.medium === 0) {
      uxLog('success', this, c.green(t('noErrorOrWarningSeverityIndicatorsDetected')));
    } else {
      uxLog('warning', this, c.yellow(t('detectedErrorSeverityAndWarningSeverityIndicators', { riskCounts: riskCounts.high, riskCounts1: riskCounts.medium })));
    }

    this.reportRows = this.buildReportRows();
    this.outputFile = await generateReportPath('org-health-check', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.reportRows, this.outputFile, { fileTitle: 'Security Health Check' });

    const notifPayload = await this.buildNotifications(flags, scoreValue, scoreSeverity, scoreText, riskCounts);
    await setConnectionVariables(flags['target-org']?.getConnection());
    await NotifProvider.postNotifications(notifPayload);

    const result: MonitorHealthCheckResult = {
      outputString: 'Security Health Check executed on org ' + flags['target-org'].getConnection().instanceUrl,
      score: scoreValue,
      riskCounts,
      risks: this.healthCheckRisks,
    };
    return result;
  }

  protected buildReportRows() {
    const reportRows = this.healthCheckRisks.map((risk) => {
      const severity = this.getRowSeverity(risk);
      return {
        SeverityIcon: getSeverityIcon(severity),
        Severity: severity,
        SettingGroup: risk.SettingGroup,
        Setting: risk.Setting,
        OrgValue: risk.OrgValue,
        StandardValue: risk.StandardValue,
        SettingRiskCategory: risk.SettingRiskCategory,
        RiskType: risk.RiskType,
      };
    });
    sortArray(reportRows, {
      by: ['Severity', 'SettingRiskCategory', 'RiskType', 'Setting'],
      order: ['Severity', "SettingRiskCategory", 'RiskType', 'asc'],
      customOrders: {
        Severity: ['error', 'warning', 'info', 'success'],
        SettingRiskCategory: ['HIGH_RISK', 'MEDIUM_RISK', 'LOW_RISK', 'INFORMATIONAL'],
        RiskType: ['HIGH_RISK', 'MEDIUM_RISK', 'MEETS_STANDARD'],
      },
    });
    return reportRows;
  }

  protected getRiskCounts(): RiskCounts {
    const base: RiskCounts = { high: 0, medium: 0, meets: 0 };
    for (const risk of this.healthCheckRisks) {
      const severity = this.getRowSeverity(risk);
      if (severity === 'error') {
        base.high += 1;
      } else if (severity === 'warning') {
        base.medium += 1;
      } else if (severity === 'success') {
        base.meets += 1;
      }
    }
    return base;
  }

  protected getScoreSeverity(score: number | null): NotifSeverity {
    if (score == null || Number.isNaN(score)) {
      return 'info';
    }
    if (score < this.errorScoreThreshold) {
      return 'error';
    }
    if (score < this.warningScoreThreshold) {
      return 'warning';
    }
    return 'success';
  }

  protected parseScore(score: any): number | null {
    if (score == null) {
      return null;
    }
    const parsed = Number(score);
    return Number.isFinite(parsed) ? parsed : null;
  }

  protected getRowSeverity(risk: SecurityHealthCheckRisk): NotifSeverity {
    if (risk.RiskType === 'MEETS_STANDARD') {
      return 'success';
    }
    if (risk.RiskType === 'HIGH_RISK') {
      return risk.SettingRiskCategory === 'HIGH_RISK' ? 'error' : 'warning';
    }
    if (risk.RiskType === 'MEDIUM_RISK') {
      return 'warning';
    }
    return 'info';
  }

  protected async buildNotifications(
    flags,
    scoreValue: number | null,
    scoreSeverity: NotifSeverity,
    scoreText: string,
    riskCounts: RiskCounts
  ): Promise<NotifMessage> {
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const risksWithSeverity = this.healthCheckRisks.map((risk) => ({ risk, severity: this.getRowSeverity(risk) }));
    const highRisks = risksWithSeverity.filter((entry) => entry.severity === 'error').map((entry) => entry.risk);
    const mediumRisks = risksWithSeverity.filter((entry) => entry.severity === 'warning').map((entry) => entry.risk);

    let notifSeverity: NotifSeverity = scoreSeverity;
    if (highRisks.length > 0) {
      notifSeverity = 'error';
    } else if (mediumRisks.length > 0 && notifSeverity !== 'error') {
      notifSeverity = 'warning';
    }

    let notifText = `Security Health Check score for ${orgMarkdown} is ${scoreText}.`;
    if (highRisks.length > 0) {
      notifText = `Security Health Check score for ${orgMarkdown} is ${scoreText} with ${highRisks.length} error-severity indicators.`;
    } else if (mediumRisks.length > 0) {
      notifText = `Security Health Check score for ${orgMarkdown} is ${scoreText} with ${mediumRisks.length} warning-severity indicators.`;
    }

    const notifAttachments: MessageAttachment[] = [];
    const highList = this.formatRisksForAttachment(highRisks);
    if (highList) {
      notifAttachments.push({ title: 'Error severity settings', text: highList });
      uxLog('error', this, c.red(t('errorSeveritySettings', { highList })));
    }
    const mediumList = this.formatRisksForAttachment(mediumRisks);
    if (mediumList && notifSeverity !== 'error') {
      notifAttachments.push({ title: 'Warning severity settings', text: mediumList });
      uxLog('warning', this, c.yellow(t('warningSeveritySettings', { mediumList })));
    }

    if (notifSeverity === 'error') {
      process.exitCode = 1;
    }

    const notifMessage: NotifMessage = {
      type: 'ORG_HEALTH_CHECK',
      text: notifText,
      buttons: notifButtons,
      attachments: notifAttachments,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.reportRows,
      metrics: {
        Score: scoreValue ?? 0,
        HighRisk: riskCounts.high,
        MediumRisk: riskCounts.medium,
        MeetsStandard: riskCounts.meets,
        Indicators: this.healthCheckRisks.length,
      },
      data: {
        metric: scoreValue ?? 0,
        score: scoreValue,
        highRisk: riskCounts.high,
        mediumRisk: riskCounts.medium,
        meetsStandard: riskCounts.meets,
      },
    };
    return notifMessage;
  }

  protected formatRisksForAttachment(risks: any[]): string {
    if (!risks || risks.length === 0) {
      return '';
    }
    return risks
      .map((risk) => {
        const groupLabel = risk.SettingGroup ? ` (${risk.SettingGroup})` : '';
        const orgValue = risk.OrgValue ?? 'N/A';
        const standardValue = risk.StandardValue ?? 'N/A';
        return `• ${risk.Setting || 'Unknown'}${groupLabel}: Org=${orgValue} / Baseline=${standardValue}`;
      })
      .join('\n');
  }
}
