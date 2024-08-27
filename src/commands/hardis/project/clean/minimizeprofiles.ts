/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { glob } from "glob";
import * as path from "path";
import { uxLog } from "../../../../common/utils";
import { minimizeProfile } from "../../../../common/utils/profileUtils";
import { getConfig } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanMinimizeProfiles extends SfdxCommand {
  public static title = "Clean profiles of Permission Set attributes";

  public static description = `Remove all profile attributes that exist on Permission Sets

It is a bad practice to define on Profiles elements that can be defined on Permission Sets.

Salesforce will deprecate such capability in Spring 26.

Don't wait for that, and use minimizeProfiles cleaning to automatically remove from Profiles any permission that exists on a Permission Set !

The following XML tags are removed automatically:

- classAccesses
- customMetadataTypeAccesses
- externalDataSourceAccesses
- fieldPermissions
- objectPermissions
- pageAccesses
- userPermissions (except on Admin Profile)

You can override this list by defining a property minimizeProfilesNodesToRemove in your .sfdx-hardis.yml config file.

You can also skip profiles using property skipMinimizeProfiles

Example: 

\`\`\`yaml
skipMinimizeProfiles
  - MyClient Customer Community Login User
  - MyClientPortail Profile
\`\`\`
`;

  public static examples = ["$ sf hardis:project:clean:minimizeprofiles"];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
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
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.folder = this.flags.folder || "./force-app";
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Removing profile attributes that exist on Permission Sets`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.profile-meta.xml`;
    const matchingProfileFiles = await glob(findManagedPattern, { cwd: process.cwd() });
    const config = await getConfig("branch");
    const skipMinimizeProfiles = config.skipMinimizeProfiles || [];
    let counter = 0;
    for (const profileFile of matchingProfileFiles) {
      const profileName = path.basename(profileFile).replace(".profile-meta.xml", "");
      if (skipMinimizeProfiles.includes(profileName)) {
        uxLog(this, c.grey(`Skipped ${profileName} as found in skipMinimizeProfiles property`));
        continue;
      }
      const res = await minimizeProfile(profileFile);
      if (res.updated === true) {
        counter++;
      }
    }

    // Summary
    if (counter > 0) {
      uxLog(this, c.yellow("Please make sure the attributes removed from Profiles are defined on Permission Sets"));
      globalThis.displayProfilesWarning = true;
    }
    const msg = `Cleaned ${c.green(c.bold(counter))} profiles from attributes existing on Permission Sets`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
