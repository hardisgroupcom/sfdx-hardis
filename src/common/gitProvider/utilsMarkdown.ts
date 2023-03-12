export function deployErrorsToMarkdown(errorsAndTips: Array<any>) {
    let md = "";
    for (const err of errorsAndTips) {
        const errorMessage = err.error.message.trim().includes("Error ") ?
            err.error.message.trim().replace("Error ", "")
                .replace(" ", "<br/>").trim()
                .replace(/(.*)<br\/>/gm, `<b>$1</b>`) :
            err.error.message.trim();
        if (err.tip) {
            md += `<details><summary>🛠️ ${errorMessage}</summary>

_${err.tip.label}_

${err.tip.message.replace(/:\n-/gm, `:\n\n-`)}
</details>

`
        }
        else {
            md += "🧐 " + errorMessage + "\n\n"
        }
    }
    return md;
}
