/* jscpd:ignore-start */
// External Libraries
import { glob } from 'glob';
import fs from 'fs-extra';
import * as xml2js from 'xml2js';
import * as path from 'path';
import c from 'chalk';

// Salesforce Specific
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';

// Project Specific Utilities
import { NotifProvider, NotifSeverity } from '../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/types';
import { getNotificationButtons, getBranchMarkdown, getSeverityIcon } from '../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { uxLog } from '../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../common/utils/projectUtils.js';
import { CONSTANTS } from '../../../config/index.js';
import { setConnectionVariables } from '../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */
export default class UnusedMetadatas extends SfCommand<any> {
  public static title = 'check unused labels and custom permissions';
  public static description = `
## Command Behavior

**Checks for unused custom labels and custom permissions within your Salesforce DX project.**

This command helps identify and report on custom labels and custom permissions that are defined in your project but do not appear to be referenced anywhere in your codebase. Identifying unused metadata is crucial for:

- **Code Cleanliness:** Removing dead code and unnecessary metadata improves project maintainability.
- **Performance:** Reducing the overall size of your metadata, which can positively impact deployment times and org performance.
- **Clarity:** Ensuring that all defined components serve a purpose, making the codebase easier to understand.

It specifically scans for references to custom labels (e.g., \`$Label.MyLabel\`) and custom permissions (by their API name or label) across various file types (Apex, JavaScript, HTML, XML, etc.).

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-unused-metadata/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses \`glob\` to find all relevant project files (Apex classes, triggers, JavaScript, HTML, XML, Aura components, Visualforce pages) and custom label (\`CustomLabels.labels-meta.xml\`) and custom permission (\`.customPermission-meta.xml\`) definition files.
- **XML Parsing:** It uses \`xml2js\` to parse the XML content of \`CustomLabels.labels-meta.xml\` and custom permission files to extract the full names of labels and permissions.
- **Content Scanning:** For each label and custom permission, it iterates through all other project files and checks if their names or associated labels are present in the file content. It performs case-insensitive checks for labels.
- **Usage Tracking:** It maintains a count of how many times each custom permission is referenced. Labels are checked for any inclusion.
- **Unused Identification:** Elements with no or very few references (for custom permissions, less than 2 to account for their own definition file) are flagged as unused.
- **Data Aggregation:** All identified unused labels and custom permissions are collected into a list.
- **Report Generation:** It generates a CSV report (\`lint-unusedmetadatas.csv\`) containing details of all unused metadata elements.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications (e.g., to Slack, MS Teams, Grafana) about the presence and count of unused metadata, making it suitable for automated monitoring in CI/CD pipelines.
</details>
`;
  public static examples = ['$ sf hardis:lint:unusedmetadatas'];
  /* jscpd:ignore-start */
  public static flags: any = {
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': optionalOrgFlagWithDeprecations,
  };
  /* jscpd:ignore-end */
  protected unusedData: any[] = [];
  protected outputFile: string;
  protected outputFilesRes: any = {};

  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;

  private projectFiles: string[];
  private labelFilePattern = '**/CustomLabels.labels-meta.xml';
  private customPermissionFilePattern = '**/customPermissions/*.xml';

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(UnusedMetadatas);
    await this.setProjectFiles();
    uxLog("action", this, c.cyan('Checking for unused labels...'));
    const unusedLabels = await this.verifyLabels();
    uxLog("action", this, c.cyan('Checking for unused custom permissions...'));
    const unusedCustomPermissions = await this.verifyCustomPermissions();

