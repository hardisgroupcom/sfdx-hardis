/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import fs from 'fs-extra';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanSystemDebug extends SfCommand<any> {
  public static title = 'Clean System debug';

  public static description: string = `
## Command Behavior

**Removes or comments out \`System.debug()\` statements from Apex classes and triggers in your Salesforce DX project.**

This command helps maintain clean and optimized Apex code by eliminating debug statements that are often left in production code. While \`System.debug()\` is invaluable during development, it can impact performance and expose sensitive information if left in deployed code.

Key functionalities:

- **Targeted File Scan:** Scans all Apex class (.cls) and trigger (.trigger) files within the specified root folder (defaults to \`force-app\`).
- **Conditional Action:**
  - **Comment Out (default):** By default, it comments out \`System.debug()\` lines by prepending // to them.
  - **Delete (\`--delete\` flag):** If the \`--delete\` flag is used, it completely removes the lines containing \`System.debug()\`.
- **Exclusion:** Lines containing \`NOPMD\` are ignored, allowing developers to intentionally keep specific debug statements.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses \`glob\` to find all Apex class and trigger files.
- **Content Reading:** Reads the content of each Apex file line by line.
- **Pattern Matching:** Checks each line for the presence of \`System.debug\` (case-insensitive).
- **Line Modification:**
  - If \`System.debug\` is found and the \`--delete\` flag is not used, it modifies the line to comment out the debug statement.
  - If \`System.debug\` is found and the \`--delete\` flag is used, it removes the line entirely.
- **File Writing:** If any changes are made to a file, the modified content is written back to the file using \`fs.writeFile\`.
- **Logging:** Provides a summary of how many files were cleaned.
</details>
`;

  public static examples = ['$ sf hardis:project:clean:systemdebug'];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    delete: Flags.boolean({
      char: 'd',
      default: false,
      description: 'Delete lines with System.debug',
    }),
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected folder: string;
  protected del = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanSystemDebug);
    this.folder = flags.folder || './force-app';
    this.del = flags.delete || false;

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(`Comment or delete System.debug line in apex classes and triggers`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.{cls,trigger}`;
    const matchingFiles = await glob(findManagedPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
    let countFiles = 0;
    for (const apexFile of matchingFiles) {
      const fileText = await fs.readFile(apexFile, 'utf8');
      const fileLines = fileText.split('\n');
      let counter = 0;
      let writeF = false;
      for (const line of fileLines) {
        if ((line.includes('System.debug') || line.includes('system.debug')) && !line.includes('NOPMD')) {
          if (!this.del && line.trim().substring(0, 2) != '//') {
            fileLines[counter] = line
              .replace('System.debug', '// System.debug')
              .replace('system.debug', '// system.debug');
            writeF = true;
          } else if (this.del) {
            delete fileLines[counter];
            writeF = true;
          }
        }
        counter++;
      }
      if (writeF) {
        const joinLines = fileLines.join('\n');
        await fs.writeFile(apexFile, joinLines, 'utf8');
        countFiles++;
      }
    }

    // Summary
    const msg = `Cleaned ${c.green(c.bold(countFiles))} class(es) and trigger(s)`;
    uxLog("action", this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
