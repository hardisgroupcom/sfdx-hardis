/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { countPackageXmlItems, parsePackageXmlFile } from '../../../common/utils/xmlUtils.js';
import { CONSTANTS } from '../../../config/index.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { uxLog } from '../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageXml2Markdown extends SfCommand<any> {
  public static title = 'PackageXml to Markdown';

  public static description = `Generates a markdown documentation from a package.xml file`;

  public static examples = ['$ sf hardis:doc:packagexml2markdown'];

  public static flags: any = {
    inputfile: Flags.string({
      char: 'x',
      description: 'Path to package.xml file. If not specified, the command will look in manifest folder',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .md',
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
  public static requiresProject = false;

  protected inputFile;
  protected outputFile;
  protected debugMode = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageXml2Markdown);
    this.inputFile = flags.inputfile || null;
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // Calculate input & output files if not defined
    await this.handleOptionDefaults();

    uxLog(this, c.cyan(this, `Generating markdown doc from ${this.inputFile} to ${this.outputFile}...`));

    // Read content
    const packageXmlContent = await parsePackageXmlFile(this.inputFile);
    const metadataTypes = Object.keys(packageXmlContent);
    metadataTypes.sort();
    const nbItems = await countPackageXmlItems(this.inputFile);

    const mdLines: string[] = []

    // Header
    mdLines.push(...[
      `## Content of ${path.basename(this.inputFile)}`,
      '',
      `Metadatas: ${nbItems}`,
      ''
    ]);

    // Generate package.xml markdown
    for (const metadataType of metadataTypes) {
      const members = packageXmlContent[metadataType];
      members.sort();
      const memberLengthLabel = members.length === 1 && members[0] === "*" ? "*" : members.length;
      mdLines.push(`<details><summary>${metadataType} (${memberLengthLabel})</summary>`);
      for (const member of members) {
        const memberLabel = member === "*" ? "ALL (wildcard *)" : member;
        mdLines.push(`  • ${memberLabel}<br/>`);
      }
      mdLines.push("</details>");
      mdLines.push("");
      mdLines.push("<br/>");
    }
    mdLines.push("");

    // Footer
    mdLines.push(`_Documentation generated with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT})_`);

    // Write output file
    await fs.writeFile(this.outputFile, mdLines.join("\n") + "\n");

    uxLog(this, c.green(`Successfully generated package.xml documentation into ${this.outputFile}`));

    // Open file in a new VsCode tab if available
    WebSocketClient.requestOpenFile(this.outputFile);

    // Return an object to be displayed with --json
    return { outputFile: this.outputFile };
  }

  private async handleOptionDefaults() {
    // Find packageXml to parse
    if (this.inputFile == null) {
      this.inputFile = path.join(process.cwd(), "manifest", "package.xml");
      if (!fs.existsSync(this.inputFile)) {
        throw new SfError("No package.xml found. You need to send the path to a package.xml file in --inputfile option");
      }
    }
    // Build output file if not defined
    if (this.outputFile == null) {
      const packageXmlFileName = path.basename(this.inputFile);
      this.outputFile = path.join(process.cwd(), "docs", `${packageXmlFileName}.md`);
    }
    await fs.ensureDir(path.dirname(this.outputFile));
  }
}
