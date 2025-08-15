/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import readFilesRecursive from 'fs-readdir-recursive';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class AuditDuplicateFiles extends SfCommand<any> {
  public static title = 'Find duplicate sfdx files';

  public static description = `
## Command Behavior

**Identifies and reports on duplicate file names within your Salesforce DX project folder.**

This command helps detect instances where files with the same name exist in different directories within your SFDX project. While some duplicates are expected (e.g., metadata files for different components of the same object), others can be a result of past Salesforce CLI bugs or improper source control practices, leading to confusion and potential deployment issues.

Key functionalities:

- **File Scan:** Recursively scans a specified root path (defaults to the current working directory) for all files.
- **Duplicate Detection:** Identifies files that share the same name but reside in different locations.
- **Intelligent Filtering:** Accounts for known patterns where duplicate file names are legitimate (e.g., \`field-meta.xml\`, \`listView-meta.xml\`, \`recordType-meta.xml\`, \`webLink-meta.xml\` files within object subdirectories).
- **Reporting:** Outputs a JSON object detailing the detected duplicates, including the file name and the full paths of its occurrences.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File System Traversal:** Uses \`fs-readdir-recursive\` to list all files within the specified directory, excluding \`node_modules\`.
- **Duplicate Logic:** Iterates through the list of all files and compares their base names. If two files have the same base name but different full paths, they are considered potential duplicates.
- **Exclusion Logic:** The \`checkDoublingAllowed\` function contains regular expressions to identify specific file path patterns where duplicate names are acceptable (e.g., \`objects/Account/fields/MyField__c.field-meta.xml\` and \`objects/Contact/fields/MyField__c.field-meta.xml\`). This prevents false positives.
- **Data Structuring:** Organizes the results into a JavaScript object where keys are duplicate file names and values are arrays of their full paths.
</details>
`;

  public static examples = ['$ sf hardis:project:audit:duplicatefiles'];

  public static flags: any = {
    path: Flags.string({
      char: 'p',
      default: process.cwd(),
      description: 'Root path to check',
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

  public static requiresProject = false;
  /* jscpd:ignore-end */

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(AuditDuplicateFiles);
    const pathToBrowser = flags.path || process.cwd();

    // List all files
    const allFiles = readFilesRecursive(pathToBrowser)
      .filter((file) => !file.includes('node_modules'))
      .map((file) => {
        return { fullPath: file, fileName: path.basename(file) };
      });

    uxLog(
      "action",
      this,
      c.cyan(`Checking for duplicate file names in ${c.bold(pathToBrowser)}. Files: ${c.bold(allFiles.length)}`)
    );

    // Find duplicates
    const duplicates: Record<string, string[]> = {};
    for (const file of allFiles) {
      const doublingFiles = allFiles.filter(
        (f) => f.fileName === file.fileName && f.fullPath !== file.fullPath && !this.checkDoublingAllowed(file, f)
      );
      if (doublingFiles.length > 0) {
        const doublingFullPaths = duplicates[file.fileName] || [];
        doublingFullPaths.push(...doublingFiles.map((f) => f.fullPath));
        duplicates[file.fileName] = doublingFullPaths;
      }
    }
    // Build summary
    const duplicateCount = Object.keys(duplicates).length;
    if (duplicateCount > 0) {
      const duplicateList = Object.entries(duplicates)
        .map(([fileName, paths]) => `${c.bold(fileName)}:\n  - ${paths.join('\n  - ')}`)
        .join('\n');
      uxLog(
        "action",
        this,
        c.cyan(`Found ${c.bold(duplicateCount)} duplicate file names in ${c.bold(pathToBrowser)}.`)
      );
      uxLog("warning", this, c.yellow(`Duplicate files:\n${duplicateList}`));
    }
    else {
      uxLog("action", this, c.cyan(`No duplicate file names found in ${c.bold(pathToBrowser)}.`));
    }
    return { duplicates: duplicates };
  }

  checkDoublingAllowed(file1, file2) {
    const regexes = [
      /objects.*fields.*field-meta\.xml/,
      /objects.*listViews.*listView-meta\.xml/,
      /objects.*recordTypes.*recordType-meta\.xml/,
      /objects.*webLinks.*webLink-meta\.xml/,
    ];
    for (const regex of regexes) {
      if (regex.test(file1.fullPath) && regex.test(file2.fullPath)) {
        return true;
      }
    }
    return false;
  }
}
