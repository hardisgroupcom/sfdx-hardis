/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { process as ApexDocGen } from '@cparra/apexdocs';
import { XMLParser } from "fast-xml-parser";
import sortArray from 'sort-array';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { completeApexDocWithAiDescription, completeAttributesDescriptionWithAi, generateLightningPageMarkdown, generateObjectMarkdown, generatePackageXmlMarkdown, readMkDocsFile, replaceInFile, writeMkDocsFile } from '../../../common/utils/docUtils.js';
import { countPackageXmlItems, parseXmlFile } from '../../../common/utils/xmlUtils.js';
import { bool2emoji, createTempDir, execCommand, execSfdxJson, getCurrentGitBranch, getGitRepoName, uxLog } from '../../../common/utils/index.js';
import { CONSTANTS, getConfig } from '../../../config/index.js';
import { listMajorOrgs } from '../../../common/utils/orgConfigUtils.js';
import { glob } from 'glob';
import { GLOB_IGNORE_PATTERNS, listApexFiles, listFlowFiles, listPageFiles, returnApexType } from '../../../common/utils/projectUtils.js';
import { generateFlowMarkdownFile, generateHistoryDiffMarkdown, generateMarkdownFileWithMermaid } from '../../../common/utils/mermaidUtils.js';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import { PACKAGE_ROOT_DIR } from '../../../settings.js';
import { BranchStrategyMermaidBuilder } from '../../../common/utils/branchStrategyMermaidBuilder.js';
import { mdTableCell } from '../../../common/gitProvider/utilsMarkdown.js';
import { prettifyFieldName } from '../../../common/utils/flowVisualiser/nodeFormatUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Project2Markdown extends SfCommand<any> {
  public static title = 'SFDX Project to Markdown';

  public static htmlInstructions = `## Doc HTML Pages

To read the documentation as HTML pages, run the following code (you need [**Python**](https://www.python.org/downloads/) on your computer)

\`\`\`python
pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || python -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || py -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists
mkdocs serve -v || python -m mkdocs serve -v || py -m mkdocs serve -v
\`\`\`

To just generate HTML pages that you can host anywhere, run \`mkdocs build || python -m mkdocs build || py -m mkdocs build\`
`

  public static description = `Generates a markdown documentation from a SFDX project

- Package.xml files
- Source Packages
- sfdx-hardis configuration
- Installed packages

Can work on any sfdx project, no need for it to be a sfdx-hardis flavored one.

Generates markdown files will be written in **docs** folder (except README.md where a link to doc index is added)

To read Flow documentations if your markdown reader doesn't handle MermaidJS syntax, this command could require @mermaid-js/mermaid-cli

- Run \`npm install @mermaid-js/mermaid-cli --global\` if puppeteer works in your environment
- It can also be run as a docker image

Both modes will be tried by default, but you can also force one of them by defining environment variable \`MERMAID_MODES=docker\` or \`MERMAID_MODES=cli\`

_sfdx-hardis docker image is alpine-based and does not succeed to run mermaid/puppeteer: if you can help, please submit a PR !_

If Flow history doc always display a single state, you probably need to update your workflow configuration:

- on Gitlab: Env variable [\`GIT_FETCH_EXTRA_FLAGS: --depth 10000\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.gitlab-ci.yml#L11)
- on GitHub: [\`fetch-depth: 0\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.github/workflows/org-monitoring.yml#L58)
- on Azure: [\`fetchDepth: "0"\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/azure-pipelines.yml#L39)
- on Bitbucket: [\`step: clone: depth: full\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/bitbucket-pipelines.yml#L18)

![Screenshot flow doc](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-flow-doc.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc-2.jpg)

If it is a sfdx-hardis CI/CD project, a diagram of the branches and orgs strategy will be generated.

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-doc-branches-strategy.jpg)

If [AI integration](${CONSTANTS.DOC_URL_ROOT}/salesforce-ai-setup/) is configured, documentation will contain a summary of the Flow.

If you have a complex strategy, you might need to input property **mergeTargets** in branch-scoped sfdx-hardis.yml file to have a correct diagram.

${this.htmlInstructions}
`;

  public static examples = [
    '$ sf hardis:doc:project2markdown',
    '$ sf hardis:doc:project2markdown --with-history'
  ];

  public static flags: any = {
    "diff-only": Flags.boolean({
      default: false,
      description: "Generate documentation only for changed files (used for monitoring)",
    }),
    "with-history": Flags.boolean({
      default: false,
      description: "Generate a markdown file with the history diff of the Flow",
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    "target-org": optionalOrgFlagWithDeprecations
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected diffOnly: boolean = false;
  protected packageXmlCandidates: any[];
  protected outputMarkdownRoot = "docs"
  protected outputMarkdownIndexFile = path.join(this.outputMarkdownRoot, "index.md")
  protected mdLines: string[] = [];
  protected sfdxHardisConfig: any = {};
  protected outputPackageXmlMarkdownFiles: any[] = [];
  protected mkDocsNavNodes: any = { "Home": "index.md" };
  protected withHistory = false;
  protected debugMode = false;
  protected footer: string;
  protected apexDescriptions: any[] = [];
  protected flowDescriptions: any[] = [];
  protected pageDescriptions: any[] = [];
  protected objectDescriptions: any[] = [];
  protected objectFiles: string[];
  protected allObjectsNames: string[];
  protected tempDir: string;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Project2Markdown);
    this.diffOnly = flags["diff-only"] === true ? true : false;
    this.withHistory = flags["with-history"] === true ? true : false;
    this.debugMode = flags.debug || false;
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email, or for Agentforce

    await fs.ensureDir(this.outputMarkdownRoot);
    const currentBranch = await getCurrentGitBranch()
    this.footer = `_Documentation generated from branch ${currentBranch} with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) by [Cloudity](${CONSTANTS.WEBSITE_URL}) command [\`sf hardis:doc:project2markdown\`](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/)_`;

    if (fs.existsSync("config/.sfdx-hardis.yml")) {
      this.sfdxHardisConfig = await getConfig("project");

      // General sfdx-hardis config
      const sfdxHardisParamsLines = this.buildSfdxHardisParams();
      this.mdLines.push(...sfdxHardisParamsLines);
      await fs.writeFile(path.join(this.outputMarkdownRoot, "sfdx-hardis-params.md"), sfdxHardisParamsLines.join("\n") + `\n${this.footer}\n`);
      this.mkDocsNavNodes["SFDX-Hardis Config"] = "sfdx-hardis-params.md";

      // Branches & orgs
      const branchesAndOrgsLines = await this.buildMajorBranchesAndOrgs();
      this.mdLines.push(...branchesAndOrgsLines);
      await fs.writeFile(path.join(this.outputMarkdownRoot, "sfdx-hardis-branches-and-orgs.md"), branchesAndOrgsLines.join("\n") + `\n${this.footer}\n`);
      this.mkDocsNavNodes["Branches & Orgs"] = "sfdx-hardis-branches-and-orgs.md";
    }
    else {
      const repoName = (await getGitRepoName() || "").replace(".git", "");
      const branchName = await getCurrentGitBranch() || ""
      this.mdLines.push(...[
        `## ${repoName}/${branchName} SFDX Project Content`,
        "",
      ]);
    }

    // List SFDX packages and generate a manifest for each of them, except if there is only force-app with a package.xml
    this.packageXmlCandidates = this.listPackageXmlCandidates();
    await this.manageLocalPackages();
    const instanceUrl = flags?.['target-org']?.getConnection()?.instanceUrl;
    await this.generatePackageXmlMarkdown(this.packageXmlCandidates, instanceUrl);
    const packageLines = await this.buildPackagesIndex();
    this.mdLines.push(...packageLines);
    await fs.writeFile(path.join(this.outputMarkdownRoot, "manifests.md"), packageLines.join("\n") + `\n${this.footer}\n`);

    // List managed packages
    const installedPackages = await this.buildInstalledPackages();
    this.mdLines.push(...installedPackages);
    await fs.writeFile(path.join(this.outputMarkdownRoot, "installed-packages.md"), installedPackages.join("\n") + `\n${this.footer}\n`);
    this.mkDocsNavNodes["Installed Packages"] = "installed-packages.md";


    this.tempDir = await createTempDir()
    // Convert source to metadata API format to build prompts
    await execCommand(`sf project convert source --metadata CustomObject --output-dir ${this.tempDir}`, this, { fail: true, output: true, debug: this.debugMode });
    this.objectFiles = (await glob("**/*.object", { cwd: this.tempDir, ignore: GLOB_IGNORE_PATTERNS })).sort();
    this.allObjectsNames = this.objectFiles.map(object => path.basename(object, ".object"));

    // Generate Apex doc
    if (!(process?.env?.GENERATE_APEX_DOC === 'false')) {
      await this.generateApexDocumentation();
    }

    // List flows & generate doc
    if (!(process?.env?.GENERATE_FLOW_DOC === 'false')) {
      await this.generateFlowsDocumentation();
    }

    // List flows & generate doc
    if (!(process?.env?.GENERATE_PAGES_DOC === 'false')) {
      await this.generatePagesDocumentation();
    }

    // List flows & generate doc
    if (!(process?.env?.GENERATE_OBJECTS_DOC === 'false')) {
      await this.generateObjectsDocumentation();
    }

    // Write output index file
    await fs.ensureDir(path.dirname(this.outputMarkdownIndexFile));
    await fs.writeFile(this.outputMarkdownIndexFile, this.mdLines.join("\n") + "\n\n" + Project2Markdown.htmlInstructions + `\n\n${this.footer}\n`);
    uxLog(this, c.green(`Successfully generated doc index at ${this.outputMarkdownIndexFile}`));

    const readmeFile = path.join(process.cwd(), "README.md");
    if (fs.existsSync(readmeFile)) {
      let readme = await fs.readFile(readmeFile, "utf8");
      if (!readme.includes("docs/index.md")) {
        readme += `
        
## Documentation

[Read auto-generated documentation of the SFDX project](docs/index.md)

${Project2Markdown.htmlInstructions}
`;
        await fs.writeFile(readmeFile, readme);
        uxLog(this, c.green(`Updated README.md to add link to docs/index.md`));
      }
    }

    await this.buildMkDocsYml();

    // Open file in a new VsCode tab if available
    WebSocketClient.requestOpenFile(this.outputMarkdownIndexFile);

    return { outputPackageXmlMarkdownFiles: this.outputPackageXmlMarkdownFiles };
  }

  private async generateApexDocumentation() {
    uxLog(this, c.cyan("Generating Apex documentation... (if you don't want it, define GENERATE_APEX_DOC=false in your environment variables)"));
    const tempDir = await createTempDir();
    uxLog(this, c.grey(`Using temp directory ${tempDir}`));
    const packageDirs = this.project?.getPackageDirectories() || [];
    for (const packageDir of packageDirs) {
      try {
        await ApexDocGen({
          sourceDir: packageDir.path,
          targetDir: tempDir,
          exclude: ["**/MetadataService.cls"],
          scope: ['global', 'public', 'private'],
          targetGenerator: "markdown"
        });
      }
      catch (e: any) {
        uxLog(this, c.yellow(`Error generating Apex documentation: ${JSON.stringify(e, null, 2)}`));
        uxLog(this, c.grey(e.stack));
      }

      // Copy files to apex folder
      const apexDocFolder = path.join(this.outputMarkdownRoot, "apex");
      await fs.ensureDir(apexDocFolder);
      await fs.copy(path.join(tempDir, "miscellaneous"), apexDocFolder, { overwrite: true });
      /*
      await ApexDocGen({
        sourceDir: packageDir.path,
        targetDir: tempDir,
        targetGenerator: "openapi"
      });
      */
    }
    const apexFiles = await listApexFiles(packageDirs);
    const apexForMenu: any = { "All Apex Classes": "apex/index.md" }
    for (const apexFile of apexFiles) {
      const apexName = path.basename(apexFile, ".cls").replace(".trigger", "");
      const mdFile = path.join(this.outputMarkdownRoot, "apex", apexName + ".md");
      if (fs.existsSync(mdFile)) {
        apexForMenu[apexName] = "apex/" + apexName + ".md";

        // Add apex code in documentation
        const apexContent = await fs.readFile(apexFile, "utf8");
        this.apexDescriptions.push({
          name: apexName,
          type: returnApexType(apexContent),
          impactedObjects: this.allObjectsNames.filter(objectName => apexContent.includes(`${objectName}`)).join(", ")
        });

        let apexMdContent = await fs.readFile(mdFile, "utf8");
        // Replace object links
        apexMdContent = apexMdContent.replaceAll("..\\custom-objects\\", "../objects/").replaceAll("../custom-objects/", "../objects/")
        // Add text before the first ##
        if (!["MetadataService"].includes(apexName)) {
          const replacement = `\n\n## AI-Generated description\n\n<!-- Apex description -->\n\n## Apex Code\n\n\`\`\`java\n${apexContent}\n\`\`\`\n\n`
          apexMdContent = apexMdContent.replace(/##/, replacement);
          apexMdContent = await completeApexDocWithAiDescription(apexMdContent, apexName, apexContent);
          await fs.writeFile(mdFile, apexMdContent);
        }
        uxLog(this, c.grey(`Generated markdown for Apex class ${apexName}`));
      }
    }
    this.mkDocsNavNodes["Apex"] = apexForMenu;

    this.mdLines.push(...this.buildApexTable("apex/"));

    // Write index file for apex folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "apex"));
    const apexIndexFile = path.join(this.outputMarkdownRoot, "apex", "index.md");
    await fs.writeFile(apexIndexFile, this.buildApexTable('').join("\n") + `\n\n${this.footer}\n`);
  }

  private async generatePagesDocumentation() {
    const packageDirs = this.project?.getPackageDirectories() || [];
    const pageFiles = await listPageFiles(packageDirs);
    const pagesForMenu: any = { "All Lightning pages": "pages/index.md" }
    for (const pagefile of pageFiles) {
      const pageName = path.basename(pagefile, "flexipage-meta.xml");
      const mdFile = path.join(this.outputMarkdownRoot, "pages", pageName + ".md");
      pagesForMenu[pageName] = "pages/" + pageName + ".md";
      // Add apex code in documentation
      const pageXml = await fs.readFile(pagefile, "utf8");
      const pageXmlParsed = new XMLParser().parse(pageXml);
      this.pageDescriptions.push({
        name: pageName,
        type: prettifyFieldName(pageXmlParsed?.FlexiPage?.type || "Unknown"),
        impactedObjects: this.allObjectsNames.filter(objectName => pageXml.includes(`${objectName}`)).join(", ")
      });
      await generateLightningPageMarkdown(pageName, pageXml, mdFile);
    }
    this.mkDocsNavNodes["Lightning Pages"] = pagesForMenu;

    this.mdLines.push(...this.buildPagesTable("pages/"));

    // Write index file for apex folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "pages"));
    const pagesIndexFile = path.join(this.outputMarkdownRoot, "pages", "index.md");
    await fs.writeFile(pagesIndexFile, this.buildPagesTable('').join("\n") + `\n\n${this.footer}\n`);
  }

  private async buildMkDocsYml() {
    // Copy default files (mkdocs.yml and other files can be updated by the SF Cli plugin developer later)
    const mkdocsYmlFile = path.join(process.cwd(), 'mkdocs.yml');
    const mkdocsYmlFileExists = fs.existsSync(mkdocsYmlFile);
    await fs.copy(path.join(PACKAGE_ROOT_DIR, 'defaults/mkdocs-project-doc', '.'), process.cwd(), { overwrite: false });
    if (!mkdocsYmlFileExists) {
      uxLog(this, c.blue('Base mkdocs files copied in your Salesforce project repo'));
      uxLog(
        this,
        c.yellow(
          'You should probably manually update mkdocs.yml to add your own configuration, like theme, site_name, etc.'
        )
      );
    }
    // Update mkdocs nav items
    const mkdocsYml: any = readMkDocsFile(mkdocsYmlFile);
    for (const menuName of Object.keys(this.mkDocsNavNodes)) {
      let pos = 0;
      let found = false;
      for (const navItem of mkdocsYml.nav) {
        if (navItem[menuName]) {
          found = true;
          break;
        }
        pos++;
      }
      const navMenu = {};
      navMenu[menuName] = this.mkDocsNavNodes[menuName];
      if (found) {
        mkdocsYml.nav[pos] = navMenu;
      } else {
        mkdocsYml.nav.push(navMenu);
      }
    }
    // Add missing plugin config if necessary
    if (!mkdocsYml.plugins) {
      mkdocsYml.plugins = [
        'search',
        {
          'exclude-search': {
            'exclude': [
              "index.md",
              "cache-ai-results/*.md",
              "*package.xml.md",
              "package-*items.xml.md"
            ]
          }
        }
      ]
    }

    // Remove deprecated Flows History if found
    mkdocsYml.nav = mkdocsYml.nav.filter(navItem => !navItem["Flows History"]);
    // Update mkdocs file
    await writeMkDocsFile(mkdocsYmlFile, mkdocsYml);
    uxLog(this, c.cyan(`To generate a HTML WebSite with this documentation with a single command, see instructions at ${CONSTANTS.DOC_URL_ROOT}/hardis/doc/project2markdown/`));
  }

  private async generateObjectsDocumentation() {
    uxLog(this, c.cyan("Generating Objects AI documentation... (if you don't want it, define GENERATE_OBJECTS_DOC=false in your environment variables)"));

    const objectLinksInfo = await this.generateLinksInfo();
    const objectsForMenu: any = { "All objects": "objects/index.md" }
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "objects"));
    for (const objectFile of this.objectFiles) {
      const objectName = path.basename(objectFile, ".object");
      if ((objectName.endsWith("__dlm") || objectName.endsWith("__dll")) && !(process.env?.INCLUDE_DATA_CLOUD_DOC === "true")) {
        uxLog(this, c.grey(`Skip Data Cloud Object ${objectName}... (use INCLUDE_DATA_CLOUD_DOC=true to enforce it)`));
        continue;
      }
      uxLog(this, c.cyan(`Generating markdown for Object ${objectName}...`));
      const objectXml = (await fs.readFile(path.join(this.tempDir, objectFile), "utf8")).toString();
      const objectMdFile = path.join(this.outputMarkdownRoot, "objects", objectName + ".md");
      // Build filtered XML
      const objectXmlParsed = new XMLParser().parse(objectXml);
      // Main AI markdown
      await generateObjectMarkdown(objectName, objectXml, this.allObjectsNames.join(","), objectLinksInfo, objectMdFile);
      // Fields table
      await this.buildAttributesTables(objectName, objectXmlParsed, objectMdFile);
      // Flows Tables
      const relatedObjectFlowsTable = await this.buildFlowsTable('../flows/', objectName);
      await replaceInFile(objectMdFile, '<!-- Flows table -->', relatedObjectFlowsTable.join("\n"));
      const relatedApexTable = this.buildApexTable('../apex/', objectName);
      await replaceInFile(objectMdFile, '<!-- Apex table -->', relatedApexTable.join("\n"));
      const relatedPages = this.buildPagesTable('../pages/', objectName);
      await replaceInFile(objectMdFile, '<!-- Pages table -->', relatedPages.join("\n"));
      this.objectDescriptions.push({
        name: objectName,
        label: objectXmlParsed?.CustomObject?.label || "",
        description: objectXmlParsed?.CustomObject?.description || "",
      });
      objectsForMenu[objectName] = "objects/" + objectName + ".md";
    }
    this.mkDocsNavNodes["Objects"] = objectsForMenu;
    // Write table on doc index
    const objectsTableLines = await this.buildObjectsTable('objects/');
    this.mdLines.push(...objectsTableLines);
    this.mdLines.push(...["___", ""]);

    // Write index file for objects folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "objects"));
    const objectsTableLinesForIndex = await this.buildObjectsTable('');
    const objectsIndexFile = path.join(this.outputMarkdownRoot, "objects", "index.md");
    await fs.writeFile(objectsIndexFile, objectsTableLinesForIndex.join("\n") + `\n${this.footer}\n`);
  }

  private async buildAttributesTables(objectName: string, objectXmlParsed: any, objectMdFile: string) {
    const fieldsTable = await this.buildCustomFieldsTable(objectXmlParsed?.CustomObject?.fields || []);
    const validationRulesTable = await this.buildValidationRulesTable(objectXmlParsed?.CustomObject?.validationRules || []);
    const attributesLines = [...fieldsTable, ...validationRulesTable];
    const attributesMarkdown = await completeAttributesDescriptionWithAi(attributesLines.join("\n"), objectName)
    await replaceInFile(objectMdFile, '<!-- Attributes tables -->', attributesMarkdown);
  }

  private async generateLinksInfo(): Promise<string> {
    uxLog(this, c.cyan("Generate MasterDetail and Lookup infos to provide context to AI prompt"));
    const findFieldsPattern = `**/objects/**/fields/**.field-meta.xml`;
    const matchingFieldFiles = (await glob(findFieldsPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS })).map(file => file.replace(/\\/g, '/'));
    const customFieldsLinks: string[] = [];
    for (const fieldFile of matchingFieldFiles) {
      const fieldXml = fs.readFileSync(fieldFile, "utf8").toString();
      const fieldDetail = new XMLParser().parse(fieldXml);
      if (fieldDetail?.CustomField?.type === "MasterDetail" || fieldDetail?.CustomField?.type === "Lookup") {
        const fieldName = path.basename(fieldFile, ".field-meta.xml");
        const objectName = fieldFile.substring(fieldFile.indexOf('objects/')).split("/")[1];
        const linkDescription = `- ${fieldDetail.CustomField.type} field "${fieldName}" defined on object ${objectName}, with target object reference to ${fieldDetail.CustomField.referenceTo} (relationship name: "${fieldDetail.CustomField.relationshipName}", label: "${fieldDetail.CustomField.label}", description: "${fieldDetail.CustomField?.description || ''}")`;
        customFieldsLinks.push(linkDescription);
      }
    }
    return customFieldsLinks.join("\n") + "\n";
  }

  private async generateFlowsDocumentation() {
    uxLog(this, c.cyan("Generating Flows Visual documentation... (if you don't want it, define GENERATE_FLOW_DOC=false in your environment variables)"));
    const flowsForMenu: any = { "All flows": "flows/index.md" }
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "flows"));
    const packageDirs = this.project?.getPackageDirectories();
    const updatedFlowNames = !this.diffOnly ?
      [] :
      (await MetadataUtils.listChangedOrFromCurrentCommitFiles()).filter(f => f?.path?.endsWith(".flow-meta.xml")).map(f => path.basename(f.path, ".flow-meta.xml"));
    const flowFiles = await listFlowFiles(packageDirs);
    const flowErrors: string[] = [];
    const flowWarnings: string[] = [];
    const flowSkips: string[] = [];
    for (const flowFile of flowFiles) {
      const flowName = path.basename(flowFile, ".flow-meta.xml");
      const flowXml = (await fs.readFile(flowFile, "utf8")).toString();
      const flowContent = await parseXmlFile(flowFile);
      this.flowDescriptions.push({
        name: flowName,
        description: flowContent?.Flow?.description?.[0] || "",
        type: flowContent?.Flow?.processType?.[0] === "Flow" ? "ScreenFlow" : flowContent?.Flow?.start?.[0]?.triggerType?.[0] ?? (flowContent?.Flow?.processType?.[0] || "ERROR (Unknown)"),
        object: flowContent?.Flow?.start?.[0]?.object?.[0] || flowContent?.Flow?.processMetadataValues?.filter(pmv => pmv.name[0] === "ObjectType")?.[0]?.value?.[0]?.stringValue?.[0] || "",
        impactedObjects: this.allObjectsNames.filter(objectName => flowXml.includes(`>${objectName}<`)).join(", ")
      });
      flowsForMenu[flowName] = "flows/" + flowName + ".md";
      const outputFlowMdFile = path.join(this.outputMarkdownRoot, "flows", flowName + ".md");
      if (this.diffOnly && !updatedFlowNames.includes(flowName) && fs.existsSync(outputFlowMdFile)) {
        flowSkips.push(flowFile);
        continue;
      }
      uxLog(this, c.grey(`Generating markdown for Flow ${flowFile}...`));
      const genRes = await generateFlowMarkdownFile(flowName, flowXml, outputFlowMdFile, { collapsedDetails: false, describeWithAi: true });
      if (!genRes) {
        flowErrors.push(flowFile);
        continue;
      }
      if (this.debugMode) {
        await fs.copyFile(outputFlowMdFile, outputFlowMdFile.replace(".md", ".mermaid.md"));
      }
      const gen2res = await generateMarkdownFileWithMermaid(outputFlowMdFile, outputFlowMdFile);
      if (!gen2res) {
        flowWarnings.push(flowFile);
        continue;
      }
    }
    this.flowDescriptions = sortArray(this.flowDescriptions, { by: ['object', 'name'], order: ['asc', 'asc'] }) as any[]

    // History
    if (this.withHistory) {
      uxLog(this, c.cyan("Generating Flows Visual Git Diff History documentation..."));
      for (const flowFile of flowFiles) {
        const flowName = path.basename(flowFile, ".flow-meta.xml");
        const diffMdFile = path.join("docs", "flows", path.basename(flowFile).replace(".flow-meta.xml", "-history.md"));
        if (this.diffOnly && !updatedFlowNames.includes(flowName) && fs.existsSync(diffMdFile)) {
          continue;
        }
        try {
          await generateHistoryDiffMarkdown(flowFile, this.debugMode);
        } catch (e: any) {
          uxLog(this, c.yellow(`Error generating history diff markdown: ${e.message}`));
        }
      }
    }

    // Summary
    if (flowSkips.length > 0) {
      uxLog(this, c.yellow(`Skipped generation for ${flowSkips.length} Flows that have not been updated: ${this.humanDisplay(flowSkips)}`));
    }
    uxLog(this, c.green(`Successfully generated ${flowFiles.length - flowSkips.length - flowWarnings.length - flowErrors.length} Flows documentation`));
    if (flowWarnings.length > 0) {
      uxLog(this, c.yellow(`Partially generated documentation (Markdown with mermaidJs but without SVG) for ${flowWarnings.length} Flows: ${this.humanDisplay(flowWarnings)}`));
    }
    if (flowErrors.length > 0) {
      uxLog(this, c.yellow(`Error generating documentation for ${flowErrors.length} Flows: ${this.humanDisplay(flowErrors)}`));
    }

    // Write table on doc index
    const flowTableLines = await this.buildFlowsTable('flows/');
    this.mdLines.push(...flowTableLines);
    this.mdLines.push(...["___", ""]);

    // Write index file for flow folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "flows"));
    const flowTableLinesForIndex = await this.buildFlowsTable('');
    const flowIndexFile = path.join(this.outputMarkdownRoot, "flows", "index.md");
    await fs.writeFile(flowIndexFile, flowTableLinesForIndex.join("\n") + `\n${this.footer}\n`);

    this.mkDocsNavNodes["Flows"] = flowsForMenu;
    uxLog(this, c.green(`Successfully generated doc index for Flows at ${flowIndexFile}`));
  }

  private humanDisplay(flows) {
    return flows.map(flow => path.basename(flow, ".flow-meta.xml")).join(", ");
  }

  private async buildFlowsTable(prefix: string, filterObject: string | null = null) {
    const filteredFlows = filterObject ? this.flowDescriptions.filter(flow => flow.object === filterObject || flow.impactedObjects.includes(filterObject)) : this.flowDescriptions;
    if (filteredFlows.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Flows" : "## Flows",
      "",
      "| Object | Name      | Type | Description |",
      "| :----  | :-------- | :--: | :---------- | "
    ]);
    for (const flow of filteredFlows) {
      const outputFlowHistoryMdFile = path.join(this.outputMarkdownRoot, "flows", flow.name + "-history.md");
      const flowNameCell = fs.existsSync(outputFlowHistoryMdFile) ?
        `[${flow.name}](${prefix}${flow.name}.md) [🕒](${prefix}${flow.name}-history.md)` :
        `[${flow.name}](${prefix}${flow.name}.md)`;
      lines.push(...[
        `| ${flow.object || "💻"} | ${flowNameCell} | ${prettifyFieldName(flow.type)} | ${mdTableCell(flow.description)} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  private async buildObjectsTable(prefix: string) {
    const lines: string[] = [];
    lines.push(...[
      "## Objects",
      "",
      "| Name      | Label | Description |",
      "| :-------- | :---- | :---------- | "
    ]);
    for (const objectDescription of this.objectDescriptions) {
      const objectNameCell = `[${objectDescription.name}](${prefix}${objectDescription.name}.md)`;
      lines.push(...[
        `| ${objectNameCell} | ${objectDescription.label || ""} | ${mdTableCell(objectDescription.description)} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  private buildApexTable(prefix: string, filterObject: string | null = null) {
    const filteredApex = filterObject ? this.apexDescriptions.filter(apex => apex.impactedObjects.includes(filterObject)) : this.apexDescriptions;
    if (filteredApex.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Apex Classes" : "## Apex Classes",
      "",
      "| Apex Class | Type |",
      "| :----      | :--: | "
    ]);
    for (const apex of filteredApex) {
      const flowNameCell = `[${apex.name}](${prefix}${apex.name}.md)`;
      lines.push(...[
        `| ${flowNameCell} | ${apex.type} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  private buildPagesTable(prefix: string, filterObject: string | null = null) {
    const filteredPages = filterObject ? this.pageDescriptions.filter(page => page.impactedObjects.includes(filterObject)) : this.pageDescriptions;
    if (filteredPages.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Lightning Pages" : "## Lightning Pages",
      "",
      "| Lightning Page | Type |",
      "| :----      | :--: | "
    ]);
    for (const page of filteredPages) {
      const pageNameCell = `[${page.name}](${prefix}${page.name}.md)`;
      lines.push(...[
        `| ${pageNameCell} | ${page.type} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  private async buildCustomFieldsTable(fields: any[]) {
    if (!Array.isArray(fields)) {
      fields = [fields];
    }
    if (fields.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      "## Fields",
      "",
      "| Name      | Label | Type | Description |",
      "| :-------- | :---- | :--: | :---------- | "
    ]);
    for (const field of fields) {
      lines.push(...[
        `| ${field.fullName} | ${field.label || ""} | ${field.type || ""} | ${mdTableCell(field.description)} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  private async buildValidationRulesTable(validationRules: any[]) {
    if (!Array.isArray(validationRules)) {
      validationRules = [validationRules];
    }
    if (validationRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      "## Validation Rules",
      "",
      "| Rule      | Active | Description | Formula |",
      "| :-------- | :---- | :---------- | :------ |"
    ]);
    for (const rule of validationRules) {
      lines.push(...[
        `| ${rule.fullName} | ${rule.active ? "Yes" : "No ⚠️"} | ${rule.description || ""} | \`${rule.errorConditionFormula}\` |`
      ]);
    }
    lines.push("");
    return lines;
  }

  private async buildInstalledPackages() {
    // CI/CD context
    const packages = this.sfdxHardisConfig.installedPackages || [];
    // Monitoring context
    const installedPackagesLines: string[] = [];
    const packageFolder = path.join(process.cwd(), 'installedPackages');
    if (packages.length === 0 && fs.existsSync(packageFolder)) {
      const findManagedPattern = "**/*.json";
      const matchingPackageFiles = await glob(findManagedPattern, { cwd: packageFolder, ignore: GLOB_IGNORE_PATTERNS });
      for (const packageFile of matchingPackageFiles) {
        const packageFileFull = path.join(packageFolder, packageFile);
        if (!fs.existsSync(packageFileFull)) {
          continue;
        }
        const pckg = await fs.readJSON(packageFileFull);
        packages.push(pckg);
      }
    }
    // Write packages table
    if (packages && packages.length > 0) {
      installedPackagesLines.push(...[
        "## Installed packages",
        "",
        "| Name  | Namespace | Version | Version Name |",
        "| :---- | :-------- | :------ | :----------: | "
      ]);
      for (const pckg of sortArray(packages, { by: ['SubscriberPackageNamespace', 'SubscriberPackageName'], order: ['asc', 'asc'] }) as any[]) {
        installedPackagesLines.push(...[
          `| ${pckg.SubscriberPackageName} | ${pckg.SubscriberPackageNamespace || ""} | [${pckg.SubscriberPackageVersionNumber}](https://test.salesforce.com/packaging/installPackage.apexp?p0=${pckg.SubscriberPackageVersionId}) | ${pckg.SubscriberPackageVersionName} |`
        ]);
      }
      installedPackagesLines.push("");
      installedPackagesLines.push("___");
      installedPackagesLines.push("");
    }
    return installedPackagesLines;
  }

  private buildSfdxHardisParams(): string[] {
    const sfdxParamsTableLines: string[] = [];
    sfdxParamsTableLines.push(...[
      `## ${this.sfdxHardisConfig?.projectName?.toUpperCase() || "SFDX Project"} CI/CD configuration`,
      ""]);
    sfdxParamsTableLines.push(...[
      "| Sfdx-hardis Parameter | Value | Description & doc link |",
      "| :--------- | :---- | :---------- |"
    ]);
    const installPackagesDuringCheckDeploy = this.sfdxHardisConfig?.installPackagesDuringCheckDeploy ?? false;
    sfdxParamsTableLines.push(`| Install Packages During Check Deploy | ${bool2emoji(installPackagesDuringCheckDeploy)} | [Install 1GP & 2GP packages during deployment check CI/CD job](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/#packages-installation) |`);
    const useDeltaDeployment = this.sfdxHardisConfig?.useDeltaDeployment ?? false;
    sfdxParamsTableLines.push(`| Use Delta Deployment | ${bool2emoji(useDeltaDeployment)} | [Deploys only updated metadatas , only when a MR/PR is from a minor branch to a major branch](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-delta-deployment/#delta-mode) |`);
    const useSmartDeploymentTests = this.sfdxHardisConfig?.useSmartDeploymentTests ?? false;
    sfdxParamsTableLines.push(`| Use Smart Deployment Tests | ${bool2emoji(useSmartDeploymentTests)} | [Skip Apex test cases if delta metadatas can not impact them, only when a MR/PR is from a minor branch to a major branch](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/#smart-deployments-tests) |`);
    sfdxParamsTableLines.push("");
    sfdxParamsTableLines.push("___");
    sfdxParamsTableLines.push("");
    return sfdxParamsTableLines;
  }

  private async buildMajorBranchesAndOrgs() {
    const branchesOrgsLines: string[] = [];
    const majorOrgs = await listMajorOrgs();
    if (majorOrgs.length > 0) {

      branchesOrgsLines.push(...[
        "## Branches & Orgs strategy",
        "",
      ]);
      const mermaidLines = new BranchStrategyMermaidBuilder(majorOrgs).build({ withMermaidTag: true, format: "list" });
      branchesOrgsLines.push(...mermaidLines);

      branchesOrgsLines.push(...[
        "",
        "| Git branch | Salesforce Org | Deployment Username |",
        "| :--------- | :------------- | :------------------ |"
      ]);
      for (const majorOrg of majorOrgs) {
        const majorOrgLine = `| ${majorOrg.branchName} | ${majorOrg.instanceUrl} | ${majorOrg.targetUsername} |`;
        branchesOrgsLines.push(majorOrgLine);
      }
      branchesOrgsLines.push("");
      branchesOrgsLines.push("___");
      branchesOrgsLines.push("");
    }
    return branchesOrgsLines;
  }

  private async manageLocalPackages() {
    const packageDirs = this.project?.getPackageDirectories();
    if (!(packageDirs?.length === 1 && packageDirs[0].name === "force-app" && fs.existsSync("manifest/package.xml"))) {
      for (const packageDir of packageDirs || []) {
        // Generate manifest from package folder
        const packageManifestFile = path.join("manifest", packageDir.name + '-package.xml');
        await fs.ensureDir(path.dirname(packageManifestFile));
        try {
          await execSfdxJson("sf project generate manifest" +
            ` --source-dir ${packageDir.path}` +
            ` --name ${packageManifestFile}`, this,
            {
              fail: true,
              output: true,
              debug: this.debugMode,
            }
          );
          // Add package in available packages list
          this.packageXmlCandidates.push({
            path: packageManifestFile,
            name: packageDir.name,
            description: `Package.xml generated from content of SFDX package ${packageDir.name} (folder ${packageDir.path})`
          });
        }
        catch (e: any) {
          uxLog(this, c.red(`Unable to generate manifest from ${packageDir.path}: it won't appear in the documentation\n${e.message}`))
        }
      }
    }
  }

  private async buildPackagesIndex() {
    const packageLines: string[] = [];
    const packagesForMenu: any = { "All manifests": "manifests.md" }
    packageLines.push(...[
      "## Package XML files",
      "",
      "| Package name | Description |",
      "| :----------- | :---------- |"
    ]);

    for (const outputPackageXmlDef of this.outputPackageXmlMarkdownFiles) {
      const metadataNb = await countPackageXmlItems(outputPackageXmlDef.path);
      const packageMdFile = path.basename(outputPackageXmlDef.path) + ".md";
      const label = outputPackageXmlDef.name ? `Package folder: ${outputPackageXmlDef.name}` : path.basename(outputPackageXmlDef.path);
      const packageTableLine = `| [${label}](${packageMdFile}) (${metadataNb}) | ${outputPackageXmlDef.description} |`;
      packageLines.push(packageTableLine);
      packagesForMenu[label] = packageMdFile;
    }
    packageLines.push("");
    packageLines.push("___");
    packageLines.push("");
    this.mkDocsNavNodes["Manifests"] = packagesForMenu;
    return packageLines;
  }

  private async generatePackageXmlMarkdown(packageXmlCandidates, instanceUrl) {
    // Generate packageXml doc when found
    for (const packageXmlCandidate of packageXmlCandidates) {
      if (fs.existsSync(packageXmlCandidate.path)) {
        // Generate markdown for package.xml
        const packageMarkdownFile = await generatePackageXmlMarkdown(packageXmlCandidate.path, null, packageXmlCandidate, instanceUrl);
        // Open file in a new VsCode tab if available
        WebSocketClient.requestOpenFile(packageMarkdownFile);
        packageXmlCandidate.markdownFile = packageMarkdownFile;
        this.outputPackageXmlMarkdownFiles.push(packageXmlCandidate);
      }
    }
  }

  private listPackageXmlCandidates(): any[] {
    return [
      // CI/CD package files
      {
        path: "manifest/package.xml",
        description: "Contains all deployable metadatas of the SFDX project"
      },
      {
        path: "manifest/packageDeployOnce.xml",
        description: "Contains all metadatas that will never be overwritten during deployment if they are already existing in the target org"
      },
      {
        path: "manifest/package-no-overwrite.xml",
        description: "Contains all metadatas that will never be overwritten during deployment if they are already existing in the target org"
      },
      {
        path: "manifest/destructiveChanges.xml",
        description: "Contains all metadatas that will be deleted during deployment, in case they are existing in the target org"
      },
      // Monitoring package files
      {
        path: "manifest/package-all-org-items.xml",
        description: "Contains the entire list of metadatas that are present in the monitored org (not all of them are in the git backup)"
      },
      {
        path: "manifest/package-backup-items.xml",
        description: "Contains the list of metadatas that are in the git backup"
      },
      {
        path: "manifest/package-skip-items.xml",
        description: "Contains the list of metadatas that are excluded from the backup.<br/>Other metadata types might be skipped using environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES"
      },
    ];
  }

}
