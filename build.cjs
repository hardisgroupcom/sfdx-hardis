#!/usr/bin/node
/* eslint-disable */
const fs = require("fs");
const https = require("https");
const yaml = require("js-yaml");

const SDR_METADATA_REGISTRY_URL =
  "https://raw.githubusercontent.com/forcedotcom/source-deploy-retrieve/refs/heads/main/src/registry/metadataRegistry.json";
const METADATA_LIST_FILE = "./src/common/metadata-utils/metadataList.ts";

// docs/llms.txt links the Markdown sources of the pages, which agents read better than the HTML
const LLMS_TXT_RAW_ROOT = "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/main/";
// docs/llms.txt: the summary and the notes at its top, the menu folders listed last as optional,
// and the folders whose name is not the best section title
const LLMS_TXT_SUMMARY =
  "sfdx-hardis is a Salesforce CLI plugin and a VS Code extension, by Cloudity: CI/CD pipelines for Salesforce (Pull Request checks, smart deployments, deployment actions, promotion branches), org monitoring with daily metadata backups, and project documentation generation.";
const LLMS_TXT_INTRO = [
  "Commands run as `sf hardis:<topic>:<action>`. Each command page lists its flags and examples. Most commands accept `--agent`, which runs them without any prompt, for coding agents and scripts.",
  "",
  "A project is configured in `config/.sfdx-hardis.yml`, with overrides per branch in `config/branches/.sfdx-hardis.<branch>.yml`: see the Settings section.",
  "",
  "Most users run sfdx-hardis from the VS Code extension: the VS Code Extension section describes its panels, and the guides say which button runs which command.",
  "",
  "Each link is the Markdown source of a page: `docs/<page>.md` is published at `https://sfdx-hardis.cloudity.com/<page>/`, the URL to give a person.",
];
const LLMS_TXT_OPTIONAL_SECTIONS = ["Community & Resources", "About", "Cloudity, Consulting Partner"];
const LLMS_TXT_SECTION_TITLES = { "Commands Reference": "Commands" };

// Title and meta description of each page generated from README.md, for search engines
const README_PAGES_FRONT_MATTER = {
  "installation.md": {
    title: "Install sfdx-hardis",
    description:
      "Install sfdx-hardis with the VS Code extension (recommended), as a Salesforce CLI plugin, or run it in CI/CD with a Docker image.",
  },
  "events.md": {
    title: "sfdx-hardis at community events",
    description: "The Salesforce community events where sfdx-hardis was presented, with the title of each talk.",
  },
  "articles-videos.md": {
    title: "Articles and videos about sfdx-hardis",
    description: "Web articles, recorded conferences, podcasts and videos about sfdx-hardis and Salesforce DevOps.",
  },
  "contributing.md": {
    title: "Contribute to sfdx-hardis",
    description: "How to contribute to the sfdx-hardis Salesforce CLI plugin and to its VS Code extension vscode-sfdx-hardis.",
  },
  "contributors.md": {
    title: "sfdx-hardis contributors",
    description: "The organization behind sfdx-hardis, the authors of its Pull Requests, and the people it thanks.",
  },
};

class SfdxHardisBuilder {
  async run() {
    console.log("Start additional building of sfdx-hardis repository...");
    await this.updateMetadataListFromRegistry();
    await this.generatePagesFromReadme();
    await this.buildDeployTipsDoc();
    await this.buildPromptTemplatesDocs();
    await this.buildTemplatesSummaries();
    this.generateLlmsTxt();
    this.truncateReadme();
    // this.fixOnlineIndex();
    console.log("All done.");
  }

