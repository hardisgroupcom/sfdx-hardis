/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { prepareOrgNotificationContext } from '../../../../common/utils/orgNotificationContext.js';
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';
import { isTestClass } from '../../../../common/utils/apexLimitUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const DEFAULT_DEPRECATED_APEX_API_VERSION = 50;

export default class DiagnoseApexApiVersion extends SfCommand<any> {
  public static title = 'Check Apex classes and triggers for deprecated API versions';

  public static description = `Detects Apex classes and triggers deployed with API versions at or below a configurable threshold.

**Apex metadata API version** is the version the code was compiled against. This is separate from \`hardis:org:diagnose:legacyapi\`, which checks deprecated **API call** versions (SOAP, REST, Bulk) from EventLogFile.

Key functionalities:

- **Threshold-based detection:** API versions at or below the threshold are flagged as deprecated. Configure via \`DEPRECATED_APEX_API_VERSION\` env var (default: \`50\`).
- **Apex classes:** Queries custom Apex classes (excludes managed packages). Optionally excludes \`@isTest\` classes via \`--includetestclasses\`.
- **Apex triggers:** Queries custom Apex triggers (excludes managed packages).
- **CSV report:** Generates a report listing all deprecated classes and triggers with their ApiVersion.
- **Notifications:** Sends alerts to Grafana, Slack, MS Teams when deprecated Apex is found.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:org:diagnose:apex-api-version',
    '$ sf hardis:org:diagnose:apex-api-version --threshold 55',
    '$ sf hardis:org:diagnose:apex-api-version --outputfile ./reports/apex-api-version.csv',
  ];

  public static flags: any = {
    threshold: Flags.integer({
      char: 't',
      description: `API version threshold. Classes/triggers with ApiVersion <= this value are flagged. Overrides DEPRECATED_APEX_API_VERSION env var.`,
    }),
    includetestclasses: Flags.boolean({
      char: 'i',
      default: false,
      description: 'Include @isTest classes in the report (excluded by default)',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected static triggerNotification = true;

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected deprecatedClasses: any[] = [];
  protected deprecatedTriggers: any[] = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseApexApiVersion);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;

    const threshold =
      flags.threshold ??
      parseInt(getEnvVar('DEPRECATED_APEX_API_VERSION') || String(DEFAULT_DEPRECATED_APEX_API_VERSION), 10);
    if (!Number.isFinite(threshold) || threshold < 1) {
      throw new Error(`Invalid DEPRECATED_APEX_API_VERSION or --threshold: must be a positive integer`);
    }

    const includeTestClasses = flags.includetestclasses ?? false;
    const conn = flags['target-org'].getConnection();

    uxLog(
      "action",
      this,
      c.cyan(
        `Querying Apex classes and triggers with ApiVersion <= ${threshold} (custom/unmanaged only)...`
      )
    );

    // Query Apex classes - need Body to detect @isTest when excluding
    const classesQuery = includeTestClasses
      ? `SELECT Id, Name, ApiVersion FROM ApexClass WHERE NamespacePrefix = null AND ApiVersion <= ${threshold} ORDER BY ApiVersion ASC, Name ASC`
      : `SELECT Id, Name, ApiVersion, Body FROM ApexClass WHERE NamespacePrefix = null AND ApiVersion <= ${threshold} ORDER BY ApiVersion ASC, Name ASC`;

    const classesRes = await soqlQueryTooling(classesQuery, conn);
    let classes = (classesRes.records || []) as any[];

    if (!includeTestClasses && classes.length > 0) {
      classes = classes.filter((cls) => !isTestClass(cls.Body));
    }

    this.deprecatedClasses = classes.map((cls) => ({
      Type: 'ApexClass',
      Name: cls.Name,
      ApiVersion: cls.ApiVersion,
      severity: 'warning',
      severityIcon: getSeverityIcon('warning'),
    }));

    // Query Apex triggers
    const triggersQuery = `SELECT Id, Name, ApiVersion FROM ApexTrigger WHERE NamespacePrefix = null AND ApiVersion <= ${threshold} ORDER BY ApiVersion ASC, Name ASC`;
    const triggersRes = await soqlQueryTooling(triggersQuery, conn);
    const triggers = (triggersRes.records || []) as any[];

    this.deprecatedTriggers = triggers.map((trg) => ({
      Type: 'ApexTrigger',
      Name: trg.Name,
      ApiVersion: trg.ApiVersion,
      severity: 'warning',
      severityIcon: getSeverityIcon('warning'),
    }));

    const allDeprecated = [...this.deprecatedClasses, ...this.deprecatedTriggers];
    const totalCount = allDeprecated.length;

    // Display summary
    uxLog("action", this, c.cyan('Results'));
    uxLog(
      "log",
      this,
      c.grey(
        `Found ${this.deprecatedClasses.length} deprecated Apex class(es) and ${this.deprecatedTriggers.length} deprecated Apex trigger(s) with ApiVersion <= ${threshold}`
      )
    );

    if (totalCount > 0) {
      this.statusCode = 1;
      uxLogTable(this, allDeprecated);
      uxLog(
        "warning",
        this,
        c.yellow(
          `Consider upgrading these to a newer API version. Use \`sf hardis:project:audit:apiversion\` to update metadata files.`
        )
      );
    } else {
      uxLog("success", this, c.green(`No Apex classes or triggers with ApiVersion <= ${threshold} found.`));
    }

    // Generate CSV report
    this.outputFile = await generateReportPath('apex-api-version', this.outputFile);
    this.outputFilesRes = await generateCsvFile(allDeprecated, this.outputFile, {
      fileTitle: 'Apex API Version (Deprecated)',
    });

    // Notifications
    const { orgMarkdown, notifButtons } = await prepareOrgNotificationContext(flags['target-org']?.getConnection());
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No deprecated Apex API versions found in ${orgMarkdown} (threshold: ${threshold})`;
    const notifAttachments: any[] = [];

    if (totalCount > 0) {
      notifSeverity = 'warning';
      notifText = `${totalCount} Apex class(es)/trigger(s) with deprecated API version (<= ${threshold}) in ${orgMarkdown}`;
      const detailText = allDeprecated
        .slice(0, 20)
        .map((r) => `• ${r.Type} ${r.Name}: ApiVersion ${r.ApiVersion}`)
        .join('\n');
      notifAttachments.push({
        text: totalCount > 20 ? `${detailText}\n... and ${totalCount - 20} more` : detailText,
      });
    }

    await NotifProvider.postNotifications({
      type: 'APEX_API_VERSION',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: allDeprecated,
      data: { metric: totalCount, threshold },
      metrics: {
        deprecatedApexClasses: this.deprecatedClasses.length,
        deprecatedApexTriggers: this.deprecatedTriggers.length,
        deprecatedApexTotal: totalCount,
      },
    });

    if ((this.argv || []).includes('apex-api-version')) {
      process.exitCode = this.statusCode;
    }

    return {
      status: this.statusCode,
      threshold,
      deprecatedClasses: this.deprecatedClasses.length,
      deprecatedTriggers: this.deprecatedTriggers.length,
      total: totalCount,
      outputFile: this.outputFile,
    };
  }
}
