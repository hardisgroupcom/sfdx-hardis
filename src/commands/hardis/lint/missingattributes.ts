/* jscpd:ignore-start */
// External Libraries and Node.js Modules
import * as fs from "fs-extra";
import * as xml2js from "xml2js";
import { glob } from "glob";
import path = require("path");

// Salesforce Specific
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";

// Project Specific Utilities
import { uxLog } from "../../../common/utils";
import { NotifProvider, NotifSeverity } from "../../../common/notifProvider";
import { MessageAttachment } from "@slack/types";
import { getBranchMarkdown, getNotificationButtons, getSeverityIcon } from "../../../common/utils/notifUtils";
import { generateCsvFile, generateReportPath } from "../../../common/utils/filesUtils";
import { GLOB_IGNORE_PATTERNS } from "../../../common/utils/projectUtils";

// Initialize and Load Messages
Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages("sfdx-hardis", "org");
/* jscpd:ignore-end */
export default class metadatastatus extends SfdxCommand {
  public static title = "check missing description on custom fields";
  public static description = "Check if elements(custom fields) aren't description";
  public static examples = ["$ sfdx hardis:lint:missingattributes"];
  /* jscpd:ignore-start */
  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };
  /* jscpd:ignore-end */

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;
  protected static supportsUsername = true;
  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;
  private objectFileDirectory = "**/objects/**/fields/*.*";
  protected fieldsWithoutDescription = [];
  protected outputFile: string;
  protected outputFilesRes: any = {};
  private nonCustomSettingsFieldDirectories: string[] = [];
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;

  public async run(): Promise<AnyJson> {
    await this.filterOutCustomSettings();
    this.fieldsWithoutDescription = await this.verifyFieldDescriptions();

    // Build notifications
    const branchMd = await getBranchMarkdown();
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = "log";
    let notifText = `No missing descriptions on fields has been found in ${branchMd}`;
    let attachments: MessageAttachment[] = [];
    if (this.fieldsWithoutDescription.length > 0) {
      notifSeverity = "warning";
      notifText = `${this.fieldsWithoutDescription.length} missing descriptions on fields have been found in ${branchMd}`;
      await this.buildCsvFile(this.fieldsWithoutDescription);
      attachments = [
        {
          text: `*Missing descriptions*\n${this.fieldsWithoutDescription.map((file) => `• ${file.name}`).join("\n")}`,
        },
      ];
    } else {
      uxLog(this, "No missing descriptions on fields have been found");
    }
    // Post notifications
    globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: "MISSING_ATTRIBUTES",
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      sideImage: "flow",
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
      const objectMetaFilePath = path.join(path.dirname(path.dirname(directory)), `${objectName}.object-meta.xml`);

      if (fs.existsSync(objectMetaFilePath)) {
        try {
          const objectMetaFileContent = fs.readFileSync(objectMetaFilePath, "utf8");
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
      }),
    );
    const severityIconInfo = getSeverityIcon("info");
    for (let i = 0; i < fieldResults.length; i++) {
      const fieldResult = fieldResults[i];
      if (fieldResult && fieldResult.CustomField) {
        const fieldName = fieldResult.CustomField.fullName[0];
        if (fieldName.endsWith("__c") && !fieldResult.CustomField.description) {
          const fieldFile = this.nonCustomSettingsFieldDirectories[i];
          const objectName = fieldFile.split("/").slice(-3, -2)[0];
          const fullFieldName = `${objectName}.${fieldName}`;
          fieldsWithoutDescription.push({
            name: fullFieldName,
            object: objectName,
            field: fieldName,
            severity: "info",
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
      fs.readFile(filePath, "utf8", (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  private async buildCsvFile(fieldsWithoutDescription: string[]): Promise<void> {
    this.outputFile = await generateReportPath("lint-missingattributes", this.outputFile);
    const csvData = fieldsWithoutDescription.map((field) => ({ type: "Field", name: field }));
    this.outputFilesRes = await generateCsvFile(csvData, this.outputFile);
  }
}
