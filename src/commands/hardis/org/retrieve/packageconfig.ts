/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { MetadataUtils } from "../../../../common/metadata-utils";
import { setConfig } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class RetrievePackageConfig extends SfdxCommand {
  public static title = "Retrieve package configuration from an org";

  public static description = "Retrieve package configuration from an org";

  public static examples = ["$ sfdx hardis:org:retrieve:packageconfig"];

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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Retrieve list of installed packages
    const installedPackages = await MetadataUtils.listInstalledPackages(null, this);
    // Store list in config
    await setConfig("project", {
      installedPackages,
    });

    const message = `[sfdx-hardis] Successfully retrieved package config`;
    this.ux.log(c.green(message));
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
