/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanStandardItems extends SfCommand<any> {
  public static title = 'Clean retrieved standard items in dx sources';

  public static description: string = `
## Command Behavior

**Removes unwanted standard Salesforce items from your Salesforce DX project sources.**

This command helps maintain a clean and focused Salesforce codebase by deleting metadata files that represent standard Salesforce objects or fields, especially when they are retrieved but not intended to be managed in your version control system. This is useful for reducing repository size and avoiding conflicts with standard Salesforce metadata.

Key functionalities:

- **Standard Object Cleaning:** Scans for standard objects (those without a \`__c\` suffix) within your \`force-app/main/default/objects\` folder.
- **Conditional Folder Deletion:** If a standard object folder contains no custom fields (fields with a \`__c\` suffix), the entire folder and its associated sharing rules (\`.sharingRules-meta.xml\`) are removed.
- **Standard Field Deletion:** If a standard object folder *does* contain custom fields, only the standard fields within that object are removed, preserving your custom metadata.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File System Traversal:** It starts by listing the contents of the \`force-app/main/default/objects\` directory.
- **Standard Object Identification:** It iterates through each directory within \`objects\` and identifies standard objects by checking if their name does not contain \`__\` (the custom object suffix).
- **Custom Field Detection:** For each standard object, it uses \`glob\` to search for custom fields (\`*__*.field-meta.xml\`) within its \`fields\` subdirectory.
- **Conditional Removal:**
  - If no custom fields are found, it removes the entire object directory and any corresponding sharing rules file using \`fs.remove\`.
  - If custom fields are found, it then uses \`glob\` again to find all standard fields (\`*.field-meta.xml\` without \`__\`) within the object's \`fields\` directory and removes only those standard field files.
- **Logging:** Provides clear messages about which folders and files are being removed or kept.
</details>
`;

  public static examples = ['$ sf hardis:project:clean:standarditems'];

  public static flags: any = {
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

  protected debugMode = false;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanStandardItems);
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(`Removing unwanted standard dx source files...`));
    /* jscpd:ignore-end */
    const sourceRootFolder = path.join(process.cwd() + '/force-app/main/default');
    const objectsFolder = path.join(sourceRootFolder + '/objects');
    const objectsFolderContent = await fs.readdir(objectsFolder);
    for (const objectDirName of objectsFolderContent) {
      const objectDir = objectsFolder + '/' + objectDirName;
      // Process only standard objects
      if (fs.lstatSync(objectDir).isDirectory() && !objectDir.includes('__')) {
        const findCustomFieldsPattern = `${objectDir}/fields/*__*`;
        const matchingCustomFiles = await glob(findCustomFieldsPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
        if (matchingCustomFiles.length === 0) {
          // Remove the whole folder
          await fs.remove(objectDir);
          uxLog("action", this, c.cyan(`Removed folder ${c.yellow(objectDir)}`));
          const sharingRuleFile = path.join(sourceRootFolder, 'sharingRules', objectDirName + '.sharingRules-meta.xml');
          if (fs.existsSync(sharingRuleFile)) {
            // Remove sharingRule if existing
            await fs.remove(sharingRuleFile);
            uxLog("action", this, c.cyan(`Removed sharing rule ${c.yellow(sharingRuleFile)}`));
          }
        } else {
          // Remove only standard fields
          const findAllFieldsPattern = `${objectDir}/fields/*.field-meta.xml`;
          const matchingAllFields = await glob(findAllFieldsPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
          for (const field of matchingAllFields) {
            if (!field.includes('__')) {
              await fs.remove(field);
              uxLog("action", this, c.cyan(`  - removed standard field ${c.yellow(field)}`));
            }
          }

          uxLog("action", this, c.cyan(`Keep folder ${c.green(objectDir)} because of custom fields found`));
        }
      }
    }

    // Return an object to be displayed with --json
    return { outputString: 'Cleaned standard items from sfdx project' };
  }
}
