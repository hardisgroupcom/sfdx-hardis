import c from "chalk"
import fs from 'fs-extra';
import * as Diff from "diff";
import * as path from "path";
import which from "which";
import { execCommand, git, isDockerRunning, uxLog } from "./index.js";
import { parseFlow } from "./flowVisualiser/flowParser.js";
import { getReportDirectory } from "../../config/index.js";
import moment from "moment";
import { SfError } from "@salesforce/core";
import { PACKAGE_ROOT_DIR } from "../../settings.js";
import { AiProvider } from "../aiProvider/index.js";
import { UtilsAi } from "../aiProvider/utils.js";
import { generatePdfFileFromMarkdown } from "../utils/markdownUtils.js";

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

let IS_DOCKER_AVAILABLE: boolean | null = null;
export async function isDockerAvailable() {
  if (IS_DOCKER_AVAILABLE !== null) {
    return IS_DOCKER_AVAILABLE;
  }
  IS_DOCKER_AVAILABLE = await isDockerRunning();
  if (!IS_DOCKER_AVAILABLE) {
    uxLog(this, c.yellow("Docker daemon is not available. If you have issues running npm package @mermaid-js/mermaid-cli, please install Docker and start it"));
  }
  return IS_DOCKER_AVAILABLE;
}

export async function generateFlowMarkdownFile(flowName: string, flowXml: string, outputFlowMdFile: string, options: { collapsedDetails: boolean, describeWithAi: boolean, flowDependencies: any } = { collapsedDetails: true, describeWithAi: true, flowDependencies: {} }): Promise<boolean> {
  try {
    const flowDocGenResult = await parseFlow(flowXml, 'mermaid', { outputAsMarkdown: true, collapsedDetails: options.collapsedDetails });
    let flowMarkdownDoc = flowDocGenResult.uml;
    if (options.describeWithAi) {
      flowMarkdownDoc = await completeWithAiDescription(flowMarkdownDoc, flowXml, flowName);
    }

    // Add link to history flow doc 
    const historyFlowDoc = path.join("docs", "flows", flowName + "-history.md");
    if (fs.existsSync(historyFlowDoc)) {
      const historyLink = `[(_View History_)](${flowName + "-history.md"})`;
      if (flowMarkdownDoc.includes("## Flow Diagram") && !flowMarkdownDoc.includes(historyLink)) {
        flowMarkdownDoc = flowMarkdownDoc.replace("## Flow Diagram", `## Flow Diagram ${historyLink}`);
      }
    }

    // Add flow dependencies
    const dependencies: string[] = [];
    for (const mainFlow of Object.keys(options.flowDependencies)) {
      if (options.flowDependencies[mainFlow].includes(flowName)) {
        dependencies.push(mainFlow);
      }
    }
    if (dependencies.length > 0) {
      flowMarkdownDoc += `\n\n## Dependencies\n\n${dependencies.map(dep => `- [${dep}](${dep}.md)`).join("\n")}\n`;
    }

    await fs.writeFile(outputFlowMdFile, flowMarkdownDoc);
    uxLog(this, c.grey(`Written ${flowName} documentation in ${outputFlowMdFile}`));
    return true;
  } catch (e: any) {
    uxLog(this, c.yellow(`Error generating Flow ${flowName} documentation: ${e.message}`) + "\n" + c.grey(e.stack));
    return false;
  }
}

export async function generateMarkdownFileWithMermaid(outputFlowMdFileIn: string, outputFlowMdFileOut: string, mermaidModes: string[] | null = null, withPdf = false): Promise<boolean> {
  await fs.ensureDir(path.dirname(outputFlowMdFileIn));
  await fs.ensureDir(path.dirname(outputFlowMdFileOut));
  if (withPdf) {
    // Force the usage of mermaid CLI so the mermaid code is converted to SVG
    mermaidModes = ["cli"];
  } else if (process.env.MERMAID_MODES) {
    mermaidModes = process.env.MERMAID_MODES.split(",");
  }
  else if (mermaidModes === null) {
    mermaidModes = ["mermaid", "cli", "docker"];
  }
  if (mermaidModes.includes("mermaid")) {
    return true;
  }
  const isDockerAvlbl = await isDockerAvailable();
  if (isDockerAvlbl && (!(globalThis.mermaidUnavailableTools || []).includes("docker")) && mermaidModes.includes("docker")) {
    const dockerSuccess = await generateMarkdownFileWithMermaidDocker(outputFlowMdFileIn, outputFlowMdFileOut);
    if (dockerSuccess) {
      return true;
    }
  }
  if ((!(globalThis.mermaidUnavailableTools || []).includes("cli")) && mermaidModes.includes("cli")) {
    const mmCliSuccess = await generateMarkdownFileWithMermaidCli(outputFlowMdFileIn, outputFlowMdFileOut);
    if (mmCliSuccess) {
      if (withPdf) {
        const pdfGenerated = await generatePdfFileFromMarkdown(outputFlowMdFileOut);
        if (!pdfGenerated) { return false; }

        const fileName = path.basename(pdfGenerated).replace(".pdf", "");
        uxLog(this, c.grey(`Written ${fileName} PDF documentation in ${pdfGenerated}`));
      }
      return true;
    }
  }
  if ((globalThis.mermaidUnavailableTools || []).includes("cli") && (globalThis.mermaidUnavailableTools || []).includes("docker")) {
    uxLog(this, c.yellow("Either mermaid-cli or docker is required to work to generate mermaidJs Graphs. Please install/fix one of them if you want to generate SVG diagrams."));
  }
  return false;
}

