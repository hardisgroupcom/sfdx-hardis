/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from "path";
import { uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanManagedItems extends SfdxCommand {
  public static title = "Clean retrieved managed items in dx sources";

  public static description = "Remove unwanted managed items within sfdx project sources";

  public static examples = ["$ sfdx hardis:project:clean:manageditems --namespace crta"];

  protected static flagsConfig = {
    namespace: flags.string({
      char: "n",
      default: "",
      description: "Namespace to remove",
    }),
    folder: flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
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
  protected static requiresProject = true;

  protected namespace: string;
  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.namespace = this.flags.namespace || "";
    this.folder = this.flags.folder || "./force-app";
    this.debugMode = this.flags.debug || false;

    if (this.namespace === "") {
      throw new SfdxError("namespace argument is mandatory");
    }

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Removing unwanted dx managed source files with namespace ${c.bold(this.namespace)}...`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/${this.namespace}__*`;
    const matchingCustomFiles = await glob(findManagedPattern, { cwd: process.cwd() });
    for (const matchingCustomFile of matchingCustomFiles) {
      if (!fs.existsSync(matchingCustomFile)) {
        continue;
      }
      // Do not remove managed folders when there are local custom items defined on it
      if (fs.lstatSync(matchingCustomFile).isDirectory()) {
        const localItems = await this.folderContainsLocalItems(matchingCustomFile);
        if (localItems) {
          continue;
        }
      }
      // Keep .object-meta.xml item if there are local custom items defined on it
      if (matchingCustomFile.endsWith(".object-meta.xml")) {
        const localItems = await this.folderContainsLocalItems(path.dirname(matchingCustomFile));
        if (localItems) {
          continue;
        }
      }
      await fs.remove(matchingCustomFile);
      uxLog(this, c.cyan(`Removed managed item ${c.yellow(matchingCustomFile)}`));
    }

    // Return an object to be displayed with --json
    return { outputString: "Cleaned managed items from sfdx project" };
  }

  private async folderContainsLocalItems(folder: string): Promise<boolean> {
    // Do not remove managed folders when there are local custom items defined on it
    const subFiles = await glob(folder + "/**/*", { cwd: process.cwd() });
    const standardItems = subFiles.filter((file) => {
      return !fs.lstatSync(file).isDirectory() && !path.basename(file).startsWith(`${this.namespace}__`);
    });
    if (standardItems.length > 0) {
      return true;
    }
    return false;
  }
}
