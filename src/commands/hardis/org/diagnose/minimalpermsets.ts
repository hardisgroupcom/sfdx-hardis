/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import fs from 'fs-extra';
import { glob } from 'glob';
import sortArray from 'sort-array';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/** xml2js parser keys (attributes, text content) - not permission elements */
const XML2JS_RESERVED_KEYS = new Set(['$', '_']);

const DEFAULT_MINIMAL_PERMSETS_THRESHOLD = 5;

/**
 * Returns true if the value represents a nested/permission element (object or array of objects).
 * Nested elements grant actual permissions (e.g. objectPermissions, fieldPermissions).
 */
function isPermissionElementValue(value: any): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.length > 0 && typeof value[0] === 'object' && value[0] !== null;
  }
  return typeof value === 'object';
}
const GLOB_IGNORE_PATTERNS = ['**/node_modules/**', '**/.git/**'];

export default class DiagnoseMinimalPermsets extends SfCommand<any> {
  public static title = 'Detect permission sets with minimal permissions';

  public static description = `Analyzes permission set metadata files in the sfdx project to identify permission sets with very few permissions (configurable threshold, default: 5 or fewer).

These "minimal" permission sets may be candidates for consolidation to reduce org complexity and improve maintainability.

Key functionalities:

- **Project-based analysis:** Scans \`.permissionset-meta.xml\` files in the project (no org connection required for analysis).
- **Permission counting:** Uses structure to differentiate leaf elements (primitives) from nested elements (objects). Leaf elements are metadata-only; nested elements grant permissions. Future API additions are supported automatically.
- **Configurable threshold:** Set \`MINIMAL_PERMSETS_THRESHOLD\` env var or use \`--threshold\` (default: 5).
- **Metadata directory:** Uses \`--metadata-dir\` or scans \`**/*.permissionset-meta.xml\` in the project.
- **CSV report:** Generates a report listing minimal permission sets with their permission count.
- **Notifications:** Sends alerts to Grafana, Slack, MS Teams when minimal permission sets are found.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:org:diagnose:minimalpermsets',
    '$ sf hardis:org:diagnose:minimalpermsets --threshold 5',
    '$ sf hardis:org:diagnose:minimalpermsets --metadata-dir force-app/main/default/permissionsets',
  ];

  public static flags: any = {
    threshold: Flags.integer({
      char: 't',
      description: `Maximum number of permissions to be considered minimal. Overrides MINIMAL_PERMSETS_THRESHOLD env var.`,
    }),
    'metadata-dir': Flags.string({
      char: 'm',
      description:
        'Directory containing .permissionset-meta.xml files. If not set, scans entire project for **/*.permissionset-meta.xml',
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

  public static requiresProject = true;

  protected static triggerNotification = true;

  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected minimalPermSets: any[] = [];
  protected totalCount = 0;
  protected errorCount = 0;
  protected statusCode = 0;

  /* jscpd:ignore-end */

  /**
   * Count permission-granting elements in a parsed PermissionSet XML object.
   * Uses structure to differentiate: leaf elements (primitives/arrays of primitives) are metadata-only;
   * nested elements (objects/arrays of objects) are actual permissions. No hard-coded element names.
   */
  private countPermissionElements(psObj: Record<string, any>): number {
    if (!psObj || typeof psObj !== 'object') {
      return 0;
    }
    let count = 0;
    for (const [key, value] of Object.entries(psObj)) {
      const elementName = key.replace(/^[^:]+:/, ''); // strip namespace prefix if present
      if (XML2JS_RESERVED_KEYS.has(elementName)) {
        continue;
      }
      if (!isPermissionElementValue(value)) {
        continue; // leaf/primitive element - metadata only
      }
      if (Array.isArray(value)) {
        count += value.length;
      } else {
        count += 1;
      }
    }
    return count;
  }

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseMinimalPermsets);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;

    const threshold =
      flags.threshold ??
      parseInt(getEnvVar('MINIMAL_PERMSETS_THRESHOLD') || String(DEFAULT_MINIMAL_PERMSETS_THRESHOLD), 10);
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error(`Invalid MINIMAL_PERMSETS_THRESHOLD or --threshold: must be a non-negative integer`);
    }

    const metadataDir = flags['metadata-dir'];
    const cwd = process.cwd();

    let psFiles: string[];
    if (metadataDir) {
      const dirPath = path.isAbsolute(metadataDir) ? metadataDir : path.join(cwd, metadataDir);
      if (!(await fs.pathExists(dirPath))) {
        uxLog("error", this, c.red(`Metadata directory not found: ${dirPath}`));
        process.exitCode = 1;
        return { status: 1, message: 'Metadata directory not found', minimalPermSets: [] };
      }
      psFiles = await glob('*.permissionset-meta.xml', { cwd: dirPath, absolute: true });
    } else {
      psFiles = await glob('**/*.permissionset-meta.xml', { cwd, ignore: GLOB_IGNORE_PATTERNS, absolute: true });
    }

    uxLog(
      "action",
      this,
      c.cyan(
        `Scanning ${psFiles.length} permission set(s) for minimal permissions (threshold: <= ${threshold})...`
      )
    );

    this.totalCount = psFiles.length;
    this.minimalPermSets = [];
    this.errorCount = 0;

    for (const filePath of psFiles) {
      const fileName = path.basename(filePath);
      const cleanName = fileName.replace(/\.permissionset-meta\.xml$/, '');
      try {
        const parsed = await parseXmlFile(filePath);
        const psRoot = parsed?.PermissionSet ?? parsed?.['sf:PermissionSet'] ?? Object.values(parsed || {})[0];
        if (!psRoot) {
          uxLog("warning", this, c.yellow(`  Skipped ${fileName}: no PermissionSet root found`));
          this.errorCount++;
          continue;
        }

        const permissionCount = this.countPermissionElements(psRoot);

        if (permissionCount <= threshold) {
          const label =
            (Array.isArray(psRoot.label) ? psRoot.label[0] : psRoot.label) || cleanName;
          const relPath = path.relative(cwd, filePath);
          const isZeroValue = permissionCount === 0;
          this.minimalPermSets.push({
            Name: label,
            FilePath: relPath,
            PermissionCount: permissionCount,
            severity: isZeroValue ? 'error' : 'warning',
            severityIcon: getSeverityIcon(isZeroValue ? 'error' : 'warning'),
          });
          if (this.debugMode) {
            uxLog("log", this, c.grey(`  MINIMAL: ${label} (${fileName}) - ${permissionCount} permissions`));
          }
        }
      } catch (e: any) {
        uxLog("warning", this, c.yellow(`  ERROR parsing ${fileName}: ${e?.message || e}`));
        this.errorCount++;
      }
    }

    this.minimalPermSets = sortArray(this.minimalPermSets, { by: ['Name'], order: ['asc'] }) as any[];

    // Display summary
    uxLog("action", this, c.cyan('Results'));
    uxLog(
      "log",
      this,
      c.grey(
        `Found ${this.minimalPermSets.length} minimal permission set(s) (<= ${threshold} permissions) out of ${this.totalCount} total. Parse errors: ${this.errorCount}`
      )
    );

    if (this.minimalPermSets.length > 0) {
      this.statusCode = 1;
      uxLogTable(this, this.minimalPermSets);
      uxLog(
        "warning",
        this,
        c.yellow(
          `Consider consolidating these permission sets to reduce org complexity and improve maintainability.`
        )
      );
    } else {
      uxLog("success", this, c.green(`No minimal permission sets found (all have > ${threshold} permissions).`));
    }

    // Generate CSV report
    this.outputFile = await generateReportPath('minimal-permission-sets', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.minimalPermSets, this.outputFile, {
      fileTitle: 'Minimal Permission Sets',
    });

    // Notifications
    await setConnectionVariables(flags['target-org']?.getConnection());
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No minimal permission sets found in project for ${orgMarkdown} (threshold: ${threshold})`;
    const notifAttachments: any[] = [];

