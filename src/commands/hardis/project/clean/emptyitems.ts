/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanEmptyItems extends SfCommand<any> {
  public static title = 'Clean retrieved empty items in dx sources';

  public static description: string = `
## Command Behavior

**Removes empty or irrelevant metadata items from your Salesforce DX project sources.**

This command helps maintain a clean and efficient Salesforce codebase by deleting metadata files that are essentially empty or contain no meaningful configuration. These files can sometimes be generated during retrieval processes or remain after refactoring, contributing to unnecessary clutter in your project.

Key functionalities:

- **Targeted Cleaning:** Specifically targets and removes empty instances of:
  - Global Value Set Translations (\`.globalValueSetTranslation-meta.xml\`)
  - Standard Value Sets (\`.standardValueSet-meta.xml\`)
  - Sharing Rules (\`.sharingRules-meta.xml\`)
- **Content-Based Deletion:** It checks the XML content of these files for the presence of specific tags (e.g., \`valueTranslation\` for Global Value Set Translations) to determine if they are truly empty or lack relevant data.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses \`glob\` to find files matching predefined patterns for Global Value Set Translations, Standard Value Sets, and Sharing Rules within the specified root folder (defaults to \`force-app\`).
- **XML Parsing:** For each matching file, it reads and parses the XML content using \`parseXmlFile\`.
- **Content Validation:** It then checks the parsed XML object for the existence of specific nested properties (e.g., \`xmlContent.GlobalValueSetTranslation.valueTranslation\`). If these properties are missing or empty, the file is considered empty.
- **File Deletion:** If a file is determined to be empty, it is removed from the file system using \`fs.remove\`.
- **Logging:** Provides clear messages about which files are being removed and a summary of the total number of items cleaned.
</details>
`;

  public static examples = ['$ sf hardis:project:clean:emptyitems'];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanEmptyItems);
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(`Removing empty dx managed source files`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const emptyConstraints = [
      {
        globPattern: `/**/*.globalValueSetTranslation-meta.xml`,
        tags: ['GlobalValueSetTranslation', 'valueTranslation'],
      },
      { globPattern: `/**/*.standardValueSet-meta.xml`, tags: ['StandardValueSet', 'standardValue'] },
      { globPattern: `/**/*.sharingRules-meta.xml`, tags: ['SharingRules', 'sharingOwnerRules'] },
    ];
    let counter = 0;
    for (const emptyConstraint of emptyConstraints) {
      const findStandardValueSetPattern = rootFolder + emptyConstraint.globPattern;
      const matchingCustomFiles = await glob(findStandardValueSetPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
      for (const matchingCustomFile of matchingCustomFiles) {
        const xmlContent = await parseXmlFile(matchingCustomFile);
        const tag1 = xmlContent[emptyConstraint.tags[0]];
        if (!(tag1 && tag1[emptyConstraint.tags[1]])) {
          await fs.remove(matchingCustomFile);
          uxLog("action", this, c.cyan(`Removed empty item ${c.yellow(matchingCustomFile)}`));
          counter++;
        }
      }
    }

    // Summary
    const msg = `Removed ${c.green(c.bold(counter))} hidden source items`;
    uxLog("action", this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
