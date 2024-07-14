/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { FilesImporter, selectFilesWorkspace } from "../../../../common/utils/filesUtils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class FilesImport extends SfdxCommand {
  public static title = "Import files";

  public static description = `Import file attachments into a Salesforce org

See article below to see how to Export them.

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)
`;

  public static examples = ["$ sfdx hardis:org:files:import"];

  protected static flagsConfig = {
    path: flags.string({
      char: "p",
      description: "Path to the file export project",
    }),
    overwrite: flags.boolean({
      char: "o",
      description: "Override existing files (doubles the number of API calls)",
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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  protected handleOverwrite;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let filesPath = this.flags.path || null;
    this.handleOverwrite = this.flags?.overwrite === true;

    // Identify files workspace if not defined
    if (filesPath == null) {
      filesPath = await selectFilesWorkspace({ selectFilesLabel: "Please select a files workspace to IMPORT" });
    }

    if (!isCI) {
      const handleOverwriteRes = await prompts({
        type: "confirm",
        name: "value",
        message: "Do you want to overwrite the existing files with the same name ? (doubles the number of used API calls)",
      });
      this.handleOverwrite = handleOverwriteRes.value;
    }

    const importOptions: any = { handleOverwrite: this.handleOverwrite };

    // Import files into org
    const importResult = await new FilesImporter(filesPath, this.org.getConnection(), importOptions, this).processImport();

    // Output message
    const message = `Successfully imported files from project ${c.green(filesPath)} from org ${c.green(this.org.getUsername())}`;
    uxLog(this, c.cyan(message));

    return { outputString: message, importResult: importResult };
  }
}