export async function generateMarkdownFileWithMermaidDocker(outputFlowMdFileIn: string, outputFlowMdFileOut: string): Promise<boolean> {
  const fileDir = path.resolve(path.dirname(outputFlowMdFileIn));
  const fileName = path.basename(outputFlowMdFileIn);
  const fileOut = path.basename(outputFlowMdFileOut);
  const dockerCommand = `docker run --rm -v "${fileDir}:/data" ghcr.io/mermaid-js/mermaid-cli/mermaid-cli -i "${fileName}" -o "${fileOut}"`;
  try {
    await execCommand(dockerCommand, this, { output: false, fail: true, debug: false });
    return true;
  } catch (e: any) {
    uxLog(this, c.yellow(`Error generating mermaidJs Graphs from ${outputFlowMdFileIn} documentation with Docker: ${e.message}`) + "\n" + c.grey(e.stack));
    if (JSON.stringify(e).includes("Cannot connect to the Docker daemon") || JSON.stringify(e).includes("daemon is not running")) {
      globalThis.mermaidUnavailableTools = (globalThis.mermaidUnavailableTools || []).concat("docker");
      uxLog(this, c.yellow("[Mermaid] Docker unavailable: do not try again"));
    }
    return false;
  }
}

export async function generateMarkdownFileWithMermaidCli(outputFlowMdFileIn: string, outputFlowMdFileOut: string): Promise<boolean> {
  // Try with NPM package
  const isMmdAvailable = await isMermaidAvailable();
  const puppeteerConfigPath = path.join(PACKAGE_ROOT_DIR, 'defaults', 'puppeteer-config.json');
  const mermaidCmd = `${!isMmdAvailable ? 'npx --yes -p @mermaid-js/mermaid-cli ' : ''}mmdc -i "${outputFlowMdFileIn}" -o "${outputFlowMdFileOut}" --puppeteerConfigFile "${puppeteerConfigPath}"`;
  try {
    await execCommand(mermaidCmd, this, { output: false, fail: true, debug: false });
    return true;
  } catch (e: any) {
    uxLog(this, c.yellow(`Error generating mermaidJs Graphs from ${outputFlowMdFileIn} documentation with CLI: ${e.message}`) + "\n" + c.grey(e.stack));
    if (JSON.stringify(e).includes("timed out")) {
      globalThis.mermaidUnavailableTools = (globalThis.mermaidUnavailableTools || []).concat("cli");
      uxLog(this, c.yellow("[Mermaid] CLI unavailable: do not try again"));
    }
    return false;
  }
}

