/* jscpd:ignore-start */

import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execCommand, uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ConvertProfilesToPermSets extends SfdxCommand {
  public static title = "Convert Profiles into Permission Sets";

  public static description = "Creates permission sets from existing profiles, with id PS_PROFILENAME";

  public static examples = ["$ sfdx hardis:project:convert:profilestopermsets"];

  protected static flagsConfig = {
    except: flags.array({
      char: "e",
      default: [],
      description: "List of filters",
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
  protected static requiresUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */
  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["shane-sfdx-plugins"];

  public async run(): Promise<AnyJson> {
    const except = this.flags.except || [];

    uxLog(this, c.cyan("This command will convert profiles into permission sets"));

    const sourceRootFolder = path.join(process.cwd() + "/force-app/main/default");
    const profilesFolder = path.join(sourceRootFolder, "profiles");
    const objectsFolderContent = await fs.readdir(profilesFolder);
    for (const profileFile of objectsFolderContent) {
      if (profileFile.includes(".profile-meta.xml")) {
        const profileName = path.basename(profileFile).replace(".profile-meta.xml", "");
        if (except.filter((str) => profileName.toLowerCase().includes(str)).length > 0) {
          continue;
        }
        const psName = "PS_" + profileName.split(" ").join("_");
        uxLog(this, c.cyan(`Generating Permission set ${c.green(psName)} from profile ${c.green(profileName)}`));
        const convertCommand = "sfdx shane:profile:convert" + ` -p "${profileName}"` + ` -n "${psName}"` + " -e";
        await execCommand(convertCommand, this, { fail: true, output: true });
      }
    }

    return {};
  }
}
