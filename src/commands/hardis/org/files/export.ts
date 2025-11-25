/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { humanizeObjectKeys, uxLog, uxLogTable, isCI } from '../../../../common/utils/index.js';
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

- **Configuration-Driven Export:** Relies on an \`export.json\` file within a designated file export project to define the export criteria, including the SOQL query for parent records, file types to export, output naming conventions, and file size filtering.
- **File Size Filtering:** Supports minimum file size filtering via the \`fileSizeMin\` configuration parameter (in KB). Files smaller than the specified size will be skipped during export.
- **File Validation:** After downloading each file, validates the integrity by:
  - **Checksum Validation:** For ContentVersion files, compares MD5 checksum with Salesforce's stored checksum
  - **Size Validation:** For both ContentVersion and Attachment files, verifies actual file size matches expected size
  - **Status Tracking:** Files are categorized with specific statuses: \`success\` (valid files), \`failed\` (download errors), \`skipped\` (filtered files), \`invalid\` (downloaded but failed validation)
  - All validation results are logged in the CSV export log for audit purposes
- **Resume/Restart Capability:**
  - **Resume Mode:** When \`--resume\` flag is used (default in CI environments), checks existing downloaded files for validity. Valid files are skipped, invalid files are re-downloaded.
  - **Restart Mode:** When resume is disabled, clears the output folder and starts a fresh export.
  - **Interactive Mode:** When existing files are found and \`--resume\` is not explicitly specified (non-CI environments), prompts the user to choose between resume or restart.
- **Interactive Project Selection:** If the file export project path is not provided via the \`--path\` flag, it interactively prompts the user to select one.
- **Configurable Export Options:** Allows overriding default export settings such as \`chunksize\` (number of records processed in a batch), \`polltimeout\` (timeout for Bulk API calls), and \`startchunknumber\` (to resume a failed export).
- **Support for ContentVersion and Attachment:** Handles both modern Salesforce Files (ContentVersion) and older Attachments.

See this article for a practical example:

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **FilesExporter Class:** The core logic is encapsulated within the \`FilesExporter\` class, which orchestrates the entire export process.
- **SOQL Queries (Bulk API):** It uses Salesforce Bulk API queries to efficiently retrieve large volumes of parent record IDs and file metadata, including checksums and file sizes.
- **File Download:** Downloads the actual file content from Salesforce.
- **File Validation:** After each successful download, validates file integrity by comparing checksums (ContentVersion) and file sizes (both ContentVersion and Attachment) against Salesforce metadata.
- **Resume Logic:** In resume mode, checks for existing files before downloading, validates their integrity, and only re-downloads invalid or missing files. This enables efficient recovery from interrupted exports.
- **File System Operations:** Writes the downloaded files to the local file system, organizing them into folders based on the configured naming conventions.
- **Configuration Loading:** Reads the \`export.json\` file to get the export configuration. It also allows for interactive overriding of these settings.
- **Interactive Prompts:** Uses \`selectFilesWorkspace\` to allow the user to choose a file export project, \`promptFilesExportConfiguration\` for customizing export options, and prompts for resume/restart choice when existing files are found.
- **Error Handling:** Includes mechanisms to handle potential errors during the export process, such as network issues, API limits, and file validation failures. Each file is assigned a specific status (\`success\`, \`failed\`, \`skipped\`, \`invalid\`) for comprehensive tracking and troubleshooting.
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
    resume: Flags.boolean({
      char: 'r',
      description: 'Resume previous export by checking existing files (default in CI)',
      default: false,
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
    const resumeExport = flags.resume;
    //const debugMode = flags.debug || false;

    const exportOptions: any = {
      pollTimeout: pollTimeout,
      recordsChunkSize: recordsChunkSize,
      startChunkNumber: startChunkNumber,
      resumeExport: resumeExport,
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

    // Display final export configuration
    let exportConfigFinal: any = (await getFilesWorkspaceDetail(filesPath || '')) || {};
    if (exportOptions.exportConfig) {
      // Merge with existing config
      exportConfigFinal = Object.assign(exportConfigFinal, exportOptions.exportConfig);
    }
    const exportConfigHuman = humanizeObjectKeys(exportConfigFinal || {});
    uxLog("action", this, c.cyan(`Export configuration has been defined (see details below).`));
    uxLogTable(this, exportConfigHuman);

    // Check for existing files and prompt user if needed
    let finalResumeExport = resumeExport;
    if (!isCI && !resumeExport) {
      // User didn't explicitly set --resume and we're not in CI
      const exportFolder = path.join(filesPath || '', 'export');
      if (fs.existsSync(exportFolder)) {
        try {
          const files = await fs.readdir(exportFolder);
          const hasFiles = files.length > 0;

          if (hasFiles) {
            uxLog("action", this, c.yellow(`Found existing files in output folder: ${exportFolder}.`));
            const resumePrompt = await prompts({
              type: 'confirm',
              message: c.cyanBright('Do you want to resume the previous export (validate and skip existing valid files)?'),
              description: 'Choose "Yes" to resume (skip valid existing files) or "No" to restart (clear folder and download all files)',
            });
            finalResumeExport = resumePrompt.value === true;

            if (finalResumeExport) {
              uxLog("log", this, c.cyan('Resume mode selected: existing files will be validated and skipped if valid'));
            } else {
              uxLog("log", this, c.yellow('Restart mode selected: output folder will be cleared'));
            }
          }
        } catch (error) {
          uxLog("warning", this, c.yellow(`Could not check existing files in ${exportFolder}: ${(error as Error).message}`));
        }
      }
    }

    // Update export options with final resume decision
    exportOptions.resumeExport = finalResumeExport;

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

    const statsTable = humanizeObjectKeys(exportResult.stats);
    uxLogTable(this, statsTable);

    return { outputString: message, exportResult: exportResult };
  }
}
