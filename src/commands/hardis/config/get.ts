/* jscpd:ignore-start */

import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { uxLog } from "../../../common/utils";
import { getConfig } from "../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfdxCommand {
  public static title = "Deploy metadata sources to org";

  public static description = "Returns sfdx-hardis project config for a given level";

  public static examples = ["$ sfdx hardis:project:deploy:sources:metadata"];

  protected static flagsConfig = {
    level: flags.string({
      char: "l",
      default: "project",
      description: "project,branch or user",
      options: ["project", "branch", "user"],
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
  protected static requiresUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected configInfo: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const level = this.flags.level || "project";
    this.configInfo = await getConfig(level);
    uxLog(this, JSON.stringify(this.configInfo));
    return {
      config: this.configInfo,
    };
  }
}
