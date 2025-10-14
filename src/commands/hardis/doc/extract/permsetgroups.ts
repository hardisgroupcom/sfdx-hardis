/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import { getReportDirectory } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ExtractPermSetGroups extends SfCommand<any> {
  public static title = 'Generate project documentation';

  public static description = `
## Command Behavior

**Extracts and documents Salesforce Permission Set Groups and their assigned Permission Sets.**

This command generates two types of output: a CSV file and a Markdown file, providing a clear overview of how Permission Set Groups are structured and what Permission Sets they contain within your Salesforce project. This is particularly useful for:

- **Documentation:** Creating human-readable documentation of your permission architecture.
- **Auditing:** Understanding the composition of permission sets for security and compliance checks.
- **Analysis:** Gaining insights into how permissions are bundled and assigned in your Salesforce environment.

The generated CSV file provides a structured, machine-readable format, while the Markdown file offers a more descriptive, human-friendly view, including the group's name, label, description, and a list of its constituent permission sets.

## Technical explanations

The command performs the following technical steps:

- **File Discovery:** It uses \`glob\` to find all \`.permissionsetgroup-meta.xml\` files within the current working directory, respecting \`.gitignore\` patterns.
- **XML Parsing:** For each discovered Permission Set Group XML file, it parses the XML content using \`parseXmlFile\` to extract relevant information such as the group's name, label, description, and the names of the Permission Sets it contains.
- **Data Structuring:** The extracted data is then structured into a list of objects, making it easy to process.
- **CSV Generation:** It constructs a CSV file with two columns: 'Permission set group' and 'Permission sets'. The 'Permission sets' column lists all assigned permission sets for each group, enclosed in quotes and separated by commas. The CSV file is saved to a temporary directory or a user-specified path.
- **Markdown Generation:** It generates a Markdown file (\`docs/permission-set-groups.md\`) that includes a title, a table of contents, and detailed sections for each Permission Set Group. Each section lists the group's name, label, description, and a bulleted list of its assigned Permission Sets.
- **File System Operations:** It uses \`fs-extra\` to ensure output directories exist and to write the generated CSV and Markdown files.
- **VS Code Integration:** It uses \`WebSocketClient.requestOpenFile\` to automatically open the generated CSV and Markdown files in VS Code, enhancing the user experience.
`;

  public static examples = ['$ sf hardis:doc:extract:permsetgroups'];

  public static flags: any = {
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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

  protected outputFile;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ExtractPermSetGroups);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    // Delete standard files when necessary
    uxLog("action", this, c.cyan(`Generating CSV and Markdown for Permission Set Groups and their related Permission Sets.`));
    /* jscpd:ignore-end */

    const psgList: any[] = [];
    const globPatternPSG = process.cwd() + `/**/*.permissionsetgroup-meta.xml`;
    const psgFiles = await glob(globPatternPSG, { ignore: GLOB_IGNORE_PATTERNS });
    uxLog("log", this, c.grey(`Found ${psgFiles.length} permission set groups.`));
    for (const psgFile of psgFiles) {
      const psgName = (psgFile.replace(/\\/g, '/').split('/').pop() || '').replace('.permissionsetgroup-meta.xml', '');
      const psg = await parseXmlFile(psgFile);
      const psgItem = {
        name: psgName,
        label: psg.PermissionSetGroup.label,
        description: psg.PermissionSetGroup.description,
        permissionSetsNames: psg.PermissionSetGroup.permissionSets,
      };
      psgList.push(psgItem);
    }

    // Build CSV
    const csvLines: any[] = [];
    const header = ['Permission set group', 'Permission sets'];
    csvLines.push(header);
    for (const psg of psgList) {
      const psgLine = [psg.name];
      psgLine.push(`"${psg.permissionSetsNames.join(',')}"`);
      csvLines.push(psgLine);
    }

    // Build output CSV file
    if (this.outputFile == null) {
      // Default file in system temp directory if --outputfile not provided
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'permission-set-groups.csv');
    } else {
      // Ensure directories to provided --outputfile are existing
      await fs.ensureDir(path.dirname(this.outputFile));
    }
    try {
      const csvText = csvLines.map((e) => e.join(',')).join('\n');
      await fs.writeFile(this.outputFile, csvText, 'utf8');
      uxLog("action", this, c.cyan(`Permission set groups CSV file generated at ${c.bold(c.green(this.outputFile))}.`));
      // Trigger command to open CSV file in VS Code extension
      WebSocketClient.requestOpenFile(this.outputFile);
    } catch (e: any) {
      uxLog("warning", this, c.yellow('Error while generating CSV file:\n' + (e as Error).message + '\n' + e.stack));
      this.outputFile = null;
    }

    // Build markdown file
    const mdPsg = ['# Permission set groups', '', '<!-- toc -->', '<!-- tocstop -->'];
    for (const psg of psgList) {
      mdPsg.push(...[`## ${psg.name}`, '', psg.label, '', psg.description, '']);
      for (const psName of psg.permissionSetsNames) {
        mdPsg.push(`  - ${psName} `);
      }
      mdPsg.push('');
    }
    const docFile = 'docs/permission-set-groups.md';
    await fs.ensureDir('docs');
    const mdPsgText = mdPsg.join('\n');
    // mdPsgText = toc.insert(mdPsgText);
    await fs.writeFile(docFile, mdPsgText, 'utf8');
    uxLog("action", this, c.cyan(`Permission set groups Markdown file generated at ${c.bold(c.green(docFile))}.`));
    // Trigger command to open CSV file in VS Code extension
    WebSocketClient.requestOpenFile(docFile);

    // Return an object to be displayed with --json
    return { outputString: 'Permission set groups documentation generated.' };
  }
}
