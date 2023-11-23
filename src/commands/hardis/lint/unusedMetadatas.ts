/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as glob from "glob-promise";
import * as fs from "fs-extra";
import * as xml2js from "xml2js";
import { NotifProvider } from "../../../common/notifProvider";
import { MessageAttachment } from "@slack/types";
import { getNotificationButtons } from "../../../common/utils/notifUtils";
import { getBranchMarkdown } from "../../../common/utils/gitUtils";
import { uxLog } from "../../../common/utils";
import path = require("path");
Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class UnusedMetadatas extends SfdxCommand {
  public static title = "check unused labels and custom permissions";
  public static description = "Check if elements (custom labels and custom permissions) are used in the project";
  public static examples = [
    "$ sfdx hardis:lint:access",
    '$ sfdx hardis:lint:access -e "ApexClass:ClassA, CustomField:Account.CustomField"',
    '$ sfdx hardis:lint:access -i "PermissionSet:permissionSetA, Profile"',
  ];
  /* jscpd:ignore-start */
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
  /* jscpd:ignore-end */

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;
  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;
  private directories: string[] = [
    "force-app/main/default/aura",
    "force-app/main/default/assignmentRules",
    "force-app/main/default/classes",
    "force-app/main/default/email",
    "force-app/main/default/flexipages",
    "force-app/main/default/flows",
    "force-app/main/default/lwc",
    "force-app/main/default/objects",
    "force-app/main/default/pages",
    "force-app/main/default/permissionsets",
    "force-app/main/default/quickActions",
    "force-app/main/default/staticresources",
    "force-app/main/default/triggers",
  ];

  private filePath = "force-app/main/default/labels/CustomLabels.labels-meta.xml";
  private directoryPath = "force-app/main/default/customPermissions/*.xml";

  public async run(): Promise<AnyJson> {
    const unusedLabels = await this.verifyLabels();
    const unusedCustomPermissions = await this.verifyCustomPermissions();

    let notifMessage = "";
    const attachments: MessageAttachment[] = [];

    if (unusedLabels.length > 0) {
      notifMessage += `Unused labels detected in your branch. `;
      attachments.push({
        text: `*Unused Labels:*\n${unusedLabels.map((label) => `• ${label}`).join("\n")}`,
      });
    }

    if (unusedCustomPermissions.length > 0) {
      notifMessage += `Unused custom permissions detected. `;
      attachments.push({
        text: `*Unused Custom Permissions:*\n${unusedCustomPermissions.map((permission) => `• ${permission}`).join("\n")}`,
      });
    }

    if (notifMessage) {
      const branchMd = await getBranchMarkdown();
      const notifButtons = await getNotificationButtons();

      NotifProvider.postNotifications({
        text: `Branch ${branchMd}:\n ${notifMessage}`,
        attachments: attachments,
        buttons: notifButtons,
        severity: "warning",
        sideImage: "flow",
      });
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
    return new Promise((resolve, reject) => {
      const unusedLabels: string[] = [];
      fs.readFile(this.filePath, "utf-8", (errorReadingFile, data) => {
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
          const files: string[] = [];
          this.directories.forEach((directory) => {
            const directoryFiles: string[] = glob.sync(`${directory}/**/*.*`);
            directoryFiles.forEach((file) => {
              const content: string = fs.readFileSync(file, "utf-8").toLowerCase();
              files.push(content);
            });
          });

          labelsArray.forEach((label) => {
            const labelLower = `label.${label.toLowerCase()}`;
            const cLower = `c.${label.toLowerCase()}`;
            const found: boolean = files.some((content) => content.includes(labelLower) || content.includes(cLower));
            if (!found) {
              unusedLabels.push(label);
            }
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
    const foundLabels = new Set<string>();
    const files: string[] = glob.sync(this.directoryPath);
    const customPermissionNames = new Set(files.map((filePath) => path.basename(filePath, ".customPermission-meta.xml")));

    for (const dir of this.directories) {
      const dirFiles: string[] = glob.sync(`${dir}/**/*.*`);
      for (const filePath of dirFiles) {
        const fileData: string = fs.readFileSync(filePath, "utf-8");
        for (const label of customPermissionNames) {
          if (fileData.includes(label)) {
            foundLabels.add(label);
          }
        }
      }
    }

    return [...customPermissionNames].filter((label) => !foundLabels.has(label));
  }
}
