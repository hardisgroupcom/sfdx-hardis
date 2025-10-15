/* jscpd:ignore-start */
// External Libraries and Node.js Modules
import fs from 'fs-extra';
import * as xml2js from 'xml2js';
import { glob } from 'glob';
import * as path from 'path';

// Salesforce Specific
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';

// Project Specific Utilities
import { uxLog } from '../../../common/utils/index.js';
import { NotifProvider, NotifSeverity } from '../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/types';
import { getBranchMarkdown, getNotificationButtons, getSeverityIcon } from '../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../common/utils/projectUtils.js';
import { setConnectionVariables } from '../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */
export default class MetadataStatus extends SfCommand<any> {
  public static title = 'check missing description on custom fields';
  public static description = `
## Command Behavior

**Checks for missing descriptions on custom fields within your Salesforce DX project.**

This command helps enforce documentation standards by identifying custom fields that lack a descriptive explanation. Comprehensive field descriptions are crucial for:

- **Maintainability:** Making it easier for developers and administrators to understand the purpose and usage of each field.
- **Data Governance:** Ensuring data quality and consistency.
- **User Adoption:** Providing clear guidance to end-users on how to interact with fields.

It specifically targets custom fields (ending with \`__c\`) and excludes standard fields, managed package fields, and fields on Custom Settings or Data Cloud objects.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses \`glob\` to find all custom field metadata files (\`.field-meta.xml\`) within your project.
- **Custom Setting Exclusion:** It first filters out fields belonging to Custom Settings by reading the corresponding object metadata files (\`.object-meta.xml\`) and checking for the \`<customSettingsType>\` tag. It also excludes Data Cloud objects (\`__dlm\`, \`__dll\`) and managed package fields.
- **XML Parsing:** For each remaining custom field file, it reads the XML content and parses it using \`xml2js\` to extract the \`fullName\` and \`description\` attributes.
- **Description Check:** It verifies if the \`description\` attribute is present and not empty for each custom field.
- **Data Aggregation:** All custom fields found to be missing a description are collected into a list, along with their object and field names.
- **Report Generation:** It generates a CSV report (\`lint-missingattributes.csv\`) containing details of all fields with missing descriptions.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications (e.g., to Slack, MS Teams, Grafana) about the presence and count of fields with missing descriptions, making it suitable for automated quality checks in CI/CD pipelines.
</details>
`;
  public static examples = ['$ sf hardis:lint:missingattributes'];
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

  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  private objectFileDirectory = '**/objects/**/fields/*.*';
  protected fieldsWithoutDescription: any[] = [];
  protected outputFile: string;
  protected outputFilesRes: any = {};
  private nonCustomSettingsFieldDirectories: string[] = [];
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MetadataStatus);
    await this.filterOutCustomSettings();
    this.fieldsWithoutDescription = await this.verifyFieldDescriptions();

    // Build notifications
    const branchMd = await getBranchMarkdown();
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No missing descriptions on fields were found in ${branchMd}.`;
    let attachments: MessageAttachment[] = [];
    if (this.fieldsWithoutDescription.length > 0) {
      notifSeverity = 'warning';
      notifText = `${this.fieldsWithoutDescription.length} fields with missing descriptions were found in ${branchMd}`;
      await this.buildCsvFile(this.fieldsWithoutDescription);
      attachments = [
        {
          text: `*Missing descriptions*\n${this.fieldsWithoutDescription.map((file) => `• ${file.name}`).join('\n')}`,
        },
      ];
    } else {
      uxLog("other", this, 'No missing descriptions on fields were found.');
    }
    // Post notifications
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'MISSING_ATTRIBUTES',
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      sideImage: 'flow',
      logElements: this.fieldsWithoutDescription,
      data: { metric: this.fieldsWithoutDescription.length },
      metrics: {
        MetadatasWithoutDescription: this.fieldsWithoutDescription.length,
      },
    });
    return {};
  }

  private async filterOutCustomSettings() {
    const parserCS = new xml2js.Parser();
    const objectDirectories: string[] = await glob(this.objectFileDirectory, { ignore: this.ignorePatterns });
    for (const directory of objectDirectories) {
      const objectName = path.basename(path.dirname(path.dirname(directory)));
      // Filter Data Cloud & managed items
      if (objectName.endsWith("__dlm") || objectName.endsWith("__dll") || objectName.split('__').length > 2) {
        continue;
      }
      const objectMetaFilePath = path.join(path.dirname(path.dirname(directory)), `${objectName}.object-meta.xml`);

      if (fs.existsSync(objectMetaFilePath)) {
        try {
          const objectMetaFileContent = fs.readFileSync(objectMetaFilePath, 'utf8');
          let isCustomSettingsObject = false;
          const result = await parserCS.parseStringPromise(objectMetaFileContent);

          if (result && result.CustomObject && result.CustomObject.customSettingsType) {
            isCustomSettingsObject = true;
          }

          if (!isCustomSettingsObject) {
            this.nonCustomSettingsFieldDirectories.push(directory);
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        this.nonCustomSettingsFieldDirectories.push(directory);
      }
    }
  }

  private async verifyFieldDescriptions(): Promise<string[]> {
    const fieldsWithoutDescription: any[] = [];
    const fieldResults = await Promise.all(
      this.nonCustomSettingsFieldDirectories.map(async (fieldFile) => {
        const fieldContent = await this.readFileAsync(fieldFile);
        return await this.parseXmlStringAsync(fieldContent);
      })
    );
    const severityIconInfo = getSeverityIcon('info');
    for (let i = 0; i < fieldResults.length; i++) {
      const fieldResult = fieldResults[i];
      if (fieldResult && fieldResult.CustomField) {
        const fieldName = fieldResult.CustomField.fullName[0];
        // Skip standard and managed fields
        if (fieldName.endsWith('__c') && !fieldResult.CustomField.description && (fieldName.match(/__/g) || []).length < 2) {
          const fieldFile = this.nonCustomSettingsFieldDirectories[i].replace(/\\/g, '/');
          const objectName = fieldFile.split('/').slice(-3, -2)[0];
          const fullFieldName = `${objectName}.${fieldName}`;
          fieldsWithoutDescription.push({
            name: fullFieldName,
            object: objectName,
            field: fieldName,
            severity: 'info',
            severityIcon: severityIconInfo,
          });
        }
      }
    }
    return fieldsWithoutDescription;
  }

  private parseXmlStringAsync(xmlString: string): Promise<any> {
    return new Promise((resolve, reject) => {
      xml2js.parseString(xmlString, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  private readFileAsync(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  private async buildCsvFile(fieldsWithoutDescription: any[]): Promise<void> {
    this.outputFile = await generateReportPath('lint-missingattributes', this.outputFile);
    const csvData = fieldsWithoutDescription.map((field) => ({ type: 'Field', name: field.name }));
    this.outputFilesRes = await generateCsvFile(csvData, this.outputFile, { fileTitle: 'Missing Attributes' });
  }
}
