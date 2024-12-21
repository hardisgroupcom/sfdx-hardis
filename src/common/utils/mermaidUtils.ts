import c from "chalk"
import fs from 'fs-extra';
import * as Diff from "diff";
import * as path from "path";
import which from "which";
import { execCommand, git, uxLog } from "./index.js";
import { parseFlow } from "./flowVisualiser/flowParser.js";
import { getReportDirectory } from "../../config/index.js";
import moment from "moment";
import { SfError } from "@salesforce/core";
import { PACKAGE_ROOT_DIR } from "../../settings.js";


let IS_MERMAID_AVAILABLE: boolean | null = null;

export async function isMermaidAvailable() {
  if (IS_MERMAID_AVAILABLE !== null) {
    return IS_MERMAID_AVAILABLE;
  }
  const isMmdAvailable = await which("mmdc", { nothrow: true });
  IS_MERMAID_AVAILABLE = isMmdAvailable !== null
  if (IS_MERMAID_AVAILABLE === false) {
    uxLog(this, c.yellow("MermaidJs is not available. To improve performances, please install it by running `npm install @mermaid-js/mermaid-cli --global`"));
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
  const puppeteerConfigPath = path.join(PACKAGE_ROOT_DIR, 'defaults', 'puppeteer-config.json');
  const mermaidCmd = `${!isMmdAvailable ? 'npx --yes -p @mermaid-js/mermaid-cli ' : ''}mmdc -i "${outputFlowMdFile}" -o "${outputFlowMdFile}" --puppeteerConfigFile "${puppeteerConfigPath}"`;
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

classDef actionCallsChanged fill:#344568,color:white,stroke:#edaa18,stroke-width:12px;
classDef assignmentsChanged fill:#F97924,color:white,stroke:#edaa18,stroke-width:12px;
classDef collectionProcessorsChanged fill:#DD7A00,color:white,stroke:#edaa18,stroke-width:12px;
classDef customErrorsChanged fill:#032D60,color:white,stroke:#edaa18,stroke-width:12px;
classDef decisionsChanged fill:#DD7A00,color:white,stroke:#edaa18,stroke-width:12px;
classDef loopsChanged fill:#E07D1C,color:undefined,stroke:#edaa18,stroke-width:12px;
classDef recordCreatesChanged fill:#F9548A,color:white,stroke:#edaa18,stroke-width:12px;
classDef recordDeletesChanged fill:#F9548A,color:white,stroke:#edaa18,stroke-width:12px;
classDef recordLookupsChanged fill:#F9548A,color:white,stroke:#edaa18,stroke-width:12px;
classDef recordUpdatesChanged fill:#F9548A,color:white,stroke:#edaa18,stroke-width:12px;
classDef screensChanged fill:#1B96FF,color:white,stroke:#edaa18,stroke-width:12px;
classDef subflowsChanged fill:#032D60,color:white,stroke:#edaa18,stroke-width:12px;

classDef addedLink stroke:#00ff00,stroke-width:3px;
classDef removedLink stroke:#ff0000,stroke-width:3px;
`
}

export async function generateFlowVisualGitDiff(flowFile, commitBefore: string, commitAfter: string,
  options: { mermaidMd: boolean, svgMd: boolean, debug: boolean } = { mermaidMd: false, svgMd: true, debug: false }): Promise<string> {
  const mermaidMdBefore = await buildMermaidMarkdown(commitBefore, flowFile);
  const mermaidMdAfter = await buildMermaidMarkdown(commitAfter, flowFile);
  const flowLabel = path.basename(flowFile, ".flow-meta.xml");

  if (options.debug) {
    uxLog(this, c.grey("FLOW DOC BEFORE:\n" + mermaidMdBefore) + "\n");
    uxLog(this, c.grey("FLOW DOC AFTER:\n" + mermaidMdAfter) + "\n");
  }

  const flowDiffs = Diff.diffLines(mermaidMdBefore, mermaidMdAfter);
  // uxLog(this, JSON.stringify(flowDiffs, null, 2));

  const mixedLines: any[] = [];
  for (const line of flowDiffs) {
    if (line.added) {
      mixedLines.push(...line.value.split(/\r?\n/).map(lineSplit => { return ["added", lineSplit] }));
    }
    else if (line.removed) {
      mixedLines.push(...line.value.split(/\r?\n/).map(lineSplit => { return ["removed", lineSplit] }));
    }
    else {
      mixedLines.push(...line.value.split(/\r?\n/).map(lineSplit => { return ["unchanged", lineSplit] }));
    }
  }
  // uxLog(this, JSON.stringify(mixedLines, null, 2));
  const compareMdLines: string[] = [];
  buildFinalCompareMarkdown(mixedLines, compareMdLines, false, false);

  // Write markdown with diff in a file
  const reportDir = await getReportDirectory();
  await fs.ensureDir(path.join(reportDir, "flow-diff"));
  const diffMdFile = path.join(reportDir, 'flow-diff', `${flowLabel}_${moment().format("YYYYMMDD-hhmmss")}.md`);
  await fs.writeFile(diffMdFile, compareMdLines.join("\n"));
  if (options.mermaidMd) {
    await fs.copyFile(diffMdFile, diffMdFile + ".mermaid.md");
  }
  if (!options.svgMd) {
    return diffMdFile;
  }
  // Generate final markdown with mermaid SVG
  const finalRes = await generateMarkdownFileWithMermaid(diffMdFile);
  if (finalRes) {
    uxLog(this, c.green(`Successfully generated visual git diff for flow: ${diffMdFile}`));
  }
  return diffMdFile;
}

function buildFinalCompareMarkdown(mixedLines: any[], compareMdLines, isMermaid, isTableStarted) {
  if (mixedLines.length === 0) {
    return;
  }
  // Take line to process
  const [status, currentLine] = mixedLines.shift();
  // Update mermaid state
  if (isMermaid === false && currentLine.includes("```mermaid")) {
    isMermaid = true;
  } else if (isMermaid === true && currentLine.includes("```")) {
    compareMdLines.push(...getMermaidExtraClasses().split("\n"));
    isMermaid = false;
  }
  let styledLine = currentLine;
  // Remove next diff line if not relevant
  if (styledLine.startsWith("|") && mixedLines.length > 1 && mixedLines[0][1] === '' && mixedLines[1][1].startsWith("|")) {
    mixedLines.shift();
  }
  // Skip table block if there are no updated lines within
  if (styledLine.startsWith("## ") && !styledLine.startsWith("## Flow")) {
    let updatedInBlock = false;
    let nextBlockPos = 0;
    for (const nextLine of mixedLines) {
      if (nextLine[1].startsWith("## ") || nextLine[1].startsWith("_Documentation")) {
        break;
      }
      if (nextLine[0] === "removed" || nextLine[0] === "added") {
        updatedInBlock = true;
      }
      nextBlockPos++;
    }
    if (!updatedInBlock) {
      const mixedLinesStartingFromNextBlock = mixedLines.slice(nextBlockPos);
      // Continue processing next lines
      buildFinalCompareMarkdown(mixedLinesStartingFromNextBlock, compareMdLines, isMermaid, isTableStarted);
      return;
    }
  }
  // Skip node block if there are no updated lines within
  else if (styledLine.startsWith("### ")) {
    let updatedInBlock = false;
    let nextBlockPos = 0;
    for (const nextLine of mixedLines) {
      if (nextLine[1].startsWith("### ") || nextLine[1].startsWith("_Documentation")) {
        break;
      }
      if (nextLine[0] === "removed" || nextLine[0] === "added") {
        updatedInBlock = true;
      }
      nextBlockPos++;
    }
    if (!updatedInBlock) {
      const mixedLinesStartingFromNextBlock = mixedLines.slice(nextBlockPos);
      // Continue processing next lines
      buildFinalCompareMarkdown(mixedLinesStartingFromNextBlock, compareMdLines, isMermaid, isTableStarted);
      return;
    }
  }
  // Skip table lines that have not been updated
  else if (!isMermaid && styledLine.startsWith("|") && isTableStarted === false) {
    isTableStarted = true;
    const tableFilteredLines: any[] = [];
    let endTablePos = 0;
    for (const nextLine of mixedLines) {
      if (!nextLine[1].startsWith("|") && nextLine[1] !== "") {
        break;
      }
      if (nextLine[0] === "removed" || nextLine[0] === "added" || endTablePos === 0) {
        tableFilteredLines.push(nextLine);
      }
      endTablePos++;
    }
    compareMdLines.push(styledLine);
    const mixedLinesStartingFromEndOfTable = mixedLines.slice(endTablePos);
    const newMixedLines = [...tableFilteredLines, ...mixedLinesStartingFromEndOfTable];
    // Continue processing next lines
    buildFinalCompareMarkdown(newMixedLines, compareMdLines, isMermaid, true);
    return;
  }

  // Tables lines
  if (!isMermaid && status === "removed" && styledLine.startsWith("|")) {
    styledLine = "|🟥" + styledLine.split("|").filter(e => e !== "").map((col: string) => `<span style="background-color: red;"><i>${col}</i></span>`).join("|") + "|";
  }
  else if (!isMermaid && status === "added" && styledLine.startsWith("|")) {
    styledLine = "|🟩" + styledLine.split("|").filter(e => e !== "").map((col: string) => `<span style="background-color: green;"><b>${col}</b></span>`).join("|") + "|";
  }
  // Normal lines
  else if (!isMermaid && status === "removed" && styledLine.startsWith("###")) {
    styledLine = `### 🟥${styledLine.replace("### ", "")}`;
  }
  else if (!isMermaid && status === "added" && styledLine.startsWith("###")) {
    styledLine = `### 🟩${styledLine.replace("### ", "")}`;
  }
  // Normal lines
  else if (!isMermaid && status === "removed" && styledLine !== "") {
    styledLine = `<span style="background-color: red;"><i>🟥${styledLine}</i></span>`;
  }
  else if (!isMermaid && status === "added" && styledLine !== "") {
    styledLine = `<span style="background-color: green;"><b>🟩${styledLine}</b></span>`;
  }
  // Boxes lines
  else if (isMermaid === true && status === "removed" && currentLine.split(":::").length === 2) {
    styledLine = styledLine + "Removed"
    if (styledLine.split('"').length === 3) {
      const splits = styledLine.split('"');
      styledLine = splits[0] + '"🟥<i>' + splits[1] + '</i>"' + splits[2]
    }
  }
  else if (isMermaid === true && status === "added" && currentLine.split(":::").length === 2) {
    styledLine = styledLine + "Added"
    if (styledLine.split('"').length === 3) {
      const splits = styledLine.split('"');
      styledLine = splits[0] + '"🟩<b>' + splits[1] + '</b>"' + splits[2]
    }
  }
  else if (isMermaid === true && currentLine.includes(":::")) {
    // Detect if link line does not change, but its content did
    const splits = currentLine.split(/[[({]/);
    if (splits.length > 1) {
      const boxName = splits[0];
      const changed = mixedLines.filter(([lineStatus, line]) => { return line.startsWith(`click ${boxName}`) && ["added", "changed"].includes(lineStatus) }).length;
      if (changed > 0) {
        styledLine = styledLine + "Changed"
        if (styledLine.split('"').length === 3) {
          const splits = styledLine.split('"');
          styledLine = splits[0] + '"🟧<b>' + splits[1] + '</b>"' + splits[2]
        }
      }
    }
  }
  // Link lines
  else if (isMermaid === true && status === "removed" && currentLine.includes('-->')) {
    styledLine = styledLine.replace("-->", "-.->") + ":::removedLink"
    if (styledLine.split("|").length === 3) {
      const splits = styledLine.split("|");
      styledLine = splits[0] + "|🟥<i>" + splits[1] + "</i>|" + splits[2]
    }
  }
  else if (isMermaid === true && status === "added" && currentLine.includes('-->')) {
    styledLine = styledLine.replace("-->", "==>") + ":::addedLink"
    if (styledLine.split("|").length === 3) {
      const splits = styledLine.split("|");
      styledLine = splits[0] + "|🟩<b>" + splits[1] + "</b>|" + splits[2]
    }
  }
  compareMdLines.push(styledLine);
  // Continue processing next lines
  buildFinalCompareMarkdown(mixedLines, compareMdLines, isMermaid, (styledLine.startsWith("|") && isTableStarted));
}

async function buildMermaidMarkdown(commit, flowFile) {
  const flowXml = await git().show([`${commit}:${flowFile}`]);
  try {
    const flowDocGenResult = await parseFlow(flowXml, 'mermaid', { outputAsMarkdown: true });
    return flowDocGenResult.uml;
  } catch (err: any) {
    throw new SfError(`Unable to build Graph for flow ${flowFile}: ${err.message}`)
  }
}