/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanRetrieveFolders extends SfCommand<any> {
  public static title = 'Retrieve dashboards, documents and report folders in DX sources';

  public static description: string = `
## Command Behavior

**Retrieves specific folders of Dashboards, Documents, Email Templates, and Reports from a Salesforce org into your DX project sources.**

This command is designed to help developers and administrators synchronize their local Salesforce DX project with the latest versions of these folder-based metadata types. It's particularly useful for:

- **Selective Retrieval:** Instead of retrieving all dashboards or reports, it allows you to retrieve specific folders, which can be more efficient for targeted development or backup.
- **Maintaining Folder Structure:** Ensures that the folder structure of these metadata types is preserved in your local project.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Folder Iteration:** It defines a list of folder-based metadata types (\`dashboards\`, \`documents\`, \`email\`, \`reports\`).
- **File System Check:** For each type, it checks if the corresponding folder exists in \`force-app/main/default/\`.
- **Recursive Retrieval:** It iterates through subfolders within these main folders. For each subfolder, it constructs and executes a \`sf project retrieve start\` command.
- **Salesforce CLI Integration:** It uses \`sf project retrieve start -m <MetadataType>:<FolderName>\` to retrieve the content of individual folders. This ensures that only the specified folder and its contents are retrieved.
- **Error Handling:** It includes basic error handling for the \`execCommand\` calls.
</details>
`;

  public static examples = ['$ sf hardis:project:clean:retrievefolders'];

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
    'target-org': requiredOrgFlagWithDeprecations,
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  /* jscpd:ignore-end */

  protected debugMode = false;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanRetrieveFolders);
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(`Retrieve dashboards, documents and report folders in DX sources`));

    const rootSourcesFolder = path.join(process.cwd() + '/force-app/main/default');
    const folderTypes = [
      { sourceType: 'dashboards', mdType: 'Dashboard' },
      { sourceType: 'documents', mdType: 'Document' },
      { sourceType: 'email', mdType: 'EmailTemplate' },
      { sourceType: 'reports', mdType: 'Report' },
    ];

    // Iterate on types, and for each sub folder found, retrieve its SFDX source from org
    for (const folderType of folderTypes) {
      const folderDir = rootSourcesFolder + '/' + folderType.sourceType;
      await this.manageRetrieveFolder(folderDir, folderType);
    }

    // Return an object to be displayed with --json
    return { outputString: 'Retrieved folders' };
  }

  private async manageRetrieveFolder(folderDir, folderType) {
    if (!fs.existsSync(folderDir)) {
      return;
    }
    const folderDirContent = await fs.readdir(folderDir);
    for (const subFolder of folderDirContent) {
      const subFolderFull = folderDir + '/' + subFolder;
      if (fs.lstatSync(subFolderFull).isDirectory()) {
        // Retrieve sub folder DX source
        await execCommand(`sf project retrieve start -m ${folderType.mdType}:${subFolder}`, this, {
          fail: true,
          output: true,
          debug: this.debugMode,
        });
        // Check for sub folders
        await this.manageRetrieveFolder(subFolderFull, folderType);
      }
    }
  }
}
