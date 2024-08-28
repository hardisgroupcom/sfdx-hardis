/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class CleanRetrieveFolders extends SfCommand<any> {
  public static title = 'Retrieve dashboards, documents and report folders in DX sources';

  public static description = 'Retrieve dashboards, documents and report folders in DX sources. Use -u ORGALIAS';

  public static examples = ['$ sf hardis:project:clean:retrievefolders'];

  public static flags = {
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
    uxLog(this, c.cyan(`Retrieve dashboards, documents and report folders in DX sources`));

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
