/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { FilesImporter, selectFilesWorkspace } from '../../../../common/utils/filesUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FilesImport extends SfCommand<any> {
  public static title = 'Import files';

  public static description = `Import file attachments into a Salesforce org

See article below to see how to Export them.

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)
`;

  public static examples = ['$ sf hardis:org:files:import'];

  public static flags = {
    path: Flags.string({
      char: 'p',
      description: 'Path to the file export project',
    }),
    overwrite: Flags.boolean({
      char: 'o',
      description: 'Override existing files (doubles the number of API calls)',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;
  protected handleOverwrite;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FilesImport);
    let filesPath = flags.path || null;
    this.handleOverwrite = flags?.overwrite === true;

    // Identify files workspace if not defined
    if (filesPath == null) {
      filesPath = await selectFilesWorkspace({ selectFilesLabel: 'Please select a files workspace to IMPORT' });
    }

    if (!isCI) {
      const handleOverwriteRes = await prompts({
        type: 'confirm',
        name: 'value',
        message:
          'Do you want to overwrite the existing files with the same name ? (doubles the number of used API calls)',
      });
      this.handleOverwrite = handleOverwriteRes.value;
    }

    const importOptions: any = { handleOverwrite: this.handleOverwrite };

    // Import files into org
    const importResult = await new FilesImporter(
      filesPath || '',
      flags['target-org'].getConnection(),
      importOptions,
      this
    ).processImport();

    // Output message
    const message = `Successfully imported files from project ${c.green(filesPath)} from org ${c.green(
      flags['target-org'].getUsername()
    )}`;
    uxLog(this, c.cyan(message));

    return { outputString: message, importResult: importResult };
  }
}
