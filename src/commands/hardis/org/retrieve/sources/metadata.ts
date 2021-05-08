/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as fs from "fs-extra";
import * as path from "path";
import { MetadataUtils } from "../../../../../common/metadata-utils";
import { ensureGitRepository } from "../../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfdxCommand {
  public static title = "Retrieve sfdx sources from org";

  public static description = messages.getMessage("retrieveDx");

  public static examples = ["$ sfdx hardis:org:retrieve:sources:metadata"];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: ".",
      description: messages.getMessage("folder"),
    }),
    packagexml: flags.string({
      char: "p",
      description: messages.getMessage("packageXml"),
    }),
    instanceurl: flags.string({
      char: "r",
      description: messages.getMessage("instanceUrl"),
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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const folder = path.resolve(this.flags.folder || ".");
    const packageXml = path.resolve(this.flags.packagexml || "package.xml");
    const debug = this.flags.debug || false;

    // Check required pre-requisites
    await ensureGitRepository({ init: true });

    // Retrieve metadatas
    await MetadataUtils.retrieveMetadatas(packageXml, folder, false, [], {}, this, debug);

    // Copy to destination
    await fs.copy(path.join(folder, "unpackaged"), path.resolve(folder));
    // Remove temporary files
    await fs.rmdir(path.join(folder, "unpackaged"), { recursive: true });

    const message = `[sfdx-hardis] Successfully retrieved metadatas in ${folder}`;
    this.ux.log(message);
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
