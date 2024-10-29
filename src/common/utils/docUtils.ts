import * as path from "path";
import c from 'chalk';
import fs from 'fs-extra';
import { uxLog } from "./index.js";
import { countPackageXmlItems, parsePackageXmlFile } from "./xmlUtils.js";
import { CONSTANTS } from "../../config/index.js";
import { SfError } from "@salesforce/core";

export async function generatePackageXmlMarkdown(inputFile: string, outputFile: string) {
  // Find packageXml to parse if not defined
  if (inputFile == null) {
    inputFile = path.join(process.cwd(), "manifest", "package.xml");
    if (!fs.existsSync(inputFile)) {
      throw new SfError("No package.xml found. You need to send the path to a package.xml file in --inputfile option");
    }
  }
  // Build output file if not defined
  if (outputFile == null) {
    const packageXmlFileName = path.basename(inputFile);
    outputFile = path.join(process.cwd(), "docs", `${packageXmlFileName}.md`);
  }
  await fs.ensureDir(path.dirname(outputFile));

  uxLog(this, c.cyan(this, `Generating markdown doc from ${inputFile} to ${outputFile}...`));

  // Read content
  const packageXmlContent = await parsePackageXmlFile(inputFile);
  const metadataTypes = Object.keys(packageXmlContent);
  metadataTypes.sort();
  const nbItems = await countPackageXmlItems(inputFile);

  const mdLines: string[] = []

  // Header
  mdLines.push(...[
    `## Content of ${path.basename(inputFile)}`,
    '',
    `Metadatas: ${nbItems}`,
    ''
  ]);

  // Generate package.xml markdown
  for (const metadataType of metadataTypes) {
    const members = packageXmlContent[metadataType];
    members.sort();
    const memberLengthLabel = members.length === 1 && members[0] === "*" ? "*" : members.length;
    mdLines.push(`<details><summary>${metadataType} (${memberLengthLabel})</summary>`);
    for (const member of members) {
      const memberLabel = member === "*" ? "ALL (wildcard *)" : member;
      mdLines.push(`  • ${memberLabel}<br/>`);
    }
    mdLines.push("</details>");
    mdLines.push("");
    mdLines.push("<br/>");
  }
  mdLines.push("");

  // Footer
  mdLines.push(`_Documentation generated with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT})_`);

  // Write output file
  await fs.writeFile(outputFile, mdLines.join("\n") + "\n");

  uxLog(this, c.green(`Successfully generated package.xml documentation into ${outputFile}`));
}