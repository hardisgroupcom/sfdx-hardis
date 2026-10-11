/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../../common/utils/fsUtils.js';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  EMPTY_ITEM_CONSTRAINTS,
  isEmptyItemDeletable,
  isKnownCommit,
  isEmptyMetadataRoot,
  removeTypeMembersFromPackageXml,
} from '../../../../common/utils/emptyItemsUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanEmptyItems extends SfCommand<any> {
  public static title = 'Clean retrieved empty items in dx sources';

  public static description: string = `
## Command Behavior

**Removes empty or irrelevant metadata items from your Salesforce DX project sources.**

This command helps maintain a clean and efficient Salesforce codebase by deleting metadata files that are essentially empty or contain no meaningful configuration. These files can sometimes be generated during retrieval processes or remain after refactoring, contributing to unnecessary clutter in your project.

Key functionalities:

- **Targeted Cleaning:** Specifically targets and removes empty instances of:
  - Global Value Set Translations (\`.globalValueSetTranslation-meta.xml\`)
  - Standard Value Sets (\`.standardValueSet-meta.xml\`)
  - Sharing Rules (\`.sharingRules-meta.xml\`)
  - Custom Objects (\`.object-meta.xml\`) with no attribute at all. Salesforce CLI writes \`<CustomObject></CustomObject>\` when a field, list view, record type or validation rule is retrieved without its object. Committed, it makes the deployment fail with \`Must specify a non-empty label for the CustomObject\`.
- **Never a destructive change:** Deleting a file that git already has would make the next delta delete the component in the target org. With \`--delta-from <commit>\` (passed by [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)), a file that already exists at that commit is kept and named in a warning. Without it, an empty CustomObject file already committed is kept the same way.
- **package.xml kept consistent:** When an empty CustomObject file is deleted, its member is removed from \`manifest/package.xml\` if it is listed there, with a log line.
- **Scope:** The package directories of \`sfdx-project.json\` are scanned, or \`--folder\` when given. \`--metadata-type\` restricts the cleaning to some types: the VS Code Metadata Retriever calls \`--metadata-type CustomObject\` after a retrieve that wrote new object files. An unknown \`--delta-from\` commit (for example a branch that was never fetched) is reported, and only the empty files not committed yet are removed.
- **Automatic cleaning:** Add \`emptyItems\` to \`autoCleanTypes\` in \`.sfdx-hardis.yml\` to run this cleaning each time a user story is saved.
- **Content-Based Deletion:** It checks the XML content of these files for the presence of specific tags (e.g., \`valueTranslation\` for Global Value Set Translations) to determine if they are truly empty or lack relevant data. A CustomObject file is empty when its root element has no child.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses \`glob\` to find files matching predefined patterns for Global Value Set Translations, Standard Value Sets, Sharing Rules and Custom Objects within the package directories of \`sfdx-project.json\`, or the folder given with \`--folder\`.
- **XML Parsing:** For each matching file, it reads and parses the XML content using \`parseXmlFile\`.
- **Content Validation:** It then checks the parsed XML object for the existence of specific nested properties (e.g., \`xmlContent.GlobalValueSetTranslation.valueTranslation\`). If these properties are missing or empty, the file is considered empty.
- **File Deletion:** If a file is determined to be empty, it is removed from the file system using \`fs.remove\`.
- **Git check:** \`git cat-file -e <commit>:<file>\` tells whether the file exists at the \`--delta-from\` commit (or at \`HEAD\` for CustomObject files when no commit is given). Outside a git repository, empty files are always deleted.
- **package.xml:** \`parsePackageXmlFile\` / \`writePackageXmlFile\` remove the CustomObject members of deleted files from \`manifest/package.xml\`: \`hardis:work:save\` computes that file from the git delta before running the cleanings, so it already lists them.
- **Logging:** Provides clear messages about which files are being removed and a summary of the total number of items cleaned.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:clean:emptyitems --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = [
    '$ sf hardis:project:clean:emptyitems',
    '$ sf hardis:project:clean:emptyitems --metadata-type CustomObject',
    '$ sf hardis:project:clean:emptyitems --delta-from origin/integration',
    '$ sf hardis:project:clean:emptyitems --agent',
  ];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      description: 'Root folder (default: the package directories of sfdx-project.json)',
    }),
    'metadata-type': Flags.string({
      multiple: true,
      options: EMPTY_ITEM_CONSTRAINTS.map((constraint) => constraint.metadataType),
      description: 'Only clean these metadata types (default: all of them)',
    }),
    'delta-from': Flags.string({
      description:
        'Git commit or ref the next delta starts from: empty files that already exist there are kept, as deleting them would generate destructive changes',
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected folders: string[] = [];
  protected metadataTypes: string[] | null = null;
  protected debugMode = false;
  protected deltaFrom: string | null = null;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanEmptyItems);
    this.folders = flags.folder
      ? [flags.folder]
      : (this.project?.getPackageDirectories() || []).map((packageDir: any) => packageDir.path);
    if (this.folders.length === 0) {
      this.folders = ['force-app'];
    }
    this.metadataTypes = flags['metadata-type'] || null;
    this.debugMode = flags.debug || false;
    this.deltaFrom = flags['delta-from'] || null;
    if (this.deltaFrom && !(await isKnownCommit(this.deltaFrom))) {
      // A ref that was never fetched, or mistyped, must not make committed files look deletable
      uxLog("warning", this, c.yellow(t('emptyItemsUnknownDeltaFrom', { commit: this.deltaFrom })));
      this.deltaFrom = 'HEAD';
    }

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(t('removingEmptyDxManagedSourceFiles')));
    /* jscpd:ignore-end */
    const removed: { type: string; file: string }[] = [];
    const kept: { type: string; file: string; reason: string }[] = [];
    const constraints = EMPTY_ITEM_CONSTRAINTS.filter(
      (constraint) => this.metadataTypes === null || this.metadataTypes.includes(constraint.metadataType)
    );
    for (const constraint of constraints) {
      const matchingFiles: string[] = [];
      for (const folder of this.folders) {
        matchingFiles.push(...(await glob(path.resolve(folder) + constraint.globPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS })));
      }
      for (const matchingFile of matchingFiles) {
        const xmlContent = await parseXmlFile(matchingFile);
        if (!isEmptyMetadataRoot(xmlContent, constraint.rootTag, constraint.childTag)) {
          continue;
        }
        if (!(await isEmptyItemDeletable(matchingFile, constraint, this.deltaFrom))) {
          uxLog("warning", this, c.yellow(t('emptyItemKeptAlreadyCommitted', { file: matchingFile, type: constraint.metadataType })));
          kept.push({ type: constraint.metadataType, file: matchingFile, reason: 'alreadyInGit' });
          continue;
        }
        await fs.remove(matchingFile);
        uxLog("action", this, c.cyan(t('removedEmptyItem', { matchingCustomFile: c.yellow(matchingFile) })));
        removed.push({ type: constraint.metadataType, file: matchingFile });
      }
    }
    await this.removeDeletedObjectsFromPackageXml(removed);

    // Summary
    const msg = t('emptyItemsRemovedCount', { count: c.green(c.bold(removed.length)) });
    uxLog("action", this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg, removed, kept };
  }

  // hardis:work:save computes manifest/package.xml from the git delta before the cleanings run, so it already
  // lists the objects whose empty file was just deleted: remove them, the file they came from is gone
  private async removeDeletedObjectsFromPackageXml(removed: { type: string; file: string }[]) {
    const objectNames = removed
      .filter((item) => item.type === 'CustomObject')
      .map((item) => path.basename(item.file).replace('.object-meta.xml', ''));
    const packageXml = path.join('manifest', 'package.xml');
    const removedMembers = await removeTypeMembersFromPackageXml(packageXml, 'CustomObject', objectNames);
    for (const member of removedMembers) {
      uxLog("action", this, c.cyan(t('emptyItemRemovedFromPackageXml', { type: 'CustomObject', name: member, packageXml })));
    }
  }
}
