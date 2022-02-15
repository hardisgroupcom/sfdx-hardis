/* jscpd:ignore-start */
import * as c from "chalk";
import { flags, SfdxCommand } from "@salesforce/command";
import { AuthInfo, Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getConfig, setConfig } from "../../../../config";
import { prompts } from "../../../../common/utils/prompts";
import { uxLog } from "../../../../common/utils";
import { instantiateProvider, listKeyValueProviders } from "../../../../common/utils/poolUtils";
import { KeyValueProviderInterface } from "../../../../common/utils/keyValueUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolCreate extends SfdxCommand {
  public static title = "Create and configure scratch org pool";

  public static description = `Select a data storage service and configure information to build a scratch org pool

  Run the command, follow instruction, then you need to schedule a daily CI job for the pool maintenance:

  - Define CI ENV variable SCRATCH_ORG_POOL with value "true"

  - Call the following lines in the CI job:

\`\`\`shell
  sfdx hardis:auth:login --devhub
  sfdx hardis:scratch:pool:refresh
\`\`\`
  `;

  public static examples = ["$ sfdx hardis:scratch:pool:configure"];

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
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Get pool configuration
    const config = await getConfig("project");
    const poolConfig = config.poolConfig || {};

    // Tell user if he/she's about to overwrite existing configuration
    if (config.poolConfig && Object.keys(poolConfig).length > 0) {
      uxLog(
        this,
        c.yellow(
          `There is already an existing scratch org pool configuration: ${JSON.stringify(config.poolConfig)}.
If you really want to replace it, please remove poolConfig property from .sfdx-hardis.yml and run again this command`
        )
      );
      return { outputString: "Scratch org pool configuration already existing" };
    }

    const allProviders = await listKeyValueProviders();
    const response = await prompts([
      {
        type: "select",
        name: "storageService",
        message: c.cyanBright("What storage service do you want to use for your scratch orgs pool ?"),
        initial: 0,
        choices: allProviders.map((provider: KeyValueProviderInterface) => {
          return { title: provider.name, description: provider.description, value: provider.name };
        }),
      },
      {
        type: "number",
        name: "maxScratchOrgsNumber",
        message: c.cyanBright("What is the maximum number of scratch orgs in the pool ?"),
        initial: poolConfig.maxScratchOrgsNumber || 5,
      },
    ]);

    // Store updated config
    poolConfig.maxScratchOrgsNumber = response.maxScratchOrgsNumber;
    poolConfig.storageService = response.storageService;
    await setConfig("project", { poolConfig: poolConfig });

    // Request additional setup to the user
    const provider = await instantiateProvider(response.storageService);
    await provider.userSetup({ devHubConn: this.hubOrg.getConnection(), devHubUsername: this.hubOrg.getUsername() });

    const authInfo = await AuthInfo.create({ username: this.hubOrg.getUsername() });
    const sfdxAuthUrl = authInfo.getSfdxAuthUrl();
    if (sfdxAuthUrl) {
      uxLog(this, c.cyan(`You need to define CI masked variable ${c.green("SFDX_AUTH_URL_DEV_HUB")} = ${c.green(sfdxAuthUrl)}`));
    } else {
      uxLog(
        this,
        c.yellow(
          `You'll probably need to define CI masked variable ${c.green(
            "SFDX_AUTH_URL_DEV_HUB"
          )} with content of sfdxAuthUrl that you can retrieve with ${c.white("sfdx force:org:display -u YOURDEVHUBUSERNAME --verbose --json")}`
        )
      );
    }

    // Return an object to be displayed with --json
    return { outputString: "Configured scratch orgs pool" };
  }
}
