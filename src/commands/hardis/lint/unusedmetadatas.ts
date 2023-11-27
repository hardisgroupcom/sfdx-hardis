/* jscpd:ignore-start */
// External Libraries
import * as glob from "glob-promise";
import * as fs from "fs-extra";
import * as xml2js from "xml2js";
import path = require("path");

// Salesforce Specific
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";

// Project Specific Utilities
import { NotifProvider } from "../../../common/notifProvider";
import { MessageAttachment } from "@slack/types";
import { getNotificationButtons, getBranchMarkdown } from "../../../common/utils/notifUtils";
import { generateCsvFile, generateReportPath } from "../../../common/utils/filesUtils";
import { uxLog } from "../../../common/utils";
import { GLOB_IGNORE_PATTERNS } from "../../../common/utils/projectUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);
// Load Messages
const messages = Messages.loadMessages("sfdx-hardis", "org");
/* jscpd:ignore-end */
export default class UnusedMetadatas extends SfdxCommand {
  public static title = "check unused labels and custom permissions";
  public static description = "Check if elements (custom labels and custom permissions) are used in the project";
  public static examples = ["$ sfdx hardis:lint:unusedmetadatas"];
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
  protected outputFile: string;
  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;
  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;

  private projectFiles: string[];
  private labelFilePattern = "**/CustomLabels.labels-meta.xml";
  private customPermissionFilePattern = "**/customPermissions/*.xml";

  public async run(): Promise<AnyJson> {
    await this.setProjectFiles();
    const unusedLabels = await this.verifyLabels();
    const unusedCustomPermissions = await this.verifyCustomPermissions();
    const attachments: MessageAttachment[] = [];

    if (unusedLabels.length > 0) {
      attachments.push({
        text: `*Unused Labels*\n${unusedLabels.map((label) => `• ${label}`).join("\n")}`,
      });
    }

    if (unusedCustomPermissions.length > 0) {
      attachments.push({
        text: `*Unused Custom Permissions*\n${unusedCustomPermissions.map((permission) => `• ${permission}`).join("\n")}`,
      });
    }

    if (unusedLabels.length > 0 || unusedCustomPermissions.length > 0) {
      const branchMd = await getBranchMarkdown();
      const notifButtons = await getNotificationButtons();

      NotifProvider.postNotifications({
        type: "UNUSED_METADATAS",
        text: `Unused metadatas detected in ${branchMd}\n`,
        attachments: attachments,
        buttons: notifButtons,
        severity: "warning",
        sideImage: "flow",
      });
      this.buildCsvFile(unusedLabels, unusedCustomPermissions);
    } else {
      uxLog(this, "No unused labels detected or custom permissions detected.");
    }

    return {};
  }

  /**
   * @description Verify if custom labels are used in the project
   * @returns
   */
  private async verifyLabels(): Promise<string[]> {
    const labelFiles = await glob(this.labelFilePattern, { ignore: this.ignorePatterns });
    const labelFilePath = labelFiles[0];

    if (!labelFilePath) {
      console.warn("No label file found.");
      return [];
    }

    return new Promise((resolve, reject) => {
      fs.readFile(labelFilePath, "utf-8", (errorReadingFile, data) => {
        if (errorReadingFile) {
          reject(errorReadingFile);
          return;
        }

        xml2js.parseString(data, (errorParseString, result: any) => {
          if (errorParseString) {
            reject(errorParseString);
            return;
          }

          const labelsArray: string[] = result.CustomLabels.labels.map((label: any) => label.fullName[0]);
          const unusedLabels: string[] = labelsArray.filter((label) => {
            const labelLower = `label.${label.toLowerCase()}`;
            const cLower = `c.${label.toLowerCase()}`;
            const auraPattern = `{!$Label.c.${label.toLowerCase()}}`;
            return !this.projectFiles.some((filePath) => {
              const fileContent = fs.readFileSync(filePath, "utf-8").toLowerCase();
              return fileContent.includes(labelLower) || fileContent.includes(cLower) || fileContent.includes(auraPattern);
            });
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
  private async verifyCustomPermissions(): Promise<string[]> {
    const foundLabels = new Map<string, number>();
    const customPermissionFiles: string[] = await glob(this.customPermissionFilePattern, { ignore: this.ignorePatterns });

    if (!customPermissionFiles) {
      console.warn("No custom permission file found.");
      return [];
    }

    for (const file of customPermissionFiles) {
      const fileData = await fs.readFile(file, "utf-8");
      const fileName = path.basename(file, ".customPermission-meta.xml");
      let label = "";

      xml2js.parseString(fileData, (error, result) => {
        if (error) {
          console.error(`Error parsing XML: ${error}`);
          return;
        }
        label = result.CustomPermission.label[0];
      });

      for (const filePath of this.projectFiles) {
        const fileContent: string = fs.readFileSync(filePath, "utf-8");
        if (fileContent.includes(fileName) || fileContent.includes(label)) {
          const currentCount = foundLabels.get(fileName) || 0;
          foundLabels.set(fileName, currentCount + 1);
        }
      }
    }

    return [...foundLabels.keys()].filter((key) => (foundLabels.get(key) || 0) < 2);
  }

  private async setProjectFiles(): Promise<void> {
    this.projectFiles = await glob("**/*.{cls,trigger,js,html,xml,cmp,email,page}", { ignore: this.ignorePatterns });
  }

  private async buildCsvFile(unusedLabels: string[], unusedCustomPermissions: string[]): Promise<void> {
    this.outputFile = await generateReportPath("lint-unusedmetadatas-", this.outputFile);
    const csvData = [
      ...unusedLabels.map((label) => ({ type: "Label", name: label })),
      ...unusedCustomPermissions.map((permission) => ({ type: "Custom Permission", name: permission })),
    ];

    await generateCsvFile(csvData, this.outputFile);
  }
}
