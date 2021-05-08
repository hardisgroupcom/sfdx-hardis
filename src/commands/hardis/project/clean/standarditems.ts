/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from 'path';
import { uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanStandardItems extends SfdxCommand {
  public static title = "Clean retrieved standard items in dx sources";

  public static description = "Remove unwanted standard items within sfdx project sources";

  public static examples = [
    "$ sfdx hardis:project:clean:standarditems",
  ];

  protected static flagsConfig = {
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
      const objectDir = objectsFolder + '/' + objectDirName;
      // Process only standard objects
      if (fs.lstatSync(objectDir).isDirectory() && !objectDir.includes('__')) {
        const findCustomFieldsPattern = `${objectDir}/fields/*__*`;
        const matchingCustomFiles = await glob(findCustomFieldsPattern, { cwd: process.cwd() });
        if (matchingCustomFiles.length === 0) {
          await fs.remove(objectDir);
          uxLog(this, c.cyan(`Removed folder ${c.yellow(objectDir)}`));
          const sharingRuleFile = path.join(sourceRootFolder, "sharingRules", objectDirName + '.sharingRules-meta.xml');
          if (fs.existsSync(sharingRuleFile)) {
            await fs.remove(sharingRuleFile);
            uxLog(this, c.cyan(`Removed sharing rule ${c.yellow(sharingRuleFile)}`));
          }
        }
        else {
          uxLog(this, c.cyan(`Keep folder ${c.green(objectDir)} because of custom fields found`));
        }
      }
    }

    // Return an object to be displayed with --json
    return { outputString: "Cleaned standard items from sfdx project" };
  }

}
