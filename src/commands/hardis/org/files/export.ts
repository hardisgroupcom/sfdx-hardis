/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { uxLog } from "../../../../common/utils";
import { exportFiles, selectFilesWorkspace } from "../../../../common/utils/filesUtils";


// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class FilesExport extends SfdxCommand {
  public static title = "Export files";

  public static description = "Export files from an org according to a configuration";

  public static examples = ["$ sfdx hardis:org:files:export"];

  protected static flagsConfig = {
    path: flags.string({
      char: "p",
      description: "Path to the file export project",
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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let filesPath = this.flags.path || null;
    //const debugMode = this.flags.debug || false;

    // Identify files workspace if not defined
    if (filesPath == null) {
      filesPath = await selectFilesWorkspace({ selectFilesLabel: "Please select a files workspace to EXPORT" });
    }

    // Export files from org
    const exportResult = await exportFiles(filesPath, this.org.getConnection(), this,);

    // Output message
    const message = `Successfully exported files from project ${c.green(filesPath)} from org ${c.green(this.org.getUsername())}`;
    uxLog(this, c.cyan(message));

    return { outputString: message, exportResult: exportResult };
  }
}
