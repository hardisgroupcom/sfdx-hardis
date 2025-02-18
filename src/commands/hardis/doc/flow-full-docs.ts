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
import { generateFlowMarkdownFile, generateHistoryDiffMarkdown, generateMarkdownFileWithMermaid } from '../../../common/utils/mermaidUtils.js';
import { CONSTANTS } from '../../../config/index.js';
import { mdToPdf } from 'md-to-pdf';


Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FlowFullDocs extends SfCommand<any> {
  public static title = 'Full Flow Documentation';

  public static description = `Generates a Markdown and PDF documentation from Flows files
  
If [AI integration](${CONSTANTS.DOC_URL_ROOT}/salesforce-ai-setup/) is configured, documentation will contain a summary of the Flow.  
  `;

  public static examples = [
    '$ sf hardis:doc:flow-full-docs',
    '$ sf hardis:doc:flow-full-docs --inputfile force-app/main/default/flows/MyFlow.flow-meta.xml'
  ];

  public static flags: any = {
    inputfile: Flags.string({
      char: 'x',
      description: 'Path to Flow metadata file. If not specified, the command will prompt the user',
    }),
    "with-history": Flags.boolean({
      default: false,
      description: "Generate a markdown file with the history diff of the Flow",
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

  protected withHistory = false;
  protected inputFiles;
  protected debugMode = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FlowFullDocs);
    const outputFiles: string[] = [];
    this.inputFiles = flags.inputfile ? [flags.inputfile] : null;
    this.withHistory = flags["with-history"] === true ? true : false;
    this.debugMode = flags.debug || false;

    if (this.inputFiles === null && !isCI) {
      this.inputFiles = await MetadataUtils.promptMultipleFlows();
    }

    for (const inputFile of this.inputFiles) {
      await fs.ensureDir(path.join("docs", "flows"));
      const outputFile = path.join("docs", "flows", path.basename(inputFile).replace(".flow-meta.xml", ".md"));

      uxLog(this, c.grey(`Generating markdown for Flow ${inputFile}...`));
      const flowXml = (await fs.readFile(inputFile, "utf8")).toString();
      const genRes = await generateFlowMarkdownFile(path.basename(inputFile, ".flow-meta.xml"), flowXml, outputFile, { collapsedDetails: false, describeWithAi: true, flowDependencies: {} });
      if (!genRes) {
        throw new Error("Error generating markdown file");
      }
      if (this.debugMode) {
        await fs.copyFile(outputFile, outputFile.replace(".md", ".mermaid.md"));
      }
      const gen2res = await generateMarkdownFileWithMermaid(outputFile, outputFile, ['cli']);
      if (!gen2res) {
        throw new Error("Error generating mermaid markdown file");
      }

      if (this.withHistory) {
        try {
          await generateHistoryDiffMarkdown(inputFile, this.debugMode);
        } catch (e: any) {
          uxLog(this, c.yellow(`Error generating history diff markdown: ${e.message}`));
        }
      }

      uxLog(this, c.grey(`Generating PDF for Flow ${inputFile}...`));
      await mdToPdf({ path: outputFile }, {
        dest: outputFile.replace('.md', '.pdf'),
        css: `img {
              max-width: 50%;
              max-height: 20%;
              display: block;
              margin: 0 auto;
            }`,
        stylesheet_encoding: 'utf-8'
      }
      );

      // Open file in a new VsCode tab if available
      WebSocketClient.requestOpenFile(outputFile);
      outputFiles.push(outputFile);

    }
    // Return an object to be displayed with --json
    return { outputFiles: outputFiles };
  }

}
