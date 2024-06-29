#!/usr/bin/node
/* eslint-disable */
const fs = require("fs-extra");
const { getAllTips } = require("./lib/common/utils/deployTipsList");

class SfdxHardisBuilder {
  run() {
    console.log("Start additional building of sfdx-hardis repository...");
    this.buildDeployTipsDoc();
    this.truncateReadme();
  }

  buildDeployTipsDoc() {
    console.log("Building salesforce-deployment-assistant-error-list.md doc...");
    const deployTipsDocFile = "./docs/salesforce-deployment-assistant-error-list.md";
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
      if (!tip.label) {
        throw new Error(`Missing label for ${JSON.stringify(tip)}`);
      }
      deployTipsMd.push(`## ${tip.label}`);
      deployTipsMd.push("");
      if (tip.expressionRegex) {
        deployTipsMd.push(...tip.expressionRegex.map((regEx) => "- `" + regEx.toString().slice(1).replace("/gm", "") + "`"));
      }
      if (tip.expressionString) {
        deployTipsMd.push(...tip.expressionString.map((str) => "- `" + str + "`"));
      }
      deployTipsMd.push(...["", "**Resolution tip**", ""]);
      if (!tip.tip) {
        throw new Error(`Missing tip for ${JSON.stringify(tip)}`);
      }
      deployTipsMd.push("```shell");
      deployTipsMd.push(...tip.tip.split("\n"));
      deployTipsMd.push("```");
      deployTipsMd.push("");
      deployTipsMd.push("---");
    }
    fs.writeFileSync(deployTipsDocFile, deployTipsMd.join("\n") + "\n");
    console.log("Written doc file " + deployTipsDocFile);
  }

  truncateReadme() {
    const readmeFile = "./README.md";
    const readmeContent = fs.readFileSync(readmeFile, "utf-8");
    const chunks = readmeContent.split("## Commands")
    fs.writeFileSync(readmeFile, chunks[0]);
    console.log("Removed README.md commands");
  }
}

new SfdxHardisBuilder().run();
