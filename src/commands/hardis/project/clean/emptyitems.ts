/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as fs from "fs-extra";
import { glob } from "glob";
import * as path from "path";
import { uxLog } from "../../../../common/utils/index.js";
import { parseXmlFile } from "../../../../common/utils/xmlUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanEmptyItems extends SfCommand<any> {
  public static title = "Clean retrieved empty items in dx sources";

  public static description = "Remove unwanted empty items within sfdx project sources";

  public static examples = ["$ sf hardis:project:clean:emptyitems"];

  public static flags = {
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
  public static requiresProject = true;

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.folder = flags.folder || "./force-app";
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Removing empty dx managed source files`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const emptyConstraints = [
      { globPattern: `/**/*.globalValueSetTranslation-meta.xml`, tags: ["GlobalValueSetTranslation", "valueTranslation"] },
      { globPattern: `/**/*.standardValueSet-meta.xml`, tags: ["StandardValueSet", "standardValue"] },
      { globPattern: `/**/*.sharingRules-meta.xml`, tags: ["SharingRules", "sharingOwnerRules"] },
    ];
    let counter = 0;
    for (const emptyConstraint of emptyConstraints) {
      const findStandardValueSetPattern = rootFolder + emptyConstraint.globPattern;
      const matchingCustomFiles = await glob(findStandardValueSetPattern, { cwd: process.cwd() });
      for (const matchingCustomFile of matchingCustomFiles) {
        const xmlContent = await parseXmlFile(matchingCustomFile);
        const tag1 = xmlContent[emptyConstraint.tags[0]];
        if (!(tag1 && tag1[emptyConstraint.tags[1]])) {
          await fs.remove(matchingCustomFile);
          uxLog(this, c.cyan(`Removed empty item ${c.yellow(matchingCustomFile)}`));
          counter++;
        }
      }
    }

    // Summary
    const msg = `Removed ${c.green(c.bold(counter))} hidden source items`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
