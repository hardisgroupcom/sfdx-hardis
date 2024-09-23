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

  public static description = `Configure export of file attachments from a Salesforce org

See article below

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)
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

    // Trigger command to open SFDMU config file in VsCode extension
    WebSocketClient.requestOpenFile(exportJsonFile);

    // Set bac initial cwd
    const message = c.cyan(`Successfully initialized files export project ${c.green(
      filesProjectFolder
    )}, with ${c.green('export.json')} file.
You can now call it using ${c.white('sf hardis:org:files:export')}
`);
    uxLog(this, message);
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
      description: 'Configure your files import/export from scratch :)',
    };

    const templateResp = await prompts({
      type: 'select',
      name: 'template',
      message: c.cyanBright('Please select a Files import/export template, or the blank one'),
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
