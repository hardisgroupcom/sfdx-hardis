/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import { glob } from "glob";
import * as path from "path";
import { uxLog } from "../../../../common/utils/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanStandardItems extends SfCommand {
  public static title = "Clean retrieved standard items in dx sources";

  public static description = "Remove unwanted standard items within sfdx project sources";

  public static examples = ["$ sf hardis:project:clean:standarditems"];

  protected static flagsConfig = {
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected debugMode = false;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Removing unwanted standard dx source files...`));
    /* jscpd:ignore-end */
    const sourceRootFolder = path.join(process.cwd() + "/force-app/main/default");
    const objectsFolder = path.join(sourceRootFolder + "/objects");
    const objectsFolderContent = await fs.readdir(objectsFolder);
    for (const objectDirName of objectsFolderContent) {
      const objectDir = objectsFolder + "/" + objectDirName;
      // Process only standard objects
      if (fs.lstatSync(objectDir).isDirectory() && !objectDir.includes("__")) {
        const findCustomFieldsPattern = `${objectDir}/fields/*__*`;
        const matchingCustomFiles = await glob(findCustomFieldsPattern, { cwd: process.cwd() });
        if (matchingCustomFiles.length === 0) {
          // Remove the whole folder
          await fs.remove(objectDir);
          uxLog(this, c.cyan(`Removed folder ${c.yellow(objectDir)}`));
          const sharingRuleFile = path.join(sourceRootFolder, "sharingRules", objectDirName + ".sharingRules-meta.xml");
          if (fs.existsSync(sharingRuleFile)) {
            // Remove sharingRule if existing
            await fs.remove(sharingRuleFile);
            uxLog(this, c.cyan(`Removed sharing rule ${c.yellow(sharingRuleFile)}`));
          }
        } else {
          // Remove only standard fields
          const findAllFieldsPattern = `${objectDir}/fields/*.field-meta.xml`;
          const matchingAllFields = await glob(findAllFieldsPattern, { cwd: process.cwd() });
          for (const field of matchingAllFields) {
            if (!field.includes("__")) {
              await fs.remove(field);
              uxLog(this, c.cyan(`  - removed standard field ${c.yellow(field)}`));
            }
          }

          uxLog(this, c.cyan(`Keep folder ${c.green(objectDir)} because of custom fields found`));
        }
      }
    }

    // Return an object to be displayed with --json
    return { outputString: "Cleaned standard items from sfdx project" };
  }
}
