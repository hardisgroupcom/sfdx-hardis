/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as glob from "glob-promise";
import { uxLog } from "../../../common/utils";
import * as fs from "fs-extra";
//TODO getConfig Unused how to use this ?
// import { getConfig } from "../../../config";
import * as xml2js from "xml2js";
// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);
// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CustomLabels extends SfdxCommand {
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
  private directories: string[] = [
    "force-app/main/default/lwc",
    "force-app/main/default/flows",
    "force-app/main/default/classes",
    "force-app/main/default/email",
    "force-app/main/default/aura",
    "force-app/main/default/flexipages",
    "force-app/main/default/quickActions",
    "force-app/main/default/objects",
    "force-app/main/default/pages",
    "force-app/main/default/staticresources",
  ];

  private filePath = "force-app/main/default/labels/CustomLabels.labels-meta.xml";

  public async run(): Promise<AnyJson> {
    // const config = await getConfig("user");
    const unusedLabels = await this.verifyLabels();

    let comment = ":warning: :warning: :warning: :warning: \n\n";
    if (unusedLabels.length > 0) {
      comment += `**Unused Labels:** \n\nThe following have not been put to use:\n\n${unusedLabels
        .map((label) => `- :label: ${label}`)
        .join("\n")}\n\n`;
      comment += "Please consider revisiting them.\n\n:warning: :warning: :warning: :warning:";
    }
    uxLog(this, comment);
    return {};
  }

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
}
