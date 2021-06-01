/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { generateSSLCertificate, promptInstanceUrl, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { checkConfig, getConfig, setConfig, setInConfigFile } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ConfigureAuth extends SfdxCommand {
  public static title = "Configure authentication";

  public static description = "Configure authentication from git branch to target org";

  public static examples = ["$ sfdx hardis:project:configure:auth"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    devhub: flags.boolean({
      char: "b",
      default: false,
      description: "Configure project DevHub",
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
  protected static supportsUsername = true ;
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const devHub = this.flags.devhub || false;
    uxLog(this, c.cyan("Please login into the org you want to configure the SFDX Authentication"));
    await this.config.runHook("auth", {
      checkAuth: true,
      Command: this,
      devHub,
    });
    await checkConfig(this);
    const config = await getConfig("project");
    // Get branch name to configure if not Dev Hub
    let branchName = "";
    let instanceUrl = "https://login.salesforce.com";
    if (!devHub) {
      const branchResponse = await prompts({
        type: "text",
        name: "value",
        message: c.cyanBright("What is the name of the git branch you want to configure ? Exemples: developpement,recette,production"),
      });
      branchName = branchResponse.value.replace(/\s/g, "-");
      instanceUrl = await promptInstanceUrl();
    }
    // Request username
    const usernameResponse = await prompts({
      type: "text",
      name: "value",
      message: c.cyanBright(
        `What is the username you will use for sfdx in the org you want to ${
          devHub ? "use as Dev Hub" : "deploy to"
        } ? Example: admin.sfdx@myclient.com`
      ),
    });
    if (devHub) {
      await setConfig("project", {
        devHubUsername: usernameResponse.value,
      });
    } else {
      // Update config file
      await setInConfigFile(
        [],
        {
          targetUsername: usernameResponse.value,
          instanceUrl,
        },
        `./config/branches/.sfdx-hardis.${branchName}.yml`
      );
    }

    // Generate SSL certificate (requires openssl to be installed on computer)
    const certFolder = devHub ? "./config/.jwt" : "./config/branches/.jwt";
    const certName = devHub ? config.devHubAlias : branchName;
    await generateSSLCertificate(certName, certFolder, this, this.org?.getConnection());
    // Return an object to be displayed with --json
    return { outputString: "Configured branch for authentication" };
  }
}
