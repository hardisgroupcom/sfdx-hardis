/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
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

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Flow2Markdown extends SfCommand<any> {
  public static title = 'Flow to Markdown';

  public static description = `Generates a markdown documentation from a Flow file
  
If [AI integration](${CONSTANTS.DOC_URL_ROOT}/salesforce-ai-setup/) is configured, documentation will contain a summary of the Flow.  
  `;

  public static examples = [
    '$ sf hardis:doc:flow2markdown',
    '$ sf hardis:doc:flow2markdown --inputfile force-app/main/default/flows/MyFlow.flow-meta.xml',
    '$ sf hardis:doc:flow2markdown --pdf',
    '$ sf hardis:doc:flow2markdown --inputfile force-app/main/default/flows/MyFlow.flow-meta.xml --pdf',
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
      default: false,
      description: "Generate a markdown file with the history diff of the Flow",
    }),
    pdf: Flags.boolean({
      description: 'Also generate the documentation in PDF format',
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
    "target-org": optionalOrgFlagWithDeprecations
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected withHistory = false;
  protected withPdf = false;
  protected singleFileMode = false;
  protected inputFiles;
  protected outputFile;
  protected debugMode = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Flow2Markdown);
    const outputFiles: string[] = [];

    this.inputFiles = flags.inputfile ? [flags.inputfile] : null;
    this.outputFile = flags.outputfile || null;
    this.withHistory = flags["with-history"] === true ? true : false;
    this.withPdf = flags.pdf === true ? true : false;
    this.singleFileMode = this.inputFiles != null && this.inputFiles.length == 1;
    this.debugMode = flags.debug || false;
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email, or for Agentforce


    if (this.inputFiles === null && !isCI) {
      this.inputFiles = await MetadataUtils.promptMultipleFlows();
    }

    if (this.singleFileMode && !this.outputFile) {
      await fs.ensureDir(path.join("docs", "flows"));
      this.outputFile = path.join("docs", "flows", path.basename(this.inputFiles[0]).replace(".flow-meta.xml", ".md"));
    }

    for (const inputFile of this.inputFiles) {
      let outputFile = this.outputFile;
      if (!this.singleFileMode) {
        await fs.ensureDir(path.join("docs", "flows"));
        outputFile = path.join("docs", "flows", path.basename(inputFile).replace(".flow-meta.xml", ".md"));
      }
      const flowName = path.basename(inputFile, ".flow-meta.xml");

      uxLog(this, c.grey(`Generating markdown for Flow ${inputFile}...`));
      const flowXml = (await fs.readFile(inputFile, "utf8")).toString();
      const genRes = await generateFlowMarkdownFile(flowName, flowXml, outputFile, { collapsedDetails: false, describeWithAi: true, flowDependencies: {} });
      if (!genRes) {
        throw new Error("Error generating markdown file");
      }
      if (this.debugMode) {
        await fs.copyFile(outputFile, outputFile.replace(".md", ".mermaid.md"));
      }
      const gen2res = await generateMarkdownFileWithMermaid(outputFile, outputFile, null, this.withPdf);
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

      // Open file in a new VsCode tab if available
      WebSocketClient.requestOpenFile(outputFile);
      outputFiles.push(outputFile);

    }
    // Return an object to be displayed with --json
    return { outputFiles: outputFiles };
  }

}
