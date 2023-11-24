/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as glob from "glob-promise";
import { uxLog } from "../../../common/utils";
import * as fs from "fs-extra";
import { MessageAttachment } from "@slack/types";
import { NotifProvider } from "../../../common/notifProvider";
import { generateCsvFile, generateReportPath } from "../../../common/utils/filesUtils";
import path = require("path");
import { getBranchMarkdown, getNotificationButtons } from "../../../common/utils/notifUtils";
Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Metadatastatus extends SfdxCommand {
  public static title = "check inactive metadatas";
  public static description = "Check if elements(flows) are inactive in the projec";
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
  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;
  private flowFilePattern = "**/flows/**/*.flow-meta.xml";
  private ignorePatterns: string[] = [
    "**/node_modules/**",
    "**/.git/**",
    "**/cache/**",
    "**/.npm/**",
    "**/logs/**",
    "**/.sfdx/**",
    "**/.sf/**",
    "**/.vscode/**",
    "**/node_modules/**",
  ];
  protected outputFile: string;

  public async run(): Promise<AnyJson> {
    const draftFiles = await this.verifyFlows();
    if (draftFiles.length > 0) {
      const attachments: MessageAttachment[] = [
        {
          text: `*Inactive Flows*\n${draftFiles.map((file) => `• ${file}`).join("\n")}`,
        },
      ];
      const branchMd = await getBranchMarkdown();
      const notifButtons = await getNotificationButtons();

      NotifProvider.postNotifications({
        text: `Inactive metadatas detected in ${branchMd}\n`,
        attachments: attachments,
        buttons: notifButtons,
        severity: "warning",
        sideImage: "flow",
      });

      this.buildCsvFile(draftFiles);
    } else {
      uxLog(this, "No draft flow files detected.");
    }
    return {};
  }

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

  private async buildCsvFile(draftFiles: string[]): Promise<void> {
    if (this.outputFile == null) {
      this.outputFile = await generateReportPath("lint-unusedmetadatas-");
    } else {
      await fs.ensureDir(path.dirname(this.outputFile));
    }

    const csvData = draftFiles.map((file) => ({ type: "Draft Flow", name: file }));
    await generateCsvFile(csvData, this.outputFile);
  }
}
