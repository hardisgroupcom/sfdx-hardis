/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { MetadataUtils } from "../../../../common/metadata-utils";
import { uxLog } from "../../../../common/utils/index.js";
import { managePackageConfig, promptOrg } from "../../../../common/utils/orgUtils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class RetrievePackageConfig extends SfCommand {
  public static title = "Retrieve package configuration from an org";

  public static description = "Retrieve package configuration from an org";

  public static examples = ["$ sf hardis:org:retrieve:packageconfig", "sf hardis:org:retrieve:packageconfig -u myOrg"];

  protected static flagsConfig = {
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
  protected static supportsUsername = true;
  protected static requiresUsername = false;
  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let targetUsername = this.flags.targetusername || null;

    // Prompt for organization if not sent
    if (targetUsername == null) {
      const org = await promptOrg(this, { setDefault: false });
      targetUsername = org.username;
    }

    // Retrieve list of installed packages
    const installedPackages = await MetadataUtils.listInstalledPackages(targetUsername, this);

    // Store list in config
    const updateConfigRes = await prompts({
      type: "confirm",
      name: "value",
      message: c.cyanBright("Do you want to update your project configuration with this list of packages ?"),
    });
    if (updateConfigRes.value === true) {
      await managePackageConfig(installedPackages, installedPackages);
    }

    const message = `[sfdx-hardis] Successfully retrieved package config`;
    uxLog(this, c.green(message));
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
