/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import { uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class FixV53Flexipages extends SfdxCommand {
  public static title = "Fix flexipages for v53";

  public static description = `Fix flexipages for apiVersion v53 (Winter22).

Note: Update api version to 53.0 in package.xml and sfdx-project.json`;

  public static examples = ["$ sfdx hardis:project:fix:v53flexipages"];

  protected static flagsConfig = {
    path: flags.string({
      char: "p",
      default: process.cwd(),
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
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected pathToBrowse: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.pathToBrowse = this.flags.path || process.cwd();
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Adding identifiers to componentInstance in flexipages`));
    /* jscpd:ignore-end */

    const globPattern = this.pathToBrowse + `/**/*.flexipage-meta.xml`;

    let counter = 0;
    const flexipages = [];
    const flexipageSourceFiles = await glob(globPattern, { cwd: this.pathToBrowse });
    uxLog(this, c.grey(`Found ${flexipageSourceFiles.length} flexipages`));
    const regexAndReplacements = [
      {
        regex: /(<componentName>.*<\/componentName>\n.*<\/componentInstance>)/gim,
        replace: "</componentName>",
        replaceWith: `</componentName>\n                <identifier>SFDX_HARDIS_REPLACEMENT_ID</identifier>`,
      },
      {
        regex: /(<componentName>.*<\/componentName>\n.*<visibilityRule>)/gim,
        replace: "</componentName>",
        replaceWith: `</componentName>\n                <identifier>SFDX_HARDIS_REPLACEMENT_ID</identifier>`,
      },
      {
        regex: /(<fieldItem>.*<\/fieldItem>\n.*<\/fieldInstance>)/gim,
        replace: "</fieldItem>",
        replaceWith: `</fieldItem>\n                <identifier>SFDX_HARDIS_REPLACEMENT_ID</identifier>`,
      },
    ];
    for (const flexiFile of flexipageSourceFiles) {
      let flexipageRawXml = await fs.readFile(flexiFile, "utf8");
      let found = false;
      for (const replaceParams of regexAndReplacements) {
        const regex = replaceParams.regex;
        let m;
        while ((m = regex.exec(flexipageRawXml)) !== null) {
          found = true;
          // This is necessary to avoid infinite loops with zero-width matches
          if (m.index === regex.lastIndex) {
            regex.lastIndex++;
          }
          // Iterate thru the regex matches
          m.forEach((match, groupIndex) => {
            console.log(`Found match, group ${groupIndex}: ${match}`);
            const newId = "sfdxHardisId" + counter;
            const replaceWith = replaceParams.replaceWith.replace("SFDX_HARDIS_REPLACEMENT_ID", newId);
            const replacementWithIdentifier = match.replace(replaceParams.replace, replaceWith);
            flexipageRawXml = flexipageRawXml.replace(match, replacementWithIdentifier);
            if (!flexipages.includes(flexiFile)) {
              flexipages.push(flexiFile);
            }
            counter++;
          });
        }
        if (found) {
          await fs.writeFile(flexiFile, flexipageRawXml);
          uxLog(this, c.grey("Updated " + flexiFile));
        }
      }
    }

    // Summary
    const msg = `Added ${c.green(c.bold(counter))} identifiers in ${c.green(c.bold(flexipages.length))} flexipages`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg, updatedNumber: counter, updated: flexipages };
  }
}
