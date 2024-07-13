/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as pascalcase from "pascalcase";
import * as path from "path";
import { uxLog } from "../../../../common/utils";
import { dataFolderRoot } from "../../../../common/utils/dataUtils";
import { prompts } from "../../../../common/utils/prompts";
import { WebSocketClient } from "../../../../common/websocketClient";
import { getConfig, setConfig } from "../../../../config";
import { PACKAGE_ROOT_DIR } from "../../../../settings";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ConfigureData extends SfdxCommand {
  public static title = "Configure Data project";

  public static description = `Configure Data Export/Import with a [SFDX Data Loader](https://help.sfdmu.com/) Project

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)
`;

  public static examples = ["$ sfdx hardis:org:configure:data"];

  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdmu"];
  additionalFiles: any = [];
  dataPath: string;
  sfdmuConfig: any;
  importInScratchOrgs: boolean;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const template = await this.selectTemplate();

    if (template === "blank") {
      // Request info to build sfdmu workspace
      await this.buildExportJsonInfo();
    } else {
      await this.buildExportJsonInfoFromTemplate(template);
    }

    // Check if not already existing
    const { exportJsonFile, sfdmuProjectFolder } = await this.generateConfigurationFiles();

    await this.promptImportInScratchOrgs(sfdmuProjectFolder);

    // Set bac initial cwd
    const message = c.cyan(`Successfully initialized sfdmu project ${c.green(sfdmuProjectFolder)}, with ${c.green("export.json")} file.
You can now configure it using SFDMU documentation: https://help.sfdmu.com/plugin-basics/basic-usage/minimal-configuration
If you don't have unique field to identify an object, use composite external ids: https://help.sfdmu.com/full-documentation/advanced-features/composite-external-id-keys
`);
    uxLog(this, message);

    // Trigger command to open SFDMU config file in VsCode extension
    WebSocketClient.requestOpenFile(exportJsonFile);

    return { outputString: message };
  }

  private async generateConfigurationFiles() {
    const sfdmuProjectFolder = path.join(dataFolderRoot, this.dataPath);
    if (fs.existsSync(sfdmuProjectFolder)) {
      throw new SfdxError(`[sfdx-hardis]${c.red(`Folder ${c.bold(sfdmuProjectFolder)} already exists`)}`);
    }

    // Create folder & export.json
    await fs.ensureDir(sfdmuProjectFolder);
    const exportJsonFile = path.join(sfdmuProjectFolder, "export.json");
    await fs.writeFile(exportJsonFile, JSON.stringify(this.sfdmuConfig, null, 2));
    uxLog(this, "Generated SFDMU config file " + exportJsonFile);

    for (const additionalFile of this.additionalFiles) {
      const additionalFileFull = path.join(sfdmuProjectFolder, additionalFile.path);
      await fs.writeFile(additionalFileFull, additionalFile.text);
      uxLog(this, c.cyan(additionalFile.message + ": ") + c.yellow(additionalFileFull));
      WebSocketClient.requestOpenFile(additionalFileFull);
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
          operation: "Upsert",
          externalId: "Name",
        },
      ],
    };

    // Manage badwords filter option
    if (additionalConfig.includes("badwordsFilter")) {
      const badwordsFileName = "badwords.json";
      this.sfdmuConfig.objects[0] = [
        {
          query: "SELECT all FROM Lead",
          operation: "Readonly",
          targetRecordsFilter: "core:DetectBadwords",
          filterRecordsAddons: [
            {
              module: "core:RecordsFilter",
              args: {
                filterType: "BadWords",
                settings: {
                  badwordsFile: badwordsFileName,
                  detectFields: ["Description"],
                  highlightWords: true,
                  outputMatches: false,
                },
              },
            },
          ],
        },
      ];
      if (!fs.existsSync("badwords.json")) {
        const badwordsSample = {
          badwords: ["write", "your", "bad", "words", "and expressions", "here"],
        };
        this.additionalFiles.push({
          path: badwordsFileName,
          text: JSON.stringify(badwordsSample, null, 2),
          message: "Sample badwords file has been generated and needs to be updated",
        });
      }
    }
  }

  private async promptExportInfo() {
    return await prompts([
      {
        type: "text",
        name: "dataPath",
        message: c.cyanBright('Please input the SFDMU folder name (PascalCase format). Ex: "ProductsActive"'),
      },
      {
        type: "text",
        name: "sfdxHardisLabel",
        message: c.cyanBright('Please input the SFDMU config label. Ex: "Active Products"'),
      },
      {
        type: "text",
        name: "sfdxHardisDescription",
        message: c.cyanBright(
          'Please input the SFDMU config description. Ex: "Active products are used for scratch org initialization and in deployments"'
        ),
      },
      {
        type: "multiselect",
        name: "additional",
        message: c.cyanBright("Please select additional options if you need them. If not, just select nothing and continue"),
        choices: [
          {
            title: "Bad words detector",
            description: "Can detect a list of bad words in records",
            value: "badwordsFilter",
          },
        ],
      },
    ]);
  }

  private async selectTemplate() {
    const templateChoices = [];
    const templatesFolder = path.join(PACKAGE_ROOT_DIR, "defaults/templates/sfdmu");
    const templateFiles = fs.readdirSync(templatesFolder);
    for (const templateFile of templateFiles) {
      const templateName = path.basename(templateFile).replace(".json", "");
      templateChoices.push({
        title: templateName,
        value: templateFile,
        description: `sfdx-hardis template for ${templateName}`,
      });
    }

    const defaultTemplateChoice = { title: "Blank template", value: "blank", description: "Configure your data import/export from scratch :)" };

    const templateResp = await prompts({
      type: "select",
      name: "template",
      message: c.cyanBright("Please select a SFDMU template, or the blank one"),
      choices: [...[defaultTemplateChoice], ...templateChoices],
    });
    return templateResp.template;
  }

  private async buildExportJsonInfoFromTemplate(templateFile) {
    const templateName = path.basename(templateFile).replace(".json", "");
    this.dataPath = pascalcase(templateName);
    this.sfdmuConfig = JSON.parse(fs.readFileSync(templateFile, "utf-8"));
  }

  private async promptImportInScratchOrgs(sfdmuProjectFolder) {
    const importResp = await prompts({
      type: "confirm",
      name: "importInScratchOrgs",
      message: c.cyanBright("Do you want this SFDMU config to be used to import data when initializing a new scratch org ?"),
      default: false,
    });
    this.importInScratchOrgs = importResp.confirm === true;

    // Manage dataPackages if importInScratchOrgs is true
    if (this.importInScratchOrgs === true) {
      const config = await getConfig("project");
      const dataPackages = config.dataPackages || [];
      dataPackages.push({ dataPath: sfdmuProjectFolder.replace(/\\/g, "/"), importInScratchOrgs: true });
      await setConfig("project", { dataPackages: dataPackages });
    }
  }
}
