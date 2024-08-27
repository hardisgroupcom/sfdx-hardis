/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execCommand, uxLog } from "../../../../common/utils/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanRetrieveFolders extends SfCommand<any> {
  public static title = "Retrieve dashboards, documents and report folders in DX sources";

  public static description = "Retrieve dashboards, documents and report folders in DX sources. Use -u ORGALIAS";

  public static examples = ["$ sf hardis:project:clean:retrievefolders"];

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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  /* jscpd:ignore-end */

  protected debugMode = false;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Retrieve dashboards, documents and report folders in DX sources`));

    const rootSourcesFolder = path.join(process.cwd() + "/force-app/main/default");
    const folderTypes = [
      { sourceType: "dashboards", mdType: "Dashboard" },
      { sourceType: "documents", mdType: "Document" },
      { sourceType: "email", mdType: "EmailTemplate" },
      { sourceType: "reports", mdType: "Report" },
    ];

    // Iterate on types, and for each sub folder found, retrieve its SFDX source from org
    for (const folderType of folderTypes) {
      const folderDir = rootSourcesFolder + "/" + folderType.sourceType;
      await this.manageRetrieveFolder(folderDir, folderType);
    }

    // Return an object to be displayed with --json
    return { outputString: "Retrieved folders" };
  }

  private async manageRetrieveFolder(folderDir, folderType) {
    if (!fs.existsSync(folderDir)) {
      return;
    }
    const folderDirContent = await fs.readdir(folderDir);
    for (const subFolder of folderDirContent) {
      const subFolderFull = folderDir + "/" + subFolder;
      if (fs.lstatSync(subFolderFull).isDirectory()) {
        // Retrieve sub folder DX source
        await execCommand(`sf project retrieve start -m ${folderType.mdType}:${subFolder}`, this, {
          fail: true,
          output: true,
          debug: this.debugMode,
        });
        // Check for sub folders
        await this.manageRetrieveFolder(subFolderFull, folderType);
      }
    }
  }
}
