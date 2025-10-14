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
import { setConnectionVariables } from '../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Flow2Markdown extends SfCommand<any> {
  public static title = 'Flow to Markdown';

  public static description = `
## Command Behavior

**Generates comprehensive Markdown documentation from a Salesforce Flow metadata file.**

This command automates the creation of human-readable documentation for Salesforce Flows, making it easier to understand their logic and behavior. It can process a single Flow file or multiple Flow files, generating a Markdown file for each.

Key features include:

- **Detailed Flow Description:** Extracts and presents the Flow's structure, elements, and decision logic in a clear, organized Markdown format.
- **AI-Powered Summarization (Optional):** If [AI integration](${CONSTANTS.DOC_URL_ROOT}/salesforce-ai-setup/) is configured, the documentation will include an AI-generated summary of the Flow's purpose and functionality.
- **Mermaid Diagram Generation:** Integrates with Mermaid to visualize the Flow's structure, providing a graphical representation alongside the textual description.
- **History Diff (Optional):** Can generate a Markdown file showing the historical differences of the Flow, useful for tracking changes over time.
- **PDF Export (Optional):** Allows for the generation of the documentation in PDF format for easy sharing and archiving.
- **Interactive File Selection:** If no input file is specified, the command interactively prompts the user to select Flow files.

<details markdown="1">
<summary>Technical explanations</summary>

The command leverages several internal utilities and external libraries to achieve its functionality:

- **Flow Metadata Parsing:** Reads and parses the XML content of Salesforce Flow metadata files (.flow-meta.xml).
- **Markdown Generation:** Utilizes 	exttt{generateFlowMarkdownFile} to transform the parsed Flow data into a structured Markdown format.
- **Mermaid Integration:** Employs 	exttt{generateMarkdownFileWithMermaid} to embed Mermaid diagrams within the Markdown output, which are then rendered by compatible Markdown viewers.
- **AI Integration:** If enabled, it interacts with an AI service (via 	exttt{describeWithAi} option) to generate a high-level summary of the Flow.
- **Git History Analysis:** For the \
--with-history\
 flag, it uses 	exttt{generateHistoryDiffMarkdown} to analyze Git history and present changes to the Flow.
- **File System Operations:** Uses 	exttt{fs-extra} for file system operations like reading input files, creating output directories (e.g., 	exttt{docs/flows/}), and writing Markdown and PDF files.
- **Salesforce CLI Integration:** Uses 	exttt{@salesforce/sf-plugins-core} for command-line parsing and 	exttt{setConnectionVariables} for Salesforce organization context.
- **WebSocket Communication:** Interacts with a WebSocket client (	exttt{WebSocketClient.requestOpenFile}) to open the generated Markdown file in a VS Code tab, enhancing user experience.
</details>
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
    await setConnectionVariables(flags['target-org']?.getConnection(), true); // Required for some notifications providers like Email, or for Agentforce


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

      uxLog("log", this, c.grey(`Generating Markdown for Flow ${inputFile}.`));
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
          uxLog("warning", this, c.yellow(`Error generating history-diff Markdown: ${e.message}.`));
        }
      }

      // Open file in a new VS Code tab if available
      WebSocketClient.requestOpenFile(outputFile);
      outputFiles.push(outputFile);

    }
    // Return an object to be displayed with --json
    return { outputFiles: outputFiles };
  }

}
