/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { humanizeObjectKeys, isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { FilesImporter, selectFilesWorkspace } from '../../../../common/utils/filesUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FilesImport extends SfCommand<any> {
  public static title = 'Import files';

  public static description = `
This command facilitates the mass upload of files into Salesforce, allowing you to populate records with associated documents, images, or other file types. It's a crucial tool for data migration, content seeding, or synchronizing external file repositories with Salesforce.

Key functionalities:

- **Configuration-Driven Import:** Relies on an \`export.json\` file within a designated file export project (created using \`sf hardis:org:configure:files\`) to determine which files to import and how they should be associated with Salesforce records.
- **Interactive Project Selection:** If the file import project path is not provided via the \`--path\` flag, it interactively prompts the user to select one.
- **Overwrite Option:** The \`--overwrite\` flag allows you to replace existing files in Salesforce with local versions that have the same name. Be aware that this option doubles the number of API calls used.
- **Support for ContentVersion and Attachment:** Handles both modern Salesforce Files (ContentVersion) and older Attachments.

See this article for how to export files, which is often a prerequisite for importing:

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **FilesImporter Class:** The core logic is encapsulated within the \`FilesImporter\` class, which orchestrates the entire import process.
- **File System Scan:** Scans the local file system within the configured project directory to identify files for import.
- **Salesforce API Interaction:** Uses Salesforce APIs (e.g., ContentVersion, Attachment) to upload files and associate them with records.
- **Configuration Loading:** Reads the \`export.json\` file to get the import configuration, including SOQL queries to identify parent records for file association.
- **Interactive Prompts:** Uses \`selectFilesWorkspace\` to allow the user to choose a file import project and \`prompts\` for confirming the overwrite behavior.
- **Error Handling:** Includes mechanisms to handle potential errors during the import process, such as API limits or file upload failures.
</details>
`;

  public static examples = ['$ sf hardis:org:files:import'];

  public static flags: any = {
    path: Flags.string({
      char: 'p',
      description: 'Path to the file export project',
    }),
    overwrite: Flags.boolean({
      char: 'f',
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
          'Do you want to overwrite the existing files with the same name?',
        description: 'Replace existing files in Salesforce with local versions (doubles the number of API calls used).',
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
    const message = `Successfully imported files from project ${c.green(filesPath)} to org ${c.green(
      flags['target-org'].getUsername()
    )}`;
    uxLog("action", this, c.cyan(message));

    const statsTable = humanizeObjectKeys(importResult.stats);
    uxLogTable(this, statsTable);

    return { outputString: message, importResult: importResult };
  }
}
