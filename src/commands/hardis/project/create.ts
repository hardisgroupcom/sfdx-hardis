/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { ensureGitRepository, execCommand, uxLog } from "../../../common/utils";
import { prompts } from "../../../common/utils/prompts";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { getConfig, setConfig } from "../../../config";
import { WebSocketClient } from "../../../common/websocketClient";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ProjectCreate extends SfdxCommand {
  public static title = "Login";

  public static description = "Create a new SFDX Project";

  public static examples = ["$ sfdx hardis:project:create"];

  protected static flagsConfig = {
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
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debugMode || false;
    // Check git repo
    await ensureGitRepository({ clone: true });
    // Connect to DevHub
    await this.config.runHook("auth", {
      checkAuth: true,
      Command: this,
      devHub: true,
      scratch: false,
    });
    // Project name
    let config = await getConfig("project");
    let projectName = config.projectName;
    if (projectName == null) {
      // User prompts
      const projectRes = await prompts({
        type: "text",
        name: "projectName",
        message: "What is the name of your project ?",
      });
      projectName = projectRes.projectName.toLowerCase().replace(" ", "_");
    }

    // Create sfdx project only if not existing
    if (!fs.existsSync("./sfdx-project.json")) {
      const createCommand = "sfdx force:project:create" + ` --projectname "${projectName}"` + " --manifest";
      await execCommand(createCommand, this, {
        output: true,
        fail: true,
        debug: this.debugMode,
      });

      // Move project files at root
      await fs.copy(path.join(process.cwd(), projectName), process.cwd(), {
        overwrite: false,
      });
      await fs.rmdir(path.join(process.cwd(), projectName), { recursive: true });
    }
    // Copy default project files
    uxLog(this, "Copying default files...");
    await fs.copy(path.join(__dirname, "../../../../defaults/ci", "."), process.cwd(), { overwrite: false });

    config = await getConfig("project");
    if (config.developmentBranch == null) {
      // User prompts
      const devBranchRes = await prompts({
        type: "text",
        name: "devBranch",
        message: "What is the name of your development branch ?",
        initial: "developpement",
      });
      await setConfig("project", { developmentBranch: devBranchRes.devBranch });
    }

    await setConfig("project", { autoCleanTypes: ["destructivechanges"] });

    // Message instructions
    uxLog(
      this,
      c.cyan(
        "SFDX Project has been created. You can now customize config/project-scratch-def.json file to add required features and settings.\nhttps://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm"
      )
    );
    uxLog(this, c.cyan(`Then, create a new scratch org using ${c.italic(c.white("sfdx hardis:scratch:create"))}`));
    uxLog(this, c.cyan(`It is also recommended to install FFLib using ${c.italic(c.white("sfdx hardis:package:install"))}`));
    uxLog(this, c.cyan("Then, you can stage, commit and make a pull request to developpement branch"));

    // Trigger commands refresh on VsCode WebSocket Client
    WebSocketClient.sendMessage({ event: "refreshCommands" });

    // Return an object to be displayed with --json
    return { outputString: "Created SFDX Project" };
  }
}
