import c from "chalk";
import fs from '../utils/fsUtils.js';
import * as path from "path"
import { MetadataUtils } from "../metadata-utils/index.js";
import { uxLog } from "../utils/index.js";
import { generateFlowVisualGitDiff } from "../utils/mermaidUtils.js";
import { GitProvider, PrCommentFlowChange } from "./index.js";
import { t } from '../utils/i18n.js';

export function deployErrorsToMarkdown(errorsAndTips: Array<any>) {
  let md = "## Deployment errors\n\n";
  for (const err of errorsAndTips) {
    // Only a component error line ("Error Name problem") gets its name in bold: an "Error " in the
    // middle of a message ("Connect Timeout Error (...)") must stay as it is
    const errorMessage = /^(\| )?Error /.test((err as any)?.error?.message?.trim() || "")
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
      md += `<details><summary>⛔ ${errorMessage}</summary>

_[**✏️ ${err.tip.label}**](${err.tip.docUrl || "https://sfdx-hardis.cloudity.com/salesforce-deployment-agent-home/"})_

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

export function deployCodeCoverageToMarkdown(orgCoverage: number, orgCoverageTarget: number, options: { check: boolean, testClasses?: string }) {
  let messageLines: string[] = [];
  if (orgCoverage < orgCoverageTarget) {
    messageLines.push(`❌ Your code coverage is insufficient: **${orgCoverage}%**, while your target is **${orgCoverageTarget}%**`);
  } else {
    messageLines.push(`✅ Your code coverage is ok 😊 **${orgCoverage}%**, while target is **${orgCoverageTarget}%**`);
  }
  const testClassesInfoLines = options.testClasses ?
    [
      '',
      `<details><summary>🧪 Apex test classes</summary>`,
      '',
      ...options.testClasses.split(" ").map(tc => `  - ${tc}`),
      '',
      `</details>`,
    ] : [];
  messageLines = messageLines.concat(testClassesInfoLines);
  return messageLines.join("\n");
}

export function mdTableCell(str: string) {
  if (!str) {
    return "<!-- -->"
  }
  if (typeof str !== "string") {
    str = String(str);
  }
  // A pipe used to be deleted, which quietly rewrote what the cell said: every "||" of a
  // Salesforce formula disappeared. Escaped instead, it renders as a pipe and the table holds.
  return str.replace(/\n/gm, "<br/>").replace(/\|/gm, "\\|");
}

// Renders free text a Salesforce admin typed (a description, a validation rule formula) as a
// table cell: the markup characters it may hold become entities, then mdTableCell neutralizes the
// line breaks and pipes that would otherwise break the row apart.
export function mdTableCellHtml(value: any): string {
  const escaped = String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return mdTableCell(escaped);
}

export async function flowDiffToMarkdownForPullRequest(flowNames: string[], fromCommit: string, toCommit: string, truncatedNb: number = 0): Promise<any> {
  if (flowNames.length === 0) {
    return "";
  }
  const supportsMermaidInPrMarkdown = await GitProvider.supportsMermaidInPrMarkdown();
  const supportsSvgAttachments = await GitProvider.supportsSvgAttachments();
  const mode: 'mermaid' | 'svg' | 'png' = supportsMermaidInPrMarkdown ? 'mermaid' : supportsSvgAttachments ? 'svg' : 'png';
  const flowDiffMarkdownList: any = [];
  // What changed per Flow, rendered by the layout of the validation comment
  const flowChanges: PrCommentFlowChange[] = [];
  // Locate every Flow source file in a single pass on the package directories
  const fileMetadataByFlowName = await MetadataUtils.findMetaFilesFromTypeAndNames("Flow", flowNames);
  for (const flowName of flowNames) {
    const fileMetadata = fileMetadataByFlowName.get(flowName) ?? null;
    if (fileMetadata == null) {
      uxLog("warning", this, c.yellow('[FlowGitDiff] ' + t('flowGitDiffFlowFileNotFound', { flowName })));
      continue;
    }
    try {
      const flowChange = await generateFlowDiffMarkdownForPullRequest(fileMetadata, fromCommit, toCommit, flowDiffMarkdownList, flowName, mode);
      if (flowChange) {
        flowChanges.push(flowChange);
      }
    } catch (e: any) {
      uxLog("warning", this, c.yellow('[FlowGitDiff] ' + t('flowGitDiffUnableToGenerate', { flowName, message: e.message })) + "\n" + c.grey(e.stack));
    }
  }
  return {
    // Kept for compatibility: the layout of the comment now reads flowChanges
    markdownSummary: "",
    flowDiffMarkdownList: flowDiffMarkdownList,
    flowChanges: flowChanges,
    truncatedNb: truncatedNb,
  }
}

// Markdown with pure MermaidJS, with Mermaid converted as SVG, or with images converted as PNG,
// depending on what the git provider renders
async function generateFlowDiffMarkdownForPullRequest(
  fileMetadata: string,
  fromCommit: string,
  toCommit: string,
  flowDiffMarkdownList: any,
  flowName: string,
  mode: 'mermaid' | 'svg' | 'png'
): Promise<PrCommentFlowChange | null> {
  const diffResult = await generateFlowVisualGitDiff(fileMetadata, fromCommit, toCommit, {
    mermaidMd: true,
    svgMd: mode === 'svg',
    pngMd: mode === 'png',
    debug: false,
    skipStatusOnlyChange: true,
  });
  if (diffResult.isStatusOnlyChange === true) {
    return { name: flowName, kind: 'status-only', statusBefore: diffResult.statusBefore, statusAfter: diffResult.statusAfter };
  }
  const { outputDiffMdFile, hasFlowDiffs, isFlowDeletedOrAdded } = diffResult;
  if (!outputDiffMdFile || !hasFlowDiffs || isFlowDeletedOrAdded) {
    return null;
  }
  const markdownFile = mode === 'mermaid' ? outputDiffMdFile.replace(".md", ".mermaid.md") : outputDiffMdFile;
  if (!fs.existsSync(markdownFile)) {
    return null;
  }
  const markdown = await fs.readFile(markdownFile, "utf8");
  flowDiffMarkdownList.push({ name: flowName, markdown: markdown, markdownFile: outputDiffMdFile });
  return { name: flowName, kind: 'diff' };
}

function getAiPromptResponseMarkdown(title, message) {
  return `<details><summary>🤖 <b>${title}</b></summary>

_AI Deployment Assistant tip (not verified !)_

${message.replace(/:\n-/gm, `:\n\n-`).trim()}
</details>
<br/>
`;
}

function getAiPromptTextMarkdown(title, message) {
  const safeMessage = typeof message === "string" ? message : String(message ?? "");
  return `<details><summary><b>${title}</b></summary>

_Request AI by copy-pasting the following text in ChatGPT or other AI prompt_

${safeMessage.replace(/:\n-/gm, `:\n\n-`)}
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
    // Remote images render by themselves in the git provider UI: nothing to upload,
    // and running a URL through path.join would mangle it into a broken warning
    if (/^https?:\/\//.test(file)) {
      return false;
    }
    if (fs.existsSync(file)) {
      return true;
    }
    else if (fs.existsSync(path.join(sourceFilePath, file))) {
      return true;
    }
    uxLog("warning", this, c.yellow('[Markdown] ' + t('markdownImageFileNotFound', { file, altPath: path.join(sourceFilePath, file) })));
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
