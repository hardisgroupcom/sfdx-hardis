/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { appendPackageXmlFilesContent } from '../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MergePackageXml extends SfCommand<any> {
  public static title = 'Merge package.xml files';

  public static description = `
## Command Behavior

**Merges multiple Salesforce \`package.xml\` files into a single, consolidated \`package.xml\` file.**

This command is useful for combining metadata definitions from various sources (e.g., different feature branches, separate development efforts) into one comprehensive package.xml, which can then be used for deployments or retrievals.

Key functionalities:

- **Flexible Input:** You can specify the \`package.xml\` files to merge either by:
  - Providing a comma-separated list of file paths using the \`--packagexmls\` flag.
  - Specifying a folder and a glob pattern using \`--folder\` and \`--pattern\` to automatically discover \`package.xml\` files.
  - If no input is provided, an interactive menu will prompt you to select files from the \`manifest\` folder.
- **Customizable Output:** You can define the name and path of the resulting merged \`package.xml\` file using the \`--result\` flag.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses \`glob\` to find \`package.xml\` files based on the provided folder and pattern, or it directly uses the list of files from the \`--packagexmls\` flag.
- **Interactive Prompts:** If no \`package.xml\` files are specified, it uses the \`prompts\` library to allow the user to interactively select files to merge.
- **\`appendPackageXmlFilesContent\` Utility:** The core merging logic is handled by the \`appendPackageXmlFilesContent\` utility function. This function reads the content of each input \`package.xml\` file, combines their metadata types and members, and writes the consolidated content to the specified result file.
- **XML Manipulation:** Internally, \`appendPackageXmlFilesContent\` parses the XML of each \`package.xml\`, merges the \`<types>\` and \`<members>\` elements, and then rebuilds the XML structure for the output file.
- **File System Operations:** It uses \`fs-extra\` to ensure the output directory exists and to write the merged \`package.xml\` file.
- **WebSocket Communication:** It uses \`WebSocketClient.requestOpenFile\` to open the generated merged \`package.xml\` file in VS Code for immediate review.
</details>
`;

  public static examples = [
    '$ sf hardis:package:mergexml',
    '$ sf hardis:package:mergexml --folder packages --pattern /**/*.xml --result myMergedPackage.xml',
    '$ sf hardis:package:mergexml --packagexmls "config/mypackage1.xml,config/mypackage2.xml,config/mypackage3.xml" --result myMergedPackage.xml',
  ];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      default: 'manifest',
      description: 'Root folder',
    }),
    packagexmls: Flags.string({
      char: 'p',
      description: 'Comma separated list of package.xml files to merge. Will be prompted to user if not provided',
    }),
    pattern: Flags.string({
      char: 'x',
      default: '/**/*package*.xml',
      description: 'Name criteria to list package.xml files',
    }),
    result: Flags.string({
      char: 'r',
      description: 'Result package.xml file name',
    }),
    debug: Flags.boolean({
      default: false,
      description: 'debug',
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected folder: string;
  protected pattern: string;
  protected packageXmlFiles: any[] = [];
  protected resultFileName: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MergePackageXml);
    this.folder = flags.folder || './manifest';
    this.pattern = flags.pattern || '/**/*package*.xml';
    this.packageXmlFiles = flags.packagexmls ? flags.packagexmls.split(',') : [];
    this.resultFileName = flags.result || path.join(this.folder, 'package-merge.xml');
    await fs.ensureDir(path.dirname(this.resultFileName));
    this.debugMode = flags.debug || false;
    /* jscpd:ignore-end */

    // If packagexmls are not provided, prompt user
    if (this.packageXmlFiles.length === 0) {
      const rootFolder = path.resolve(this.folder);
      const findPackageXmlPattern = rootFolder + this.pattern;
      const matchingFiles = await glob(findPackageXmlPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
      const filesSelectRes = await prompts({
        type: 'multiselect',
        name: 'files',
        message: 'Please select the package.xml files you want to merge',
        description: 'Choose which package.xml files to combine into a single merged file',
        choices: matchingFiles.map((file) => {
          const relativeFile = path.relative(process.cwd(), file);
          return { title: relativeFile, value: relativeFile };
        }),
      });
      this.packageXmlFiles = filesSelectRes.files;
    }

    // Process merge of package.xml files
    await appendPackageXmlFilesContent(this.packageXmlFiles, this.resultFileName);

    // Summary
    const msg = `Merged ${c.green(c.bold(this.packageXmlFiles.length))} files into ${c.green(this.resultFileName)}`;
    uxLog("action", this, c.cyan(msg));

    // Trigger command to open files config file in VS Code extension
    WebSocketClient.requestOpenFile(this.resultFileName);

    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
