/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import pascalcase from 'pascalcase';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { filesFolderRoot } from '../../../../common/utils/filesUtils.js';
import { promptFilesExportConfiguration } from '../../../../common/utils/filesUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigureData extends SfCommand<any> {
  public static title = 'Configure File export project';

  public static description = `
## Command Behavior

**Configures a project for exporting file attachments from a Salesforce org.**

This command streamlines the setup of configurations for mass downloading files (such as Notes, Attachments, or Salesforce Files) associated with Salesforce records. It's particularly useful for data backups, migrations, or integrating Salesforce files with external systems.

Key functionalities:

- **Template-Based Configuration:** Allows you to choose from predefined templates for common file export scenarios or start with a blank configuration. Templates can pre-populate the export settings.
- **Interactive Setup:** Guides you through defining the export project folder name and other export parameters.
- **\`export.json\` Generation:** Creates an \`export.json\` file within the designated project folder. This file contains the configuration for the file export operation, including:
  - **SOQL Query:** A SOQL query to select the parent records from which files will be exported.
  - **File Types:** Specifies which types of files (e.g., \`ContentVersion\`, \`Attachment\`) to include.
  - **File Size Filtering:** Minimum file size in KB to filter files during export (files smaller than this will be skipped).
  - **Output Folder/File Naming:** Defines how the exported files and their containing folders will be named based on record fields.
  - **Overwrite Options:** Controls whether existing files or parent records should be overwritten during the export.

See this article for a practical example:

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Template Selection:** It uses \`selectTemplate\` to present predefined file export templates or a blank option to the user.
- **Interactive Prompts:** The \`promptFilesExportConfiguration\` utility is used to gather detailed export settings from the user, such as the SOQL query, file types, and naming conventions.
- **File System Operations:** Employs \`fs-extra\` to create the project directory (\`files/your-project-name/\`) and write the \`export.json\` configuration file.
- **PascalCase Conversion:** Uses \`pascalcase\` to format the files export path consistently.
- **JSON Serialization:** Serializes the collected export configuration into a JSON string and writes it to \`export.json\`.
- **WebSocket Communication:** Uses \`WebSocketClient.requestOpenFile\` to open the generated \`export.json\` file in VS Code, facilitating immediate configuration.
</details>
`;

  public static examples = ['$ sf hardis:org:configure:files'];

  public static flags: any = {
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;
  exportConfig: any;
  filesExportPath: any;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const template = await this.selectTemplate();

    if (template === 'blank') {
      // Request info to build sfdmu workspace
      await this.buildExportJsonInfo();
    } else {
      await this.buildExportJsonInfoFromTemplate(template);
    }

    // Check if not already existing
    const { exportJsonFile, filesProjectFolder } = await this.createConfigFiles();

    // Trigger command to open SFDMU config file in VS Code extension
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(exportJsonFile, 'Edit your Files export configuration', 'report');
    }
    else {
      WebSocketClient.requestOpenFile(exportJsonFile);
    }

    // Set bac initial cwd
    const message = c.cyan(`Successfully initialized files export project ${c.green(
      filesProjectFolder
    )}, with ${c.green('export.json')} file.
You can now call it using ${c.white('sf hardis:org:files:export')}
`);
    uxLog("other", this, message);
    return { outputString: message };
  }

  private async createConfigFiles() {
    const filesProjectFolder = path.join(filesFolderRoot, this.filesExportPath);
    if (fs.existsSync(filesProjectFolder)) {
      throw new SfError(`[sfdx-hardis]${c.red(`Folder ${c.bold(filesProjectFolder)} already exists`)}`);
    }

    // Create folder & export.json
    await fs.ensureDir(filesProjectFolder);
    const exportJsonFile = path.join(filesProjectFolder, 'export.json');
    await fs.writeFile(exportJsonFile, JSON.stringify(this.exportConfig, null, 2));
    return { exportJsonFile, filesProjectFolder };
  }

  private async selectTemplate() {
    const templateFileChoices: any[] = [];
    const templatesFilesFolder = path.join(PACKAGE_ROOT_DIR, 'defaults/templates/files');
    const templateFiles = fs.readdirSync(templatesFilesFolder);
    for (const templateFile of templateFiles) {
      const templateName = path.basename(templateFile).replace('.json', '');
      templateFileChoices.push({
        title: `📝 ${templateName}`,
        value: path.join(templatesFilesFolder, templateFile),
        description: `sfdx-hardis template for ${templateName}`,
      });
    }

    const defaultTemplateChoice = {
      title: '📄 Blank template',
      value: 'blank',
      description: 'Configure your files import/export from scratch 😊',
    };

    const templateResp = await prompts({
      type: 'select',
      name: 'template',
      message: c.cyanBright('Please select a Files import/export template, or the blank one'),
      description: 'Choose a pre-configured template for file operations or start with a blank configuration',
      placeholder: 'Select a template',
      choices: [...[defaultTemplateChoice], ...templateFileChoices],
    });
    return templateResp.template;
  }

  private async buildExportJsonInfo() {
    const defaultConfig = {
      sfdxHardisLabel: '',
      sfdxHardisDescription: '',
      soqlQuery: 'SELECT Id,Name FROM Opportunity',
      fileTypes: 'all',
      outputFolderNameField: 'Name',
      outputFileNameFormat: 'title',
      overwriteParentRecords: true,
      overwriteFiles: false,
      fileSizeMin: 0,
    };

    this.exportConfig = await promptFilesExportConfiguration(defaultConfig, false);
    // Collect / reformat data
    this.filesExportPath = pascalcase(this.exportConfig.filesExportPath);
    delete this.exportConfig.filesExportPath;
  }

  private async buildExportJsonInfoFromTemplate(templateFile) {
    const templateName = path.basename(templateFile).replace('.json', '');
    this.filesExportPath = pascalcase(templateName);
    this.exportConfig = JSON.parse(fs.readFileSync(templateFile, 'utf-8'));
  }
}
