/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import { uxLog } from '../../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FixV53Flexipages extends SfCommand<any> {
  public static title = 'Fix flexipages for v53';

  public static description: string = `
## Command Behavior

**Fixes Salesforce FlexiPages for compatibility with API Version 53.0 (Winter '22 release) by adding missing identifiers to component instances.**

Salesforce introduced a change in API Version 53.0 that requires \`identifier\` tags within \`componentInstance\` and \`fieldInstance\` elements in FlexiPage metadata. If these identifiers are missing, deployments to orgs with API version 53.0 or higher will fail. This command automates the process of adding these missing identifiers, ensuring your FlexiPages remain deployable.

Key functionalities:

- **Targeted FlexiPage Processing:** Scans all .flexipage-meta.xml files within the specified root folder (defaults to current working directory).
- **Identifier Injection:** Inserts a unique \`identifier\` tag (e.g., \`SFDX_HARDIS_REPLACEMENT_ID\`) into \`componentInstance\` and \`fieldInstance\` elements that lack one.

**Important Note:** After running this command, ensure you update your \`apiVersion\` to \`53.0\` (or higher) in your \`package.xml\` and \`sfdx-project.json\` files.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses \`glob\` to find all .flexipage-meta.xml files.
- **Content Reading:** Reads the XML content of each FlexiPage file.
- **Regular Expression Replacement:** Employs a set of regular expressions to identify specific XML patterns (componentName.../componentName.../componentInstance, componentName.../componentName.../visibilityRule, fieldItem.../fieldItem.../fieldInstance) that are missing the \`identifier\` tag.
- **Dynamic ID Generation:** For each match, it generates a unique identifier (e.g., \`sfdxHardisIdX\`) and injects it into the XML structure.
- **File Writing:** If changes are made, the modified XML content is written back to the FlexiPage file using \`fs.writeFile\`.
- **Logging:** Provides messages about which FlexiPages are being processed and a summary of the total number of identifiers added.
</details>
`;

  public static examples = ['$ sf hardis:project:fix:v53flexipages'];

  public static flags: any = {
    path: Flags.string({
      char: 'p',
      default: process.cwd(),
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

  protected pathToBrowse: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FixV53Flexipages);
    this.pathToBrowse = flags.path || process.cwd();
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(`Adding identifiers to componentInstance in flexipages`));
    /* jscpd:ignore-end */

    const globPattern = this.pathToBrowse + `/**/*.flexipage-meta.xml`;

    let counter = 0;
    const flexipages: any[] = [];
    const flexipageSourceFiles = await glob(globPattern, { cwd: this.pathToBrowse, ignore: GLOB_IGNORE_PATTERNS });
    uxLog("log", this, c.grey(`Found ${flexipageSourceFiles.length} flexipages`));
    const regexAndReplacements = [
      {
        regex: /(<componentName>.*<\/componentName>\n.*<\/componentInstance>)/gim,
        replace: '</componentName>',
        replaceWith: `</componentName>\n                <identifier>SFDX_HARDIS_REPLACEMENT_ID</identifier>`,
      },
      {
        regex: /(<componentName>.*<\/componentName>\n.*<visibilityRule>)/gim,
        replace: '</componentName>',
        replaceWith: `</componentName>\n                <identifier>SFDX_HARDIS_REPLACEMENT_ID</identifier>`,
      },
      {
        regex: /(<fieldItem>.*<\/fieldItem>\n.*<\/fieldInstance>)/gim,
        replace: '</fieldItem>',
        replaceWith: `</fieldItem>\n                <identifier>SFDX_HARDIS_REPLACEMENT_ID</identifier>`,
      },
    ];
    for (const flexiFile of flexipageSourceFiles) {
      let flexipageRawXml = await fs.readFile(flexiFile, 'utf8');
      let found = false;
      for (const replaceParams of regexAndReplacements) {
        const regex = replaceParams.regex;
        let m;
        while ((m = regex.exec(flexipageRawXml)) !== null) {
          found = true;
          // This is necessary to avoid infinite loops with zero-width matches
          if (m.index === regex.lastIndex) {
            regex.lastIndex++;
          }
          // Iterate thru the regex matches
          m.forEach((match, groupIndex) => {
            console.log(`Found match, group ${groupIndex}: ${match}`);
            const newId = 'sfdxHardisId' + counter;
            const replaceWith = replaceParams.replaceWith.replace('SFDX_HARDIS_REPLACEMENT_ID', newId);
            const replacementWithIdentifier = match.replace(replaceParams.replace, replaceWith);
            flexipageRawXml = flexipageRawXml.replace(match, replacementWithIdentifier);
            if (!flexipages.includes(flexiFile)) {
              flexipages.push(flexiFile);
            }
            counter++;
          });
        }
        if (found) {
          await fs.writeFile(flexiFile, flexipageRawXml);
          uxLog("log", this, c.grey('Updated ' + flexiFile));
        }
      }
    }

    // Summary
    const msg = `Added ${c.green(c.bold(counter))} identifiers in ${c.green(c.bold(flexipages.length))} flexipages`;
    uxLog("action", this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg, updatedNumber: counter, updated: flexipages };
  }
}
