/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from "chalk";
import * as path from "path";
import fs from "fs-extra";
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import { generateFlowMarkdownFile, generateMarkdownFileWithMermaid } from '../../../common/utils/mermaidUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Flow2Markdown extends SfCommand<any> {
  public static title = 'Flow to Markdown';

  public static description = `Generates a markdown documentation from a Flow file`;

  public static examples = [
    '$ sf hardis:doc:flow2markdown',
    '$ sf hardis:doc:flow2markdown --inputfile force-app/main/default/flows/MyFlow.flow-meta.xml'
  ];

  public static flags: any = {
    inputfile: Flags.string({
      char: 'x',
      description: 'Path to Flow metadata file. If not specified, the command will prompt the user',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output markdown file. Must end with .md',
    }),
    "with-history": Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
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
    const { flags } = await this.parse(Flow2Markdown);
    this.inputFile = flags.inputfile || null;
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    if (this.inputFile === null && !isCI) {
      this.inputFile = await MetadataUtils.promptFlow();
    }
    if (!this.outputFile) {
      await fs.ensureDir(path.join("docs", "flows"));
      this.outputFile = path.join("docs", "flows", path.basename(this.inputFile).replace(".flow-meta.xml", ".md"));
    }

    uxLog(this, c.grey(`Generating markdown for Flow ${this.inputFile}...`));
    const flowXml = (await fs.readFile(this.inputFile, "utf8")).toString();
    const genRes = await generateFlowMarkdownFile(this.inputFile, flowXml, this.outputFile, { collapsedDetails: false });
    if (!genRes) {
      throw new Error("Error generating markdown file");
    }
    if (this.debugMode) {
      await fs.copyFile(this.outputFile, this.outputFile + ".mermaid.md");
    }
    const gen2res = await generateMarkdownFileWithMermaid(this.outputFile);
    if (!gen2res) {
      throw new Error("Error generating mermaid markdown file");
    }
    // Open file in a new VsCode tab if available
    WebSocketClient.requestOpenFile(this.outputFile);

    // Return an object to be displayed with --json
    return { outputFile: this.outputFile };
  }

}
