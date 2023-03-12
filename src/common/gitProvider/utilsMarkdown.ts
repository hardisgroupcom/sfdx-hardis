export function deployErrorsToMarkdown(errorsAndTips: Array<any>) {
    let md = "";
    for (const err of errorsAndTips) {
        if (err.tip) {
            md += `<details><summary>🛠️ ${err.error.message.replace("Error ","")}</summary>
_${err.tip.label}_
${err.tip.message.replace(/:\n-/gm, `:\n\n-`)}
</details>

`
        }
        else {
            md += "🧐 "+err.error.message + "\n\n"
        }
    }
    return md;
}
