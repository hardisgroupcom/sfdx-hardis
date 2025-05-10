#!/usr/bin/node
/* eslint-disable */
const fs = require("fs-extra");
const yaml = require("js-yaml");

class SfdxHardisBuilder {
  async run() {
    console.log("Start additional building of sfdx-hardis repository...");
    await this.buildDeployTipsDoc();
    await this.buildPromptTemplatesDocs();
    this.truncateReadme();
  }

  async buildDeployTipsDoc() {
    console.log("Building salesforce-deployment-assistant-error-list.md doc...");
    const deployTipsDocFile = "./docs/salesforce-deployment-assistant-error-list.md";
    const { getAllTips } = await import("./lib/common/utils/deployTipsList.js");
    const deployTips = getAllTips();
    const deployTipsMd = [
      "---",
      "title: Sfdx-hardis deployment assistant list of errors",
      "description: List of errors that are handled by sfdx-hardis deployment assistant",
      "---",
      "<!-- markdownlint-disable MD013 -->",
      "",
      "# Salesforce deployment assistant errors list",
      "",
      "sfdx-hardis can help solve solve deployment errors using a predefined list of issues and associated solutions",
      "",
      "See how to [setup sfdx-hardis deployment assistant](salesforce-deployment-assistant-setup.md)",
      "",
      "If you see a deployment error which is not here yet, please [add it in this file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/deployTipsList.ts) :)",
      ""
    ];
    for (const tip of deployTips) {
      const linkName = `sf-deployment-assistant/${tip.label.replace(/[^a-zA-Z0-9 -]|\s/g, '-')}.md`
      const tipFile = `./docs/` + linkName;
      this.buildIndividualMarkdownPageForTip(tip, tipFile);
      this.buildMainDeployFixesMarkdown(tip, deployTipsMd, linkName);
    }
    fs.writeFileSync(deployTipsDocFile, deployTipsMd.join("\n") + "\n");
    console.log("Written doc file " + deployTipsDocFile);
  }

  buildMainDeployFixesMarkdown(tip, deployTipsMd, linkName) {
    if (!tip.label) {
      throw new Error(`Missing label for ${JSON.stringify(tip)}`);
    }
    deployTipsMd.push(`## [${tip.label}](${linkName})`);
    deployTipsMd.push(...["", "**Detection**", ""]);
    if (tip.expressionRegex) {
      deployTipsMd.push(...tip.expressionRegex.map((regEx) => "- RegExp: `" + regEx.toString().slice(1).replace("/gm", "") + "`"));
    }
    if (tip.expressionString) {
      deployTipsMd.push(...tip.expressionString.map((str) => "- String: `" + str + "`"));
    }
    if (tip.examples) {
      deployTipsMd.push(...["", "**Examples**", ""]);
      deployTipsMd.push(...tip.examples.map((str) => "- `" + str + "`"));
    }
    deployTipsMd.push(...["", "**Resolution**", ""]);
    if (!tip.tip) {
      throw new Error(`Missing tip for ${JSON.stringify(tip)}`);
    }
    deployTipsMd.push("```shell");
    deployTipsMd.push(...tip.tip.split("\n"));
    deployTipsMd.push("```");
    deployTipsMd.push("");
    deployTipsMd.push("---");
  }

  buildIndividualMarkdownPageForTip(tip, tipFile) {
    const errorDescription = tip?.examples?.length > 0 ? tip.examples[0] :
      tip?.expressionString?.length > 0 ? tip?.expressionString[0] :
        tip.expressionRegex[0].toString().replace("/Error", "Error").replace("/gm", "").replace(/\"/gm, '\\\"');
    const tipFileMd = [
      "---",
      `title: "${tip.label} (Deployment assistant)"`,
      `description: "How to solve Salesforce deployment error \\\"${errorDescription}\\\""`,
      "---",
      "<!-- markdownlint-disable MD013 -->"
    ];
    tipFileMd.push(`# ${tip.label}`);
    tipFileMd.push(...["", "## Detection", ""]);
    if (tip.expressionRegex) {
      tipFileMd.push(...tip.expressionRegex.map((regEx) => "- RegExp: `" + regEx.toString().slice(1).replace("/gm", "") + "`"));
    }
    if (tip.expressionString) {
      tipFileMd.push(...tip.expressionString.map((str) => "- String: `" + str + "`"));
    }
    if (tip.examples) {
      tipFileMd.push(...["", "## Examples", ""]);
      tipFileMd.push(...tip.examples.map((str) => "- `" + str + "`"));
    }
    tipFileMd.push(...["", "## Resolution", ""]);
    if (!tip.tip) {
      throw new Error(`Missing tip for ${JSON.stringify(tip)}`);
    }
    tipFileMd.push("```shell");
    tipFileMd.push(...tip.tip.split("\n"));
    tipFileMd.push("```");
    fs.writeFileSync(tipFile, tipFileMd.join("\n") + "\n");
  }

  async buildPromptTemplatesDocs() {
    console.log("Building prompt templates documentation...");
    const { PROMPT_TEMPLATES } = await import("./lib/common/aiProvider/promptTemplates/index.js");
    const docsPromptDir = "./docs/prompt-templates";
    fs.ensureDirSync(docsPromptDir);

    const promptNav = [];
    for (const templateName of Object.keys(PROMPT_TEMPLATES)) {
      const templateDocFile = `${docsPromptDir}/${templateName}.md`;
      const prompt = PROMPT_TEMPLATES[templateName]
      // Read the template file and extract the prompt text
      const md = [
        `---`,
        `title: ${templateName}`,
        `description: Prompt template for ${templateName}`,
        `---`,
        '',
        `# ${templateName}`,
        '',
        `## Variables`,
        "| Name | Description | Example |",
        "| :------|:-------------|:---------|",
        ...prompt.variables.map(
          v => {
            // Escape pipe characters in example to avoid breaking the markdown table
            let example = String(v.example ?? "");
            // Replace | with \| and newlines with <br> for markdown table safety
            example = example.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
            return `| **${v.name}** | ${v.description} | \`${example}\` |`;
          }
        ),
        '',
        `## Prompt`,
        "",
        "```",
        prompt.text.en,
        "```",
        '',
        '## How to override',
        '',
        `To define your own prompt text, you can define a local file **config/prompt-templates/${templateName}.txt**`,
        ``,
        `If you do so, please don't forget to use the replacement variables :)`
      ];
      fs.writeFileSync(templateDocFile, md.join("\n") + "\n");
      promptNav.push({ [templateName]: `prompt-templates/${templateName}.md` });
    }
    console.log("Prompt templates documentation generated");
  }

  truncateReadme() {
    const readmeFile = "./README.md";
    const readmeContent = fs.readFileSync(readmeFile, "utf-8");
    const chunks = readmeContent.split("<!-- commands -->")
    fs.writeFileSync(readmeFile, chunks[0] + "<!-- commands -->");
    console.log("Removed README.md commands");
  }
}

(async () => {
  await new SfdxHardisBuilder().run();
})();

