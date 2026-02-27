/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { process as ApexDocGen } from '@cparra/apexdocs';
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import sortArray from 'sort-array';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { completeAttributesDescriptionWithAi, getMetaHideLines, readMkDocsFile, replaceInFile, writeMkDocsFile } from '../../../common/docBuilder/docUtils.js';
import { parseXmlFile } from '../../../common/utils/xmlUtils.js';
import { bool2emoji, createTempDir, execCommand, execSfdxJson, filterPackageXml, getCurrentGitBranch, sortCrossPlatform, uxLog } from '../../../common/utils/index.js';
import { CONSTANTS, getConfig } from '../../../config/index.js';
import { listMajorOrgs } from '../../../common/utils/orgConfigUtils.js';
import { glob } from 'glob';
import { GLOB_IGNORE_PATTERNS, listApexFiles, listFlowFiles, listPageFiles, returnApexType } from '../../../common/utils/projectUtils.js';
import { generateFlowMarkdownFile, generateHistoryDiffMarkdown, generateMarkdownFileWithMermaid } from '../../../common/utils/mermaidUtils.js';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import { PACKAGE_ROOT_DIR } from '../../../settings.js';
import { BranchStrategyMermaidBuilder } from '../../../common/utils/branchStrategyMermaidBuilder.js';
import { prettifyFieldName } from '../../../common/utils/flowVisualiser/nodeFormatUtils.js';
import { ObjectModelBuilder } from '../../../common/docBuilder/objectModelBuilder.js';
import { generatePdfFileFromMarkdown } from '../../../common/utils/markdownUtils.js';
import { DocBuilderPage } from '../../../common/docBuilder/docBuilderPage.js';
import { DocBuilderProfile } from '../../../common/docBuilder/docBuilderProfile.js';
import { DocBuilderObject } from '../../../common/docBuilder/docBuilderObject.js';
import { DocBuilderApex } from '../../../common/docBuilder/docBuilderApex.js';
import { DocBuilderFlow } from '../../../common/docBuilder/docBuilderFlow.js';
import { DocBuilderLwc } from '../../../common/docBuilder/docBuilderLwc.js';
import { DocBuilderPackageXML } from '../../../common/docBuilder/docBuilderPackageXml.js';
import { DocBuilderPermissionSet } from '../../../common/docBuilder/docBuilderPermissionSet.js';
import { DocBuilderPermissionSetGroup } from '../../../common/docBuilder/docBuilderPermissionSetGroup.js';
import { DocBuilderAssignmentRules } from '../../../common/docBuilder/docBuilderAssignmentRules.js';
import { DocBuilderApprovalProcess } from '../../../common/docBuilder/docBuilderApprovalProcess.js';
import { DocBuilderAutoResponseRules } from "../../../common/docBuilder/docBuilderAutoResponseRules.js";
import { DocBuilderEscalationRules } from '../../../common/docBuilder/docBuilderEscalationRules.js';
import { DocBuilderRoles } from '../../../common/docBuilder/docBuilderRoles.js';
import { DocBuilderPackage } from '../../../common/docBuilder/docBuilderPackage.js';
import { DocBuilderWorkflowRule } from '../../../common/docBuilder/docBuilderWorkflowRule.js';
import { setConnectionVariables } from '../../../common/utils/orgUtils.js';
import { makeFileNameGitCompliant } from '../../../common/utils/gitUtils.js';
import { PromisePool } from '@supercharge/promise-pool';
import { UtilsAi } from '../../../common/aiProvider/utils.js';
import ExcelJS from 'exceljs';


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

