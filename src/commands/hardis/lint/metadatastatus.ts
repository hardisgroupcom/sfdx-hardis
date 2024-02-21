/* jscpd:ignore-start */
// External Libraries and Node.js Modules
import * as glob from "glob-promise";
import * as fs from "fs-extra";
import path = require("path");

// Salesforce Specific
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";

// Project Specific Utilities
import { uxLog } from "../../../common/utils";
import { NotifProvider } from "../../../common/notifProvider";
import { MessageAttachment } from "@slack/types";
import { getBranchMarkdown, getNotificationButtons } from "../../../common/utils/notifUtils";
import { generateCsvFile, generateReportPath } from "../../../common/utils/filesUtils";
import { GLOB_IGNORE_PATTERNS } from "../../../common/utils/projectUtils";

// Initialize and Load Messages
Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages("sfdx-hardis", "org");
/* jscpd:ignore-end */
export default class metadatastatus extends SfdxCommand {
  public static title = "check inactive metadatas";
  public static description = "Check if elements(flows) are inactive in the project";
  public static examples = ["$ sfdx hardis:lint:metadatastatus"];
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
  private flowFilePattern = "**/flows/**/*.flow-meta.xml";
  private validationRuleFilePattern = "**/objects/**/validationRules/*.validationRule-meta.xml";
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;
  protected outputFile: string;
  protected outputFilesRes: any = {};

  public async run(): Promise<AnyJson> {
    const draftFlows = await this.verifyFlows();
    const inactiveValidationRules = await this.verifyValidationRules();

    if (draftFlows.length > 0 || inactiveValidationRules.length > 0) {
      const attachments: MessageAttachment[] = [];
      if (draftFlows.length > 0) {
        attachments.push({
          text: `*Inactive Flows*\n${draftFlows.map((file) => `• ${file}`).join("\n")}`,
        });
      }

      if (inactiveValidationRules.length > 0) {
        attachments.push({
          text: `*Inactive Validation Rules*\n${inactiveValidationRules.map((file) => `• ${file}`).join("\n")}`,
        });
      }

      await this.buildCsvFile(draftFlows, inactiveValidationRules);

      const branchMd = await getBranchMarkdown();
      const notifButtons = await getNotificationButtons();
      globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
      NotifProvider.postNotifications({
        type: "METADATA_STATUS",
        text: `Inactive configuration elements in ${branchMd}`,
        attachments: attachments,
        buttons: notifButtons,
        severity: "warning",
        sideImage: "flow",
        attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      });
    } else {
      uxLog(this, "No draft flow or validation rule files detected.");
    }
    return {};
  }

  /**
   * This function verifies the status of flows by checking each flow file.
   * It reads each flow file and checks if the flow is in 'Draft' status.
   * If the flow is in 'Draft' status, it extracts the file name and adds it to the list of draft files.
   *
   * @returns {Promise<string[]>} - A Promise that resolves to an array of draft files. Each entry in the array is the name of a draft file.
   */
  private async verifyFlows(): Promise<string[]> {
    const draftFiles: string[] = [];
    const flowFiles: string[] = await glob(this.flowFilePattern, { ignore: this.ignorePatterns });
    for (const file of flowFiles) {
      const flowContent: string = await fs.readFile(file, "utf-8");
      if (flowContent.includes("<status>Draft</status>")) {
        const fileName = path.basename(file, ".flow-meta.xml");
        draftFiles.push(fileName);
      }
    }

    return draftFiles;
  }

  /**
   * This function verifies the validation rules by checking each rule file for inactive rules.
   * It reads each validation rule file and checks if the rule is active or not.
   * If the rule is inactive, it extracts the rule name and the object name and adds them to the list of inactive rules.
   *
   * @returns {Promise<string[]>} - A Promise that resolves to an array of inactive rules. Each entry in the array is a string in the format 'ObjectName - RuleName'.
   */
  private async verifyValidationRules(): Promise<string[]> {
    const inactiveRules: string[] = [];
    const validationRuleFiles: string[] = await glob(this.validationRuleFilePattern, { ignore: this.ignorePatterns });

    for (const file of validationRuleFiles) {
      const ruleContent: string = await fs.readFile(file, "utf-8");
      if (ruleContent.includes("<active>false</active>")) {
        const ruleName = path.basename(file, ".validationRule-meta.xml");
        const objectName = path.basename(path.dirname(path.dirname(file)));
        inactiveRules.push(`${objectName} - ${ruleName}`);
      }
    }

    return inactiveRules;
  }

  /**
   * This function builds a CSV file from arrays of draft flows and inactive validation rules.
   * It first ensures that the output file path is generated.
   * It then maps the draft flows and inactive validation rules into an array of objects, each with a 'type' property set to either "Draft Flow" or "Inactive VR" and a 'name' property set to the file or rule name.
   * Finally, it generates a CSV file from this array and writes it to the output file.
   *
   * @param {string[]} draftFlows - An array of draft flow names.
   * @param {string[]} inactiveValidationRules - An array of inactive validation rule names.
   * @returns {Promise<void>} - A Promise that resolves when the CSV file has been successfully generated.
   */
  private async buildCsvFile(draftFlows: string[], inactiveValidationRules: string[]): Promise<void> {
    this.outputFile = await generateReportPath("lint-metadatastatus", this.outputFile);

    const csvData = [
      ...draftFlows.map((file) => ({ type: "Draft Flow", name: file })),
      ...inactiveValidationRules.map((rule) => ({ type: "Inactive VR", name: rule })),
    ];

    this.outputFilesRes = await generateCsvFile(csvData, this.outputFile);
  }
}
