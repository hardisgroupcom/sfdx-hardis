/* jscpd:ignore-start */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConvertProfilesToPermSets extends SfCommand<any> {
  public static title = 'Convert Profiles into Permission Sets';

  public static description: string = `
## Command Behavior

**Converts existing Salesforce Profiles into Permission Sets, facilitating a more granular and recommended security model.**

This command helps in migrating permissions from Profiles to Permission Sets, which is a best practice for managing user access in Salesforce. It creates a new Permission Set for each specified Profile, adopting a naming convention of \`PS_PROFILENAME\`.

Key functionalities:

- **Profile to Permission Set Conversion:** Automatically extracts permissions from a Profile and creates a corresponding Permission Set.
- **Naming Convention:** New Permission Sets are named with a \`PS_\` prefix followed by the Profile name (e.g., \`PS_Standard_User\`).
- **Exclusion Filter:** Allows you to exclude specific Profiles from the conversion process using the \`--except\` flag.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **External Plugin Integration:** It relies on the \`shane-sfdx-plugins\` (specifically the \`sf shane:profile:convert\` command) to perform the actual conversion.
- **File System Scan:** It reads the contents of the \`force-app/main/default/profiles\` directory to identify all available Profile metadata files.
- **Command Execution:** For each identified Profile (that is not excluded), it constructs and executes the \`sf shane:profile:convert\` command with the appropriate Profile name and desired Permission Set name.
- **Error Handling:** Includes basic error handling for the external command execution.
</details>
`;

  public static examples = ['$ sf hardis:project:convert:profilestopermsets'];

  public static flags: any = {
    except: Flags.string({
      char: 'e',
      default: [],
      description: 'List of filters',
      multiple: true,
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */
  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['shane-sfdx-plugins'];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ConvertProfilesToPermSets);
    const except = flags.except || [];

    uxLog("action", this, c.cyan('This command will convert profiles into permission sets'));

    const sourceRootFolder = path.join(process.cwd() + '/force-app/main/default');
    const profilesFolder = path.join(sourceRootFolder, 'profiles');
    const objectsFolderContent = await fs.readdir(profilesFolder);
    for (const profileFile of objectsFolderContent) {
      if (profileFile.includes('.profile-meta.xml')) {
        const profileName = path.basename(profileFile).replace('.profile-meta.xml', '');
        if (except.filter((str) => profileName.toLowerCase().includes(str)).length > 0) {
          continue;
        }
        const psName = 'PS_' + profileName.split(' ').join('_');
        uxLog("action", this, c.cyan(`Generating Permission set ${c.green(psName)} from profile ${c.green(profileName)}`));
        const convertCommand = 'sf shane:profile:convert' + ` -p "${profileName}"` + ` -n "${psName}"` + ' -e';
        await execCommand(convertCommand, this, { fail: true, output: true });
      }
    }

    return {};
  }
}
