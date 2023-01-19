#!/usr/bin/node
/* eslint-disable */
const fs = require("fs-extra");
const { getAllTips } = require("./lib/common/utils/deployTipsList");

class SfdxHardisBuilder {
  run() {
    console.log("Start additional building of sfdx-hardis repository...");
    this.buildDeployTipsDoc();
  }

  buildDeployTipsDoc() {
    console.log("Building deployTips doc...");
    const deployTipsDocFile = "./docs/deployTips.md";
    const deployTips = getAllTips();
    const deployTipsMd = [
      "---",
      "title: How to solve Salesforce DX Deployment errors",
      "description: Learn how to fix issues that can happen during sfdx deployments",
      "---",
      "<!-- markdownlint-disable MD013 -->",
      "",
      "# Salesforce deployment errors tips",
      "",
      "This page summarizes all errors that can be detected by sfdx-hardis wrapper commands",
      "",
      "| sfdx command             | sfdx-hardis wrapper command |",
      "| :-----------             | :-------------------------- |",
      "| [sfdx force:source:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy) | [sfdx hardis:source:deploy](https://hardisgroupcom.github.io/sfdx-hardis/hardis/source/deploy/)   |",
      "| [sfdx force:source:push](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push)   | [sfdx hardis:source:push](https://hardisgroupcom.github.io/sfdx-hardis/hardis/source/push/)     |",
      "| [sfdx force:mdapi:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_mdapi.htm#cli_reference_force_mdapi_beta_deploy)  | [sfdx hardis:mdapi:deploy](https://hardisgroupcom.github.io/sfdx-hardis/hardis/mdapi/deploy/)    |",
      "",
      "You can also use this function on a [sfdx-hardis Salesforce CI/CD project](https://hardisgroupcom.github.io/sfdx-hardis/salesforce-ci-cd-home/)",
      "",
      "If you see a deployment error which is not here yet, please [add it in this file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/deployTipsList.ts) :)",
      "",
      "Example:",
      "",
      "![Deployment Tip example](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/deploy-tip-example.jpg)",
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
    }
    fs.writeFileSync(deployTipsDocFile, deployTipsMd.join("\n") + "\n");
    console.log("Written doc file " + deployTipsDocFile);
  }
}

new SfdxHardisBuilder().run();
