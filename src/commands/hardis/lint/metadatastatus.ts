/* jscpd:ignore-start */
// External Libraries and Node.js Modules
import { glob } from 'glob';
import fs from 'fs-extra';
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
import { CONSTANTS } from '../../../config/index.js';
import { setConnectionVariables } from '../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/* jscpd:ignore-end */
export default class LintMetadataStatus extends SfCommand<any> {
  public static title = 'check inactive metadatas';
  public static description = `
## Command Behavior

**Checks for inactive metadata elements within your Salesforce DX project, helping to maintain a clean and efficient codebase.**

This command identifies various types of metadata components that are marked as inactive in your local project files. Keeping metadata active and relevant is crucial for deployment success, performance, and avoiding confusion. This tool helps you pinpoint and address such inactive elements.

It specifically checks for the inactive status of:

- **Approval Processes**
- **Assignment Rules**
- **Auto Response Rules**
- **Escalation Rules**
- **Flows** (specifically those in 'Draft' status)
- **Forecasting Types**
- **Record Types**
- **Validation Rules**
- **Workflow Rules**

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/detect-inactive-metadata.gif)

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-inactive-metadata/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses \`glob\` patterns (e.g., \`**/flows/**/*.flow-meta.xml\`, \`**/objects/**/validationRules/*.validationRule-meta.xml\`) to locate relevant metadata files within your project.
- **XML Parsing:** For each identified metadata file, it reads the XML content and parses it to extract the \`active\` or \`status\` flag (e.g., \`<active>false</active>\`, \`<status>Draft</status>\`).
- **Status Verification:** It checks the value of these flags to determine if the metadata component is inactive.
- **Data Aggregation:** All detected inactive items are collected into a list, including their type, name, and a severity level.
- **Report Generation:** It generates a CSV report (\`lint-metadatastatus.csv\`) containing details of all inactive metadata elements, which can be used for further analysis or record-keeping.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications (e.g., to Slack, MS Teams, Grafana) about the presence and count of inactive metadata, making it suitable for automated monitoring in CI/CD pipelines.
- **Error Handling:** It includes basic error handling for file operations and ensures that the process continues even if some files cannot be read.
</details>
`;

  public static examples = ['$ sf hardis:lint:metadatastatus'];
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
  private flowFilePattern = '**/flows/**/*.flow-meta.xml';
  private validationRuleFilePattern = '**/objects/**/validationRules/*.validationRule-meta.xml';
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;
  protected inactiveItems: any[] = [];
  protected outputFile: string;
  protected outputFilesRes: any = {};

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(LintMetadataStatus);

    const inactiveApprovalProcesses = await this.verifyApprovalProcesses();
    const inactiveAssignmentRules = await this.verifyAssignmentRules();
    const inactiveAutoResponseRules = await this.verifyAutoResponseRules();
    const inactiveEscalationRules = await this.verifyEscalationRules();
    const draftFlows = await this.verifyFlows();
    const inactiveForecastingTypes = await this.verifyForecastingTypes();
    const inactiveRecordTypes = await this.verifyRecordTypes();
    const inactiveValidationRules = await this.verifyValidationRules();
    const inactiveWorkflows = await this.verifyWorkflowRules();

