/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as readFilesRecursive from "fs-readdir-recursive";
import * as path from "path";
import { uxLog } from "../../../../common/utils/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class AuditDuplicateFiles extends SfCommand<any> {
  public static title = "Find duplicate sfdx files";

  public static description = "Find duplicate files in sfdx folder (often from past @salesforce/cli bugs)";

  public static examples = ["$ sf hardis:project:audit:duplicatefiles"];

  protected static flagsConfig = {
    path: Flags.string({
      char: "p",
      default: process.cwd(),
      description: "Root path to check",
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
  public static requiresProject = false;
  /* jscpd:ignore-end */

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    const pathToBrowser = this.flags.path || process.cwd();
    this.debug = this.flags.debug || false;

    // List all files
    const allFiles = readFilesRecursive(pathToBrowser)
      .filter((file) => !file.includes("node_modules"))
      .map((file) => {
        return { fullPath: file, fileName: path.basename(file) };
      });

    uxLog(this, c.cyan(`Checking for duplicate file names in ${c.bold(pathToBrowser)}. Files: ${c.bold(allFiles.length)}`));

    // Find duplicates
    const duplicates = {};
    for (const file of allFiles) {
      const doublingFiles = allFiles.filter(
        (f) => f.fileName === file.fileName && f.fullPath !== file.fullPath && !this.checkDoublingAllowed(file, f),
      );
      if (doublingFiles.length > 0) {
        const doublingFullPaths = duplicates[file.fileName] || [];
        doublingFullPaths.push(...doublingFiles.map((f) => f.fullPath));
        duplicates[file.fileName] = doublingFullPaths;
      }
    }
    uxLog(this, JSON.stringify(duplicates, null, 2));
    return { duplicates: duplicates };
  }

  checkDoublingAllowed(file1, file2) {
    const regexes = [
      /objects.*fields.*field-meta\.xml/,
      /objects.*listViews.*listView-meta\.xml/,
      /objects.*recordTypes.*recordType-meta\.xml/,
      /objects.*webLinks.*webLink-meta\.xml/,
    ];
    for (const regex of regexes) {
      if (regex.test(file1.fullPath) && regex.test(file2.fullPath)) {
        return true;
      }
    }
    return false;
  }
}
