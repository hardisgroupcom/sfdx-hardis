/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from 'fs-extra';
import * as glob from "glob-promise";
import * as path from 'path';
import { uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanStanrdItems extends SfdxCommand {
  public static title = "Clean retrieved managed items in dx sources";

  public static description = "Remove unwanted managed items within sfdx project sources";

  public static examples = [
    "$ sfdx hardis:project:clean:manageditems",
  ];

  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  /* jscpd:ignore-end */

  protected debugMode = false;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Removing unwanted dx source files...`));

    const classesFolder = path.join(process.cwd()+"/force-app/main/default/classes");
    const findManagedClassesPattern = classesFolder+'/*__*';
    const matchingCustomFiles = await glob(findManagedClassesPattern, { cwd: process.cwd() });
    for (const matchingCustomFile of matchingCustomFiles) {
          await fs.remove(matchingCustomFile);
          uxLog(this,c.cyan(`Removed managed class ${c.yellow(matchingCustomFile)}`));
    }

    // Return an object to be displayed with --json
    return { outputString: "Cleaned standard items from sfdx project" };
  }

}
