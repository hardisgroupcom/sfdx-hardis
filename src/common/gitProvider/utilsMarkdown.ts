import c from "chalk";
import fs from "fs-extra"
import * as path from "path"
import { MetadataUtils } from "../metadata-utils/index.js";
import { uxLog } from "../utils/index.js";
import { generateFlowVisualGitDiff } from "../utils/mermaidUtils.js";
import { GitProvider } from "./index.js";

export function deployErrorsToMarkdown(errorsAndTips: Array<any>) {
  let md = "## Deployment errors\n\n";
  for (const err of errorsAndTips) {
    const errorMessage = (err as any)?.error?.message?.trim().includes("Error ")
      ? (err as any)?.error?.message
        .trim()
        .replace("| Error ", "")
        .replace("Error ", "")
        .replace(" ", "<br/>")
        .trim()
        .replace(/(.*)<br\/>/gm, `<b>$1</b> `)
      : (err as any)?.error?.message?.trim() || "WE SHOULD NOT GO THERE: PLEASE DECLARE AN ISSUE";
    // sfdx-hardis tip
    if (err.tip) {
      const aiText = err?.tipFromAi?.promptResponse
        ? getAiPromptResponseMarkdown("AI Deployment Assistant recommendation", err.tipFromAi.promptResponse)
        : err?.tipFromAi?.promptText
          ? getAiPromptTextMarkdown("Get prompt for AI", err.tipFromAi.promptText)
          : "";
      md += `<details><summary>🛠️ ${errorMessage}</summary>

_[**${err.tip.label}**](${err.tip.docUrl || "https://sfdx-hardis.cloudity.com/salesforce-deployment-assistant-home/"})_

${err.tip.message.replace(/:\n-/gm, `:\n\n-`)}
${aiText}
</details>
<br/>
`;
    }
    // No sfdx-hardis tip but AI instructions
    else if (err?.tipFromAi?.promptResponse) {
      md += getAiPromptResponseMarkdown(errorMessage, err.tipFromAi.promptResponse);
    }
    // No tip or AI instruction but a prompt to copy-paste
    else if (err?.tipFromAi?.promptText) {
      md += getAiPromptTextMarkdown(errorMessage, err.tipFromAi.promptText);
    }
    // No tip & no AI prompt or response
    else {
      md += "🔨 " + errorMessage + "\n\n";
    }
  }
  return md;
}

export function testFailuresToMarkdown(testFailures: any[]) {
  let md = "## Test classes failures\n\n";
  for (const err of testFailures) {
    const errorMessage = `<b>${err.class}.${err.method}</b><br/>${err.error}`;
    if (err.stack) {
      md += `<details><summary>💥 ${errorMessage}</summary>

${err.stack}
</details>

`;
    } else {
      md += "💥 " + errorMessage + "\n\n";
    }
  }
  return md;
}

export function deployCodeCoverageToMarkdown(orgCoverage: number, orgCoverageTarget: number) {
  if (orgCoverage < orgCoverageTarget) {
    return `❌ Your code coverage is insufficient: **${orgCoverage}%**, while your target is **${orgCoverageTarget}%**`;
  } else {
    return `✅ Your code coverage is ok :) **${orgCoverage}%**, while target is **${orgCoverageTarget}%**`;
  }
}