  async updateMetadataListFromRegistry() {
    console.log("Updating metadata list from source-deploy-retrieve registry...");
    let metadataRegistry;
    try {
      metadataRegistry = await this.fetchJson(SDR_METADATA_REGISTRY_URL);
    } catch (e) {
      console.warn(`Warning: Could not download metadata registry (network unavailable?): ${e.message}`);
      console.warn("Skipping metadata list update.");
      return;
    }
    const metadataTypes = this.buildMetadataTypesList(metadataRegistry);
    const metadataListContent = this.buildMetadataListFileContent(metadataTypes);
    this.writeFileIfChanged(METADATA_LIST_FILE, metadataListContent);
    console.log(`Updated ${METADATA_LIST_FILE} from remote metadata registry`);
  }

  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const request = https
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
      // Without a timeout, a stalled connection hangs forever and blocks the pre-commit hook
      request.setTimeout(30000, () => {
        request.destroy(new Error(`Timeout downloading ${url}`));
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

  // A YAML double-quoted scalar only accepts a fixed set of escape sequences, so a raw backslash
  // coming from a regex (\(, \), \.) or a raw double quote coming from a label or an error message
  // makes the front matter unparseable and breaks the documentation build.
  toYamlDoubleQuotedString(value) {
    const escapedValue = String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
    return `"${escapedValue}"`;
  }

  async buildDeployTipsDoc() {
    console.log("Building salesforce-deployment-agent-error-list.md doc...");
    const deployTipsDocFile = "./docs/salesforce-deployment-agent-error-list.md";
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
      "See how to [setup Deployment Agent](salesforce-deployment-agent-setup.md)",
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
        tip.expressionRegex[0].toString().replace("/Error", "Error").replace("/gm", "");
    const tipFileMd = [
      "---",
      `title: ${this.toYamlDoubleQuotedString(`${tip.label} (Deployment assistant)`)}`,
      `description: ${this.toYamlDoubleQuotedString(`How to solve Salesforce deployment error "${errorDescription}"`)}`,
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
    fs.mkdirSync(docsPromptDir, { recursive: true });

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
            // A multi-line example needs one code span per line: a <br> placed inside a single
            // code span is rendered literally instead of breaking the line. Pipes are escaped so
            // they do not split the markdown table.
            const exampleCell = String(v.example ?? "")
              .split("\n")
              .map(line => line.replace(/\|/g, "\\|"))
              .filter(line => line.length > 0)
              .map(line => `\`${line}\``)
              .join("<br>");
            return `| **${v.name}** | ${v.description} | ${exampleCell} |`;
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
        `To define your own prompt text, you can define a local file **config/prompt-templates/${templateName}.md**`,
        ``,
        `> For backward compatibility, **config/prompt-templates/${templateName}.txt** is also supported, but **.md is preferred**.`,
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
        `To define your own variable content, you can define a local file **config/prompt-templates/${variableName}.md**`,
        ``,
        `> For backward compatibility, **config/prompt-templates/${variableName}.txt** is also supported, but **.md is preferred**.`,
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
      const frontMatter = README_PAGES_FRONT_MATTER[pageName];
      if (!frontMatter) {
        throw new Error(`Add the title and description of ${pageName} to README_PAGES_FRONT_MATTER in build.cjs`);
      }
      const frontMatterBlock = `---\ntitle: ${JSON.stringify(frontMatter.title)}\ndescription: ${JSON.stringify(frontMatter.description)}\n---\n`;
      fs.writeFileSync(pageFile, frontMatterBlock + pageContent + "\n");
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

  // docs/llms.txt (https://llmstxt.org), served at the root of the site: the pages a coding agent
  // should read, in the order of the menu of mkdocs.yml, each with the title and the description
  // of its front matter. The command pages are read as they are in docs/hardis: generate them
  // first (yarn build:doc) when commands changed.
  generateLlmsTxt() {
    console.log("Generating docs/llms.txt...");
    // The python tags of mkdocs.yml mean nothing here
    const mkdocsText = fs.readFileSync("./mkdocs.yml", "utf-8").replace(/!!python\/name:\S+/g, '""');
    const mkdocs = yaml.load(mkdocsText);
    const listed = new Set();
    const pageLine = (label, target) => {
      if (/^https?:\/\//.test(target)) {
        return `- [${label}](${target})`;
      }
      if (listed.has(target)) {
        return null;
      }
      listed.add(target);
      const { frontMatter, sourcePath } = this.readMarkdownPage(target);
      const url = LLMS_TXT_RAW_ROOT + sourcePath;
      const title = frontMatter.title || label;
      return `- [${title}](${url})` + (frontMatter.description ? `: ${frontMatter.description}` : "");
    };
    // A menu entry without a label (- page.md) is a page titled by its own front matter
    const navEntries = (item) => (typeof item === "string" ? [[item, item]] : Object.entries(item));
    // The pages of a menu folder; a folder inside it gets a ### heading
    const flatten = (items, depth = 0) =>
      items.flatMap((item) =>
        navEntries(item).flatMap(([label, value]) => {
          if (!Array.isArray(value)) {
            return [pageLine(label, value)];
          }
          return depth === 0 ? ["", `### ${label}`, "", ...flatten(value, depth + 1)] : flatten(value, depth + 1);
        }),
      );

    const sections = [];
    const startPages = [];
    const optionalPages = [];
    for (const item of mkdocs.nav) {
      const [[label, value]] = navEntries(item);
      if (!Array.isArray(value)) {
        if (value === "index.md" || value === "sfdx-hardis-config-file.md") {
          continue;
        }
        (LLMS_TXT_OPTIONAL_SECTIONS.includes(label) ? optionalPages : startPages).push(pageLine(label, value));
      } else if (LLMS_TXT_OPTIONAL_SECTIONS.includes(label)) {
        optionalPages.push(...flatten(value));
      } else {
        sections.push({ title: LLMS_TXT_SECTION_TITLES[label] || label, lines: flatten(value) });
      }
    }
    const settings = [
      pageLine("Configuration", "sfdx-hardis-config-file.md"),
      `- [JSON schema of the configuration](${LLMS_TXT_RAW_ROOT}config/sfdx-hardis.jsonschema.json): every key of \`config/.sfdx-hardis.yml\`, with its type, default value and description`,
    ];
    const md = [
      "# sfdx-hardis",
      "",
      `> ${LLMS_TXT_SUMMARY}`,
      "",
      ...LLMS_TXT_INTRO,
      "",
      "## Get started",
      "",
      ...startPages,
      "",
      "## Settings",
      "",
      ...settings,
      ...sections.flatMap((section) => ["", `## ${section.title}`, "", ...section.lines]),
      "",
      "## Optional",
      "",
      ...optionalPages,
      "",
    ].filter((line) => line !== null);
    this.writeFileIfChanged("./docs/llms.txt", md.join("\n"));
  }

  // A page of the menu, read once: its front matter ({} when it has none), and the path in the
  // repository of the Markdown it is made of: the page itself, or the file it only includes
  // (--8<-- "../CHANGELOG.md"), which is what an agent should read
  readMarkdownPage(target) {
    const file = `./docs/${target}`;
    if (!fs.existsSync(file)) {
      throw new Error(`mkdocs.yml lists ${file}, which does not exist`);
    }
    const content = fs.readFileSync(file, "utf-8");
    const frontMatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const frontMatter = frontMatterMatch ? yaml.load(frontMatterMatch[1]) || {} : {};
    const body = content
      .substring(frontMatterMatch ? frontMatterMatch[0].length : 0)
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    const include = body.match(/^--8<-- "\.\.\/([^"]+)"$/);
    return { frontMatter, sourcePath: include ? include[1] : `docs/${target}` };
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
  // node build.cjs --llms-txt: only docs/llms.txt (yarn build:llms-txt)
  if (process.argv.includes("--llms-txt")) {
    new SfdxHardisBuilder().generateLlmsTxt();
    return;
  }
  await new SfdxHardisBuilder().run();
})();