    if (this.minimalPermSets.length > 0) {
      const zeroValueCount = this.minimalPermSets.filter((ps) => ps.PermissionCount === 0).length;
      notifSeverity = zeroValueCount > 0 ? 'error' : 'warning';
      notifText = `${this.minimalPermSets.length} minimal permission set(s) (<= ${threshold} permissions) in project for ${orgMarkdown}`;
      if (zeroValueCount > 0) {
        notifText = `${zeroValueCount} zero-value permission set(s) (0 permissions) and ${this.minimalPermSets.length - zeroValueCount} minimal in project for ${orgMarkdown}`;
      }
      const detailText = this.minimalPermSets
        .slice(0, 20)
        .map((ps) => {
          const prefix = ps.PermissionCount === 0 ? '❌' : '⚠️';
          return `${prefix} ${ps.Name}: ${ps.PermissionCount} permissions`;
        })
        .join('\n');
      notifAttachments.push({
        text: this.minimalPermSets.length > 20 ? `${detailText}\n... and ${this.minimalPermSets.length - 20} more` : detailText,
      });
    }

    await NotifProvider.postNotifications({
      type: 'MINIMAL_PERMSETS',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.minimalPermSets,
      data: { metric: this.minimalPermSets.length, threshold },
      metrics: {
        minimalPermissionSets: this.minimalPermSets.length,
        zeroValuePermissionSets: this.minimalPermSets.filter((ps) => ps.PermissionCount === 0).length,
        totalPermissionSets: this.totalCount,
        parseErrors: this.errorCount,
      },
    });

    if ((this.argv || []).includes('minimalpermsets')) {
      process.exitCode = this.statusCode;
    }

    return {
      status: this.statusCode,
      threshold,
      totalPermissionSets: this.totalCount,
      minimalPermissionSets: this.minimalPermSets.length,
      errorCount: this.errorCount,
      minimalPermSets: this.minimalPermSets,
      outputFile: this.outputFile,
    };
  }
}
