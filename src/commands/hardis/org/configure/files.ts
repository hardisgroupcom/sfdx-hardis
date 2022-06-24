/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as pascalcase from "pascalcase";
import * as path from "path";
import { uxLog } from "../../../../common/utils";
import { filesFolderRoot } from "../../../../common/utils/filesUtils";
import { promptFilesExportConfiguration } from "../../../../common/utils/filesUtils";
import { WebSocketClient } from "../../../../common/websocketClient";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ConfigureData extends SfdxCommand {
  public static title = "Configure File export project";

  public static description = `Configure export of file attachments from a Salesforce org

See article below

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)
`;

  public static examples = ["$ sfdx hardis:org:configure:files"];

  protected static flagsConfig = {
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
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Request info to build files export workspace
    const defaultConfig = {
      sfdxHardisLabel: "",
      sfdxHardisDescription: "",
      soqlQuery: "SELECT Id,Name FROM Opportunity",
      fileTypes: "all",
      outputFolderNameField: "Name",
      overwriteParentRecords: true,
      overwriteFiles: false,
    };

    const exportConfig = await promptFilesExportConfiguration(defaultConfig, false);

    // Collect / reformat data
    const filesExportPath = pascalcase(exportConfig.filesExportPath);
    delete exportConfig.filesExportPath;

    // Check if not already existing
    const filesProjectFolder = path.join(filesFolderRoot, filesExportPath);
    if (fs.existsSync(filesProjectFolder)) {
      throw new SfdxError(`[sfdx-hardis]${c.red(`Folder ${c.bold(filesProjectFolder)} already exists`)}`);
    }

    // Create folder & export.json
    await fs.ensureDir(filesProjectFolder);
    const exportJsonFile = path.join(filesProjectFolder, "export.json");
    await fs.writeFile(exportJsonFile, JSON.stringify(exportConfig, null, 2));

    // Trigger command to open SFDMU config file in VsCode extension
    WebSocketClient.requestOpenFile(exportJsonFile);

    // Set bac initial cwd
    const message = c.cyan(`Successfully initialized files export project ${c.green(filesProjectFolder)}, with ${c.green("export.json")} file.
You can now call it using ${c.white("sfdx hardis:org:files:export")}
`);
    uxLog(this, message);
    return { outputString: message };
  }
}
