export function deployErrorsToMarkdown(errorsAndTips: Array<any>) {
    let md = "";
    for (const err of errorsAndTips) {
        if (err.tip) {
            md += `<details><summary>${err.error.message}</summary>
${err.tip.message}
</details>

`
        }
        else {
            md += err.error.message + "\n\n"
        }
    }
    return md;
}
