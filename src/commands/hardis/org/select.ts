/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { promptOrg } from "../../../common/utils/orgUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgSelect extends SfCommand {
  public static title = "Select org";

  public static description = messages.getMessage("selectOrg");

  public static examples = ["$ sf hardis:org:select"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    devhub: Flags.boolean({
      char: "h",
      default: false,
      description: messages.getMessage("withDevHub"),
    }),
    scratch: Flags.boolean({
      char: "s",
      default: false,
      description: "Select scratch org related to default DevHub",
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
  protected static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const devHub = this.flags.devhub || false;
    const scratch = this.flags.scratch;
    this.debugMode = this.flags.debug || false;

    const org = await promptOrg(this, { devHub: devHub, setDefault: true, scratch: scratch });

    // Return an object to be displayed with --json
    return { outputString: `Selected org ${org.username}` };
  }
}
