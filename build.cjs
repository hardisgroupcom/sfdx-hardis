#!/usr/bin/node
/* eslint-disable */
const fs = require("fs-extra");
const https = require("https");
const yaml = require("js-yaml");

const SDR_METADATA_REGISTRY_URL =
  "https://raw.githubusercontent.com/forcedotcom/source-deploy-retrieve/refs/heads/main/src/registry/metadataRegistry.json";
const METADATA_LIST_FILE = "./src/common/metadata-utils/metadataList.ts";

class SfdxHardisBuilder {
  async run() {
    console.log("Start additional building of sfdx-hardis repository...");
    await this.updateMetadataListFromRegistry();
    await this.generatePagesFromReadme();
    await this.buildDeployTipsDoc();
    await this.buildPromptTemplatesDocs();
    await this.buildTemplatesSummaries();
    this.truncateReadme();
    // this.fixOnlineIndex();
    console.log("All done.");
  }

  async updateMetadataListFromRegistry() {
    console.log("Updating metadata list from source-deploy-retrieve registry...");
    const metadataRegistry = await this.fetchJson(SDR_METADATA_REGISTRY_URL);
    const metadataTypes = this.buildMetadataTypesList(metadataRegistry);
    const metadataListContent = this.buildMetadataListFileContent(metadataTypes);
    this.writeFileIfChanged(METADATA_LIST_FILE, metadataListContent);
    console.log(`Updated ${METADATA_LIST_FILE} from remote metadata registry`);
  }

