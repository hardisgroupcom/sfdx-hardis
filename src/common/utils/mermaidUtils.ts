import c from "chalk"
import fs from 'fs-extra';
import which from "which";
import { execCommand, uxLog } from "./index.js";
import { parseFlow } from "salesforce-flow-visualiser";

let IS_MERMAID_AVAILABLE: boolean | null = null;

export async function isMermaidAvailable() {
  if (IS_MERMAID_AVAILABLE !== null) {
    return IS_MERMAID_AVAILABLE;
  }
  const isMmdAvailable = await which("mmdc", { nothrow: true });
  IS_MERMAID_AVAILABLE = isMmdAvailable !== null
  if (IS_MERMAID_AVAILABLE === false) {
    uxLog(this, c.yellow("MermaidJs is not available. Please install it by running `npm install @mermaid-js/mermaid-cli --global`"));
  }
  return IS_MERMAID_AVAILABLE;
}

export async function generateFlowMarkdownFile(flowName: string, flowXml: string, outputFlowMdFile: string): Promise<boolean> {
  try {
    const flowDocGenResult = await parseFlow(flowXml, 'mermaid', { outputAsMarkdown: true });
    const flowMarkdownDoc = flowDocGenResult.uml;
    await fs.writeFile(outputFlowMdFile, flowMarkdownDoc);
    uxLog(this, c.grey(`Written ${flowName} documentation in ${outputFlowMdFile}`));
    return true;
  } catch (e: any) {
    uxLog(this, c.yellow(`Error generating Flow ${flowName} documentation: ${e.message}`) + "\n" + c.grey(e.stack));
    return false;
  }
}

export async function generateMarkdownFileWithMermaid(outputFlowMdFile: string): Promise<boolean> {
  const isMmdAvailable = await isMermaidAvailable();
  uxLog(this, c.grey(`Generating mermaidJs Graphs in ${outputFlowMdFile}...`));
  const mermaidCmd = `${!isMmdAvailable ? 'npx --yes -p @mermaid-js/mermaid-cli ' : ''}mmdc -i "${outputFlowMdFile}" -o "${outputFlowMdFile}"`;
  try {
    await execCommand(mermaidCmd, this, { output: false, fail: true, debug: false });
    return true;
  } catch (e: any) {
    uxLog(this, c.yellow(`Error generating mermaidJs Graphs in ${outputFlowMdFile} documentation: ${e.message}`) + "\n" + c.grey(e.stack));
    return false;
  }
}

export function getMermaidExtraClasses() {
  return `classDef actionCallsAdded fill:#344568,color:white,stroke:#00ff00,stroke-width:12px;
classDef assignmentsAdded fill:#F97924,color:white,stroke:#00ff00,stroke-width:12px;
classDef collectionProcessorsAdded fill:#DD7A00,color:white,stroke:#00ff00,stroke-width:12px;
classDef customErrorsAdded fill:#032D60,color:white,stroke:#00ff00,stroke-width:12px;
classDef decisionsAdded fill:#DD7A00,color:white,stroke:#00ff00,stroke-width:12px;
classDef loopsAdded fill:#E07D1C,color:undefined,stroke:#00ff00,stroke-width:12px;
classDef recordCreatesAdded fill:#F9548A,color:white,stroke:#00ff00,stroke-width:12px;
classDef recordDeletesAdded fill:#F9548A,color:white,stroke:#00ff00,stroke-width:12px;
classDef recordLookupsAdded fill:#F9548A,color:white,stroke:#00ff00,stroke-width:12px;
classDef recordUpdatesAdded fill:#F9548A,color:white,stroke:#00ff00,stroke-width:12px;
classDef screensAdded fill:#1B96FF,color:white,stroke:#00ff00,stroke-width:12px;
classDef subflowsAdded fill:#032D60,color:white,stroke:#00ff00,stroke-width:12px;
  
classDef actionCallsRemoved fill:#344568,color:white,stroke:#ff0000,stroke-width:12px;
classDef assignmentsRemoved fill:#F97924,color:white,stroke:#ff0000,stroke-width:12px;
classDef collectionProcessorsRemoved fill:#DD7A00,color:white,stroke:#ff0000,stroke-width:12px;
classDef customErrorsRemoved fill:#032D60,color:white,stroke:#ff0000,stroke-width:12px;
classDef decisionsRemoved fill:#DD7A00,color:white,stroke:#ff0000,stroke-width:12px;
classDef loopsRemoved fill:#E07D1C,color:undefined,stroke:#ff0000,stroke-width:12px;
classDef recordCreatesRemoved fill:#F9548A,color:white,stroke:#ff0000,stroke-width:12px;
classDef recordDeletesRemoved fill:#F9548A,color:white,stroke:#ff0000,stroke-width:12px;
classDef recordLookupsRemoved fill:#F9548A,color:white,stroke:#ff0000,stroke-width:12px;
classDef recordUpdatesRemoved fill:#F9548A,color:white,stroke:#ff0000,stroke-width:12px;
classDef screensRemoved fill:#1B96FF,color:white,stroke:#ff0000,stroke-width:12px;
classDef subflowsRemoved fill:#032D60,color:white,stroke:#ff0000,stroke-width:12px;

classDef addedLink stroke:#00ff00,stroke-width:3px;
classDef removedLink stroke:#ff0000,stroke-width:3px;
`
}