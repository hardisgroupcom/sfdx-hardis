/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { execSfdxJson, generateSSLCertificate, promptInstanceUrl, uxLog } from "../../../../common/utils/index.js";
import { getOrgAliasUsername, promptOrg } from "../../../../common/utils/orgUtils.js";
import { prompts } from "../../../../common/utils/prompts.js";
import { checkConfig, getConfig, setConfig, setInConfigFile } from "../../../../config/index.js";
import { WebSocketClient } from "../../../../common/websocketClient.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ConfigureAuth extends SfCommand<any> {
  public static title = "Configure authentication";

  public static description = "Configure authentication from git branch to target org";

  public static examples = ["$ sf hardis:project:configure:auth"];

  // public static args = [{name: 'file'}];

  public static flags = {
    devhub: Flags.boolean({
      char: "b",
      default: false,
      description: "Configure project DevHub",
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
    'target-org': requiredOrgFlagWithDeprecations,
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected static requiresDependencies = ["openssl"];
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ConfigureAuth);
    const devHub = flags.devhub || false;

    // Ask user to login to org
    const prevUserName = devHub ? this.hubOrg?.getUsername() : flags['target-org']?.getUsername();
    /*uxLog(this, c.cyan("Please select org login into the org you want to configure the SF CLI Authentication"));
     await this.config.runHook("auth", {
      checkAuth: true,
      Command: this,
      alias: "CONFIGURE_CI",
      devHub,
    }); */
    await promptOrg(this, {
      setDefault: true,
      devHub: devHub,
      promptMessage: "Please select org login into the org you want to configure the SF CLI Authentication",
    });
    await checkConfig(this);

    // Check if the user has changed. If yes, ask to run the command again
    const configGetRes = await execSfdxJson("sf config get " + (devHub ? "target-dev-hub" : "target-org"), this, {
      output: false,
      fail: false,
    });
    let newUsername = configGetRes?.result[0]?.value || "";
    newUsername = (await getOrgAliasUsername(newUsername)) || newUsername;

    if (prevUserName !== newUsername) {
      // Restart command so the org is selected as default org (will help to select profiles)
      const infoMsg = "Default org changed. Please restart the same command if VsCode does not do that automatically for you :)";
      uxLog(this, c.yellow(infoMsg));
      const currentCommand = "sf " + this.id + " " + this.argv.join(" ");
      WebSocketClient.sendMessage({
        event: "runSfdxHardisCommand",
        sfdxHardisCommand: currentCommand,
      });
      return { outputString: infoMsg };
    }

    const config = await getConfig("project");
    // Get branch name to configure if not Dev Hub
    let branchName = "";
    let instanceUrl = "https://login.salesforce.com";
    if (!devHub) {
      const branchResponse = await prompts({
        type: "text",
        name: "value",
        message: c.cyanBright("What is the name of the git branch you want to configure ? Examples: developpement,recette,production"),
      });
      branchName = branchResponse.value.replace(/\s/g, "-");
      /* if (["main", "master"].includes(branchName)) {
        throw new SfError("You can not use main or master as deployment branch name. Maybe you want to use production ?");
      } */
      instanceUrl = await promptInstanceUrl(["login", "test"], `${branchName} related org`, {
        instanceUrl: devHub ? this.hubOrg.getConnection().instanceUrl : flags['target-org'].getConnection().instanceUrl,
      });
    }
    // Request username
    const usernameResponse = await prompts({
      type: "text",
      name: "value",
      initial: (devHub ? this.hubOrg.getUsername() : flags['target-org'].getUsername()) || "",
      message: c.cyanBright(
        `What is the Salesforce username that will be ${devHub ? "used as Dev Hub" : "used for deployments by CI server"
        } ? Example: admin.sfdx@myclient.com`,
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
        `./config/branches/.sfdx-hardis.${branchName}.yml`,
      );
    }

    // Generate SSL certificate (requires openssl to be installed on computer)
    const certFolder = devHub ? "./config/.jwt" : "./config/branches/.jwt";
    const certName = devHub ? config.devHubAlias : branchName;
    const orgConn = devHub ? this.hubOrg?.getConnection() : flags['target-org']?.getConnection();
    const sslGenOptions = {
      targetUsername: devHub ? this.hubOrg?.getUsername() : flags['target-org']?.getUsername(),
    };
    await generateSSLCertificate(certName, certFolder, this, orgConn, sslGenOptions);
    // Return an object to be displayed with --json
    return { outputString: "Configured branch for authentication" };
  }
}
