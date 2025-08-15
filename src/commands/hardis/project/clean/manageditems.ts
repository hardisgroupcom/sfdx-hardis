/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanManagedItems extends SfCommand<any> {
  public static title = 'Clean retrieved managed items in dx sources';

  public static description: string = `
## Command Behavior

**Removes unwanted managed package items from your Salesforce DX project sources.**

This command helps clean up your local Salesforce project by deleting metadata files that belong to a specific managed package namespace. This is particularly useful when you retrieve metadata from an org that contains managed packages, and you only want to keep the unmanaged or custom metadata in your local repository.

Key functionalities:

- **Namespace-Based Filtering:** Requires a \`--namespace\` flag to specify which managed package namespace's files should be removed.
- **Targeted File Deletion:** Scans for files and folders that start with the specified namespace prefix (e.g., \`yourNamespace__*\`).
- **Intelligent Folder Handling:** Prevents the deletion of managed folders if they contain local custom items. This ensures that if you have custom metadata within a managed package's folder structure, only the managed components are removed, preserving your local customizations.
- **Object Metadata Preservation:** Specifically, it will not remove .object-meta.xml files if there are local custom items defined within that object's folder.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Namespace Validation:** Ensures that a namespace is provided, throwing an \`SfError\` if it's missing.
- **File Discovery:** Uses \`glob\` to find all files and directories within the specified \`folder\` (defaults to \`force-app\`) that match the managed package namespace pattern (\`**/\${this.namespace}__*\`).
- **Folder Content Check:** For identified managed folders, the \`folderContainsLocalItems\` function is called. This function uses \`glob\` again to check for the presence of any files within that folder that *do not* start with the managed package namespace, indicating local customizations.
- **Conditional Deletion:** Based on the \`folderContainsLocalItems\` check, it conditionally removes files and folders using \`fs.remove\`. If a managed folder contains local items, it is skipped to prevent accidental deletion of custom work.
- **Logging:** Provides clear messages about which managed items are being removed.
</details>
`;

  public static examples = ['$ sf hardis:project:clean:manageditems --namespace crta'];

  public static flags: any = {
    namespace: Flags.string({
      char: 'n',
      default: '',
      description: 'Namespace to remove',
    }),
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

  protected namespace: string;
  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanManagedItems);
    this.namespace = flags.namespace || '';
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    if (this.namespace === '') {
      throw new SfError('namespace argument is mandatory');
    }

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(`Removing unwanted dx managed source files with namespace ${c.bold(this.namespace)}...`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/${this.namespace}__*`;
    const matchingCustomFiles = await glob(findManagedPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
    for (const matchingCustomFile of matchingCustomFiles) {
      if (!fs.existsSync(matchingCustomFile)) {
        continue;
      }
      // Do not remove managed folders when there are local custom items defined on it
      if (fs.lstatSync(matchingCustomFile).isDirectory()) {
        const localItems = await this.folderContainsLocalItems(matchingCustomFile);
        if (localItems) {
          continue;
        }
      }
      // Keep .object-meta.xml item if there are local custom items defined on it
      if (matchingCustomFile.endsWith('.object-meta.xml')) {
        const localItems = await this.folderContainsLocalItems(path.dirname(matchingCustomFile));
        if (localItems) {
          continue;
        }
      }
      await fs.remove(matchingCustomFile);
      uxLog("action", this, c.cyan(`Removed managed item ${c.yellow(matchingCustomFile)}`));
    }

    // Return an object to be displayed with --json
    return { outputString: 'Cleaned managed items from sfdx project' };
  }

  private async folderContainsLocalItems(folder: string): Promise<boolean> {
    // Do not remove managed folders when there are local custom items defined on it
    const subFiles = await glob(folder + '/**/*', { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
    const standardItems = subFiles.filter((file) => {
      return !fs.lstatSync(file).isDirectory() && !path.basename(file).startsWith(`${this.namespace}__`);
    });
    if (standardItems.length > 0) {
      return true;
    }
    return false;
  }
}