To just generate HTML pages that you can host anywhere, run \`mkdocs build -v || python -m mkdocs build -v || py -m mkdocs build -v\`
`

  public static description = `Generates Markdown documentation from a SFDX project

- Objects (with fields, validation rules, relationships and dependencies)
- Automations
  - Approval Processes
  - Assignment Rules
  - AutoResponse Rules
  - Escalation Rules
  - Flows
- Authorizations
  - Profiles
  - Permission Set Groups
  - Permission Sets
- Code
  - Apex
  - Lightning Web Components
- Lightning Pages
- Packages
- SFDX-Hardis Config
- Branches & Orgs
- Manifests

Can work on any sfdx project, no need for it to be a sfdx-hardis flavored one.

Generated markdown files will be written in the **docs** folder (except README.md, where a link to the doc index is added).

- You can customize the pages following [mkdocs-material setup documentation](https://squidfunk.github.io/mkdocs-material/setup/)
- You can manually add new markdown files in the "docs" folder to extend this documentation and add references to them in "mkdocs.yml"
- You can also add images in folder "docs/assets" and embed them in markdown files.

To read flow documentation, if your markdown reader doesn't handle MermaidJS syntax this command may require @mermaid-js/mermaid-cli.

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

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-object-diagram.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc-profile.gif)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-doc-apex.png)

If it is a sfdx-hardis CI/CD project, a diagram of the branches and orgs strategy will be generated.

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-doc-branches-strategy.jpg)

If [AI integration](${CONSTANTS.DOC_URL_ROOT}/salesforce-ai-setup/) is configured, documentation will contain a summary of the Flow.

- Use variable PROMPTS_LANGUAGE (ex: PROMPTS_LANGUAGE=fr) to force language for LLM calls (default:en)

If you have a complex strategy, you might need to input property **mergeTargets** in branch-scoped sfdx-hardis.yml file to have a correct diagram.

Define DO_NOT_OVERWRITE_INDEX_MD=true to avoid overwriting the index.md file in docs folder, useful if you want to keep your own index.md file.

${this.htmlInstructions}
`;

  public static examples = [
    '$ sf hardis:doc:project2markdown',
    '$ sf hardis:doc:project2markdown --with-history',
    '$ sf hardis:doc:project2markdown --with-history --pdf',
    '$ sf hardis:doc:project2markdown --hide-apex-code',
    '$ sf hardis:doc:project2markdown --excel',
    '$ sf hardis:doc:project2markdown --no-generate-apex-doc --no-generate-lwc-doc',
    '$ sf hardis:doc:project2markdown --no-generate-automations-doc'
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
    pdf: Flags.boolean({
      description: 'Also generate the documentation in PDF format',
    }),
    excel: Flags.boolean({
      description: 'Also generate an Excel file with all metadata in separate tabs',
    }),
    "hide-apex-code": Flags.boolean({
      default: false,
      description: "Hide Apex code in the generated documentation for Apex classes.",
    }),
    "generate-packages-doc": Flags.boolean({
      default: true,
      description: "Generate Installed Packages documentation",
      allowNo: true
    }),
    "generate-apex-doc": Flags.boolean({
      default: true,
      description: "Generate Apex documentation",
      allowNo: true
    }),
    "generate-flow-doc": Flags.boolean({
      default: true,
      description: "Generate Flows, Process Builders and Workflow Rules documentation",
      allowNo: true
    }),
    "generate-pages-doc": Flags.boolean({
      default: true,
      description: "Generate Lightning Pages documentation",
      allowNo: true
    }),
    "generate-profiles-doc": Flags.boolean({
      default: true,
      description: "Generate Profiles, Permission Sets, Permission Set Groups and Roles documentation",
      allowNo: true
    }),
    "generate-objects-doc": Flags.boolean({
      default: true,
      description: "Generate Objects documentation",
      allowNo: true
    }),
    "generate-automations-doc": Flags.boolean({
      default: true,
      description: "Generate Automations documentation (Approval Processes, Assignment Rules, AutoResponse Rules, Escalation Rules)",
      allowNo: true
    }),
    "generate-lwc-doc": Flags.boolean({
      default: true,
      description: "Generate Lightning Web Components documentation",
      allowNo: true
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
  protected mkDocsNavNodes: any[] = [{ "Home": "index.md" }];
  protected withHistory = false;
  protected withPdf = false;
  protected withExcel = false;
  protected hideApexCode = false;
  protected debugMode = false;
  protected generatePackagesDoc = true;
  protected generateApexDoc = true;
  protected generateFlowDoc = true;
  protected generatePagesDoc = true;
  protected generateProfilesDoc = true;
  protected generateObjectsDoc = true;
  protected generateAutomationsDoc = true;
  protected generateLwcDoc = true;
  protected footer: string;
  protected apexDescriptions: any[] = [];
  protected flowDescriptions: any[] = [];
  protected lwcDescriptions: any[] = [];
  protected packageDescriptions: any[] = [];
  protected pageDescriptions: any[] = [];
  protected profileDescriptions: any[] = [];
  protected permissionSetsDescriptions: any[] = [];
  protected permissionSetGroupsDescriptions: any[] = [];
  protected assignmentRulesDescriptions: any[] = [];
  protected autoResponseRulesDescriptions: any[] = [];
  protected approvalProcessesDescriptions: any[] = [];
  protected escalationRulesDescriptions: any[] = [];
  protected workflowRulesDescriptions: any[] = [];
  protected roleDescriptions: any[] = [];
  protected objectDescriptions: any[] = [];
  protected processBuildersForMenu: any = { "All Process Builders": "processBuilders/index.md" };
  protected objectFiles: string[];
  protected allObjectsNames: string[];
  protected tempDir: string;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Project2Markdown);
    this.diffOnly = flags["diff-only"] === true ? true : false;
    this.withHistory = flags["with-history"] === true ? true : false;
    this.withPdf = flags.pdf === true ? true : false;
    this.withExcel = flags.excel === true ? true : false;
    this.hideApexCode = flags["hide-apex-code"] === true || process?.env?.HIDE_APEX_CODE === 'true' ? true : false;
    this.debugMode = flags.debug || false;
    this.generatePackagesDoc = flags["generate-packages-doc"] !== false && process?.env?.GENERATE_PACKAGES_DOC !== 'false';
    this.generateApexDoc = flags["generate-apex-doc"] !== false && process?.env?.GENERATE_APEX_DOC !== 'false';
    this.generateFlowDoc = flags["generate-flow-doc"] !== false && process?.env?.GENERATE_FLOW_DOC !== 'false';
    this.generatePagesDoc = flags["generate-pages-doc"] !== false && process?.env?.GENERATE_PAGES_DOC !== 'false';
    this.generateProfilesDoc = flags["generate-profiles-doc"] !== false && process?.env?.GENERATE_PROFILES_DOC !== 'false';
    this.generateObjectsDoc = flags["generate-objects-doc"] !== false && process?.env?.GENERATE_OBJECTS_DOC !== 'false';
    this.generateAutomationsDoc = flags["generate-automations-doc"] !== false && process?.env?.GENERATE_AUTOMATIONS_DOC !== 'false';
    this.generateLwcDoc = flags["generate-lwc-doc"] !== false && process?.env?.GENERATE_LWC_DOC !== 'false';
    await setConnectionVariables(flags['target-org']?.getConnection(), true);// Required for some notifications providers like Email, or for Agentforce

    await fs.ensureDir(this.outputMarkdownRoot);
    const currentBranch = await getCurrentGitBranch()
    this.footer = `_Documentation generated from branch ${currentBranch} with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) by [Cloudity](${CONSTANTS.WEBSITE_URL}) command [\`sf hardis:doc:project2markdown\`](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/)_`;

    this.mdLines.push(...[
      "Welcome to the documentation of your Salesforce project.",
      "",
      "![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/sfdx-hardis-banner-doc.png)",
      "",
      "- [Objects](objects/index.md)",
      "- Automations",
      "  - [Approval Processes](approvalProcesses/index.md)",
      "  - [Assignment Rules](assignmentRules/index.md)",
      "  - [AutoResponse Rules](autoResponseRules/index.md)",
      "  - [Escalation Rules](escalationRules/index.md)",
      "  - [Flows](flows/index.md)",
      "  - [Process Builders](processBuilders/index.md)",
      "  - [Workflow Rules](workflowRules/index.md)",
      "- Authorizations",
      "  - [Profiles](profiles/index.md)",
      "  - [Permission Set Groups](permissionsetgroups/index.md)",
      "  - [Permission Sets](permissionsets/index.md)",
      "- Code",
      "  - [Apex](apex/index.md)",
      "  - [Lightning Web Components](lwc/index.md)",
      "- [Lightning Pages](pages/index.md)",
      "- [Packages](packages/index.md)",
      "- [Roles](roles.md)",
      "- [SFDX-Hardis Config](sfdx-hardis-params.md)",
      "- [Branches & Orgs](sfdx-hardis-branches-and-orgs.md)",
      "- [Manifests](manifests.md)",
      ""
    ]);

    let sfdxHardisParamsLines = ["Available only in a [sfdx-hardis CI/CD project](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)"];
    let branchesAndOrgsLines = ["Available only in a [sfdx-hardis CI/CD project](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)"];
    if (fs.existsSync("config/.sfdx-hardis.yml")) {
      this.sfdxHardisConfig = await getConfig("project");
      // General sfdx-hardis config
      sfdxHardisParamsLines = this.buildSfdxHardisParams();
      // Branches & orgs
      branchesAndOrgsLines = await this.buildMajorBranchesAndOrgs();
    }
    await fs.writeFile(path.join(this.outputMarkdownRoot, "sfdx-hardis-params.md"), getMetaHideLines() + sfdxHardisParamsLines.join("\n") + `\n${this.footer}\n`);
    this.addNavNode("SFDX-Hardis Config", "sfdx-hardis-params.md");
    await fs.writeFile(path.join(this.outputMarkdownRoot, "sfdx-hardis-branches-and-orgs.md"), getMetaHideLines() + branchesAndOrgsLines.join("\n") + `\n${this.footer}\n`);
    this.addNavNode("Branches & Orgs", "sfdx-hardis-branches-and-orgs.md");

    // Object model Mermaid schema
    /* Disabled: too messy to read
    let mermaidSchema = await new ObjectModelBuilder().buildObjectsMermaidSchema();
    mermaidSchema = "```mermaid\n" + mermaidSchema + "\n```";
    await fs.writeFile(path.join(this.outputMarkdownRoot, "object-model.md"), getMetaHideLines() + mermaidSchema + `\n${this.footer}\n`);
    this.addNavNode("Object Model", "object-model.md");
    */

    // List SFDX packages and generate a manifest for each of them, except if there is only force-app with a package.xml
    this.packageXmlCandidates = DocBuilderPackageXML.listPackageXmlCandidates();
    await this.manageLocalPackages();
    const instanceUrl = flags?.['target-org']?.getConnection()?.instanceUrl;
    await this.generatePackageXmlMarkdown(this.packageXmlCandidates, instanceUrl);
    const { packageLines, packagesForMenu } = await DocBuilderPackageXML.buildIndexTable(this.outputPackageXmlMarkdownFiles);
    if (Object.keys(packagesForMenu).length > 0) {
      this.addNavNode("Manifests", packagesForMenu);
    }
    await fs.writeFile(path.join(this.outputMarkdownRoot, "manifests.md"), getMetaHideLines() + packageLines.join("\n") + `\n${this.footer}\n`);

    this.tempDir = await createTempDir()
    // Convert source to metadata API format to build prompts
    uxLog("action", this, c.cyan("Converting source to metadata API format to ease the build of LLM prompts."));
    await execCommand(`sf project convert source --metadata CustomObject --output-dir ${this.tempDir}`, this, { fail: true, output: true, debug: this.debugMode });
    this.objectFiles = (await glob("**/*.object", { cwd: this.tempDir, ignore: GLOB_IGNORE_PATTERNS }));
    sortCrossPlatform(this.objectFiles);
    this.allObjectsNames = this.objectFiles.map(object => path.basename(object, ".object"));

    // Generate packages documentation
    if (this.generatePackagesDoc) {
      await this.generatePackagesDocumentation();
    }

    // Generate Apex doc
    if (this.generateApexDoc) {
      await this.generateApexDocumentation();
    }

    // List flows & generate doc (Flows, Process Builder & Workflow rules)
    if (this.generateFlowDoc) {
      await this.generateFlowsDocumentation();
      await this.generateProcessBuilderDocumentation();
      await this.generateWorkflowRulesDocumentation();
    }

    // List pages & generate doc
    if (this.generatePagesDoc) {
      await this.generatePagesDocumentation();
    }

    // List profiles & generate doc
    if (this.generateProfilesDoc) {
      await this.generateProfilesDocumentation();
      await this.generatePermissionSetGroupsDocumentation();
      await this.generatePermissionSetsDocumentation();
      await this.generateRolesDocumentation();
    }

    // List objects & generate doc
    if (this.generateObjectsDoc) {
      await this.generateObjectsDocumentation();
    }

    if (this.generateAutomationsDoc) {
      // List approval processes & generate doc
      await this.generateApprovalProcessDocumentation();
      // List assignment rules and generate doc
      await this.generateAssignmentRulesDocumentation();
      // List auto response rules and generate doc
      await this.generateAutoResponseRulesDocumentation();
      // List escalation rules and generate doc
      await this.generateEscalationRulesDocumentation();
    }

    // List LWC & generate doc
    if (this.generateLwcDoc) {
      await this.generateLwcDocumentation();
    }

    // Write output index file
    await fs.ensureDir(path.dirname(this.outputMarkdownIndexFile));
    if (process.env.DO_NOT_OVERWRITE_INDEX_MD !== 'true' || !fs.existsSync(this.outputMarkdownIndexFile)) {
      await fs.writeFile(this.outputMarkdownIndexFile, getMetaHideLines() + this.mdLines.join("\n") + `\n\n${this.footer}\n`);
      uxLog("success", this, c.green(`Successfully generated doc index at ${this.outputMarkdownIndexFile}`));
    }

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
        uxLog("success", this, c.green(`Updated README.md to add link to docs/index.md`));
      }
    }

    await this.buildMkDocsYml();

    // Generate Excel file if requested
    if (this.withExcel) {
      await this.generateExcelFile();
    }

    // Delete files found in docs folder that contain characters not compliant with Windows file system
    // (e.g. /, \, :, *, ?, ", <, >, |)
    const filesToDelete = await glob("**/*", { cwd: this.outputMarkdownRoot, nodir: true });
    for (const file of filesToDelete) {
      const fileName = path.basename(file);
      if (fileName.includes("/") || fileName.includes("\\") || fileName.includes(":") || fileName.includes("*") || fileName.includes("?") || fileName.includes('"') || fileName.includes("<") || fileName.includes(">") || fileName.includes("|")) {
        const filePath = path.join(this.outputMarkdownRoot, file);
        uxLog("warning", this, c.yellow(`Deleting file ${filePath} because it contains characters not compliant with Windows file system`));
        await fs.remove(filePath);
      }
    }


    // Open file in a new VS Code tab if available
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(this.outputMarkdownIndexFile, "Project documentation Index", "report");
    }
    else {
      WebSocketClient.requestOpenFile(this.outputMarkdownIndexFile);
    }

    return { outputPackageXmlMarkdownFiles: this.outputPackageXmlMarkdownFiles };
  }

  private async generateApexDocumentation() {
    uxLog("action", this, c.cyan("Calling ApexDocGen to initialize Apex documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-apex-doc or define GENERATE_APEX_DOC=false");
    const tempDir = await createTempDir();
    uxLog("log", this, c.grey(`Using temp directory ${tempDir}`));
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
        // Copy files to apex folder
        const apexDocFolder = path.join(this.outputMarkdownRoot, "apex");
        await fs.ensureDir(apexDocFolder);
        const miscDir = path.join(tempDir, "miscellaneous");
        if (fs.existsSync(miscDir)) {
          await fs.copy(miscDir, apexDocFolder, { overwrite: true });
        }
        // Also copy triggers generated by ApexDocGen (they are in a separate "triggers" group folder)
        const triggersDir = path.join(tempDir, "triggers");
        if (fs.existsSync(triggersDir)) {
          await fs.copy(triggersDir, apexDocFolder, { overwrite: true });
        }
        uxLog("log", this, c.grey(`Generated markdown for Apex classes in ${apexDocFolder}`));
      }
      catch (e: any) {
        uxLog("warning", this, c.yellow(`Error generating Apex documentation: ${JSON.stringify(e, null, 2)}`));
        uxLog("log", this, c.grey(e.stack));
      }
      /*
      await ApexDocGen({
        sourceDir: packageDir.path,
        targetDir: tempDir,
        targetGenerator: "openapi"
      });
      */
    }
    const apexFiles = await listApexFiles(packageDirs);
    const apexClassNames = apexFiles.map(file => path.basename(file, ".cls").replace(".trigger", ""));

    // Build relationship between apex classes and objects
    for (const apexFile of apexFiles) {
      const apexName = path.basename(apexFile, ".cls").replace(".trigger", "");
      const apexContent = await fs.readFile(apexFile, "utf8");
      this.apexDescriptions.push({
        name: apexName,
        type: returnApexType(apexContent),
        impactedObjects: this.allObjectsNames.filter(objectName => apexContent.includes(`${objectName}`)),
        relatedClasses: apexClassNames.filter(name => apexContent.includes(`${name}`) && name !== apexName),
      });
    }

    // Complete generated documentation
    if (apexFiles.length === 0) {
      uxLog("log", this, c.yellow("No Apex class found in the project"));
      return;
    }
    const apexForMenu: any = { "All Apex Classes": "apex/index.md" }

    // Phase 1: Collect data and prepare work items
    type ApexWorkItem = { apexName: string; apexContent: string; mdFile: string; needsAi: boolean; apexMdContent: string; mermaidClassDiagram: string };
    const workItems: ApexWorkItem[] = [];
    for (const apexFile of apexFiles) {
      const apexName = path.basename(apexFile, ".cls").replace(".trigger", "");
      const apexContent = await fs.readFile(apexFile, "utf8");
      const mdFile = path.join(this.outputMarkdownRoot, "apex", apexName + ".md");
      if (fs.existsSync(mdFile)) {
        apexForMenu[apexName] = "apex/" + apexName + ".md";
        let apexMdContent = await fs.readFile(mdFile, "utf8");
        // Replace object links
        apexMdContent = apexMdContent.replaceAll("..\\custom-objects\\", "../objects/").replaceAll("../custom-objects/", "../objects/")
        // Add text before the first ##
        if (!["MetadataService"].includes(apexName) &&
          // Do not mess with existing apex doc if generation has crashed
          !apexMdContent.includes(getMetaHideLines())) {
          const mermaidClassDiagram = DocBuilderApex.buildMermaidClassDiagram(apexName, this.apexDescriptions);
          let insertion = `${mermaidClassDiagram}\n\n<!-- Apex description -->\n\n`;
          if (!this.hideApexCode) {
            insertion += `## Apex Code\n\n\`\`\`java\n${apexContent}\n\`\`\`\n\n`;
          }
          const firstHeading = apexMdContent.indexOf("## ");
          apexMdContent = apexMdContent.substring(0, firstHeading) + insertion + apexMdContent.substring(firstHeading);
          workItems.push({ apexName, apexContent, mdFile, needsAi: true, apexMdContent, mermaidClassDiagram });
        } else {
          workItems.push({ apexName, apexContent, mdFile, needsAi: false, apexMdContent: "", mermaidClassDiagram: "" });
        }
      } else if (apexFile.endsWith(".trigger")) {
        // Trigger files are not processed by ApexDocGen, so we create markdown from scratch
        apexForMenu[apexName] = "apex/" + apexName + ".md";
        await fs.ensureDir(path.join(this.outputMarkdownRoot, "apex"));
        const mermaidClassDiagram = DocBuilderApex.buildMermaidClassDiagram(apexName, this.apexDescriptions);
        let apexMdContent = `# ${apexName}\n\n`;
        if (mermaidClassDiagram) {
          apexMdContent += `${mermaidClassDiagram}\n\n`;
        }
        apexMdContent += `<!-- Apex description -->\n\n`;
        if (!this.hideApexCode) {
          apexMdContent += `## Apex Code\n\n\`\`\`java\n${apexContent}\n\`\`\`\n\n`;
        }
        workItems.push({ apexName, apexContent, mdFile, needsAi: true, apexMdContent, mermaidClassDiagram });
      }
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Apex documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        if (item.needsAi) {
          const apexDocBuilder = new DocBuilderApex(item.apexName, item.apexContent, "", {
            "CLASS_NAME": item.apexName,
            "APEX_CODE": item.apexContent
          });
          apexDocBuilder.markdownDoc = item.apexMdContent;
          const updatedContent = await apexDocBuilder.completeDocWithAiDescription();
          await fs.writeFile(item.mdFile, getMetaHideLines() + updatedContent);
        }
        uxLog("log", this, c.grey(`Generated markdown for Apex class ${item.apexName}`));
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(apexForMenu).length > 1) {
      this.addNavNode("Apex", apexForMenu);
    }

    // Write index file for apex folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "apex"));
    const apexIndexFile = path.join(this.outputMarkdownRoot, "apex", "index.md");
    await fs.writeFile(apexIndexFile, getMetaHideLines() + DocBuilderApex.buildIndexTable('', this.apexDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generatePackagesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Installed Packages documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-packages-doc or define GENERATE_PACKAGES_DOC=false");

    const packagesForMenu: any = { "All Packages": "packages/index.md" }
    // List packages
    const packages = this.sfdxHardisConfig.installedPackages || [];     // CI/CD context
    const packageFolder = path.join(process.cwd(), 'installedPackages');     // Monitoring context
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

    if (packages.length === 0) {
      uxLog("log", this, c.yellow("No installed package found in the project"));
      return;
    }

    // Phase 1: Collect data and prepare work items
    WebSocketClient.sendProgressStartMessage("Collecting Installed Packages data and preparing work items...", packages.length);
    const workItems: { packageName: string; mdFile: string; pckg: any; packageMetadatas: string; tmpOutput: string; mdFileBad: string }[] = [];
    let counter = 0;
    for (const pckg of packages) {
      const packageName = pckg.SubscriberPackageName;
      const mdFile = path.join(this.outputMarkdownRoot, "packages", makeFileNameGitCompliant(packageName) + ".md");
      packagesForMenu[packageName] = "packages/" + makeFileNameGitCompliant(packageName) + ".md";
      this.packageDescriptions.push({
        name: packageName,
        namespace: pckg.SubscriberPackageNamespace || "None",
        versionNumber: pckg.SubscriberPackageVersionNumber || "Unknown",
        versionName: pckg.SubscriberPackageVersionName || "Unknown",
        versionId: pckg.SubscriberPackageVersionId || "Unknown",
      });
      let packageMetadatas = "Unable to list package Metadatas";
      const packageWithAllMetadatas = path.join(process.cwd(), "manifest", "package-all-org-items.xml");
      const tmpOutput = path.join(this.tempDir, pckg.SubscriberPackageVersionId + ".xml");
      if (fs.existsSync(packageWithAllMetadatas) && pckg.SubscriberPackageNamespace) {
        const filterRes = await filterPackageXml(packageWithAllMetadatas, tmpOutput, { keepOnlyNamespaces: [pckg.SubscriberPackageNamespace] })
        if (filterRes.updated) {
          packageMetadatas = await fs.readFile(tmpOutput, "utf8");
        }
      }
      const mdFileBad = path.join(this.outputMarkdownRoot, "packages", packageName + ".md");
      workItems.push({ packageName, mdFile, pckg, packageMetadatas, tmpOutput, mdFileBad });
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, packages.length);
    }
    WebSocketClient.sendProgressEndMessage();

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Installed Packages documentation...", workItems.length);
    counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderPackage(makeFileNameGitCompliant(item.packageName), item.pckg, item.mdFile, {
          "PACKAGE_METADATAS": item.packageMetadatas,
          "PACKAGE_FILE": item.tmpOutput
        }).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        // Recovery to save git repos: Kill existing file if it has been created with forbidden characters
        if (item.mdFileBad !== item.mdFile && fs.existsSync(item.mdFileBad)) {
          await fs.remove(item.mdFileBad);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(packagesForMenu).length > 1) {
      this.addNavNode("Packages", packagesForMenu);
    }
    // Write index file for packages folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "packages"));
    const packagesIndexFile = path.join(this.outputMarkdownRoot, "packages", "index.md");
    await fs.writeFile(packagesIndexFile, getMetaHideLines() + DocBuilderPackage.buildIndexTable('', this.packageDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generatePagesDocumentation() {
    const packageDirs = this.project?.getPackageDirectories() || [];
    const pageFiles = await listPageFiles(packageDirs);
    const pagesForMenu: any = { "All Lightning pages": "pages/index.md" }

    // Phase 1: Collect data and prepare work items
    const workItems: { pageName: string; mdFile: string; pageXml: string }[] = [];
    for (const pagefile of pageFiles) {
      const pageName = path.basename(pagefile, ".flexipage-meta.xml");
      const mdFile = path.join(this.outputMarkdownRoot, "pages", pageName + ".md");
      pagesForMenu[pageName] = "pages/" + pageName + ".md";
      const pageXml = await fs.readFile(pagefile, "utf8");
      const pageXmlParsed = new XMLParser().parse(pageXml);
      this.pageDescriptions.push({
        name: pageName,
        type: prettifyFieldName(pageXmlParsed?.FlexiPage?.type || "Unknown"),
        impactedObjects: this.allObjectsNames.filter(objectName => pageXml.includes(`${objectName}`))
      });
      workItems.push({ pageName, mdFile, pageXml });
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Lightning Pages documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderPage(item.pageName, item.pageXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(pagesForMenu).length > 1) {
      this.addNavNode("Lightning Pages", pagesForMenu);
    }

    // Write index file for pages folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "pages"));
    const pagesIndexFile = path.join(this.outputMarkdownRoot, "pages", "index.md");
    await fs.writeFile(pagesIndexFile, getMetaHideLines() + DocBuilderPage.buildIndexTable('', this.pageDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generateProfilesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Profiles documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-profiles-doc or define GENERATE_PROFILES_DOC=false");
    const profilesForMenu: any = { "All Profiles": "profiles/index.md" };
    const profilesFiles = (await glob("**/profiles/**.profile-meta.xml", { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS }));
    sortCrossPlatform(profilesFiles);
    if (profilesFiles.length === 0) {
      uxLog("log", this, c.yellow("No profile found in the project"));
      return;
    }

    // Phase 1: Collect data and prepare work items
    const workItems: { profileName: string; mdFile: string; profileXml: string }[] = [];
    for (const profileFile of profilesFiles) {
      const profileName = path.basename(profileFile, ".profile-meta.xml");
      const mdFile = path.join(this.outputMarkdownRoot, "profiles", profileName + ".md");
      profilesForMenu[profileName] = "profiles/" + profileName + ".md";
      const profileXml = await fs.readFile(profileFile, "utf8");
      const profileXmlParsed = new XMLParser().parse(profileXml);
      this.profileDescriptions.push({
        name: profileName,
        userLicense: prettifyFieldName(profileXmlParsed?.Profile?.userLicense || "Unknown"),
        impactedObjects: this.allObjectsNames.filter(objectName => profileXml.includes(`${objectName}`))
      });
      workItems.push({ profileName, mdFile, profileXml });
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Profiles documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderProfile(item.profileName, item.profileXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(profilesForMenu).length > 1) {
      this.addNavNode("Profiles", profilesForMenu);
    }
    // Write index file for profiles folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "profiles"));
    const profilesIndexFile = path.join(this.outputMarkdownRoot, "profiles", "index.md");
    await fs.writeFile(profilesIndexFile, getMetaHideLines() + DocBuilderProfile.buildIndexTable('', this.profileDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generatePermissionSetsDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Permission Sets documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-profiles-doc or define GENERATE_PROFILES_DOC=false");
    const psForMenu: any = { "All Permission Sets": "permissionsets/index.md" };
    const psFiles = (await glob("**/permissionsets/**.permissionset-meta.xml", { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS }));
    sortCrossPlatform(psFiles);
    if (psFiles.length === 0) {
      uxLog("log", this, c.yellow("No permission set found in the project"));
      return;
    }

    // Phase 1: Collect data and prepare work items
    const workItems: { psName: string; mdFile: string; psXml: string }[] = [];
    for (const psFile of psFiles) {
      const psName = path.basename(psFile, ".permissionset-meta.xml");
      const mdFile = path.join(this.outputMarkdownRoot, "permissionsets", psName + ".md");
      psForMenu[psName] = "permissionsets/" + psName + ".md";
      const psXml = await fs.readFile(psFile, "utf8");
      const psXmlParsed = new XMLParser().parse(psXml);
      this.permissionSetsDescriptions.push({
        name: psName,
        userLicense: prettifyFieldName(psXmlParsed?.PermissionSet?.license || "Unknown"),
        impactedObjects: this.allObjectsNames.filter(objectName => psXml.includes(`${objectName}`))
      });
      workItems.push({ psName, mdFile, psXml });
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Permission Sets documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderPermissionSet(item.psName, item.psXml, item.mdFile).generateMarkdownFileFromXml();
        // Permission Set Groups Table
        const relatedPsg = DocBuilderPermissionSetGroup.buildIndexTable('../permissionsetgroups/', this.permissionSetGroupsDescriptions, item.psName);
        await replaceInFile(item.mdFile, '<!-- Permission Set Groups table -->', relatedPsg.join("\n"));
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(psForMenu).length > 1) {
      this.addNavNode("Permission Sets", psForMenu);
    }
    // Write index file for permission sets folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "permissionsets"));
    const psIndexFile = path.join(this.outputMarkdownRoot, "permissionsets", "index.md");
    await fs.writeFile(psIndexFile, getMetaHideLines() + DocBuilderPermissionSet.buildIndexTable('', this.permissionSetsDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generatePermissionSetGroupsDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Permission Set Groups documentation..."));
    const psgForMenu: any = { "All Permission Set Groups": "permissionsetgroups/index.md" };
    const psgFiles = (await glob("**/permissionsetgroups/**.permissionsetgroup-meta.xml", { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS }))
    sortCrossPlatform(psgFiles);
    if (psgFiles.length === 0) {
      uxLog("log", this, c.yellow("No permission set group found in the project"));
      return;
    }

    // Phase 1: Collect data and prepare work items
    const workItems: { psgName: string; mdFile: string; psgXml: string }[] = [];
    for (const psgFile of psgFiles) {
      const psgName = path.basename(psgFile, ".permissionsetgroup-meta.xml");
      const mdFile = path.join(this.outputMarkdownRoot, "permissionsetgroups", psgName + ".md");
      psgForMenu[psgName] = "permissionsetgroups/" + psgName + ".md";
      const psgXml = await fs.readFile(psgFile, "utf8");
      const psgXmlParsed = new XMLParser().parse(psgXml);
      let permissionSets = psgXmlParsed?.PermissionSetGroup?.permissionSets || [];
      if (!Array.isArray(permissionSets)) {
        permissionSets = [permissionSets];
      }
      this.permissionSetGroupsDescriptions.push({
        name: psgName,
        description: psgXmlParsed?.PermissionSetGroup?.description || "None",
        relatedPermissionSets: permissionSets,
      });
      workItems.push({ psgName, mdFile, psgXml });
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Permission Set Groups documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderPermissionSetGroup(item.psgName, item.psgXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(psgForMenu).length > 1) {
      this.addNavNode("Permission Set Groups", psgForMenu);
    }

    // Write index file for permission set groups folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "permissionsetgroups"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "permissionsetgroups", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderPermissionSetGroup.buildIndexTable('', this.permissionSetGroupsDescriptions).join("\n") + `\n${this.footer}\n`);
  }

  private async generateRolesDocumentation() {
    uxLog("action", this, c.cyan("Generating Roles documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-profiles-doc or define GENERATE_PROFILES_DOC=false");
    const roleFiles = (await glob("**/roles/**.role-meta.xml", { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS }));
    sortCrossPlatform(roleFiles);
    if (roleFiles.length === 0) {
      uxLog("log", this, c.yellow("No role found in the project"));
      return;
    }
    for (const roleFile of roleFiles) {
      const roleApiName = path.basename(roleFile, ".role-meta.xml");
      const roleXml = await fs.readFile(roleFile, "utf8");
      const roleXmlParsed = new XMLParser().parse(roleXml);
      // build object with all XML root tags
      const roleInfo = { apiName: roleApiName };
      for (const roleAttribute of Object.keys(roleXmlParsed?.Role || {})) {
        roleInfo[roleAttribute] = roleXmlParsed?.Role[roleAttribute] || "";
      }

      this.roleDescriptions.push(roleInfo);
    }
    if (this.roleDescriptions.length > 0) {
      this.addNavNode("Roles", "roles.md");
    }

    // Add Roles documentation
    const rolesIndexFile = path.join(this.outputMarkdownRoot, "roles.md");
    await DocBuilderRoles.generateMarkdownFileFromRoles(this.roleDescriptions, rolesIndexFile);
    if (this.withPdf) {
      await generatePdfFileFromMarkdown(rolesIndexFile);
    }
  }


  private async generateAssignmentRulesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Assignment Rules documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-automations-doc or define GENERATE_AUTOMATIONS_DOC=false");

    const assignmentRulesForMenu: any = { "All Assignment Rules": "assignmentRules/index.md" };
    const assignmentRulesFiles = (await glob("**/assignmentRules/**.assignmentRules-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(assignmentRulesFiles);
    const builder = new XMLBuilder();

    // Phase 1: Collect data and prepare work items
    const workItems: { currentRuleName: string; mdFile: string; ruleXml: string }[] = [];
    for (const assignmentRulesFile of assignmentRulesFiles) {
      const assignmentRulesXml = await fs.readFile(assignmentRulesFile, "utf8");
      const assignmentRulesXmlParsed = new XMLParser().parse(assignmentRulesXml);
      const assignmentRulesName = path.basename(assignmentRulesFile, ".assignmentRules-meta.xml");
      let rulesList = assignmentRulesXmlParsed?.AssignmentRules?.assignmentRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }
      for (const rule of rulesList) {
        const currentRuleName = assignmentRulesName + "." + rule?.fullName;
        assignmentRulesForMenu[currentRuleName] = "assignmentRules/" + currentRuleName + ".md";
        const mdFile = path.join(this.outputMarkdownRoot, "assignmentRules", currentRuleName + ".md");
        this.assignmentRulesDescriptions.push({
          name: currentRuleName,
          active: rule.active,
        });
        const ruleXml = builder.build({ assignmentRule: rule });
        workItems.push({ currentRuleName, mdFile, ruleXml });
      }
    }

    if (workItems.length === 0) {
      uxLog("log", this, c.yellow("No assignment rule found in the project"));
      return;
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Assignment Rules documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderAssignmentRules(item.currentRuleName, item.ruleXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();

    if (Object.keys(assignmentRulesForMenu).length > 1) {
      this.addNavNode("Assignment Rules", assignmentRulesForMenu);
    }

    await fs.ensureDir(path.join(this.outputMarkdownRoot, "assignmentRules"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "assignmentRules", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderAssignmentRules.buildIndexTable('', this.assignmentRulesDescriptions).join("\n") + `\n${this.footer}\n`);
  }

  private async generateApprovalProcessDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Approval Processes documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-automations-doc or define GENERATE_AUTOMATIONS_DOC=false");

    const approvalProcessesForMenu: any = { "All Approval Processes": "approvalProcesses/index.md" }
    const approvalProcessFiles = (await glob("**/approvalProcesses/**.approvalProcess-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(approvalProcessFiles);

    if (approvalProcessFiles.length === 0) {
      uxLog("log", this, c.yellow("No approval process found in the project"));
      return;
    }

    // Phase 1: Collect data and prepare work items
    const workItems: { approvalProcessName: string; mdFile: string; approvalProcessXml: string }[] = [];
    for (const approvalProcessFile of approvalProcessFiles) {
      const approvalProcessName = path.basename(approvalProcessFile, ".approvalProcess-meta.xml");
      const mdFile = path.join(this.outputMarkdownRoot, "approvalProcesses", approvalProcessName + ".md");
      approvalProcessesForMenu[approvalProcessName] = "approvalProcesses/" + approvalProcessName + ".md";
      const approvalProcessXml = await fs.readFile(approvalProcessFile, "utf8");
      const approvalProcessXmlParsed = new XMLParser().parse(approvalProcessXml);
      this.approvalProcessesDescriptions.push({
        name: approvalProcessName,
        active: approvalProcessXmlParsed?.ApprovalProcess?.active,
        impactedObjects: this.allObjectsNames.filter(objectName => approvalProcessXml.includes(`${objectName}`))
      });
      workItems.push({ approvalProcessName, mdFile, approvalProcessXml });
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Approval Processes documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderApprovalProcess(item.approvalProcessName, item.approvalProcessXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();

    if (Object.keys(approvalProcessesForMenu).length > 1) {
      this.addNavNode("Approval Processes", approvalProcessesForMenu);
    }
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "approvalProcesses"));
    const approvalProcessesIndexFile = path.join(this.outputMarkdownRoot, "approvalProcesses", "index.md");
    await fs.writeFile(approvalProcessesIndexFile, getMetaHideLines() + DocBuilderApprovalProcess.buildIndexTable('', this.approvalProcessesDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generateAutoResponseRulesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of AutoResponse Rules documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-automations-doc or define GENERATE_AUTOMATIONS_DOC=false");

    const autoResponseRulesForMenu: any = { "All AutoResponse Rules": "autoResponseRules/index.md" };
    const autoResponseRulesFiles = (await glob("**/autoResponseRules/**.autoResponseRules-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(autoResponseRulesFiles);
    const builder = new XMLBuilder();

    // Phase 1: Collect data and prepare work items
    const workItems: { currentRuleName: string; mdFile: string; ruleXml: string }[] = [];
    for (const autoResponseRulesFile of autoResponseRulesFiles) {
      const autoResponseRulesXml = await fs.readFile(autoResponseRulesFile, "utf8");
      const autoResponseRulesXmlParsed = new XMLParser().parse(autoResponseRulesXml);
      const autoResponseRulesName = path.basename(autoResponseRulesFile, ".autoResponseRules-meta.xml");
      let rulesList = autoResponseRulesXmlParsed?.AutoResponseRules?.autoResponseRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }
      for (const rule of rulesList) {
        const currentRuleName = autoResponseRulesName + "." + rule?.fullName;
        autoResponseRulesForMenu[currentRuleName] = "autoResponseRules/" + currentRuleName + ".md";
        const mdFile = path.join(this.outputMarkdownRoot, "autoResponseRules", currentRuleName + ".md");
        this.autoResponseRulesDescriptions.push({
          name: currentRuleName,
          active: rule.active,
        });
        const ruleXml = builder.build({ autoResponseRule: rule });
        workItems.push({ currentRuleName, mdFile, ruleXml });
      }
    }

    if (workItems.length === 0) {
      uxLog("log", this, c.yellow("No auto-response rules found in the project"));
      return;
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating AutoResponse Rules documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderAutoResponseRules(item.currentRuleName, item.ruleXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(autoResponseRulesForMenu).length > 1) {
      this.addNavNode("AutoResponse Rules", autoResponseRulesForMenu);
    }

    // Write index file for permission set groups folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "autoResponseRules"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "autoResponseRules", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderAutoResponseRules.buildIndexTable('', this.autoResponseRulesDescriptions).join("\n") + `\n${this.footer}\n`);
  }

  private async generateEscalationRulesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Escalation Rules documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-automations-doc or define GENERATE_AUTOMATIONS_DOC=false");

    const escalationRulesForMenu: any = { "All Escalation Rules": "escalationRules/index.md" };
    const escalationRulesFiles = (await glob("**/escalationRules/**.escalationRules-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(escalationRulesFiles);
    const builder = new XMLBuilder();

    // Phase 1: Collect data and prepare work items
    const workItems: { currentRuleName: string; mdFile: string; ruleXml: string }[] = [];
    for (const escalationRulesFile of escalationRulesFiles) {
      const escalationRulesXml = await fs.readFile(escalationRulesFile, "utf8");
      const escalationRulesXmlParsed = new XMLParser().parse(escalationRulesXml);
      const escalationRulesName = path.basename(escalationRulesFile, ".escalationRules-meta.xml");
      let rulesList = escalationRulesXmlParsed?.EscalationRules?.escalationRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }
      for (const rule of rulesList) {
        const currentRuleName = escalationRulesName + "." + rule?.fullName;
        escalationRulesForMenu[currentRuleName] = "escalationRules/" + currentRuleName + ".md";
        const mdFile = path.join(this.outputMarkdownRoot, "escalationRules", currentRuleName + ".md");
        this.escalationRulesDescriptions.push({
          name: currentRuleName,
          active: rule.active,
        });
        const ruleXml = builder.build({ escalationRule: rule });
        workItems.push({ currentRuleName, mdFile, ruleXml });
      }
    }

    if (workItems.length === 0) {
      uxLog("log", this, c.yellow("No escalation rules found in the project"));
      return;
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Escalation Rules documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderEscalationRules(item.currentRuleName, item.ruleXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();

    if (Object.keys(escalationRulesForMenu).length > 1) {
      this.addNavNode("Escalation Rules", escalationRulesForMenu);
    }

    await fs.ensureDir(path.join(this.outputMarkdownRoot, "escalationRules"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "escalationRules", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderEscalationRules.buildIndexTable('', this.escalationRulesDescriptions).join("\n") + `\n${this.footer}\n`);
  }

  private async generateWorkflowRulesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Workflow Rules documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-automations-doc or define GENERATE_AUTOMATIONS_DOC=false");

    const workflowRulesForMenu: any = { "All Workflow Rules": "workflowRules/index.md" };
    const workflowRulesFiles = (await glob("**/workflows/**.workflow-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(workflowRulesFiles);
    const builder = new XMLBuilder();

    if (workflowRulesFiles.length === 0) {
      uxLog("log", this, c.yellow("No workflow rule found in the project"));
      return;
    }

    const workItems: { ruleName: string; mdFile: string; ruleXml: string }[] = [];
    for (const workflowFile of workflowRulesFiles) {
      const workflowXml = await fs.readFile(workflowFile, "utf8");
      const workflowXmlParsed = new XMLParser().parse(workflowXml);
      const workflowObjectName = path.basename(workflowFile, ".workflow-meta.xml");
      let rulesList = workflowXmlParsed?.Workflow?.rules || workflowXmlParsed?.Workflow?.workflowRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }

      for (const rule of rulesList) {
        const ruleName = rule?.fullName || rule?.name || "Unnamed";
        const displayName = `${workflowObjectName}.${ruleName}`;
        const fileName = makeFileNameGitCompliant(displayName);
        const mdFile = path.join(this.outputMarkdownRoot, "workflowRules", fileName + ".md");
        workflowRulesForMenu[displayName] = "workflowRules/" + fileName + ".md";
        this.workflowRulesDescriptions.push({
          name: displayName,
          fileName,
          active: rule?.active,
          object: workflowObjectName,
          impactedObjects: [workflowObjectName]
        });
        const ruleXml = builder.build({ workflowRule: rule });
        workItems.push({ ruleName: displayName, mdFile, ruleXml });
      }
    }

    if (workItems.length === 0) {
      uxLog("log", this, c.yellow("No workflow rule found in the project"));
      return;
    }

    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Workflow Rules documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderWorkflowRule(item.ruleName, item.ruleXml, item.mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();

    if (Object.keys(workflowRulesForMenu).length > 1) {
      this.addNavNode("Workflow Rules", workflowRulesForMenu);
    }

    await fs.ensureDir(path.join(this.outputMarkdownRoot, "workflowRules"));
    const workflowRulesIndexFile = path.join(this.outputMarkdownRoot, "workflowRules", "index.md");
    await fs.writeFile(
      workflowRulesIndexFile,
      getMetaHideLines() + DocBuilderWorkflowRule.buildIndexTable('', this.workflowRulesDescriptions).join("\n") + `\n${this.footer}\n`
    );
  }

  private async generateProcessBuilderDocumentation() {
    const processBuilders = this.flowDescriptions.filter(flow => flow.processType === "Workflow");
    if (processBuilders.length === 0) {
      uxLog("log", this, c.yellow("No process builder found in the project"));
      return;
    }

    uxLog("action", this, c.cyan("Generating Process Builder documentation..."));

    if (Object.keys(this.processBuildersForMenu).length > 1) {
      this.addNavNode("Process Builders", this.processBuildersForMenu);
    }

    await fs.ensureDir(path.join(this.outputMarkdownRoot, "processBuilders"));
    const indexLines = DocBuilderFlow.buildIndexTable('../flows/', processBuilders, this.outputMarkdownRoot);
    const processBuildersIndexFile = path.join(this.outputMarkdownRoot, "processBuilders", "index.md");
    await fs.writeFile(processBuildersIndexFile, getMetaHideLines() + indexLines.join("\n") + `\n${this.footer}\n`);
    if (this.withPdf) {
      await generatePdfFileFromMarkdown(processBuildersIndexFile);
    }
  }

  private async buildMkDocsYml() {
    // Copy default files (mkdocs.yml and other files can be updated by the SF Cli plugin developer later)
    const mkdocsYmlFile = path.join(process.cwd(), 'mkdocs.yml');
    const mkdocsYmlFileExists = fs.existsSync(mkdocsYmlFile);
    await fs.copy(path.join(PACKAGE_ROOT_DIR, 'defaults/mkdocs-project-doc', '.'), process.cwd(), { overwrite: false });
    if (!mkdocsYmlFileExists) {
      uxLog("log", this, c.grey('Base mkdocs files copied in your Salesforce project repo'));
      uxLog(
        "warning",
        this,
        c.yellow(
          'You should probably manually update mkdocs.yml to add your own configuration, like theme, site_name, etc.'
        )
      );
    }
    // Update mkdocs nav items
    const mkdocsYml: any = readMkDocsFile(mkdocsYmlFile);

    for (const navMenu of this.mkDocsNavNodes) {
      let pos = 0;
      let found = false;
      for (const navItem of mkdocsYml.nav) {
        if (Object.keys(navItem)[0] === Object.keys(navMenu)[0]) {
          found = true;
          break;
        }
        pos++;
      }
      if (found) {
        mkdocsYml.nav[pos] = navMenu;
      } else {
        mkdocsYml.nav.push(navMenu);
      }
    }
    // Add missing javascripts if necessary
    const allJavascripts = [
      "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.4/jquery.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jstree/3.3.12/jstree.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/tablesort/5.2.1/tablesort.min.js",
      "javascripts/tables.js",
      "javascripts/gtag.js",
      "javascripts/jstree-handler.js"
    ];
    const extraJavascript = mkdocsYml.extra_javascript || [];
    for (const jsItem of allJavascripts) {
      if (!extraJavascript.includes(jsItem)) {
        extraJavascript.push(jsItem);
      }
    }
    mkdocsYml.extra_javascript = extraJavascript;

    // Add missing CSS if necessary
    const allCss = [
      "https://cdnjs.cloudflare.com/ajax/libs/jstree/3.3.12/themes/default/style.min.css",
      "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css",
      "stylesheets/extra.css",
      "stylesheets/jstree-custom.css"
    ];
    const extraCss = mkdocsYml.extra_css || [];
    for (const cssItem of allCss) {
      if (!extraCss.includes(cssItem)) {
        extraCss.push(cssItem);
      }
    }
    mkdocsYml.extra_css = extraCss;

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

    // Remove deprecated items if found
    mkdocsYml.nav = mkdocsYml.nav.filter(navItem => !navItem["Flows History"]);
    mkdocsYml.nav = mkdocsYml.nav.filter(navItem => !navItem["Installed Packages"]);

    // Add root menus
    const rootSections = [
      { menu: "Automations", subMenus: ["Approval Processes", "Assignment Rules", "AutoResponse Rules", "Escalation Rules", "Flows", "Process Builders", "Workflow Rules"] },
      { menu: "Authorizations", subMenus: ["Profiles", "Permission Set Groups", "Permission Sets"] },
      { menu: "Code", subMenus: ["Apex", "Lightning Web Components"] },
    ];
    for (const rootSection of rootSections) {
      const navSubmenus: any[] = [];
      for (const subMenu of rootSection.subMenus) {
        // Find submenu
        const subMenuContent = mkdocsYml.nav.find(navItem => Object.keys(navItem)[0] === subMenu);
        if (subMenuContent) {
          navSubmenus.push(subMenuContent);
        }
        // Remove sub menus from root menus
        mkdocsYml.nav = mkdocsYml.nav.filter(navItem => !navItem[subMenu]);
      }
      // Check if rootSection.menu already exists in nav
      const existingRootMenuIndex = mkdocsYml.nav.findIndex(navItem => Object.keys(navItem)[0] === rootSection.menu);
      if (existingRootMenuIndex > -1) {
        // Append new submenus to existing root menu
        const existingSubMenus = mkdocsYml.nav[existingRootMenuIndex][rootSection.menu];
        const uniqueSubMenus = new Map();
        for (const item of [...existingSubMenus, ...navSubmenus]) {
          const key = Object.keys(item)[0];
          if (!uniqueSubMenus.has(key) || navSubmenus.some(navItem => Object.keys(navItem)[0] === key)) {
            uniqueSubMenus.set(key, item);
          }
        }
        mkdocsYml.nav[existingRootMenuIndex][rootSection.menu] = Array.from(uniqueSubMenus.values()).sort((a, b) => {
          const keyA = Object.keys(a)[0].toLowerCase();
          const keyB = Object.keys(b)[0].toLowerCase();
          return keyA.localeCompare(keyB, 'en', { sensitivity: 'base' });
        });
      }
      else {
        // Add root menu with submenus
        mkdocsYml.nav.push({ [rootSection.menu]: navSubmenus });
      }
    }

    // Order nav items with this elements in first
    const firstItemsInOrder = [
      "Home",
      // "Object Model",
      "Objects",
      "Automations",
      "Authorizations",
      "Code",
      "Lightning Pages",
      "Packages",
      "Roles",
      "SFDX-Hardis Config",
      "Branches & Orgs",
      "Manifests"
    ];
    mkdocsYml.nav = firstItemsInOrder.map(item => mkdocsYml.nav.find(navItem => Object.keys(navItem)[0] === item)).filter(item => item).concat(mkdocsYml.nav.filter(navItem => !firstItemsInOrder.includes(Object.keys(navItem)[0])));


    // Update mkdocs file
    await writeMkDocsFile(mkdocsYmlFile, mkdocsYml);
    uxLog("action", this, c.cyan(`To generate a HTML WebSite with this documentation with a single command, see instructions at ${CONSTANTS.DOC_URL_ROOT}/hardis/doc/project2markdown/`));
  }

  private async generateObjectsDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Objects AI documentation..."));
    uxLog("log", this, "If you don't want it, use --no-generate-objects-doc or define GENERATE_OBJECTS_DOC=false");

    const objectLinksInfo = await this.generateLinksInfo();
    const objectsForMenu: any = { "All objects": "objects/index.md" }
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "objects"));

    // Phase 1: Collect data and prepare work items
    type ObjectWorkItem = { objectName: string; objectXml: string; objectMdFile: string; objectXmlParsed: any; skip: boolean };
    const workItems: ObjectWorkItem[] = [];
    for (const objectFile of this.objectFiles) {
      const objectName = path.basename(objectFile, ".object");
      if ((objectName.endsWith("__dlm") || objectName.endsWith("__dll")) && !(process.env?.INCLUDE_DATA_CLOUD_DOC === "true")) {
        workItems.push({ objectName, objectXml: "", objectMdFile: "", objectXmlParsed: null, skip: true });
        continue;
      }
      const objectXml = (await fs.readFile(path.join(this.tempDir, objectFile), "utf8")).toString();
      const objectMdFile = path.join(this.outputMarkdownRoot, "objects", objectName + ".md");
      const objectXmlParsed = new XMLParser().parse(objectXml);
      objectsForMenu[objectName] = "objects/" + objectName + ".md";
      this.objectDescriptions.push({
        name: objectName,
        label: objectXmlParsed?.CustomObject?.label || "",
        description: String(objectXmlParsed?.CustomObject?.description || ""),
      });
      workItems.push({ objectName, objectXml, objectMdFile, objectXmlParsed, skip: false });
    }
    uxLog("log", this, `Skipped ${workItems.filter(item => item.skip).length} Data Cloud objects from documentation generation (define variable INCLUDE_DATA_CLOUD_DOC=true to include them)`);

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Objects documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        if (item.skip) {
          counter++;
          WebSocketClient.sendProgressStepMessage(counter, workItems.length);
          return;
        }
        uxLog("log", this, c.grey(`Generating markdown for Object ${item.objectName}...`));
        // Main AI markdown
        await new DocBuilderObject(
          item.objectName,
          item.objectXml,
          item.objectMdFile, {
          "ALL_OBJECTS_LIST": this.allObjectsNames.join(","),
          "ALL_OBJECT_LINKS": objectLinksInfo
        }).generateMarkdownFileFromXml();
        // Fields table
        await this.buildAttributesTables(item.objectName, item.objectXmlParsed, item.objectMdFile);
        // Mermaid schema
        const mermaidSchema = await new ObjectModelBuilder(item.objectName).buildObjectsMermaidSchema();
        await replaceInFile(item.objectMdFile, '<!-- Mermaid schema -->', '## Schema\n\n```mermaid\n' + mermaidSchema + '\n```\n');
        if (this.withPdf) {
          /** Regenerate using Mermaid CLI to convert Mermaid code into SVG */
          await generateMarkdownFileWithMermaid(item.objectMdFile, item.objectMdFile, null, true);
        }
        // Flows Table
        const nonProcessBuilderFlows = this.flowDescriptions.filter(flow => flow.processType !== "Workflow");
        const relatedObjectFlowsTable = DocBuilderFlow.buildIndexTable('../flows/', nonProcessBuilderFlows, this.outputMarkdownRoot, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- Flows table -->', relatedObjectFlowsTable.join("\n"));
        // Process Builders Table
        const processBuilderFlows = this.flowDescriptions.filter(flow => flow.processType === "Workflow");
        const relatedProcessBuildersTable = DocBuilderFlow.buildIndexTable('../flows/', processBuilderFlows, this.outputMarkdownRoot, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- Process Builders table -->', relatedProcessBuildersTable.join("\n"));
        // Apex Table
        const relatedApexTable = DocBuilderApex.buildIndexTable('../apex/', this.apexDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- Apex table -->', relatedApexTable.join("\n"));
        // Lightning Pages table
        const relatedPages = DocBuilderPage.buildIndexTable('../pages/', this.pageDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- Pages table -->', relatedPages.join("\n"));
        // Add Profiles table
        const relatedProfilesTable = DocBuilderProfile.buildIndexTable('../profiles/', this.profileDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- Profiles table -->', relatedProfilesTable.join("\n"));
        // Add Permission Sets table
        const relatedPermissionSetsTable = DocBuilderPermissionSet.buildIndexTable('../permissionsets/', this.permissionSetsDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- PermissionSets table -->', relatedPermissionSetsTable.join("\n"));
        // Add Approval Processes table
        const relatedApprovalProcessTable = DocBuilderApprovalProcess.buildIndexTable('../approvalProcesses/', this.approvalProcessesDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- ApprovalProcess table -->', relatedApprovalProcessTable.join("\n"));
        // Assignment Rules table
        const relatedAssignmentRulesTable = DocBuilderAssignmentRules.buildIndexTable('../assignmentRules/', this.assignmentRulesDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- AssignmentRules table -->', relatedAssignmentRulesTable.join("\n"));
        // AutoResponse Rules table
        const relatedAutoResponseRulesTable = DocBuilderAutoResponseRules.buildIndexTable('../autoResponseRules/', this.autoResponseRulesDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- AutoResponseRules table -->', relatedAutoResponseRulesTable.join("\n"));
        // Escalation Rules table
        const relatedEscalationRulesTable = DocBuilderEscalationRules.buildIndexTable('../escalationRules/', this.escalationRulesDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- EscalationRules table -->', relatedEscalationRulesTable.join("\n"));
        // Workflow Rules table
        const relatedWorkflowRulesTable = DocBuilderWorkflowRule.buildIndexTable('../workflowRules/', this.workflowRulesDescriptions, item.objectName);
        await replaceInFile(item.objectMdFile, '<!-- Workflow Rules table -->', relatedWorkflowRulesTable.join("\n"));

        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.objectMdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    if (Object.keys(objectsForMenu).length > 1) {
      this.addNavNode("Objects", objectsForMenu);
    }

    // Write index file for objects folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "objects"));
    const objectsTableLinesForIndex = DocBuilderObject.buildIndexTable('', this.objectDescriptions);
    const objectsIndexFile = path.join(this.outputMarkdownRoot, "objects", "index.md");
    await fs.writeFile(objectsIndexFile, getMetaHideLines() + objectsTableLinesForIndex.join("\n") + `\n${this.footer}\n`);
  }

  private async buildAttributesTables(objectName: string, objectXmlParsed: any, objectMdFile: string) {
    const fieldsTable = DocBuilderObject.buildCustomFieldsTable(objectXmlParsed?.CustomObject?.fields || []);
    const validationRulesTable = DocBuilderObject.buildValidationRulesTable(objectXmlParsed?.CustomObject?.validationRules || []);
    const attributesLines = [...fieldsTable, ...validationRulesTable];
    const attributesMarkdown = await completeAttributesDescriptionWithAi(attributesLines.join("\n"), objectName)
    await replaceInFile(objectMdFile, '<!-- Attributes tables -->', attributesMarkdown);
  }

  private async generateLinksInfo(): Promise<string> {
    uxLog("log", this, c.cyan("Generate MasterDetail and Lookup infos to provide context to AI prompt"));
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
    uxLog("action", this, c.cyan("Preparing generation of Flows Visual documentation... (if you don't want it, use --no-generate-flow-doc or define GENERATE_FLOW_DOC=false)"));
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

    // List flows dependencies
    const flowDeps: any = {};
    for (const flowFile of flowFiles) {
      const flowName = path.basename(flowFile, ".flow-meta.xml");
      const flowXml = (await fs.readFile(flowFile, "utf8")).toString();
      // Find all occurences of <flowName>.*</flowName> in flowXml
      const regex = /<flowName>(.*?)<\/flowName>/g;
      const extractedNames = [...flowXml.matchAll(regex)].map(match => match[1]);
      flowDeps[flowName] = extractedNames;
    }
    if (flowFiles.length === 0) {
      uxLog("log", this, c.yellow("No flow found in the project"));
      return;
    }
    // Generate Flows documentation
    type FlowWorkItem = { flowFile: string; flowName: string; flowXml: string; outputFlowMdFile: string; skip: boolean };
    const flowWorkItems: FlowWorkItem[] = [];
    for (const flowFile of flowFiles) {
      const flowName = path.basename(flowFile, ".flow-meta.xml");
      const flowXml = (await fs.readFile(flowFile, "utf8")).toString();
      const flowContent = await parseXmlFile(flowFile);
      this.flowDescriptions.push({
        name: flowName,
        description: flowContent?.Flow?.description?.[0] || "",
        type: flowContent?.Flow?.processType?.[0] === "Flow" ? "ScreenFlow" : flowContent?.Flow?.start?.[0]?.triggerType?.[0] ?? (flowContent?.Flow?.processType?.[0] || "ERROR (Unknown)"),
        processType: flowContent?.Flow?.processType?.[0] || "",
        status: flowContent?.Flow?.status?.[0] || "",
        object: flowContent?.Flow?.start?.[0]?.object?.[0] || flowContent?.Flow?.processMetadataValues?.filter(pmv => pmv.name[0] === "ObjectType")?.[0]?.value?.[0]?.stringValue?.[0] || "",
        impactedObjects: this.allObjectsNames.filter(objectName => flowXml.includes(`>${objectName}<`))
      });
      if (flowContent?.Flow?.processType?.[0] !== "Workflow") {
        flowsForMenu[flowName] = "flows/" + flowName + ".md";
      } else {
        this.processBuildersForMenu[flowName] = "flows/" + flowName + ".md";
      }
      const outputFlowMdFile = path.join(this.outputMarkdownRoot, "flows", flowName + ".md");
      if (this.diffOnly && !updatedFlowNames.includes(flowName) && fs.existsSync(outputFlowMdFile)) {
        flowSkips.push(flowFile);
        flowWorkItems.push({ flowFile, flowName, flowXml, outputFlowMdFile, skip: true });
      } else {
        flowWorkItems.push({ flowFile, flowName, flowXml, outputFlowMdFile, skip: false });
      }
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Flows documentation...", flowWorkItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(flowWorkItems)
      .process(async (item) => {
        if (item.skip) {
          counter++;
          WebSocketClient.sendProgressStepMessage(counter, flowWorkItems.length);
          return;
        }
        uxLog("log", this, c.grey(`Generating markdown for Flow ${item.flowFile}...`));
        const genRes = await generateFlowMarkdownFile(item.flowName, item.flowXml, item.outputFlowMdFile, { collapsedDetails: false, describeWithAi: true, flowDependencies: flowDeps });
        if (!genRes) {
          flowErrors.push(item.flowFile);
          counter++;
          WebSocketClient.sendProgressStepMessage(counter, flowWorkItems.length);
          return;
        }
        if (this.debugMode) {
          await fs.copyFile(item.outputFlowMdFile, item.outputFlowMdFile.replace(".md", ".mermaid.md"));
        }
        const gen2res = await generateMarkdownFileWithMermaid(item.outputFlowMdFile, item.outputFlowMdFile, null, this.withPdf);
        if (!gen2res) {
          flowWarnings.push(item.flowFile);
          counter++;
          WebSocketClient.sendProgressStepMessage(counter, flowWorkItems.length);
          return;
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, flowWorkItems.length);
      });
    WebSocketClient.sendProgressEndMessage();
    this.flowDescriptions = sortArray(this.flowDescriptions, { by: ['object', 'name'], order: ['asc', 'asc'] }) as any[]
    const nonProcessBuilderFlowsSorted = this.flowDescriptions.filter(flow => flow.processType !== "Workflow");

    // History
    if (this.withHistory) {
      type HistoryWorkItem = { flowFile: string; flowName: string; diffMdFile: string; skip: boolean };
      const historyWorkItems: HistoryWorkItem[] = [];

      // Phase 1: Prepare work items
      for (const flowFile of flowFiles) {
        const flowName = path.basename(flowFile, ".flow-meta.xml");
        const diffMdFile = path.join("docs", "flows", path.basename(flowFile).replace(".flow-meta.xml", "-history.md"));
        const skip = this.diffOnly && !updatedFlowNames.includes(flowName) && fs.existsSync(diffMdFile);
        historyWorkItems.push({ flowFile, flowName, diffMdFile, skip });
      }

      // Phase 2: Generate history documentation with parallelization
      WebSocketClient.sendProgressStartMessage("Generating Flows History documentation...", historyWorkItems.length);
      let historyCounter = 0;
      await PromisePool.withConcurrency(parallelism)
        .for(historyWorkItems)
        .process(async (item) => {
          if (!item.skip) {
            try {
              await generateHistoryDiffMarkdown(item.flowFile, this.debugMode);
            } catch (e: any) {
              uxLog("warning", this, c.yellow(`Error generating history diff markdown for ${item.flowName}: ${e.message}`));
            }
          }
          historyCounter++;
          WebSocketClient.sendProgressStepMessage(historyCounter, historyWorkItems.length);
        });
      WebSocketClient.sendProgressEndMessage();
    }

    // Summary
    if (flowSkips.length > 0) {
      uxLog("warning", this, c.yellow(`Skipped generation for ${flowSkips.length} Flows that have not been updated: ${this.humanDisplay(flowSkips)}`));
    }
    uxLog("success", this, c.green(`Successfully generated ${flowFiles.length - flowSkips.length - flowWarnings.length - flowErrors.length} Flows documentation`));
    if (flowWarnings.length > 0) {
      uxLog("warning", this, c.yellow(`Partially generated documentation (Markdown with MermaidJS but without SVG) for ${flowWarnings.length} Flows: ${this.humanDisplay(flowWarnings)}`));
    }
    if (flowErrors.length > 0) {
      uxLog("warning", this, c.yellow(`Error generating documentation for ${flowErrors.length} Flows: ${this.humanDisplay(flowErrors)}`));
    }

    // Write index file for flow folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "flows"));
    const flowTableLinesForIndex = DocBuilderFlow.buildIndexTable('', nonProcessBuilderFlowsSorted, this.outputMarkdownRoot);
    const flowIndexFile = path.join(this.outputMarkdownRoot, "flows", "index.md");
    await fs.writeFile(flowIndexFile, getMetaHideLines() + flowTableLinesForIndex.join("\n") + `\n${this.footer}\n`);

    this.addNavNode("Flows", flowsForMenu);
    uxLog("success", this, c.green(`Successfully generated doc index for Flows at ${flowIndexFile}`));
  }

  private humanDisplay(flows) {
    return flows.map(flow => path.basename(flow, ".flow-meta.xml")).join(", ");
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
    uxLog("action", this, c.cyan("Generating package.xml files for local packages..."));
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
          uxLog("error", this, c.red(`Unable to generate manifest from ${packageDir.path}: it won't appear in the documentation\n${e.message}`))
        }
      }
    }
  }

  private addNavNode(nodeName, nodeValue) {
    const nodeIndex = this.mkDocsNavNodes.findIndex(navNode => Object.keys(navNode)[0] === nodeName);
    if (nodeIndex > -1) {
      this.mkDocsNavNodes[nodeIndex][nodeName] = nodeValue;
    }
    else {
      const nodeMenu = {};
      nodeMenu[nodeName] = nodeValue;
      this.mkDocsNavNodes.push(nodeMenu);
    }
  }

  private async generatePackageXmlMarkdown(packageXmlCandidates, instanceUrl) {
    uxLog("action", this, c.cyan("Generating package.xml documentation..."));
    // Generate packageXml doc when found
    for (const packageXmlCandidate of packageXmlCandidates) {
      if (fs.existsSync(packageXmlCandidate.path)) {
        // Generate markdown for package.xml
        const packageMarkdownFile = await DocBuilderPackageXML.generatePackageXmlMarkdown(packageXmlCandidate.path, null, packageXmlCandidate, instanceUrl);
        // Open file in a new VS Code tab if available
        WebSocketClient.requestOpenFile(packageMarkdownFile);
        packageXmlCandidate.markdownFile = packageMarkdownFile;
        this.outputPackageXmlMarkdownFiles.push(packageXmlCandidate);
      }
    }
  }

  private async generateLwcDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Lightning Web Components documentation... "));
    uxLog("log", this, "If you don't want it, use --no-generate-lwc-doc or define GENERATE_LWC_DOC=false");

    const lwcForMenu: any = { "All Lightning Web Components": "lwc/index.md" };
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "lwc"));

    const packageDirs = this.project?.getPackageDirectories() || [];

    // Phase 1: Collect data and prepare work items
    type LwcWorkItem = { lwcName: string; mdFile: string; lwcDirPath: string; jsContent: string; htmlContent: string; lwcMetaXml: string };
    const workItems: LwcWorkItem[] = [];
    for (const packageDir of packageDirs) {
      const lwcMetaFiles = await glob(`${packageDir.path}/**/lwc/**/*.js-meta.xml`, {
        cwd: process.cwd(),
        ignore: GLOB_IGNORE_PATTERNS
      });

      for (const lwcMetaFile of lwcMetaFiles) {
        const lwcDirPath = path.dirname(lwcMetaFile);
        const lwcName = path.basename(lwcDirPath);
        const mdFile = path.join(this.outputMarkdownRoot, "lwc", lwcName + ".md");

        lwcForMenu[lwcName] = "lwc/" + lwcName + ".md";

        // Read XML metadata for information about the component
        const lwcMetaXml = await fs.readFile(lwcMetaFile, "utf8");
        const lwcMetaXmlParsed = new XMLParser().parse(lwcMetaXml);

        // Read JS file to get a better idea of what objects this component works with
        const jsFile = path.join(lwcDirPath, `${lwcName}.js`);
        let jsContent = "none";
        if (fs.existsSync(jsFile)) {
          jsContent = await fs.readFile(jsFile, "utf8");
        }

        // Read HTML template file
        const htmlFile = path.join(lwcDirPath, `${lwcName}.html`);
        let htmlContent = "none";
        if (fs.existsSync(htmlFile)) {
          htmlContent = await fs.readFile(htmlFile, "utf8");
        }

        // Track this LWC in our descriptions array
        this.lwcDescriptions.push({
          name: lwcName,
          description: lwcMetaXmlParsed?.LightningComponentBundle?.description ||
            lwcMetaXmlParsed?.LightningComponentBundle?.masterLabel || "",
          targets: Array.isArray(lwcMetaXmlParsed?.LightningComponentBundle?.targets?.target)
            ? lwcMetaXmlParsed?.LightningComponentBundle?.targets?.target.join(", ")
            : lwcMetaXmlParsed?.LightningComponentBundle?.targets?.target || "",
          isExposed: lwcMetaXmlParsed?.LightningComponentBundle?.isExposed,
          impactedObjects: this.allObjectsNames.filter(objectName =>
            lwcMetaXml.includes(`${objectName}`) ||
            jsContent.includes(`${objectName}`)
          )
        });

        workItems.push({ lwcName, mdFile, lwcDirPath, jsContent, htmlContent, lwcMetaXml });
      }
    }

    if (workItems.length === 0) {
      uxLog("log", this, c.yellow("No Lightning Web Component found in the project"));
      return;
    }

    // Phase 2: Generate documentation with parallel AI calls
    const parallelism = await UtilsAi.getPromptsParallelCallNumber();
    WebSocketClient.sendProgressStartMessage("Generating Lightning Web Components documentation...", workItems.length);
    let counter = 0;
    await PromisePool.withConcurrency(parallelism)
      .for(workItems)
      .process(async (item) => {
        await new DocBuilderLwc(item.lwcName, "", item.mdFile, {
          LWC_PATH: item.lwcDirPath,
          LWC_NAME: item.lwcName,
          LWC_JS_CODE: item.jsContent,
          LWC_HTML_CODE: item.htmlContent,
          LWC_JS_META: item.lwcMetaXml
        }).generateMarkdownFileFromXml();

        if (this.withPdf) {
          await generatePdfFileFromMarkdown(item.mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, workItems.length);
      });

    WebSocketClient.sendProgressEndMessage();

    if (Object.keys(lwcForMenu).length > 1) {
      this.addNavNode("Lightning Web Components", lwcForMenu);
    }

    // Write index file for LWC folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "lwc"));
    const lwcIndexFile = path.join(this.outputMarkdownRoot, "lwc", "index.md");
    await fs.writeFile(
      lwcIndexFile,
      getMetaHideLines() +
      DocBuilderLwc.buildIndexTable('', this.lwcDescriptions).join("\n") +
      `\n\n${this.footer}\n`
    );

    uxLog("success", this, c.green(`Successfully generated documentation for Lightning Web Components at ${lwcIndexFile}`));
  }

  private async generateExcelFile() {
    uxLog("action", this, c.cyan("Generating Excel file with all metadata..."));

    const workbook = new ExcelJS.Workbook();
    const excelFilePath = path.join(this.outputMarkdownRoot, "project-documentation.xlsx");

    // Collect metadata counts
    const nonProcessBuilderFlows = this.flowDescriptions.filter(flow => flow.processType !== "Workflow");
    const processBuilders = this.flowDescriptions.filter(flow => flow.processType === "Workflow");

    const metadataCounts = [
      { type: 'Objects', count: this.objectDescriptions.length },
      { type: 'Apex', count: this.apexDescriptions.length },
      { type: 'Flows', count: nonProcessBuilderFlows.length },
      { type: 'Process Builders', count: processBuilders.length },
      { type: 'Workflow Rules', count: this.workflowRulesDescriptions.length },
      { type: 'Approval Processes', count: this.approvalProcessesDescriptions.length },
      { type: 'Assignment Rules', count: this.assignmentRulesDescriptions.length },
      { type: 'AutoResponse Rules', count: this.autoResponseRulesDescriptions.length },
      { type: 'Escalation Rules', count: this.escalationRulesDescriptions.length },
      { type: 'Profiles', count: this.profileDescriptions.length },
      { type: 'Permission Sets', count: this.permissionSetsDescriptions.length },
      { type: 'Permission Set Groups', count: this.permissionSetGroupsDescriptions.length },
      { type: 'Roles', count: this.roleDescriptions.length },
      { type: 'Lightning Pages', count: this.pageDescriptions.length },
      { type: 'Packages', count: this.packageDescriptions.length },
      { type: 'Lightning Web Components', count: this.lwcDescriptions.length }
    ];

    // Create summary worksheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metadata Type', key: 'type', width: 30 },
      { header: 'Count', key: 'count', width: 15 }
    ];

    // Style summary header
    summarySheet.getRow(1).font = { bold: true, size: 12 };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add summary data
    let totalCount = 0;
    metadataCounts.forEach(item => {
      summarySheet.addRow(item);
      totalCount += item.count;
    });

    // Add total row
    const totalRow = summarySheet.addRow({ type: 'TOTAL', count: totalCount });
    totalRow.font = { bold: true };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Helper function to create a worksheet with data
    const addWorksheet = (name: string, data: any[], columns: string[]) => {
      if (data.length === 0) return;

      const worksheet = workbook.addWorksheet(name);

      // Add header row
      worksheet.columns = columns.map(col => ({
        header: col.charAt(0).toUpperCase() + col.slice(1).replace(/([A-Z])/g, ' $1').trim(),
        key: col,
        width: 20
      }));

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add data rows
      data.forEach(item => {
        const row: any = {};
        columns.forEach(col => {
          let value = item[col];
          // Handle arrays
          if (Array.isArray(value)) {
            value = value.join(', ');
          }
          // Handle booleans
          if (typeof value === 'boolean') {
            value = value ? 'Yes' : 'No';
          }
          row[col] = value || '';
        });
        worksheet.addRow(row);
      });

      // Auto-filter
      worksheet.autoFilter = {
        from: 'A1',
        to: String.fromCharCode(64 + columns.length) + '1'
      };
    };

    // Add sheets for each metadata type
    if (this.objectDescriptions.length > 0) {
      addWorksheet('Objects', this.objectDescriptions, ['name', 'label', 'description']);
    }

    if (this.apexDescriptions.length > 0) {
      addWorksheet('Apex', this.apexDescriptions, ['name', 'type']);
    }

    if (nonProcessBuilderFlows.length > 0) {
      addWorksheet('Flows', nonProcessBuilderFlows, ['name', 'type', 'object', 'description', 'status']);
    }

    if (processBuilders.length > 0) {
      addWorksheet('Process Builders', processBuilders, ['name', 'type', 'object', 'description', 'status']);
    }

    if (this.workflowRulesDescriptions.length > 0) {
      addWorksheet('Workflow Rules', this.workflowRulesDescriptions, ['name', 'active', 'object']);
    }

    if (this.approvalProcessesDescriptions.length > 0) {
      addWorksheet('Approval Processes', this.approvalProcessesDescriptions, ['name', 'active']);
    }

    if (this.assignmentRulesDescriptions.length > 0) {
      addWorksheet('Assignment Rules', this.assignmentRulesDescriptions, ['name', 'active']);
    }

    if (this.autoResponseRulesDescriptions.length > 0) {
      addWorksheet('AutoResponse Rules', this.autoResponseRulesDescriptions, ['name', 'active']);
    }

    if (this.escalationRulesDescriptions.length > 0) {
      addWorksheet('Escalation Rules', this.escalationRulesDescriptions, ['name', 'active']);
    }

    if (this.profileDescriptions.length > 0) {
      addWorksheet('Profiles', this.profileDescriptions, ['name', 'userLicense']);
    }

    if (this.permissionSetsDescriptions.length > 0) {
      addWorksheet('Permission Sets', this.permissionSetsDescriptions, ['name', 'userLicense']);
    }

    if (this.permissionSetGroupsDescriptions.length > 0) {
      addWorksheet('Permission Set Groups', this.permissionSetGroupsDescriptions, ['name', 'description']);
    }

    if (this.roleDescriptions.length > 0) {
      addWorksheet('Roles', this.roleDescriptions, ['apiName', 'name', 'parentRole']);
    }

    if (this.pageDescriptions.length > 0) {
      addWorksheet('Lightning Pages', this.pageDescriptions, ['name', 'type']);
    }

    if (this.packageDescriptions.length > 0) {
      addWorksheet('Packages', this.packageDescriptions, ['name', 'namespace', 'versionNumber', 'versionName']);
    }

    if (this.lwcDescriptions.length > 0) {
      addWorksheet('LWC', this.lwcDescriptions, ['name', 'description', 'targets', 'isExposed']);
    }

    // Save the workbook
    await workbook.xlsx.writeFile(excelFilePath);
    uxLog("success", this, c.green(`Successfully generated Excel file at ${excelFilePath}`));

    // Open file in VS Code if available
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(excelFilePath, "Excel summary", 'report');
    }
    else {
      WebSocketClient.requestOpenFile(excelFilePath);
    }
  }
}