    // Build notification
    const branchMd = await getBranchMarkdown();
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No unused metadata were detected in ${branchMd}.`;
    const attachments: MessageAttachment[] = [];
    if (unusedLabels.length > 0) {
      attachments.push({
        text: `*Unused Labels*\n${unusedLabels.map((label) => `• ${label.name}`).join('\n')}`,
      });
    }
    if (unusedCustomPermissions.length > 0) {
      attachments.push({
        text: `*Unused Custom Permissions*\n${unusedCustomPermissions
          .map((permission) => `• ${permission.name}`)
          .join('\n')}`,
      });
    }
    uxLog("action", this, c.cyan("Summary"));
    if (unusedLabels.length > 0 || unusedCustomPermissions.length > 0) {
      notifSeverity = 'warning';
      notifText = `${this.unusedData.length} unused metadata were detected in ${branchMd}`;
      if (unusedLabels.length > 0) {
        uxLog("warning", this, c.yellow(`Unused Labels: ${unusedLabels.length}`));
      }
      if (unusedCustomPermissions.length > 0) {
        uxLog("warning", this, c.yellow(`Unused Custom Permissions: ${unusedCustomPermissions.length}`));
      }
      await this.buildCsvFile(unusedLabels, unusedCustomPermissions);
    } else {
      uxLog("success", this, c.green('No unused labels or custom permissions detected.'));
    }
    // Post notification
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'UNUSED_METADATAS',
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      sideImage: 'flow',
      logElements: this.unusedData,
      data: { metric: this.unusedData.length },
      metrics: {
        MetadatasNotUsed: this.unusedData.length,
      },
    });

    return {};
  }

  /**
   * @description Verify if custom labels are used in the project
   * @returns
   */
  private async verifyLabels(): Promise<any[]> {
    const labelFiles = await glob(this.labelFilePattern, { ignore: this.ignorePatterns });
    const labelFilePath = labelFiles[0];

    if (!labelFilePath) {
      uxLog("warning", this, c.yellow('No label file found.'));
      return [];
    }

    return new Promise((resolve, reject) => {
      try {
        fs.readFile(labelFilePath, 'utf-8', (errorReadingFile, data) => {
          if (errorReadingFile) {
            reject(errorReadingFile);
            return;
          }

          xml2js.parseString(data, (errorParseString, result: any) => {
            if (errorParseString) {
              reject(errorParseString);
              return;
            }
            const severityIconInfo = getSeverityIcon('info');
            const labelsArray: string[] = result.CustomLabels.labels.map((label: any) => label.fullName[0]);
            const unusedLabels: any[] = labelsArray
              .filter((label) => {
                const labelLower = `label.${label.toLowerCase()}`;
                const cLower = `c.${label.toLowerCase()}`;
                const auraPattern = `{!$Label.c.${label.toLowerCase()}}`;
                return !this.projectFiles.some((filePath) => {
                  if (!fs.existsSync(filePath)) {
                    uxLog("warning", this, c.yellow(`File not found: ${filePath}`));
                    return false;
                  }
                  try {
                    const fileContent = fs.readFileSync(filePath, 'utf-8').toLowerCase();
                    return (
                      fileContent.includes(labelLower) || fileContent.includes(cLower) || fileContent.includes(auraPattern)
                    );
                  } catch (error) {
                    uxLog("warning", this, c.yellow(`Error reading file ${filePath}: ${error}`));
                    return false;
                  }
                });
              })
              .map((label) => {
                return {
                  name: label,
                  severity: 'info',
                  severityIcon: severityIconInfo,
                };
              });

            resolve(unusedLabels);
          });
        });
      } catch (error) {
        uxLog("warning", this, c.yellow(`Error processing label file: ${error}`));
        reject(error);
      }
    });
  }

  /**
   * @description Verify if custom permissions are used in the project
   * @returns
   */
  private async verifyCustomPermissions(): Promise<any[]> {
    const foundLabels = new Map<string, number>();
    const customPermissionFiles: string[] = await glob(this.customPermissionFilePattern, {
      ignore: this.ignorePatterns,
    });

    if (!customPermissionFiles) {
      uxLog("warning", this, c.yellow('No custom permission file found.'));
      return [];
    }

    for (const file of customPermissionFiles) {
      try {
        const fileData = await fs.readFile(file, 'utf-8');
        const fileName = path.basename(file, '.customPermission-meta.xml');
        let label = '';

        xml2js.parseString(fileData, (error, result) => {
          if (error) {
            uxLog("warning", this, c.yellow(`Error parsing XML: ${error}`));
            return;
          }
          label = result.CustomPermission.label[0];
        });
        for (const filePath of this.projectFiles) {
          const fileContent: string = fs.readFileSync(filePath, 'utf-8');
          if (fileContent.includes(fileName) || fileContent.includes(label)) {
            const currentCount = foundLabels.get(fileName) || 0;
            foundLabels.set(fileName, currentCount + 1);
          }
        }
      } catch (error) {
        uxLog("warning", this, c.yellow(`Error processing custom permission file ${file}: ${error}`));
      }
    }
    const severityIconInfo = getSeverityIcon('info');
    const result = [...foundLabels.keys()]
      .filter((key) => (foundLabels.get(key) || 0) < 2)
      .map((name) => {
        return {
          name: name,
          severity: 'info',
          severityIcon: severityIconInfo,
        };
      });
    return result;
  }

  private async setProjectFiles(): Promise<void> {
    this.projectFiles = await glob('**/*.{cls,trigger,js,html,xml,cmp,email,page}', { ignore: this.ignorePatterns });
  }

  private async buildCsvFile(unusedLabels: string[], unusedCustomPermissions: string[]): Promise<void> {
    this.outputFile = await generateReportPath('lint-unusedmetadatas', this.outputFile);
    this.unusedData = [
      ...unusedLabels.map((label: any) => ({ type: 'Label', name: label?.name || label })),
      ...unusedCustomPermissions.map((permission: any) => ({ type: 'Custom Permission', name: permission.name || permission })),
    ];

    this.outputFilesRes = await generateCsvFile(this.unusedData, this.outputFile, { fileTitle: 'Unused Metadatas' });
  }
}
