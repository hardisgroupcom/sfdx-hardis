/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { humanizeObjectKeys, isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
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

### Agent Mode

Use \`--agent\` to disable all prompts. Typical usage:

\`sf hardis:org:files:import --agent --path ./my-files-project --target-org myOrg\`

- Overwrite confirmation prompt is skipped; files are imported with overwrite enabled by default.
- The \`--path\` flag is required in agent mode (no interactive workspace selection).
`;

  public static examples = ['$ sf hardis:org:files:import', '$ sf hardis:org:files:import --agent --path ./my-files-project'];

  public static flags: any = {
    path: Flags.string({
      char: 'p',
      description: 'Path to the file export project',
    }),
    overwrite: Flags.boolean({
      char: 'f',
      description: 'Override existing files (doubles the number of API calls)',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
    const agentMode = flags.agent === true;

    // Identify files workspace if not defined
    if (filesPath == null) {
      if (isCI || agentMode) {
        throw new SfError(c.red('In agent/CI mode, --path flag is required to specify the files workspace.'));
      }
      filesPath = await selectFilesWorkspace({ selectFilesLabel: 'Please select a files workspace to IMPORT' });
    }

    if (!isCI && !agentMode) {
      const handleOverwriteRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: t('overwriteExistingFilesPrompt'),
        description: t('overwriteFilesDescription'),
      });
      this.handleOverwrite = handleOverwriteRes.value;
    } else if (agentMode) {
      this.handleOverwrite = true;
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
    uxLog("action", this, c.cyan(t('successfullyImportedFiles')));

    const statsTable = humanizeObjectKeys(importResult.stats);
    uxLogTable(this, statsTable);

    return { outputString: message, importResult: importResult };
  }
}