export async function flowDiffToMarkdownForPullRequest(flowNames: string[], fromCommit: string, toCommit: string): Promise<any> {
  if (flowNames.length === 0) {
    return "";
  }
  const supportsMermaidInPrMarkdown = await GitProvider.supportsMermaidInPrMarkdown();
  const flowDiffMarkdownList: any = [];
  let flowDiffFilesSummary = "## Flow changes\n\n";
  for (const flowName of flowNames) {
    flowDiffFilesSummary += `- [${flowName}](#${flowName})\n`;
    const fileMetadata = await MetadataUtils.findMetaFileFromTypeAndName("Flow", flowName);
    try {
      if (supportsMermaidInPrMarkdown) {
        await generateDiffMarkdownWithMermaid(fileMetadata, fromCommit, toCommit, flowDiffMarkdownList, flowName);
      }
      else {
        await generateDiffMarkdownWithSvg(fileMetadata, fromCommit, toCommit, flowDiffMarkdownList, flowName);
      }
    } catch (e: any) {
      uxLog(this, c.yellow(`[FlowGitDiff] Unable to generate Flow diff for ${flowName}: ${e.message}`));
      const flowGenErrorMd = `# ${flowName}

Error while generating Flows visual git diff
`;
      flowDiffMarkdownList.push({ name: flowName, markdown: flowGenErrorMd });
    }
  }
  return {
    markdownSummary: flowDiffFilesSummary,
    flowDiffMarkdownList: flowDiffMarkdownList
  }
}

async function generateDiffMarkdownWithMermaid(fileMetadata: string | null, fromCommit: string, toCommit: string, flowDiffMarkdownList: any, flowName: string) {
  const { outputDiffMdFile } = await generateFlowVisualGitDiff(fileMetadata, fromCommit, toCommit, { mermaidMd: true, svgMd: false, debug: false });
  if (outputDiffMdFile) {
    const flowDiffMarkdownMermaid = await fs.readFile(outputDiffMdFile.replace(".md", ".mermaid.md"), "utf8");
    flowDiffMarkdownList.push({ name: flowName, markdown: flowDiffMarkdownMermaid, markdownFile: outputDiffMdFile });
  }
}

async function generateDiffMarkdownWithSvg(fileMetadata: string | null, fromCommit: string, toCommit: string, flowDiffMarkdownList: any, flowName: string) {
  const { outputDiffMdFile } = await generateFlowVisualGitDiff(fileMetadata, fromCommit, toCommit, { mermaidMd: true, svgMd: true, debug: false });
  const flowDiffMarkdownWithSvg = await fs.readFile(outputDiffMdFile, "utf8");
  flowDiffMarkdownList.push({ name: flowName, markdown: flowDiffMarkdownWithSvg, markdownFile: outputDiffMdFile });
}

function getAiPromptResponseMarkdown(title, message) {
  return `<details><summary>🤖 <b>${title}</b> 🤖</summary>

_AI Deployment Assistant tip (not verified !)_

${message.replace(/:\n-/gm, `:\n\n-`).trim()}
</details>
<br/>
`;
}

function getAiPromptTextMarkdown(title, message) {
  return `<details><summary><b>${title}</b></summary>

_Request AI by copy-pasting the following text in ChatGPT or other AI prompt_

${message.replace(/:\n-/gm, `:\n\n-`)}
</details>
<br/>
`;
}

export function extractImagesFromMarkdown(markdown: string, sourceFile: string | null): any[] {
  let sourceFilePath = "";
  if (sourceFile && fs.existsSync(sourceFile)) {
    sourceFilePath = path.dirname(sourceFile)
  }
  const imageRegex = /!\[.*?\]\((.*?)\)/gm;
  const matches = Array.from(markdown.matchAll(imageRegex));
  return matches.map((match) => match[1]).filter(file => {
    if (fs.existsSync(file)) {
      return true;
    }
    else if (fs.existsSync(path.join(sourceFilePath, file))) {
      return true;
    }
    uxLog(this, c.yellow(`[Markdown] Image file not found: ${file}`));
    return false;
  }).map(file => {
    if (fs.existsSync(file)) {
      return { name: file, path: file };
    }
    else if (fs.existsSync(path.join(sourceFilePath, file))) {
      return { name: file, path: path.join(sourceFilePath, file) };
    }
    return {};
  });
}

export function replaceImagesInMarkdown(markdown: string, replacements: any): string {
  for (const replacedImage of Object.keys(replacements)) {
    markdown = markdown.replaceAll(replacedImage, replacements[replacedImage]);
  }
  return markdown;
}