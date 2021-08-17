/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { WebSocketClient } from "../../../common/websocketClient";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class WebSocketAction extends SfdxCommand {
  public static title = "WebSocket operations";

  public static description = "Technical calls to WebSocket functions";

  public static examples = ["$ sfdx hardis:work:ws --event refreshStatus"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    event: flags.string({
      char: "e",
      description: "WebSocket event",
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

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;
  protected event = "";

  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    this.event = this.flags.event || "";

    if (WebSocketClient.isAlive()) {
      if (this.event === "refreshStatus") {
        WebSocketClient.sendMessage({ event: "refreshStatus" });
      }
    }

    // Return an object to be displayed with --json
    return { event: this.event };
  }
}