    this.inactiveItems = [
      ...inactiveApprovalProcesses,
      ...inactiveAssignmentRules,
      ...inactiveAutoResponseRules,
      ...draftFlows,
      ...inactiveEscalationRules,
      ...inactiveForecastingTypes,
      ...inactiveRecordTypes,
      ...inactiveValidationRules,
      ...inactiveWorkflows,
    ];
    // Prepare notifications
    const branchMd = await getBranchMarkdown();
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No inactive configuration elements were found in ${branchMd}.`;
    const attachments: MessageAttachment[] = [];
    if (this.inactiveItems.length > 0) {
      notifSeverity = 'warning';
      if (inactiveApprovalProcesses.length > 0) {
        attachments.push({
          text: `*Inactive Approval Processes*\n${inactiveApprovalProcesses.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (inactiveAssignmentRules.length > 0) {
        attachments.push({
          text: `*Inactive Assignment Rules*\n${inactiveAssignmentRules.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (inactiveAutoResponseRules.length > 0) {
        attachments.push({
          text: `*Inactive Auto Response Rules*\n${inactiveAutoResponseRules.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (inactiveEscalationRules.length > 0) {
        attachments.push({
          text: `*Inactive Escalation Rules*\n${inactiveEscalationRules.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (draftFlows.length > 0) {
        attachments.push({
          text: `*Inactive Flows*\n${draftFlows.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (inactiveForecastingTypes.length > 0) {
        attachments.push({
          text: `*Inactive Forecasting Types*\n${inactiveForecastingTypes.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (inactiveRecordTypes.length > 0) {
        attachments.push({
          text: `*Inactive Record Types*\n${inactiveRecordTypes.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (inactiveValidationRules.length > 0) {
        attachments.push({
          text: `*Inactive Validation Rules*\n${inactiveValidationRules.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }
      if (inactiveWorkflows.length > 0) {
        attachments.push({
          text: `*Inactive Workflow Rules*\n${inactiveWorkflows.map((file) => `• ${file.name}`).join('\n')}`,
        });
      }

      notifText = `${this.inactiveItems.length} inactive configuration elements were found in ${branchMd}`;
      // Build result file
      await this.buildCsvFile();
    } else {
      uxLog("other", this, 'No draft flow or validation rule files detected.');
    }
    // Post notifications
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'METADATA_STATUS',
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      sideImage: 'flow',
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.inactiveItems,
      data: { metric: this.inactiveItems.length },
      metrics: {
        InactiveMetadatas: this.inactiveItems.length,
      },
    });

    return {};
  }

  /**
   * This function verifies the status of flows by checking each flow file.
   * It reads each flow file and checks if the flow is in 'Draft' status.
   * If the flow is in 'Draft' status, it extracts the file name and adds it to the list of draft files.
   *
   * @returns {Promise<string[]>} - A Promise that resolves to an array of draft files. Each entry in the array is the name of a draft file.
   */
  private async verifyFlows(): Promise<any[]> {
    const draftFiles: any[] = [];
    const flowFiles: string[] = await glob(this.flowFilePattern, { ignore: this.ignorePatterns });
    const severityIcon = getSeverityIcon('warning');
    for (const file of flowFiles) {
      const flowContent: string = await fs.readFile(file, 'utf-8');
      if (flowContent.includes('<status>Draft</status>')) {
        const fileName = path.basename(file, '.flow-meta.xml');
        draftFiles.push({ type: 'Flow (draft)', name: fileName, severity: 'warning', severityIcon: severityIcon });
      }
    }

    return draftFiles.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * This function verifies the validation rules by checking each rule file for inactive rules.
   * It reads each validation rule file and checks if the rule is active or not.
   * If the rule is inactive, it extracts the rule name and the object name and adds them to the list of inactive rules.
   *
   * @returns {Promise<string[]>} - A Promise that resolves to an array of inactive rules. Each entry in the array is a string in the format 'ObjectName - RuleName'.
   */
  private async verifyValidationRules(): Promise<any[]> {
    const inactiveRules: any[] = [];
    const validationRuleFiles: string[] = await glob(this.validationRuleFilePattern, { ignore: this.ignorePatterns });
    const severityIcon = getSeverityIcon('warning');
    for (const file of validationRuleFiles) {
      // Skip if validation rule is from a managed package
      if (path.basename(file).includes('__')) {
        continue;
      }
      const ruleContent: string = await fs.readFile(file, 'utf-8');
      if (ruleContent.includes('<active>false</active>')) {
        const ruleName = path.basename(file, '.validationRule-meta.xml');
        const objectName = path.basename(path.dirname(path.dirname(file)));
        inactiveRules.push({
          type: 'Validation Rule (inactive)',
          name: `${objectName} - ${ruleName}`,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveRules.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async verifyRecordTypes(): Promise<any[]> {
    const inactiveRecordTypes: any[] = [];
    const recordTypeFiles: string[] = await glob('**/objects/**/recordTypes/*.recordType-meta.xml', {
      ignore: this.ignorePatterns,
    });
    const severityIcon = getSeverityIcon('warning');
    for (const file of recordTypeFiles) {
      const recordTypeName = path.basename(file, '.recordType-meta.xml');
      const objectName = path.basename(path.dirname(path.dirname(file)));
      // Skip if record type is from a managed package
      if (path.basename(recordTypeName).includes('__')) {
        continue;
      }
      const recordTypeXml: string = await fs.readFile(file, 'utf-8');
      if (recordTypeXml.includes('<active>false</active>')) {
        inactiveRecordTypes.push({
          type: 'Record Type (inactive)',
          name: `${objectName} - ${recordTypeName}`,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveRecordTypes.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async verifyApprovalProcesses(): Promise<any[]> {
    const inactiveApprovalProcesses: any[] = [];
    const approvalProcessFiles: string[] = await glob('**/approvalProcesses/**/*.approvalProcess-meta.xml', {
      ignore: this.ignorePatterns,
    });
    const severityIcon = getSeverityIcon('warning');
    for (const file of approvalProcessFiles) {
      const approvalProcessFullName = path.basename(file, '.approvalProcess-meta.xml');
      const [objectName, approvalProcessName] = approvalProcessFullName.split('.');
      // Skip if approval process is from a managed package
      if (path.basename(approvalProcessName).includes('__')) {
        continue;
      }
      const approvalProcessXml: string = await fs.readFile(file, 'utf-8');
      if (approvalProcessXml.includes('<active>false</active>')) {
        inactiveApprovalProcesses.push({
          type: 'Approval Process (inactive)',
          name: `${objectName} - ${approvalProcessName}`,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveApprovalProcesses.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async verifyForecastingTypes(): Promise<any[]> {
    const inactiveForecastTypes: any[] = [];
    const forecastTypeFiles: string[] = await glob('**/forecastingTypes/**/*.forecastingType-meta.xml', {
      ignore: this.ignorePatterns,
    });
    const severityIcon = getSeverityIcon('warning');
    for (const file of forecastTypeFiles) {
      const forecastingTypeName = path.basename(file, '.forecastingType-meta.xml');
      const forecastTypeXml: string = await fs.readFile(file, 'utf-8');
      if (forecastTypeXml.includes('<active>false</active>')) {
        inactiveForecastTypes.push({
          type: 'Forecasting Type (inactive)',
          name: forecastingTypeName,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveForecastTypes.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async verifyWorkflowRules(): Promise<any[]> {
    const inactiveWorkflowRules: any[] = [];
    const workflowRuleFiles: string[] = await glob('**/workflows/**/*.workflow-meta.xml', {
      ignore: this.ignorePatterns,
    });
    const severityIcon = getSeverityIcon('warning');
    for (const file of workflowRuleFiles) {
      const workflowRuleName = path.basename(file, '.workflow-meta.xml');
      const workflowRuleXml: string = await fs.readFile(file, 'utf-8');
      if (workflowRuleXml.includes('<active>false</active>')) {
        inactiveWorkflowRules.push({
          type: 'Workflow Rule (inactive)',
          name: workflowRuleName,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveWorkflowRules.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async verifyAssignmentRules(): Promise<any[]> {
    const inactiveAssignmentRules: any[] = [];
    const assignmentRuleFiles: string[] = await glob('**/assignmentRules/**/*.assignmentRules-meta.xml', {
      ignore: this.ignorePatterns,
    });
    const severityIcon = getSeverityIcon('warning');
    for (const file of assignmentRuleFiles) {
      const assignmentRuleName = path.basename(file, '.assignmentRules-meta.xml');
      const assignmentRuleXml: string = await fs.readFile(file, 'utf-8');
      if (assignmentRuleXml.includes('<active>false</active>')) {
        inactiveAssignmentRules.push({
          type: 'Assignment Rule (inactive)',
          name: assignmentRuleName,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveAssignmentRules.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async verifyAutoResponseRules(): Promise<any[]> {
    const inactiveAutoResponseRules: any[] = [];
    const autoResponseRuleFiles: string[] = await glob('**/autoResponseRules/**/*.autoResponseRules-meta.xml', {
      ignore: this.ignorePatterns,
    });
    const severityIcon = getSeverityIcon('warning');
    for (const file of autoResponseRuleFiles) {
      const autoResponseRuleName = path.basename(file, '.autoResponseRules-meta.xml');
      const autoResponseRuleXml: string = await fs.readFile(file, 'utf-8');
      if (autoResponseRuleXml.includes('<active>false</active>')) {
        inactiveAutoResponseRules.push({
          type: 'Auto Response Rule (inactive)',
          name: autoResponseRuleName,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveAutoResponseRules.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async verifyEscalationRules(): Promise<any[]> {
    const inactiveEscalationRules: any[] = [];
    const escalationRuleFiles: string[] = await glob('**/escalationRules/**/*.escalationRules-meta.xml', {
      ignore: this.ignorePatterns,
    });
    const severityIcon = getSeverityIcon('warning');
    for (const file of escalationRuleFiles) {
      const escalationRuleName = path.basename(file, '.escalationRules-meta.xml');
      const escalationRuleXml: string = await fs.readFile(file, 'utf-8');
      if (escalationRuleXml.includes('<active>false</active>')) {
        inactiveEscalationRules.push({
          type: 'Escalation Rule (inactive)',
          name: escalationRuleName,
          severity: 'warning',
          severityIcon: severityIcon,
        });
      }
    }

    return inactiveEscalationRules.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * This function builds a CSV file from arrays of draft flows and inactive validation rules.
   * It first ensures that the output file path is generated.
   * It then maps the draft flows and inactive validation rules into an array of objects, each with a 'type' property set to either "Draft Flow" or "Inactive VR" and a 'name' property set to the file or rule name.
   * Finally, it generates a CSV file from this array and writes it to the output file.
   *
   * @returns {Promise<void>} - A Promise that resolves when the CSV file has been successfully generated.
   */
  private async buildCsvFile(): Promise<void> {
    this.outputFile = await generateReportPath('lint-metadatastatus', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.inactiveItems, this.outputFile, { fileTitle: 'Inactive Metadata Elements' });
  }
}
