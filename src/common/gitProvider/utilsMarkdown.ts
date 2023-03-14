export function deployErrorsToMarkdown(errorsAndTips: Array<any>) {
  let md = "";
  for (const err of errorsAndTips) {
    const errorMessage = err.error.message.trim().includes("Error ")
      ? err.error.message
          .trim()
          .replace("Error ", "")
          .replace(" ", "<br/>")
          .trim()
          .replace(/(.*)<br\/>/gm, `<b>$1</b> `)
      : err.error.message.trim();
    if (err.tip) {
      md += `<details><summary>🛠️ ${errorMessage}</summary>

_${err.tip.label}_

${err.tip.message.replace(/:\n-/gm, `:\n\n-`)}
</details>

`;
    } else {
      md += "🔨 " + errorMessage + "\n\n";
    }
  }
  return md;
}

export function testFailuresToMarkdown(testFailures: any[]) {
  let md = "";
  for (const err of testFailures) {
    const errorMessage = `**${err.class}.${err.method}**<br/>${err.error}`;
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
