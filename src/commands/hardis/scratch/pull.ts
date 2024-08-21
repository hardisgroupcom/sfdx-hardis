/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { forceSourcePull } from "../../../common/utils/deployUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class SourcePull extends SfdxCommand {
  public static title = "Scratch PULL";

  public static description = `This commands pulls the updates you performed in your scratch or sandbox org, into your local files

Then, you probably want to stage and commit the files containing the updates you want to keep, as explained in this video.

<iframe width="560" height="315" src="https://www.youtube.com/embed/Ik6whtflmfY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

- Calls sf project retrieve start under the hood
- If there are errors, proposes to automatically add erroneous item in \`.forceignore\`, then pull again
- If you want to always retrieve sources like CustomApplication that are not always detected as updates by project:retrieve:start , you can define property **autoRetrieveWhenPull** in .sfdx-hardis.yml

Example:
\`\`\`yaml
autoRetrieveWhenPull:
  - CustomApplication:MyCustomApplication
  - CustomApplication:MyOtherCustomApplication
  - CustomApplication:MyThirdCustomApp
\`\`\`
`;

  public static examples = ["$ sfdx hardis:scratch:pull"];

  // public static args = [{name: 'file'}];

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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const debugMode = this.flags.debug || false;
    const targetUsername = this.org.getUsername();
    await forceSourcePull(targetUsername, debugMode);

    // Return an object to be displayed with --json
    return { outputString: "Pulled scratch org updates" };
  }
}
