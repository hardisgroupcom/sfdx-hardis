/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import * as glob from "glob-promise";
import { createTempDir, execCommand, isCI, removeObjectPropertyLists, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { parsePackageXmlFile, parseXmlFile, writePackageXmlFile, writeXmlFile } from "../../../../common/utils/xmlUtils";
import { getConfig, setConfig } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanReferences extends SfdxCommand {
  public static title = "Clean references in dx sources";

  public static description = "Remove unwanted references within sfdx project sources";

  public static examples = [
    "$ sfdx hardis:project:clean:references",
    "$ sfdx hardis:project:clean:references --type all",
    "$ sfdx hardis:project:clean:references --config ./cleaning/myconfig.json",
    "$ sfdx hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml",
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    type: flags.string({
      char: "t",
      description: "Cleaning type",
      options: ["all", "caseentitlement", "dashboards", "datadotcom", "destructivechanges", "localfields", "productrequest"],
    }),
    config: flags.string({
      char: "c",
      description: "Path to a JSON config file or a destructiveChanges.xml file",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  /* jscpd:ignore-end */

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  protected debugMode = false;
  protected cleaningTypes = [];
  protected allCleaningTypes = [
    {
      value: "caseentitlement",
      title: "References to Entitlement Management items",
    },
    {
      value: "dashboards",
      title: "Reference to users in Dashboards",
    },
    {
      value: "datadotcom",
      title: "References to Data.com items. https://help.salesforce.com/articleView?id=000320795&type=1&mode=1",
    },
    {
      value: "destructivechanges",
      title: "References to destructiveChanges.xml items",
    },
    {
      value: "localfields",
      title: "References to Local Fields items. https://help.salesforce.com/articleView?id=sf.admin_local_name_fields.htm&type=5",
    },
    {
      value: "listViewsMine",
      title: `Convert scope "Everything" into scope "Mine" on ListViews`,
      command: "sfdx hardis:project:clean:listviews",
    },
    {
      value: "minimizeProfiles",
      title: "Remove profile attributes that exists on permission sets",
      command: "sfdx hardis:project:clean:minimizeprofiles",
    },
    {
      value: "productrequest",
      title: "References to ProductRequest object",
    },
  ];

  protected configFile: string;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.cleaningTypes = this.flags.type ? [this.flags.type] : [];
    this.configFile = this.flags.config || null;
    const config = await getConfig("project");

    // Config file sent by user
    if (this.configFile != null) {
      this.cleaningTypes = [this.configFile.trim()];
    } else {
      // Read list of cleanings to perform in references
      if (this.cleaningTypes.length > 0 && this.cleaningTypes[0] === "all") {
        this.cleaningTypes = config.autoCleanTypes || [];
      }

      // Prompt user cleanings to perform
      if (!isCI && this.cleaningTypes.length === 0) {
        const typesResponse = await prompts({
          type: "multiselect",
          name: "value",
          message: c.cyanBright("What references do you want to clean from your SFDX project sources ?"),
          choices: this.allCleaningTypes,
        });
        this.cleaningTypes = typesResponse.value;
      }
    }

    // Prompt user to save choice in configuration
    const autoCleanTypes = config.autoCleanTypes || [];
    const toAdd = this.cleaningTypes.filter((type) => !autoCleanTypes.includes(type));
    if (toAdd.length > 0 && !isCI && this.flags.type !== "all") {
      const saveResponse = await prompts({
        type: "confirm",
        name: "value",
        default: true,
        message: c.cyanBright("Do you want to save this action in your project configuration, so it is executed at each Work Save ?"),
      });
      if (saveResponse.value === true) {
        autoCleanTypes.push(...this.cleaningTypes);
        await setConfig("project", {
          autoCleanTypes: [...new Set(autoCleanTypes)],
        });
      }
    }

    // Process cleaning
    for (const cleaningType of this.cleaningTypes) {
      const cleaningTypeObj = this.allCleaningTypes.filter((cleaningTypeObj) => cleaningTypeObj.value === cleaningType)[0];
      if (cleaningTypeObj?.command) {
        uxLog(this, c.cyan(`Run cleaning command ${c.bold(cleaningType)} (${cleaningTypeObj.title}) ...`));
        // Command based cleaning
        await execCommand(cleaningTypeObj.command, this, {
          fail: true,
          output: false,
          debug: this.debugMode,
        });
      } else {
        // Template based cleaning
        uxLog(this, c.cyan(`Apply cleaning of references to ${c.bold(cleaningType)} (${cleaningTypeObj.title})...`));
        const filterConfigFile = await this.getFilterConfigFile(cleaningType);
        const cleanCommand =
          "sfdx essentials:metadata:filter-xml-content" +
          ` -c ${filterConfigFile}` +
          ` --inputfolder ./force-app/main/default` +
          ` --outputfolder ./force-app/main/default` +
          " --noinsight";
        await execCommand(cleanCommand, this, {
          fail: true,
          output: false,
          debug: this.debugMode,
        });
      }
    }

    // Clean package.xml file from deleted items
    uxLog(this, c.grey(`Cleaning package.xml files...`));
    const patternPackageXml = process.cwd() + "/**/manifest/**/package*.xml";
    const packageXmlFiles = await glob(patternPackageXml, {
      cwd: process.cwd(),
    });
    for (const packageXmlFile of packageXmlFiles) {
      const packageXmlContent = await parsePackageXmlFile(packageXmlFile);
      const packageXmlContentStr = JSON.stringify(packageXmlContent);
      const newPackageXmlContent = removeObjectPropertyLists(packageXmlContent, this.deleteItems);
      if (packageXmlContentStr !== JSON.stringify(newPackageXmlContent)) {
        await writePackageXmlFile(packageXmlFile, newPackageXmlContent);
        uxLog(this, c.grey("-- cleaned elements from " + packageXmlFile));
      }
    }

    // Delete files when necessary (in parallel)
    uxLog(this, c.grey(`Removing obsolete files...`));
    await Promise.all(
      Object.keys(this.deleteItems).map(async (type) => {
        await this.manageDeleteRelatedFiles(type);
      })
    );

    uxLog(this, c.green(`Cleaning complete`));
    // Return an object to be displayed with --json
    return { outputString: "Cleaned references from sfdx project" };
  }

  private async getFilterConfigFile(cleaningType) {
    const templateFile = path.join(path.join(__dirname, "../../../../../defaults/clean", "template.txt"));
    // Read and complete cleaning template
    let templateContent = await fs.readFile(templateFile, "utf8");
    if (cleaningType === "destructivechanges" || cleaningType.endsWith(".xml")) {
      // destructive changes file
      const destructiveChangesFile = cleaningType.endsWith(".xml") ? cleaningType : "./manifest/destructiveChanges.xml";
      const destructiveChanges = await parseXmlFile(destructiveChangesFile);
      for (const type of destructiveChanges.Package.types || []) {
        const members = type.members;
        templateContent = templateContent.replace(new RegExp(`{{ ${type.name[0]} }}`, "g"), JSON.stringify(members, null, 2));
        this.deleteItems[type.name[0]] = (this.deleteItems[type.name[0]] || []).concat(members);
      }
    } else {
      // Predefined destructive items file
      const filterConfigFileConfigPath = cleaningType.endsWith(".json")
        ? cleaningType
        : path.join(path.join(__dirname, "../../../../../defaults/clean", cleaningType + ".json"));
      const filterConfigFileConfig = JSON.parse(await fs.readFile(filterConfigFileConfigPath, "utf8"));
      for (const type of Object.keys(filterConfigFileConfig.items)) {
        templateContent = templateContent.replace(new RegExp(`{{ ${type} }}`, "g"), JSON.stringify(filterConfigFileConfig.items[type], null, 2));
        this.deleteItems[type] = (this.deleteItems[type] || []).concat(filterConfigFileConfig.items[type]);
      }
    }
    // Create temporary file
    templateContent = templateContent.replace(/{{ .* }}/gm, "[]");
    const tmpCleanFileName = cleaningType.endsWith(".xml") || cleaningType.endsWith(".json") ? path.basename(cleaningType) : cleaningType;
    const filterConfigFile = path.join(await createTempDir(), `clean_${tmpCleanFileName}.json`);
    await fs.writeFile(filterConfigFile, templateContent);
    return filterConfigFile;
  }

  private async manageDeleteRelatedFiles(type) {
    // Custom fields
    if (type === "CustomField") {
      await Promise.all(
        Object.keys(this.deleteItems[type]).map(async (field) => {
          await this.manageDeleteCustomFieldRelatedFiles(field);
        })
      );
    }
  }

  private async manageDeleteCustomFieldRelatedFiles(field: string) {
    // Remove custom field and customTranslation
    const [obj, fld] = field.split(".");
    const patternField = process.cwd() + "/force-app/" + `**/objects/${obj}/fields/${fld}.field-meta.xml`;
    const patternTranslation = process.cwd() + "/force-app/" + `**/objectTranslations/${obj}-*/${fld}.fieldTranslation-meta.xml`;
    for (const pattern of [patternField, patternTranslation]) {
      const matchFiles = await glob(pattern, { cwd: process.cwd() });
      for (const removeFile of matchFiles) {
        await fs.remove(removeFile);
        uxLog(this, c.grey(`Removed file ${removeFile}`));
      }
    }
    // Remove field in recordTypes
    const patternRecordType = process.cwd() + "/force-app/" + `**/objects/${obj}/recordTypes/*.recordType-meta.xml`;
    const matchFilesPattern = await glob(patternRecordType, {
      cwd: process.cwd(),
    });
    for (const recordTypeFile of matchFilesPattern) {
      const recordType = await parseXmlFile(recordTypeFile);
      if (recordType?.RecordType.picklistValues) {
        const updatedPicklistValues = recordType.RecordType.picklistValues.filter((picklistValue) => {
          return picklistValue?.picklist[0] !== fld;
        });
        if (updatedPicklistValues.length !== recordType.RecordType.picklistValues.length) {
          recordType.RecordType.picklistValues = updatedPicklistValues;
          await writeXmlFile(recordTypeFile, recordType);
          uxLog(this, c.grey(`Cleaned file ${recordTypeFile} from ${obj}.${fld}`));
        }
      }
    }
  }
}