  fetchJson(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`Unable to download ${url} (status: ${response.statusCode})`));
            return;
          }

          let data = "";
          response.on("data", (chunk) => {
            data += chunk;
          });

          response.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Invalid JSON response from ${url}: ${(e).message}`));
            }
          });
        })
        .on("error", (error) => {
          reject(new Error(`Unable to download ${url}: ${error.message}`));
        });
    });
  }

  buildMetadataTypesList(metadataRegistry) {
    const metadataTypesById = metadataRegistry?.types || {};
    const sortedTypeIds = Object.keys(metadataTypesById).sort();
    const metadataTypes = [];
    const generatedChildTypeIds = new Set();

    for (const typeId of sortedTypeIds) {
      const type = metadataTypesById[typeId];
      if (!type || !type.name || !type.directoryName) {
        continue;
      }

      const childrenById = type?.children?.types || {};
      const childNames = Object.values(childrenById)
        .map((childType) => childType?.name)
        .filter(Boolean);
      const metadataType = this.mapRegistryTypeToMetadataType(type, {
        childXmlNames: childNames.length > 0 ? childNames : undefined,
      });
      metadataTypes.push(metadataType);

      for (const childTypeId of Object.keys(childrenById).sort()) {
        if (metadataTypesById[childTypeId] || generatedChildTypeIds.has(childTypeId)) {
          continue;
        }
        const childType = childrenById[childTypeId];
        if (!childType || !childType.name || !childType.directoryName) {
          continue;
        }

        generatedChildTypeIds.add(childTypeId);
        metadataTypes.push(
          this.mapRegistryTypeToMetadataType(childType, {
            parentXmlName: type.name,
            xmlTag: childType.xmlElementName,
            key: childType.uniqueIdElement,
          })
        );
      }
    }

    return metadataTypes;
  }

  mapRegistryTypeToMetadataType(type, additionalFields = {}) {
    const metadataType = {
      directoryName: type.directoryName,
      inFolder: Boolean(type.inFolder),
      metaFile: this.isMetaFileType(type),
      ...(type.suffix ? { suffix: type.suffix } : {}),
      xmlName: type.name,
      ...additionalFields,
    };

    // Keep only defined fields so output stays clean.
    return Object.fromEntries(Object.entries(metadataType).filter(([, value]) => value !== undefined));
  }

  isMetaFileType(type) {
    const adapter = type?.strategies?.adapter;
    return ["matchingContentFile", "mixedContent", "digitalExperience", "webApplications"].includes(adapter);
  }

  buildMetadataListFileContent(metadataTypes) {
    const metadataTypesAsTs = this.toTsLiteral(metadataTypes, 2);
    return `export function listMetadataTypes() {\n  // Generated from ${SDR_METADATA_REGISTRY_URL}\n  return ${metadataTypesAsTs};\n}\n`;
  }

  toTsLiteral(value, indentLevel = 0) {
    const indent = "  ".repeat(indentLevel);
    const childIndent = "  ".repeat(indentLevel + 1);

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "[]";
      }
      const items = value.map((item) => `${childIndent}${this.toTsLiteral(item, indentLevel + 1)},`);
      return `[\n${items.join("\n")}\n${indent}]`;
    }

    if (value != null && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return "{}";
      }

      const entries = keys.map((key) => {
        const keyLiteral = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : this.toTsString(key);
        return `${childIndent}${keyLiteral}: ${this.toTsLiteral(value[key], indentLevel + 1)},`;
      });
      return `{\n${entries.join("\n")}\n${indent}}`;
    }

    if (typeof value === "string") {
      return this.toTsString(value);
    }

    return String(value);
  }

  toTsString(value) {
    const escapedValue = value
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
    return `'${escapedValue}'`;
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
    this.writeFileIfChanged(deployTipsDocFile, deployTipsMd.join("\n") + "\n");
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
    this.writeFileIfChanged(tipFile, tipFileMd.join("\n") + "\n");
  }

  async buildPromptTemplatesDocs() {
    console.log("Building prompt templates documentation...");
    const { PROMPT_TEMPLATES } = await import("./lib/common/aiProvider/promptTemplates/index.js");
    const { PROMPT_VARIABLES } = await import("./lib/common/aiProvider/promptTemplates/variablesIndex.js");
    const docsPromptDir = "./docs/prompt-templates";
    fs.ensureDirSync(docsPromptDir);

    // Build prompt templates documentation
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
        '', '## How to override',

        '',
        `To define your own prompt text, you can define a local file **config/prompt-templates/${templateName}.txt**`,
        ``,
        `You can also use the command \`sf hardis:doc:override-prompts\` to automatically create all override template files at once.`,
        ``,
        `If you do so, please don't forget to use the replacement variables :)`
      ];
      this.writeFileIfChanged(templateDocFile, md.join("\n") + "\n");
      promptNav.push({ [templateName]: `prompt-templates/${templateName}.md` });
    }

    // Build prompt variables documentation in the same folder
    const variablesNav = [];
    for (const variableName of Object.keys(PROMPT_VARIABLES)) {
      const variableDocFile = `${docsPromptDir}/${variableName}.md`;
      const variable = PROMPT_VARIABLES[variableName];
      // Read the variable file and extract the variable text
      const md = [
        `---`,
        `title: ${variableName}`,
        `description: Prompt variable for ${variableName}`,
        `---`,
        '',
        `# ${variableName}`,
        '',
        `## Description`,
        '',
        'This is a reusable prompt variable that provides common instructions across multiple prompt templates.',
        '',
        `## Content`,
        "",
        "```",
        variable.text.en,
        "```",
        '',
        '## How to override',
        '',
        `To define your own variable content, you can define a local file **config/prompt-templates/${variableName}.txt**`,
        ``,
        `You can also use the command \`sf hardis:doc:override-prompts\` to automatically create all override variable files at once.`,
        ``
      ];
      this.writeFileIfChanged(variableDocFile, md.join("\n") + "\n");
      promptNav.push({ [variableName]: `prompt-templates/${variableName}.md` });
    }

    console.log("Prompt templates and variables documentation generated");
  }

  // Read README.md 
  // Find sub-content between HTML comments <!-- PAGENAME.md start --> and <!-- PAGENAME.md end --> (example: <!-- contributing.md start --> & <!-- contributing.md end -->)
  // For each start & and found, generate a new markdown file in docs/ folder with the name PAGENAME.md (example: contributing.md)
  async generatePagesFromReadme() {
    console.log("Generating pages from README.md...");
    const readmeFile = "./README.md";
    const readmeContent = fs.readFileSync(readmeFile, "utf-8");
    const regex = /<!-- (.+?) start -->([\s\S]*?)<!-- \1 end -->/g;
    let match;
    while ((match = regex.exec(readmeContent)) !== null) {
      const pageName = match[1].trim();
      const pageContent = match[2].trim();
      const pageFile = `./docs/${pageName}`;
      fs.writeFileSync(pageFile, pageContent + "\n");
      console.log(`Generated ${pageFile}`);
    }
    console.log("All pages generated from README.md");
  }

  async buildTemplatesSummaries() {
    console.log("Building templates summaries...");
    const GITHUB_RAW_BASE = "https://github.com/hardisgroupcom/sfdx-hardis/raw/refs/heads/main/defaults/templates";
    const TEMPLATES_ROOT = "./defaults/templates";
    const subFolders = [
      { folder: "files", outputFile: `${TEMPLATES_ROOT}/file-templates.json` },
      { folder: "sfdmu", outputFile: `${TEMPLATES_ROOT}/data-templates.json` },
    ];
    for (const { folder, outputFile } of subFolders) {
      const folderPath = `${TEMPLATES_ROOT}/${folder}`;
      const files = fs.readdirSync(folderPath).filter((f) => f.endsWith(".json"));
      const templates = [];
      for (const file of files.sort()) {
        const filePath = `${folderPath}/${file}`;
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        templates.push({
          name: file,
          sfdxHardisLabel: content.sfdxHardisLabel || "",
          sfdxHardisDescription: content.sfdxHardisDescription || "",
          url: `${GITHUB_RAW_BASE}/${folder}/${file}`,
        });
      }
      const summary = JSON.stringify({ templates }, null, 2) + "\n";
      this.writeFileIfChanged(outputFile, summary);
      console.log(`Written templates summary ${outputFile}`);
    }
  }

  truncateReadme() {
    const readmeFile = "./README.md";
    const readmeContent = fs.readFileSync(readmeFile, "utf-8");
    const chunks = readmeContent.split("<!-- commands -->")
    fs.writeFileSync(readmeFile, chunks[0] + "<!-- commands -->");
    console.log("Removed README.md commands");
  }

  fixOnlineIndex() {
    const indexFile = "./docs/index.md";
    let indexContent = fs.readFileSync(indexFile, "utf-8");
    indexContent = indexContent.replace("[_See online documentation for a better navigation_](https://sfdx-hardis.cloudity.com)", "");
    fs.writeFileSync(indexFile, fixedLines.join("\n"));
    console.log("Fixed online index.md links");
  }

  writeFileIfChanged(filePath, content) {
    let existingContent = "";
    if (fs.existsSync(filePath)) {
      existingContent = fs.readFileSync(filePath, "utf-8");
    }
    if (this.areContentsDifferent(existingContent, content)) {
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`Updated ${filePath}`);
    } else {
      console.log(`No changes in ${filePath}`);
    }
  }

  // Check if changes are more than spacing, line endings or "-" differences
  areContentsDifferent(contentA, contentB) {
    // Function to remove all spaces, line endings and "-" from a string
    const normalize = (str) => str.replace(/[\s\-]/g, '');
    return normalize(contentA) !== normalize(contentB);
  }
}

(async () => {
  await new SfdxHardisBuilder().run();
})();

