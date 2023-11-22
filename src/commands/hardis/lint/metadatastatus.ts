/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as glob from "glob-promise";
import { uxLog } from "../../../common/utils";
import * as fs from "fs-extra";
import { MessageAttachment } from "@slack/types";
import { NotifProvider } from "../../../common/notifProvider";
//TODO getConfig Unused how to use this ?
// import { getConfig } from "../../../config";
// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);
// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Metadatastatus extends SfdxCommand {
  public static title = "check permission access";
  public static description = "Check if elements(apex class and field) are at least in one permission set";
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

  private flowDirectory = ["force-app/main/default/flows"];

  public async run(): Promise<AnyJson> {
    // const config = await getConfig("user");
    const draftFiles = await this.verifyFlows();
    if (draftFiles.length > 0) {
      const notifMessage = `Draft flow files detected in your org`;
      const attachments: MessageAttachment[] = [
        {
          text: draftFiles.map((file) => `* ${file}`).join("\n"),
        },
      ];

      NotifProvider.postNotifications({
        text: notifMessage,
        attachments: attachments,
        severity: "warning",
        sideImage: "flow", // ou toute autre image que vous souhaitez associer
      });
    } else {
      uxLog(this, "No draft flow files detected.");
    }
    return {};
  }

  private async verifyFlows(): Promise<string[]> {
    const draftFiles: string[] = [];

    for (const directory of this.flowDirectory) {
      const directoryFiles: string[] = glob.sync(`${directory}/**/*.*`);

      for (const file of directoryFiles) {
        const flowContent: string = await fs.readFile(file, "utf-8");

        if (flowContent.includes("<status>Draft</status>")) {
          draftFiles.push(file);
        }
      }
    }

    return draftFiles;
  }
}
