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

export default class CleanHiddenItems extends SfCommand {
  public static title = "Clean retrieved hidden items in dx sources";

  public static description = "Remove unwanted hidden items within sfdx project sources";

  public static examples = ["$ sf hardis:project:clean:hiddenitems"];

  protected static flagsConfig = {
    folder: Flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
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

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.folder = this.flags.folder || "./force-app";
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Removing hidden dx managed source files`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.{app,cmp,evt,tokens,html,css,js,xml}`;
    const matchingCustomFiles = await glob(findManagedPattern, { cwd: process.cwd() });
    let counter = 0;
    for (const matchingCustomFile of matchingCustomFiles) {
      if (!fs.existsSync(matchingCustomFile)) {
        continue;
      }
      const fileContent = await fs.readFile(matchingCustomFile, "utf8");
      if (fileContent.startsWith("(hidden)")) {
        const componentFolder = path.dirname(matchingCustomFile);
        const folderSplit = componentFolder.split(path.sep);
        const toRemove = folderSplit.includes("lwc") || folderSplit.includes("aura") ? componentFolder : matchingCustomFile;
        await fs.remove(toRemove);
        uxLog(this, c.cyan(`Removed hidden item ${c.yellow(toRemove)}`));
        counter++;
      }
    }

    // Summary
    const msg = `Removed ${c.green(c.bold(counter))} hidden source items`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
