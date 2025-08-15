/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import {
  FilesExporter,
  getFilesWorkspaceDetail,
  promptFilesExportConfiguration,
  selectFilesWorkspace,
} from '../../../../common/utils/filesUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FilesExport extends SfCommand<any> {
  public static title = 'Export files';

  public static description = `
## Command Behavior

**Exports file attachments (ContentVersion, Attachment) from a Salesforce org based on a predefined configuration.**

This command enables the mass download of files associated with Salesforce records, providing a robust solution for backing up files, migrating them to other systems, or integrating them with external document management solutions.

Key functionalities:

- **Configuration-Driven Export:** Relies on an \`export.json\` file within a designated file export project to define the export criteria, including the SOQL query for parent records, file types to export, and output naming conventions.
- **Interactive Project Selection:** If the file export project path is not provided via the \`--path\` flag, it interactively prompts the user to select one.
- **Configurable Export Options:** Allows overriding default export settings such as \`chunksize\` (number of records processed in a batch), \`polltimeout\` (timeout for Bulk API calls), and \`startchunknumber\` (to resume a failed export).
- **Support for ContentVersion and Attachment:** Handles both modern Salesforce Files (ContentVersion) and older Attachments.

See this article for a practical example:

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)

<details>
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **FilesExporter Class:** The core logic is encapsulated within the \`FilesExporter\` class, which orchestrates the entire export process.
- **SOQL Queries (Bulk API):** It uses Salesforce Bulk API queries to efficiently retrieve large volumes of parent record IDs and file metadata.
- **File Download:** Downloads the actual file content from Salesforce.
- **File System Operations:** Writes the downloaded files to the local file system, organizing them into folders based on the configured naming conventions.
- **Configuration Loading:** Reads the \`export.json\` file to get the export configuration. It also allows for interactive overriding of these settings.
- **Interactive Prompts:** Uses \`selectFilesWorkspace\` to allow the user to choose a file export project and \`promptFilesExportConfiguration\` for customizing export options.
- **Error Handling:** Includes mechanisms to handle potential errors during the export process, such as network issues or API limits.
</details>
`;

  public static examples = ['$ sf hardis:org:files:export'];

  public static flags: any = {
    path: Flags.string({
      char: 'p',
      description: 'Path to the file export project',
    }),
    chunksize: Flags.integer({
      char: 'c',
      description: 'Number of records to add in a chunk before it is processed',
      default: 1000,
    }),
    polltimeout: Flags.integer({
      char: 't',
      description: 'Timeout in MS for Bulk API calls',
      default: 300000,
    }),
    startchunknumber: Flags.integer({
      char: 's',
      description: 'Chunk number to start from',
      default: 0,
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

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FilesExport);
    let filesPath = flags.path || null;
    const recordsChunkSize = flags.chunksize;
    const pollTimeout = flags.polltimeout;
    const startChunkNumber = flags.startchunknumber || 0;
    //const debugMode = flags.debug || false;

    const exportOptions: any = {
      pollTimeout: pollTimeout,
      recordsChunkSize: recordsChunkSize,
      startChunkNumber: startChunkNumber,
    };

    // Identify files workspace if not defined
    if (filesPath == null) {
      filesPath = await selectFilesWorkspace({ selectFilesLabel: 'Please select a files workspace to EXPORT' });
      const exportConfigInitial: any = (await getFilesWorkspaceDetail(filesPath || '')) || {};
      // Request to use defaut config or to override it for this run
      const defaultConfigRes = await prompts({
        type: 'confirm',
        message: c.cyanBright('Do you want to use default configuration for ' + exportConfigInitial.label + ' ?'),
        description: 'Use the saved configuration settings or customize them for this export operation',
      });
      if (defaultConfigRes.value !== true) {
        const exportConfig = await promptFilesExportConfiguration(exportConfigInitial, true);
        exportOptions.exportConfig = exportConfig;
      }
    }

    // Export files from org

    const exportResult = await new FilesExporter(
      filesPath || '',
      flags['target-org'].getConnection(),
      exportOptions,
      this
    ).processExport();

    // Output message
    const message = `Successfully exported files from project ${c.green(filesPath)} from org ${c.green(
      flags['target-org'].getUsername()
    )}`;
    uxLog("action", this, c.cyan(message));

    return { outputString: message, exportResult: exportResult };
  }
}
