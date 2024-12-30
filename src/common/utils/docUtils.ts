import * as path from "path";
import c from 'chalk';
import fs from 'fs-extra';
import { uxLog } from "./index.js";
import * as yaml from 'js-yaml';
import { countPackageXmlItems, parsePackageXmlFile } from "./xmlUtils.js";
import { CONSTANTS } from "../../config/index.js";
import { SfError } from "@salesforce/core";

export async function generatePackageXmlMarkdown(inputFile: string | null, outputFile: string | null = null, packageXmlDefinition: any = null) {
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

  if (packageXmlDefinition && packageXmlDefinition.description) {
    // Header
    mdLines.push(...[
      `## Content of ${path.basename(inputFile)}`,
      '',
      packageXmlDefinition.description,
      '',
      `Metadatas: ${nbItems}`,
      ''
    ]);
  }
  else {
    // Header
    mdLines.push(...[
      `## Content of ${path.basename(inputFile)}`,
      '',
      `Metadatas: ${nbItems}`,
      ''
    ]);
  }

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
  }
  mdLines.push("");

  // Footer
  mdLines.push(`_Documentation generated with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT})_`);

  // Write output file
  await fs.writeFile(outputFile, mdLines.join("\n") + "\n");

  uxLog(this, c.green(`Successfully generated ${path.basename(inputFile)} documentation into ${outputFile}`));

  return outputFile;
}

export function readMkDocsFile(mkdocsYmlFile: string): any {
  const mkdocsYml: any = yaml.load(
    fs
      .readFileSync(mkdocsYmlFile, 'utf-8')
      .replace('!!python/name:materialx.emoji.twemoji', "'!!python/name:materialx.emoji.twemoji'")
      .replace('!!python/name:materialx.emoji.to_svg', "'!!python/name:materialx.emoji.to_svg'")
      .replace('!!python/name:pymdownx.superfences.fence_code_format', "'!!python/name:pymdownx.superfences.fence_code_format'")
  );
  if (!mkdocsYml.nav) {
    mkdocsYml.nav = {}
  }
  return mkdocsYml;
}

export async function writeMkDocsFile(mkdocsYmlFile: string, mkdocsYml: any) {
  const mkdocsYmlStr = yaml
    .dump(mkdocsYml)
    .replace("'!!python/name:materialx.emoji.twemoji'", '!!python/name:materialx.emoji.twemoji')
    .replace("'!!python/name:materialx.emoji.to_svg'", '!!python/name:materialx.emoji.to_svg')
    .replace("'!!python/name:pymdownx.superfences.fence_code_format'", '!!python/name:pymdownx.superfences.fence_code_format');
  await fs.writeFile(mkdocsYmlFile, mkdocsYmlStr);
  uxLog(this, c.cyan(`Updated mkdocs-material config file at ${c.green(mkdocsYmlFile)}`));
}