/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { promptOrg } from "../../../common/utils/orgUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgSelect extends SfCommand<any> {
  public static title = "Select org";

  public static description = messages.getMessage("selectOrg");

  public static examples = ["$ sf hardis:org:select"];

  // public static args = [{name: 'file'}];

  public static flags = {
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const devHub = flags.devhub || false;
    const scratch = flags.scratch;
    this.debugMode = flags.debug || false;

    const org = await promptOrg(this, { devHub: devHub, setDefault: true, scratch: scratch });

    // Return an object to be displayed with --json
    return { outputString: `Selected org ${org.username}` };
  }
}
