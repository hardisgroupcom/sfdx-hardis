/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import pascalcase from 'pascalcase';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { DATA_FOLDERS_ROOT } from '../../../../common/utils/dataUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { getConfig, setConfig } from '../../../../config/index.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigureData extends SfCommand<any> {
  public static title = 'Configure Data project';

  public static description = `
## Command Behavior

**Configures a Salesforce Data Migration Utility (SFDMU) project for data export and import operations.**

This command assists in setting up SFDMU workspaces, which are essential for managing data within your Salesforce environments. It streamlines the creation of \`export.json\` files and related configurations, enabling efficient data seeding, migration, and synchronization.

Key functionalities:

- **Template-Based Configuration:** Allows you to choose from predefined SFDMU templates or start with a blank configuration. Templates can pre-populate \`export.json\` with common data migration scenarios.
- **Interactive Setup:** Guides you through the process of defining the SFDMU project folder name, label, and description.
- **\`export.json\` Generation:** Creates the \`export.json\` file, which is the core configuration file for SFDMU, defining objects to export/import, queries, and operations.
- **Additional File Generation:** Can generate additional configuration files, such as a \`badwords.json\` file for data filtering scenarios.
- **Scratch Org Integration:** Offers to automatically configure the SFDMU project to be used for data import when initializing a new scratch org, ensuring consistent test data across development environments.

See this article for a practical example:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SFDMU Integration:** It acts as a setup wizard for SFDMU, generating the necessary configuration files that the \`sfdmu\` plugin consumes.
- **Interactive Prompts:** Uses the \`prompts\` library to gather user input for various configuration parameters, such as the data path, label, and description.
- **File System Operations:** Employs \`fs-extra\` to create directories (e.g., \`data/your-project-name/\`) and write the \`export.json\` and any additional configuration files.
- **JSON Manipulation:** Constructs the \`export.json\` content dynamically based on user input and selected templates, including defining objects, queries, and operations.
- **PascalCase Conversion:** Uses \`pascalcase\` to format the SFDMU folder name consistently.
- **Configuration Persistence:** Updates the project's \`sfdx-hardis.yml\` file (via \`setConfig\`) to include the newly configured data package if it's intended for scratch org initialization.
- **WebSocket Communication:** Uses \`WebSocketClient.requestOpenFile\` to open the generated \`export.json\` file in VS Code, facilitating immediate configuration.
- **Required Plugin Check:** Explicitly lists \`sfdmu\` as a required plugin, ensuring the necessary dependency is present.
</details>
`;

  public static examples = ['$ sf hardis:org:configure:data'];

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

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdmu'];
  additionalFiles: any = [];
  dataPath: string;
  sfdmuConfig: any;
  importInScratchOrgs: boolean;

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
    const { exportJsonFile, sfdmuProjectFolder } = await this.generateConfigurationFiles();

    await this.promptImportInScratchOrgs(sfdmuProjectFolder);

    // Set bac initial cwd
    const sfdmuBaseDoc = "https://help.sfdmu.com/configuration";
    const sfdmuExternalIdsDoc = "https://help.sfdmu.com/full-documentation/advanced-features/composite-external-id-keys";
    const message = c.cyan(`Successfully initialized sfdmu project ${c.green(sfdmuProjectFolder)}, with ${c.green(
      'export.json'
    )} file.`);
    uxLog("other", this, message);
    uxLog("log", this, c.grey(`You can now configure it using SFDMU documentation: ${c.yellow(sfdmuBaseDoc)}.`));
    uxLog("log", this, c.grey(`If you don't have a unique field to identify an object, use composite external ids: ${c.yellow(sfdmuExternalIdsDoc)}.`));

    // Trigger command to open SFDMU config file in VS Code extension
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(exportJsonFile, 'Edit your SFDMU export.json file', 'report');
      WebSocketClient.sendReportFileMessage(sfdmuBaseDoc, 'SFDMU documentation (Basic)', 'docUrl');
      WebSocketClient.sendReportFileMessage(sfdmuExternalIdsDoc, 'SFDMU documentation (External Ids)', 'docUrl');
    }
    else {
      WebSocketClient.requestOpenFile(exportJsonFile);
    }

    return { outputString: message };
  }

  private async generateConfigurationFiles() {
    const sfdmuProjectFolder = path.join(DATA_FOLDERS_ROOT, this.dataPath);
    if (fs.existsSync(sfdmuProjectFolder)) {
      throw new SfError(`[sfdx-hardis]${c.red(`Folder ${c.bold(sfdmuProjectFolder)} already exists`)}`);
    }

    // Create folder & export.json
    await fs.ensureDir(sfdmuProjectFolder);
    const exportJsonFile = path.join(sfdmuProjectFolder, 'export.json');
    await fs.writeFile(exportJsonFile, JSON.stringify(this.sfdmuConfig, null, 2));
    uxLog("action", this, c.cyan('Generated SFDMU config file ' + exportJsonFile));

    for (const additionalFile of this.additionalFiles) {
      const additionalFileFull = path.join(sfdmuProjectFolder, additionalFile.path);
      await fs.writeFile(additionalFileFull, additionalFile.text);
      uxLog("action", this, c.cyan(additionalFile.message + ': ') + c.yellow(additionalFileFull));
      if (WebSocketClient.isAliveWithLwcUI()) {
        WebSocketClient.sendReportFileMessage(additionalFileFull, additionalFile.message, 'report');
      }
      else {
        WebSocketClient.requestOpenFile(additionalFileFull);
      }
    }
    return { exportJsonFile, sfdmuProjectFolder };
  }

  private async buildExportJsonInfo() {
    const resp = await this.promptExportInfo();

    // Collect / reformat data
    this.dataPath = pascalcase(resp.dataPath);
    const sfdxHardisLabel = resp.sfdxHardisLabel;
    const sfdxHardisDescription = resp.sfdxHardisDescription;
    const additionalConfig: Array<string> = resp.additional || [];

    this.sfdmuConfig = {
      sfdxHardisLabel: sfdxHardisLabel,
      sfdxHardisDescription: sfdxHardisDescription,
      objects: [
        {
          query: "SELECT all FROM Account WHERE Name='sfdx-hardis'",
          operation: 'Upsert',
          externalId: 'Name',
        },
      ],
    };

    // Manage badwords filter option
    if (additionalConfig.includes('badwordsFilter')) {
      const badwordsFileName = 'badwords.json';
      this.sfdmuConfig.objects[0] = [
        {
          query: 'SELECT all FROM Lead',
          operation: 'Readonly',
          targetRecordsFilter: 'core:DetectBadwords',
          filterRecordsAddons: [
            {
              module: 'core:RecordsFilter',
              args: {
                filterType: 'BadWords',
                settings: {
                  badwordsFile: badwordsFileName,
                  detectFields: ['Description'],
                  highlightWords: true,
                  outputMatches: false,
                },
              },
            },
          ],
        },
      ];
      if (!fs.existsSync('badwords.json')) {
        const badwordsSample = {
          badwords: ['write', 'your', 'bad', 'words', 'and expressions', 'here'],
        };
        this.additionalFiles.push({
          path: badwordsFileName,
          text: JSON.stringify(badwordsSample, null, 2),
          message: 'Sample badwords file has been generated and needs to be updated',
        });
      }
    }
  }

  private async promptExportInfo() {
    return await prompts([
      {
        type: 'text',
        name: 'dataPath',
        message: c.cyanBright('Please input the SFDMU folder name (PascalCase format)'),
        description: 'The folder name that will contain the SFDMU data configuration files',
        placeholder: 'Ex: ProductsActive',
      },
      {
        type: 'text',
        name: 'sfdxHardisLabel',
        message: c.cyanBright('Please input the SFDMU config label'),
        description: 'A human-readable label for this data configuration',
        placeholder: 'Ex: Active Products',
      },
      {
        type: 'text',
        name: 'sfdxHardisDescription',
        message: c.cyanBright(
          'Please input the SFDMU config description'
        ),
        description: 'A detailed description explaining what this data configuration does',
        placeholder: 'Ex: Active products are used for scratch org initialization and in deployments',
      },
      {
        type: 'multiselect',
        name: 'additional',
        message: c.cyanBright(
          'Please select additional options if you need them'
        ),
        description: 'Choose optional features to include in the data configuration (select nothing to skip)',
        choices: [
          {
            title: 'Bad words detector',
            description: 'Can detect a list of bad words in records',
            value: 'badwordsFilter',
          },
        ],
      },
    ]);
  }

  private async selectTemplate() {
    const templateChoices: any[] = [];
    const templatesFolder = path.join(PACKAGE_ROOT_DIR, 'defaults/templates/sfdmu');
    const templateFiles = fs.readdirSync(templatesFolder);
    for (const templateFile of templateFiles) {
      const templateName = path.basename(templateFile).replace('.json', '');
      templateChoices.push({
        title: `📝 ${templateName}`,
        value: path.join(templatesFolder, templateFile),
        description: `sfdx-hardis template for ${templateName}`,
      });
    }

    const defaultTemplateChoice = {
      title: '📄 Blank template',
      value: 'blank',
      description: 'Configure your data import/export from scratch 😊',
    };

    const templateResp = await prompts({
      type: 'select',
      name: 'template',
      message: c.cyanBright('Please select a SFDMU template, or the blank one'),
      description: 'Choose a pre-configured SFDMU template for data operations or start with a blank configuration',
      placeholder: 'Select a template',
      choices: [...[defaultTemplateChoice], ...templateChoices],
    });
    return templateResp.template;
  }

  private async buildExportJsonInfoFromTemplate(templateFile) {
    const templateName = path.basename(templateFile).replace('.json', '');
    this.dataPath = pascalcase(templateName);
    this.sfdmuConfig = JSON.parse(fs.readFileSync(templateFile, 'utf-8'));
  }

  private async promptImportInScratchOrgs(sfdmuProjectFolder) {
    const importResp = await prompts({
      type: 'confirm',
      name: 'importInScratchOrgs',
      message: c.cyanBright(
        'Do you want this SFDMU config to be used to import data when initializing a new scratch org ?'
      ),
      description: 'Automatically import this data set when creating new scratch orgs for development and testing',
      default: false,
    });
    this.importInScratchOrgs = importResp.importInScratchOrgs === true;

    // Manage dataPackages if importInScratchOrgs is true
    if (this.importInScratchOrgs === true) {
      const config = await getConfig('project');
      const dataPackages = config.dataPackages || [];
      dataPackages.push({ dataPath: sfdmuProjectFolder.replace(/\\/g, '/'), importInScratchOrgs: true });
      await setConfig('project', { dataPackages: dataPackages });
    }
  }
}
