/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Login extends SfCommand<any> {
  public static title = "Login";

  public static description = messages.getMessage("loginToOrg");

  public static examples = ["$ sf hardis:auth:login"];

  // public static args = [{name: 'file'}];

  public static flags = {
    instanceurl: Flags.string({
      char: "r",
      description: messages.getMessage("instanceUrl"),
    }),
    devhub: Flags.boolean({
      char: "h",
      default: false,
      description: messages.getMessage("withDevHub"),
    }),
    scratchorg: Flags.boolean({
      char: "s",
      default: false,
      description: messages.getMessage("scratch"),
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
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Login);
    const devHub = flags.devhub || false;
    const scratch = flags.scratchorg || false;
    await this.config.runHook("auth", {
      checkAuth: !devHub,
      Command: this,
      devHub,
      scratch,
    });

    // Return an object to be displayed with --json
    return { outputString: "Logged to Salesforce org" };
  }
}
