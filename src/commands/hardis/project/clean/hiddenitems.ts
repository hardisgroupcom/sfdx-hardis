/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../../common/utils/fsUtils.js';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
const HIDDEN_SOURCE_FILE_EXTENSIONS = 'app,cmp,evt,tokens,html,css,js,xml,cls,trigger,component';

function fileContentStartsWithHiddenMarker(fileContent: string): boolean {
  return fileContent.replace(/^\uFEFF/, '').trimStart().startsWith('(hidden)');
}

async function removeHiddenSourceItem(filePath: string): Promise<string> {
  const componentFolder = path.dirname(filePath);
  const folderSplit = componentFolder.split(path.sep);
  const toRemove =
    folderSplit.includes('lwc') || folderSplit.includes('aura') ? componentFolder : filePath;

  await fs.remove(toRemove);

  if (toRemove !== filePath) {
    return toRemove;
  }

  const metaFile = `${filePath}-meta.xml`;
  if (await fs.pathExists(metaFile)) {
    await fs.remove(metaFile);
    return `${toRemove} (+ ${metaFile})`;
  }

  return toRemove;
}

export default class CleanHiddenItems extends SfCommand<any> {
  public static title = 'Clean retrieved hidden items in dx sources';

  public static description: string = `
## Command Behavior

**Removes hidden or temporary metadata items from your Salesforce DX project sources.**

This command helps clean up your local Salesforce project by deleting files that are marked as hidden or are temporary artifacts.
Salesforce CLI can retrieve \`(hidden)\` file bodies for metadata that belongs to installed managed packages, because the implementation is not visible in subscriber orgs.
Those placeholder files, and their companion metadata files, are not deployable source and should not be kept in version control.

Key functionalities:

- **Targeted File Scan:** Scans for files with specific extensions (\`.app\`, \`.cmp\`, \`.evt\`, \`.tokens\`, \`.html\`, \`.css\`, \`.js\`, \`.xml\`, \`.cls\`, \`.trigger\`, \`.component\`) within the specified root folder (defaults to \`force-app\`).
- **Hidden Content Detection:** Identifies files whose content starts with (hidden), allowing an initial BOM or whitespace. This is a convention used by some Salesforce tools to mark temporary or internal files.
- **Component Folder Removal:** If a hidden file is part of a Lightning Web Component (LWC) or Aura component folder, the entire component folder is removed to ensure a complete cleanup.
- **Companion Metadata Removal:** If a hidden source file has a sibling \`*-meta.xml\` file (for example \`.cls-meta.xml\`, \`.trigger-meta.xml\`, \`.component-meta.xml\`), the companion metadata file is removed as well.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses \`glob\` to find files matching the specified patterns within the \`folder\`.
- **Content Reading:** Reads the content of each file.
- **Hidden Marker Check:** Checks if the file content starts with the literal string (hidden), after an optional BOM or whitespace.
- **Folder or File Removal:** If a file is identified as hidden:
  - If it's within an lwc or aura component folder, the entire component folder is removed using \`fs.remove\`.
  - Otherwise, the individual file and its optional \`*-meta.xml\` companion file are removed.
- **Logging:** Provides clear messages about which items are being removed and a summary of the total number of hidden items cleaned.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:clean:hiddenitems --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = ['$ sf hardis:project:clean:hiddenitems',
    '$ sf hardis:project:clean:hiddenitems --agent',];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
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

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanHiddenItems);
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(t('removingHiddenDxManagedSourceFiles')));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = `**/*.{${HIDDEN_SOURCE_FILE_EXTENSIONS}}`;
    const matchingCustomFiles = await glob(findManagedPattern, {
      cwd: rootFolder,
      ignore: PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS,
      nodir: true,
    });
    let counter = 0;
    for (const matchingCustomFile of matchingCustomFiles) {
      const matchingCustomFilePath = path.join(rootFolder, matchingCustomFile);
      if (!fs.existsSync(matchingCustomFilePath)) {
        continue;
      }
      const fileStats = await fs.stat(matchingCustomFilePath);
      if (!fileStats.isFile()) {
        continue;
      }
      const fileContent = await fs.readFile(matchingCustomFilePath, 'utf8');
      if (fileContentStartsWithHiddenMarker(fileContent)) {
        const toRemove = await removeHiddenSourceItem(matchingCustomFilePath);
        uxLog("action", this, c.cyan(t('removedHiddenItem', { toRemove: c.yellow(toRemove) })));
        counter++;
      }
    }

    // Summary
    const msg = `Removed ${c.green(c.bold(counter))} hidden source items`;
    uxLog("action", this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
