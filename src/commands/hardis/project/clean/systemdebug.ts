/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { glob } from "glob";
import * as path from "path";
import { uxLog } from "../../../../common/utils/index.js";
import * as fs from "fs-extra";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanSystemDebug extends SfCommand<any> {
  public static title = "Clean System debug";

  public static description = "Clean System.debug() lines in APEX Code (classes and triggers)";

  public static examples = ["$ sf hardis:project:clean:systemdebug"];

  public static flags = {
    folder: Flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
    delete: Flags.boolean({
      char: "d",
      default: false,
      description: "Delete lines with System.debug",
    }),
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected folder: string;
  protected del = false;

  public async run(): Promise<AnyJson> {
    this.folder = flags.folder || "./force-app";
    this.del = flags.delete || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Comment or delete System.debug line in apex classes and triggers`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.{cls,trigger}`;
    const matchingFiles = await glob(findManagedPattern, { cwd: process.cwd() });
    let countFiles = 0;
    for (const apexFile of matchingFiles) {
      const fileText = await fs.readFile(apexFile, "utf8");
      const fileLines = fileText.split("\n");
      let counter = 0;
      let writeF = false;
      for (const line of fileLines) {
        if ((line.includes("System.debug") || line.includes("system.debug")) && !line.includes("NOPMD")) {
          if (!this.del && line.trim().substring(0, 2) != "//") {
            fileLines[counter] = line.replace("System.debug", "// System.debug").replace("system.debug", "// system.debug");
            writeF = true;
          } else if (this.del) {
            delete fileLines[counter];
            writeF = true;
          }
        }
        counter++;
      }
      if (writeF) {
        const joinLines = fileLines.join("\n");
        await fs.writeFile(apexFile, joinLines, "utf8");
        countFiles++;
      }
    }

    // Summary
    const msg = `Cleaned ${c.green(c.bold(countFiles))} class(es) and trigger(s)`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
