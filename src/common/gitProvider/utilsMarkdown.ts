export function deployErrorsToMarkdown(errorsAndTips: Array<any>) {
  let md = "## Deployment errors\n\n";
  for (const err of errorsAndTips) {
    const errorMessage = (err as any)?.error?.message?.trim().includes("Error ")
      ? (err as any)?.error?.message
        .trim()
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

_[**${err.tip.label}**](${err.tip.docUrl})_

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
