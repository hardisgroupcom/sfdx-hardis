import c from "chalk";
import fs from "fs-extra"
import { MetadataUtils } from "../metadata-utils/index.js";
import { uxLog } from "../utils/index.js";
import { generateFlowVisualGitDiff } from "../utils/mermaidUtils.js";

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

export async function flowDiffToMarkdown(flowNames: string[], fromCommit: string, toCommit: string): Promise<string> {
  if (flowNames.length === 0) {
    return "";
  }
  let flowDiffFilesSummary = "## Flow changes\n\n";
  for (const flowName of flowNames) {
    const fileMetadata = await MetadataUtils.findMetaFileFromTypeAndName("Flow", flowName);
    try {
      const diffMdFile = await generateFlowVisualGitDiff(fileMetadata, fromCommit, toCommit, true);
      if (diffMdFile) {
        const flowDiffMarkdownMermaid = await fs.readFile(diffMdFile + ".mermaid.md", "utf8");
        const flowSection = `<details><summary>🤖 <b>${flowName}</b> 🤖</summary>

${flowDiffMarkdownMermaid}

</details>
<br/>
`
        flowDiffFilesSummary += flowSection
      }
    } catch (e: any) {
      uxLog(this, c.yellow(`[FlowGitDiff] Unable to generate Flow diff: ${e.message}`));
      const flowSection = `<details><summary>🤖 <b>${flowName}</b> 🤖</summary>

Unable to generate Flow diff: ${e.message}

</details>
<br/>
`
      flowDiffFilesSummary += flowSection
    }
  }
  return flowDiffFilesSummary;
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