export function getMermaidExtraClasses() {
  const added = 'fill:green,color:white,stroke-width:4px,text-decoration:none,max-height:100px';
  const removed = 'fill:red,color:white,stroke-width:4px,text-decoration:none,max-height:100px';
  const changed = 'fill:orange,color:white,stroke-width:4px,text-decoration:none,max-height:100px';

  const addedClasses = [
    'actionCallsAdded',
    'assignmentsAdded',
    'collectionProcessorsAdded',
    'customErrorsAdded',
    'decisionsAdded',
    'loopsAdded',
    'recordCreatesAdded',
    'recordDeletesAdded',
    'recordLookupsAdded',
    'recordUpdatesAdded',
    'screensAdded',
    'subflowsAdded',
    'startClassAdded'
  ];

  const removedClasses = [
    'actionCallsRemoved',
    'assignmentsRemoved',
    'collectionProcessorsRemoved',
    'customErrorsRemoved',
    'decisionsRemoved',
    'loopsRemoved',
    'recordCreatesRemoved',
    'recordDeletesRemoved',
    'recordLookupsRemoved',
    'recordUpdatesRemoved',
    'screensRemoved',
    'subflowsRemoved',
    'startClassRemoved'
  ];

  const changedClasses = [
    'actionCallsChanged',
    'assignmentsChanged',
    'collectionProcessorsChanged',
    'customErrorsChanged',
    'decisionsChanged',
    'loopsChanged',
    'recordCreatesChanged',
    'recordDeletesChanged',
    'recordLookupsChanged',
    'recordUpdatesChanged',
    'screensChanged',
    'subflowsChanged',
    'startClassChanged'
  ];

  const formatClasses = (classList, style) =>
    classList.map(className => `classDef ${className} ${style}`).join('\n');

  return `
${formatClasses(addedClasses, added)}

${formatClasses(removedClasses, removed)}

${formatClasses(changedClasses, changed)}
  `;
}

export async function generateFlowVisualGitDiff(flowFile, commitBefore: string, commitAfter: string,
  options: { mermaidMd: boolean, svgMd: boolean, pngMd: boolean, debug: boolean } = { mermaidMd: false, svgMd: true, pngMd: false, debug: false }) {
  const result: any = { outputDiffMdFile: "", hasFlowDiffs: false };
  const { mermaidMdBefore, flowXmlBefore } = await getFlowXmlBefore(commitBefore, flowFile);
  const { mermaidMdAfter, flowXmlAfter } = await getFlowXmlAfter(commitAfter, flowFile);
  const flowLabel = path.basename(flowFile, ".flow-meta.xml");

  const reportDir = await getReportDirectory();
  await fs.ensureDir(path.join(reportDir, "flow-diff"));
  const diffMdFile = path.join(reportDir, 'flow-diff', `${flowLabel}_${moment().format("YYYYMMDD-hhmmss")}.md`);

  if (options.debug) {
    uxLog(this, c.grey("FLOW DOC BEFORE:\n" + mermaidMdBefore) + "\n");
    await fs.writeFile(diffMdFile.replace(".md", ".mermaid-before.md"), mermaidMdBefore);
    uxLog(this, c.grey("FLOW DOC AFTER:\n" + mermaidMdAfter) + "\n");
    await fs.writeFile(diffMdFile.replace(".md", ".mermaid-after.md"), mermaidMdAfter);
  }

  const flowDiffs = Diff.diffLines(mermaidMdBefore, mermaidMdAfter);
  result.hasFlowDiffs = flowDiffs.some((line) => (line.added || line.removed) && line.value.trim() !== "");
  result.diffLines = flowDiffs.filter(line => line.added || line.removed);

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
  const linkLines: string[] = [];
  buildFinalCompareMarkdown(mixedLines, compareMdLines, false, false, linkLines);

  let diffMarkdown = compareMdLines.join("\n");

  if (result.hasFlowDiffs === true && flowXmlAfter !== "" && flowXmlBefore !== "") {
    const flowDiffKey = `${flowLabel}-${commitBefore}-${commitAfter}`;
    diffMarkdown = await completeWithDiffAiDescription(diffMarkdown, flowXmlAfter, flowXmlBefore, flowDiffKey)
  }

  // Write markdown with diff in a file
  await fs.writeFile(diffMdFile, diffMarkdown);
  if (options.mermaidMd) {
    await fs.copyFile(diffMdFile, diffMdFile.replace(".md", ".mermaid.md"));
  }
  result.outputDiffMdFile = diffMdFile;
  if (!options.svgMd && !options.pngMd) {
    return result;
  }
  if (options.svgMd) {
    // Generate final markdown with mermaid SVG
    const finalRes = await generateMarkdownFileWithMermaid(diffMdFile, diffMdFile, ["cli", "docker"]);
    if (finalRes) {
      uxLog(this, c.green(`Successfully generated visual git diff for flow: ${diffMdFile}`));
    }
  }
  else if (options.pngMd) {
    // General final markdown with mermaid PNG
    const pngFile = path.join(path.dirname(diffMdFile), path.basename(diffMdFile, ".md") + ".png");
    const pngRes = await generateMarkdownFileWithMermaid(diffMdFile, pngFile, ["cli", "docker"]);
    if (pngRes) {
      let mdWithMermaid = fs.readFileSync(diffMdFile, "utf8");
      mdWithMermaid = mdWithMermaid.replace(
        /```mermaid\n([\s\S]*?)\n```/g,
        `![Diagram as PNG](./${path.basename(pngFile).replace(".png", "-1.png")})`);
      await fs.writeFile(diffMdFile, mdWithMermaid);
    }
  }
  return result;
}

