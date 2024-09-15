/* jscpd:ignore-start */
// External Libraries
import { glob } from 'glob';
import fs from 'fs-extra';
import * as xml2js from 'xml2js';
import * as path from 'path';

// Salesforce Specific
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
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

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */
export default class UnusedMetadatas extends SfCommand<any> {
  public static title = 'check unused labels and custom permissions';
  public static description = `Check if elements (custom labels and custom permissions) are used in the project

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-unused-metadata/) and can output Grafana, Slack and MsTeams Notifications.
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
      char: 'o',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  };
  /* jscpd:ignore-end */
  protected unusedData: any[] = [];
  protected outputFile: string;
  protected outputFilesRes: any = {};

  protected static supportsUsername = true;

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
    const unusedLabels = await this.verifyLabels();
    const unusedCustomPermissions = await this.verifyCustomPermissions();

    // Build notification
    const branchMd = await getBranchMarkdown();
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No unused metadatas has been detected in ${branchMd}`;
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
    if (unusedLabels.length > 0 || unusedCustomPermissions.length > 0) {
      notifSeverity = 'warning';
      notifText = `${this.unusedData.length} unused metadatas have been detected in ${branchMd}`;
      await this.buildCsvFile(unusedLabels, unusedCustomPermissions);
    } else {
      uxLog(this, 'No unused labels or custom permissions detected.');
    }
    // Post notification
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
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
      console.warn('No label file found.');
      return [];
    }

    return new Promise((resolve, reject) => {
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
                const fileContent = fs.readFileSync(filePath, 'utf-8').toLowerCase();
                return (
                  fileContent.includes(labelLower) || fileContent.includes(cLower) || fileContent.includes(auraPattern)
                );
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
      console.warn('No custom permission file found.');
      return [];
    }

    for (const file of customPermissionFiles) {
      const fileData = await fs.readFile(file, 'utf-8');
      const fileName = path.basename(file, '.customPermission-meta.xml');
      let label = '';

      xml2js.parseString(fileData, (error, result) => {
        if (error) {
          console.error(`Error parsing XML: ${error}`);
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
      ...unusedLabels.map((label) => ({ type: 'Label', name: label })),
      ...unusedCustomPermissions.map((permission) => ({ type: 'Custom Permission', name: permission })),
    ];

    this.outputFilesRes = await generateCsvFile(this.unusedData, this.outputFile);
  }
}
