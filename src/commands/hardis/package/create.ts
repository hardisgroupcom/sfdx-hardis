/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { execSfdxJson, uxLog } from "../../../common/utils/index.js";
import { prompts } from "../../../common/utils/prompts.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class PackageCreate extends SfCommand<any> {
  public static title = "Create a new package";

  public static description = messages.getMessage("packageCreate");

  public static examples = ["$ sf hardis:package:create"];

  // public static args = [{name: 'file'}];

  public static flags = {
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
  protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const debugMode = flags.debug || false;

    // Request questions to user
    const packageResponse = await prompts([
      {
        type: "text",
        name: "packageName",
        message: c.cyanBright(`Please input the name of the package (ex: MyPackage)`),
      },
      {
        type: "text",
        name: "packagePath",
        message: c.cyanBright(`Please input the path of the package (ex: sfdx-source/apex-mocks)`),
      },
      {
        type: "select",
        name: "packageType",
        message: c.cyanBright(`Please select the type of the package`),
        choices: [
          {
            title: "Managed",
            value: "Managed",
            description: "Managed packages code is hidden in orgs where it is installed. Suited for AppExchanges packages",
          },
          {
            title: "Unlocked",
            value: "Unlocked",
            description:
              "Unlocked packages code is readable and modifiable in orgs where it is installed. Use it for client project or shared tooling",
          },
        ],
      },
    ]);

    // Create package
    const packageCreateCommand =
      "sf package create" +
      ` --name "${packageResponse.packageName}"` +
      ` --package-type ${packageResponse.packageType}` +
      ` --path "${packageResponse.packagePath}"`;
    const packageCreateResult = await execSfdxJson(packageCreateCommand, this, {
      output: true,
      fail: true,
      debug: debugMode,
    });
    uxLog(this, c.cyan(`Created package Id: ${c.green(packageCreateResult.result.Id)} associated to DevHub ${c.green(this.hubOrg.getUsername())}`));

    // Return an object to be displayed with --json
    return {
      outputString: `Create new package ${packageCreateResult.result.Id}`,
      packageId: packageCreateResult.result.Id,
    };
  }
}