async function getFlowXmlAfter(commitAfter: string, flowFile: any) {
  try {
    const flowXmlAfter = await git().show([`${commitAfter}:${flowFile}`]);
    const mermaidMdAfter = await buildMermaidMarkdown(flowXmlAfter, flowFile);
    return { mermaidMdAfter, flowXmlAfter };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  catch (err: any) {
    return { mermaidMdAfter: "", flowXmlAfter: "" };
  }
}

async function getFlowXmlBefore(commitBefore: string, flowFile: any) {
  try {
    const flowXmlBefore = await git().show([`${commitBefore}:${flowFile}`]);
    const mermaidMdBefore = await buildMermaidMarkdown(flowXmlBefore, flowFile);
    return { mermaidMdBefore, flowXmlBefore };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  catch (err: any) {
    return { mermaidMdBefore: "", flowXmlBefore: "" };
  }
}

function buildFinalCompareMarkdown(mixedLines: any[], compareMdLines, isMermaid, isTableStarted, linkLines) {
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
    // Build link positions
    let pos = 0;
    const positions = {
      added: [],
      removed: [],
      unchanged: []
    }
    for (const linkType of linkLines) {
      positions[linkType].push(pos);
      pos++;
    }
    // Build added and removed links styles
    if (positions.added.length > 0) {
      compareMdLines.push("linkStyle " + positions.added.join(",") + " stroke:#00ff00,stroke-width:4px,color:green;");
    }
    if (positions.removed.length > 0) {
      compareMdLines.push("linkStyle " + positions.removed.join(",") + " stroke:#ff0000,stroke-width:4px,color:red;");
    }
    isMermaid = false
  }
  let styledLine = currentLine;
  // Remove next diff line if not relevant
  if (styledLine.startsWith("|") && mixedLines.length > 1 && mixedLines[0][1] === '' && mixedLines[1][1].startsWith("|") && !mixedLines[1][1].startsWith("|Condition Id|") && !mixedLines[1][1].startsWith("|Filter Id|")) {
    mixedLines.shift();
  }
  // Skip table block if there are no updated lines within
  if (styledLine.startsWith("## ") && !styledLine.startsWith("## Flow Diagram")) {
    let updatedInBlock = false;
    let nextBlockPos = 0;
    for (const nextLine of mixedLines) {
      if (nextLine[1].startsWith("## ") || nextLine[1].includes("_Documentation") || nextLine[1].startsWith("___")) {
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
      buildFinalCompareMarkdown(mixedLinesStartingFromNextBlock, compareMdLines, isMermaid, false, linkLines);
      return;
    }
  }
  /* jscpd:ignore-start */
  // Skip node block if there are no updated lines within
  else if (styledLine.startsWith("### ")) {
    let updatedInBlock = false;
    let nextBlockPos = 0;
    for (const nextLine of mixedLines) {
      if (nextLine[1].startsWith("### ") || nextLine[1].startsWith("## ") || nextLine[1].includes("_Documentation") || nextLine[1].startsWith("___")) {
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
      buildFinalCompareMarkdown(mixedLinesStartingFromNextBlock, compareMdLines, isMermaid, false, linkLines);
      return;
    }
  }
  else if (styledLine.startsWith("#### ")) {
    let updatedInBlock = false;
    let nextBlockPos = 0;
    for (const nextLine of mixedLines) {
      if (nextLine[1].startsWith("#### ") || nextLine[1].startsWith("### ") || nextLine[1].startsWith("## ") || nextLine[1].includes("_Documentation") || nextLine[1].startsWith("___")) {
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
      buildFinalCompareMarkdown(mixedLinesStartingFromNextBlock, compareMdLines, isMermaid, false, linkLines);
      return;
    }
  }
  /* jscpd:ignore-end */
  // Skip table lines that have not been updated
  /*
  else if (!isMermaid && styledLine.startsWith("|") && isTableStarted === false) {
    isTableStarted = true;
    const tableFilteredLines: any[] = [];
    let endTablePos = 0;
    for (const nextLine of mixedLines) {
      if ((!nextLine[1].startsWith("|") || nextLine[1].includes("Condition Id") || nextLine[1].includes("Filter Id")) && nextLine[1] !== "") {
        break;
      }
      if ((nextLine[0] === "removed" || nextLine[0] === "added" || endTablePos === 0) && nextLine[1] !== "") {
        tableFilteredLines.push(nextLine);
      }
      endTablePos++;
    }
    if (tableFilteredLines.length < 2) {
      // Empty table
      const mixedLinesStartingFromEndOfTable = mixedLines.slice(endTablePos);
      buildFinalCompareMarkdown(mixedLinesStartingFromEndOfTable, compareMdLines, isMermaid, false, linkLines);
    }
    else {
      compareMdLines.push(styledLine);
      const mixedLinesStartingFromEndOfTable = mixedLines.slice(endTablePos);
      const newMixedLines = [...tableFilteredLines, ...[["unchanged", ""]], ...mixedLinesStartingFromEndOfTable];
      // Continue processing next lines
      buildFinalCompareMarkdown(newMixedLines, compareMdLines, isMermaid, true, linkLines);
    }
    return;
  }
  */

  // Tables lines
  if (!isMermaid && status === "removed" && styledLine.startsWith("|") && !styledLine.startsWith("|:-")) {
    styledLine = "|🟥" + styledLine.split("|").filter(e => e !== "").map((col: string) => `<span style="background-color: #ff7f7f; color: black;"><i>${col}</i></span>`).join("|") + "|";
  }
  else if (!isMermaid && status === "added" && styledLine.startsWith("|") && !styledLine.startsWith("|:-")) {
    styledLine = "|🟩" + styledLine.split("|").filter(e => e !== "").map((col: string) => `<span style="background-color: #a6e22e; color: black;"><b>${col}</b></span>`).join("|") + "|";
  }
  // Normal lines header 3
  else if (!isMermaid && status === "removed" && styledLine.startsWith("#### ")) {
    styledLine = `#### 🟥${styledLine.replace("#### ", "")}`;
  }
  else if (!isMermaid && status === "added" && styledLine.startsWith("#### ")) {
    styledLine = `#### 🟩${styledLine.replace("#### ", "")}`;
  }
  // Normal lines header 2
  else if (!isMermaid && status === "removed" && styledLine.startsWith("### ")) {
    styledLine = `### 🟥${styledLine.replace("### ", "")}`;
  }
  else if (!isMermaid && status === "added" && styledLine.startsWith("### ")) {
    styledLine = `### 🟩${styledLine.replace("### ", "")}`;
  }
  // Normal lines header 3
  else if (!isMermaid && status === "removed" && styledLine.startsWith("## ")) {
    styledLine = `## 🟥${styledLine.replace("## ", "")}`;
  }
  else if (!isMermaid && status === "added" && styledLine.startsWith("## ")) {
    styledLine = `## 🟩${styledLine.replace("## ", "")}`;
  }
  // Normal lines
  else if (!isMermaid && status === "removed" && styledLine !== "" && !styledLine.includes('```') && !styledLine.startsWith("|:-") && !styledLine.startsWith("___")) {
    styledLine = `<span style="background-color: #ff7f7f; color: black;"><i>🟥${styledLine}</i></span>`;
  }
  else if (!isMermaid && status === "added" && styledLine !== "" && !styledLine.includes('```') && !styledLine.startsWith("|:-") && !styledLine.startsWith("___")) {
    styledLine = `<span style="background-color: #a6e22e; color: black;"><b>🟩${styledLine}</b></span>`;
  }
  // Boxes lines
  else if (isMermaid === true && status === "removed" && currentLine.split(":::").length === 2) {
    styledLine = styledLine + "Removed"
    if (styledLine.split('"').length === 3) {
      const splits = styledLine.split('"');
      styledLine = splits[0] + '"<i>' + splits[1] + '</i>"' + splits[2]
    }
  }
  else if (isMermaid === true && status === "added" && currentLine.split(":::").length === 2) {
    styledLine = styledLine + "Added"
    if (styledLine.split('"').length === 3) {
      const splits = styledLine.split('"');
      styledLine = splits[0] + '"<b>' + splits[1] + '</b>"' + splits[2]
    }
  }
  else if (isMermaid === true && currentLine.includes(":::")) {
    // Detect if link line does not change, but its content did
    const splits = currentLine.split(/[[({]/);
    if (splits.length > 1) {
      const boxName = splits[0];
      const changed = mixedLines.filter(([lineStatus, line]) => { return line.startsWith(`click ${boxName}`) && ["added", "removed"].includes(lineStatus) }).length;
      if (changed > 0) {
        styledLine = styledLine + "Changed"
        if (styledLine.split('"').length === 3) {
          const splits = styledLine.split('"');
          styledLine = splits[0] + '"<b>' + splits[1] + '</b>"' + splits[2]
        }
        // Remove "removed" line from mixedLines
        const removedNodePos = mixedLines.findIndex(([lineStatus, line]) => { return line.startsWith(`click ${boxName}`) && lineStatus === "removed" });
        if (removedNodePos !== -1) {
          mixedLines.splice(removedNodePos, 1);
        }
      }
    }
  }
  // Long Link lines
  else if (isMermaid === true && status === "removed" && currentLine.includes('-. Fault .->')) {
    styledLine = styledLine.replace('-. Fault .->', '-. 🟥Fault .->') //+ ":::removedLink"
    linkLines.push("removed");
  }
  else if (isMermaid === true && status === "added" && currentLine.includes('-. Fault .->')) {
    styledLine = styledLine.replace('-. Fault .->', '-. 🟩Fault .->') // + ":::addedLink"
    linkLines.push("added");
  }
  /* jscpd:ignore-start */
  // Long Link lines
  else if (isMermaid === true && status === "removed" && currentLine.includes('--->')) {
    styledLine = styledLine.replace("--->", "-.->");//+ ":::removedLink"
    linkLines.push("removed");
    if (styledLine.split("|").length === 3) {
      const splits = styledLine.split("|");
      styledLine = splits[0] + '|"🟥<i>' + removeQuotes(splits[1]) + '</i>"|' + splits[2]
    }
  }
  else if (isMermaid === true && status === "added" && currentLine.includes('--->')) {
    styledLine = styledLine.replace("--->", "===>"); // + ":::addedLink"
    linkLines.push("added");
    if (styledLine.split("|").length === 3) {
      const splits = styledLine.split("|");
      styledLine = splits[0] + '|"🟩<b>' + removeQuotes(splits[1]) + '</b>"|' + splits[2]
    }
  }
  // Link lines
  else if (isMermaid === true && status === "removed" && currentLine.includes('-->')) {
    styledLine = styledLine.replace("-->", "-.->") // + ":::removedLink"
    linkLines.push("removed");
    if (styledLine.split("|").length === 3) {
      const splits = styledLine.split("|");
      styledLine = splits[0] + '|"🟥<i>' + removeQuotes(splits[1]) + '</i>"|' + splits[2]
    }
  }
  else if (isMermaid === true && status === "added" && currentLine.includes('-->')) {
    styledLine = styledLine.replace("-->", "==>") // + ":::addedLink"
    linkLines.push("added");
    if (styledLine.split("|").length === 3) {
      const splits = styledLine.split("|");
      styledLine = splits[0] + '|"🟩<b>' + removeQuotes(splits[1]) + '</b>"|' + splits[2]
    }
  }
  else if (isMermaid === true && !["added", "removed"].includes(status) &&
    (currentLine.includes('-->') || currentLine.includes('-. Fault .->'))
  ) {
    linkLines.push("unchanged");
  }
  /* jscpd:ignore-end */
  compareMdLines.push(styledLine);
  // Continue processing next lines
  buildFinalCompareMarkdown(mixedLines, compareMdLines, isMermaid, (styledLine.startsWith("|") && isTableStarted), linkLines);
}

async function buildMermaidMarkdown(flowXml, flowFile) {
  try {
    const flowDocGenResult = await parseFlow(flowXml, 'mermaid', { outputAsMarkdown: true });
    return flowDocGenResult.uml;
  } catch (err: any) {
    throw new SfError(`Unable to build Graph for flow ${flowFile}: ${err.message}`)
  }
}

function removeQuotes(str: string) {
  if (str.startsWith('"')) {
    str = str.slice(1);
  }
  if (str.endsWith('"')) {
    str = str.slice(0, -1)
  }
  return str;
}

export async function generateHistoryDiffMarkdown(flowFile: string, debugMode: boolean) {
  await fs.ensureDir(path.join("docs", "flows"));
  const diffMdFile = path.join("docs", "flows", path.basename(flowFile).replace(".flow-meta.xml", "-history.md"));
  // Compute for all states
  const fileHistory = await git().log({ file: flowFile });
  const flowLabel = path.basename(flowFile, ".flow-meta.xml");
  uxLog(this, c.cyan(`Generating ${flowLabel} markdown diff between ${fileHistory.all.length} Flow states...`));
  const diffMdFiles: any[] = [];
  for (let i = 0; i < fileHistory.all.length; i++) {
    const commitAfter = fileHistory.all[i];
    // Initial state
    if (i === fileHistory.all.length - 1) {
      const flowXml = await git().show([`${fileHistory.all[i].hash}:${flowFile}`]);
      const reportDir = await getReportDirectory();
      await fs.ensureDir(path.join(reportDir, "flow-diff"));
      const diffMdFileTmp = path.join(reportDir, 'flow-diff', `${flowLabel}_${moment().format("YYYYMMDD-hhmmss")}.md`);
      const genRes = await generateFlowMarkdownFile(flowLabel, flowXml, diffMdFileTmp, { collapsedDetails: false, describeWithAi: false, flowDependencies: {} });
      if (!genRes) {
        throw new Error(`Error generating markdown file for flow ${flowFile}`);
      }
      diffMdFiles.push({
        initialVersion: true,
        commitAfter: commitAfter,
        markdown: fs.readFileSync(diffMdFileTmp, "utf8")
      });
    }
    else {
      const commitBefore = fileHistory.all[i + 1];
      const genDiffRes = await generateFlowVisualGitDiff(flowFile, commitBefore.hash, commitAfter.hash, { svgMd: false, mermaidMd: true, pngMd: false, debug: debugMode });
      if (genDiffRes.hasFlowDiffs && fs.existsSync(genDiffRes.outputDiffMdFile)) {
        diffMdFiles.push({
          commitBefore: commitBefore,
          commitAfter: commitAfter,
          markdown: fs.readFileSync(genDiffRes.outputDiffMdFile, "utf8")
        });
      }
      else {
        uxLog(this, c.yellow(`No real flow diff has been found between ${commitBefore.hash} and ${commitAfter.hash}`));
      }
    }
  }
  // Set all the results in a single tabbed markdown
  uxLog(this, c.cyan(`Aggregating results in summary tabbed file ${diffMdFile}...`));
  let finalMd = `# ${flowLabel} history\n\n`;
  finalMd += "<!-- This page has been generated to be viewed with mkdocs-material, you can not view it just as markdown . Activate tab plugin following the doc at https://squidfunk.github.io/mkdocs-material/reference/content-tabs/ -->\n\n"
  for (const diffMdFile of diffMdFiles) {
    finalMd += `=== "${moment(diffMdFile.commitAfter.date).format("ll")}` + (diffMdFile.initialVersion ? " (Initial)" : "") + `"\n\n`;
    finalMd += `    _${moment(diffMdFile.commitAfter.date).format("ll")}, by ${diffMdFile.commitAfter.author_name} in commit ${diffMdFile.commitAfter.message}_\n\n`;
    // Remove title and add indentation for tabs to be displayed
    finalMd += diffMdFile.markdown.split("\n").filter(line => !line.startsWith("# ")).map(line => `    ${line}`).join("\n");
    finalMd += "\n\n";
  }
  await fs.writeFile(diffMdFile, finalMd);
  if (debugMode) {
    await fs.copyFile(diffMdFile, diffMdFile.replace(".md", ".mermaid.md"));
  }
  const genSvgRes = await generateMarkdownFileWithMermaid(diffMdFile, diffMdFile);
  if (!genSvgRes) {
    throw new Error("Error generating mermaid markdown file");
  }

  // Fix indentation for mermaid SVG links
  const diffMarkdown = await fs.readFile(diffMdFile, "utf8");
  const diffMarkdownFixed = diffMarkdown.split("\n").map(line => {
    if (line.startsWith("![diagram]")) {
      return `    ${line}`;
    }
    return line;
  }).join("\n");
  await fs.writeFile(diffMdFile, diffMarkdownFixed);

  // Add link to main flow doc 
  const mainFlowDoc = path.join("docs", "flows", path.basename(flowFile).replace(".flow-meta.xml", ".md"));
  if (fs.existsSync(mainFlowDoc)) {
    const mainFlowDocContent = await fs.readFile(mainFlowDoc, "utf8");
    const mainFlowDocLink = `[(_View History_)](${path.basename(flowFile).replace(".flow-meta.xml", "-history.md")})`;
    if (mainFlowDocContent.includes("## Flow Diagram") && !mainFlowDocContent.includes(mainFlowDocLink)) {
      const updatedFlowDocContent = mainFlowDocContent.replace("## Flow Diagram", `## Flow Diagram ${mainFlowDocLink}`);
      await fs.writeFile(mainFlowDoc, updatedFlowDocContent);
    }
  }

  uxLog(this, c.green(`Markdown diff between ${fileHistory.all.length} Flow states generated in ${diffMdFile}`));
  return diffMdFile;
}

export function removeMermaidLinks(messageBody: string) {
  let result = messageBody + "";
  if (result.includes("```mermaid")) {
    let withinMermaid = false;
    result = result
      .split("\n")
      .filter((line) => {
        // Toggle mermaid flag on/off
        if (line.includes("```mermaid")) {
          withinMermaid = true;
        }
        else if (line.includes("```") && withinMermaid === true) {
          withinMermaid = false;
        }
        // Filter if click line for better display
        if (line.startsWith("click") && withinMermaid === true) {
          return false;
        }
        return true;
      })
      .join("\n");
  }
  return result;
}

async function completeWithAiDescription(flowMarkdownDoc: string, flowXml: string, flowName: string): Promise<string> {
  const flowXmlStripped = UtilsAi.stripXmlForAi("Flow", flowXml);
  const aiCache = await UtilsAi.findAiCache("PROMPT_DESCRIBE_FLOW", [flowXmlStripped], flowName);
  if (aiCache.success === true) {
    uxLog(this, c.grey("Used AI cache for flow description (set IGNORE_AI_CACHE=true to force call to AI)"));
    const replaceText = `## AI-Generated Description\n\n<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${aiCache.cacheText || ""}`;
    return flowMarkdownDoc.replace("<!-- Flow description -->", replaceText);
  }
  if (AiProvider.isAiAvailable()) {
    // Invoke AI Service
    const prompt = AiProvider.buildPrompt("PROMPT_DESCRIBE_FLOW", { "FLOW_XML": flowXmlStripped });
    const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_DESCRIBE_FLOW");
    // Replace description in markdown
    if (aiResponse?.success) {
      let responseText = aiResponse.promptResponse || "No AI description available";
      if (responseText.startsWith("##")) {
        responseText = responseText.split("\n").slice(1).join("\n");
      }
      await UtilsAi.writeAiCache("PROMPT_DESCRIBE_FLOW", [flowXmlStripped], flowName, responseText);
      const replaceText = `## AI-Generated Description\n\n<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${responseText}`;
      const flowMarkdownDocUpdated = flowMarkdownDoc.replace("<!-- Flow description -->", replaceText);
      return flowMarkdownDocUpdated;
    }
  }
  return flowMarkdownDoc;
}

/* jscpd:ignore-start */
async function completeWithDiffAiDescription(flowMarkdownDoc: string, flowXmlNew: string, flowXmlPrevious: string, diffKey: string): Promise<string> {
  const flowXmlNewStripped = UtilsAi.stripXmlForAi("Flow", flowXmlNew);
  const flowXmlPreviousStripped = UtilsAi.stripXmlForAi("Flow", flowXmlPrevious);
  const aiCache = await UtilsAi.findAiCache("PROMPT_DESCRIBE_FLOW_DIFF", [flowXmlNewStripped, flowXmlPreviousStripped], diffKey);
  if (aiCache.success) {
    uxLog(this, c.grey("Used AI cache for diff description (set IGNORE_AI_CACHE=true to force call to AI)"));
    const replaceText = `## AI-Generated Differences Summary\n\n<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${aiCache.cacheText || ""}`;
    return flowMarkdownDoc.replace("<!-- Flow description -->", replaceText);
  }
  if (AiProvider.isAiAvailable()) {
    // Invoke AI Service
    const prompt = AiProvider.buildPrompt("PROMPT_DESCRIBE_FLOW_DIFF", { "FLOW_XML_NEW": flowXmlNewStripped, "FLOW_XML_PREVIOUS": flowXmlPreviousStripped });
    const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_DESCRIBE_FLOW_DIFF");
    // Replace description in markdown
    if (aiResponse?.success) {
      let responseText = aiResponse.promptResponse || "No AI description available";
      if (responseText.startsWith("##")) {
        responseText = responseText.split("\n").slice(1).join("\n");
      }
      await UtilsAi.writeAiCache("PROMPT_DESCRIBE_FLOW_DIFF", [flowXmlNewStripped, flowXmlPreviousStripped], diffKey, responseText);
      const replaceText = `## AI-Generated Differences Summary\n\n<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${responseText || ""}`;
      const flowMarkdownDocUpdated = flowMarkdownDoc.replace("<!-- Flow description -->", replaceText);
      return flowMarkdownDocUpdated;
    }
  }
  return flowMarkdownDoc;
}
/* jscpd:ignore-end */

