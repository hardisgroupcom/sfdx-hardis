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
import { GLOB_IGNORE_PATTERNS, listApexFiles, listFlowFiles, listVfFiles, listPageFiles, returnApexType } from '../../../common/utils/projectUtils.js';
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
import { DocBuilderVf, VfDocGenerationResult, VfDocBuilderConfig } from '../../../common/docBuilder/docBuilderVf.js';
import { DocBuilderPackageXML } from '../../../common/docBuilder/docBuilderPackageXml.js';
import { DocBuilderPermissionSet } from '../../../common/docBuilder/docBuilderPermissionSet.js';
import { DocBuilderPermissionSetGroup } from '../../../common/docBuilder/docBuilderPermissionSetGroup.js';
import { DocBuilderAssignmentRules } from '../../../common/docBuilder/docBuilderAssignmentRules.js';
import { DocBuilderApprovalProcess } from '../../../common/docBuilder/docBuilderApprovalProcess.js';
import { DocBuilderAutoResponseRules } from "../../../common/docBuilder/docBuilderAutoResponseRules.js";
import { DocBuilderEscalationRules } from '../../../common/docBuilder/docBuilderEscalationRules.js';
import { DocBuilderRoles } from '../../../common/docBuilder/docBuilderRoles.js';
import { DocBuilderPackage } from '../../../common/docBuilder/docBuilderPackage.js';
import { setConnectionVariables } from '../../../common/utils/orgUtils.js';
import { makeFileNameGitCompliant } from '../../../common/utils/gitUtils.js';


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
  - Visualforce Pages
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
    '$ sf hardis:doc:project2markdown --hide-apex-code'
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
    "hide-apex-code": Flags.boolean({
      default: false,
      description: "Hide Apex code in the generated documentation for Apex classes.",
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
  protected hideApexCode = false;
  protected debugMode = false;
  protected footer: string;
  protected apexDescriptions: any[] = [];
  protected flowDescriptions: any[] = [];
  protected lwcDescriptions: any[] = [];
  protected vfDescriptions: any[] = [];
  protected packageDescriptions: any[] = [];
  protected pageDescriptions: any[] = [];
  protected profileDescriptions: any[] = [];
  protected permissionSetsDescriptions: any[] = [];
  protected permissionSetGroupsDescriptions: any[] = [];
  protected assignmentRulesDescriptions: any[] = [];
  protected autoResponseRulesDescriptions: any[] = [];
  protected approvalProcessesDescriptions: any[] = [];
  protected escalationRulesDescriptions: any[] = [];
  protected roleDescriptions: any[] = [];
  protected objectDescriptions: any[] = [];
  protected objectFiles: string[];
  protected allObjectsNames: string[];
  protected tempDir: string;
  protected packageDirs: any[] = [];
  protected projectRoot: string;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Project2Markdown);
    this.diffOnly = flags["diff-only"] === true ? true : false;
    this.withHistory = flags["with-history"] === true ? true : false;
    this.withPdf = flags.pdf === true ? true : false;
    this.hideApexCode = flags["hide-apex-code"] === true || process?.env?.HIDE_APEX_CODE === 'true' ? true : false;
    this.debugMode = flags.debug || false;
    await setConnectionVariables(flags['target-org']?.getConnection(), true);// Required for some notifications providers like Email, or for Agentforce

    await fs.ensureDir(this.outputMarkdownRoot);
    const currentBranch = await getCurrentGitBranch()
    this.footer = `_Documentation generated from branch ${currentBranch} with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) by [Cloudity](${CONSTANTS.WEBSITE_URL}) command [\`sf hardis:doc:project2markdown\`](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/)_`;

    this.mdLines.push(...[
      "Welcome to the documentation of your Salesforce project.",
      "",
      // "- [Object Model](object-model.md)",
      "- [Objects](objects/index.md)",
      "- Automations",
      "  - [Approval Processes](approvalProcesses/index.md)",
      "  - [Assignment Rules](assignmentRules/index.md)",
      "  - [AutoResponse Rules](autoResponseRules/index.md)",
      "  - [Escalation Rules](escalationRules/index.md)",
      "  - [Flows](flows/index.md)",
      "- Authorizations",
      "  - [Profiles](profiles/index.md)",
      "  - [Permission Set Groups](permissionsetgroups/index.md)",
      "  - [Permission Sets](permissionsets/index.md)",
      "- [Roles](roles.md)",
      "- Code",
      "  - [Apex](apex/index.md)",
      "  - [Lightning Web Components](lwc/index.md)",
      "  - [Visualforce Pages](vf/index.md)",
      "- [Lightning Pages](pages/index.md)",
      "- [Packages](packages/index.md)",
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
    this.addNavNode("Manifests", packagesForMenu);
    await fs.writeFile(path.join(this.outputMarkdownRoot, "manifests.md"), getMetaHideLines() + packageLines.join("\n") + `\n${this.footer}\n`);

    this.tempDir = await createTempDir()
    // Convert source to metadata API format to build prompts
    uxLog("action", this, c.cyan("Converting source to metadata API format to ease the build of LLM prompts."));
    await execCommand(`sf project convert source --metadata CustomObject --output-dir ${this.tempDir}`, this, { fail: true, output: true, debug: this.debugMode });
    this.objectFiles = (await glob("**/*.object", { cwd: this.tempDir, ignore: GLOB_IGNORE_PATTERNS }));
    sortCrossPlatform(this.objectFiles);
    this.allObjectsNames = this.objectFiles.map(object => path.basename(object, ".object"));

    // Generate packages documentation
    if (!(process?.env?.GENERATE_PACKAGES_DOC === 'false')) {
      await this.generatePackagesDocumentation();
    }

    // Generate Apex doc
    if (!(process?.env?.GENERATE_APEX_DOC === 'false')) {
      await this.generateApexDocumentation();
    }

    // List flows & generate doc
    if (!(process?.env?.GENERATE_FLOW_DOC === 'false')) {
      await this.generateFlowsDocumentation();
    }

    // List pages & generate doc
    if (!(process?.env?.GENERATE_PAGES_DOC === 'false')) {
      await this.generatePagesDocumentation();
    }

    // List profiles & generate doc
    if (!(process?.env?.GENERATE_PROFILES_DOC === 'false')) {
      await this.generateProfilesDocumentation();
      await this.generatePermissionSetGroupsDocumentation();
      await this.generatePermissionSetsDocumentation();
      await this.generateRolesDocumentation();
    }

    // List objects & generate doc
    if (!(process?.env?.GENERATE_OBJECTS_DOC === 'false')) {
      await this.generateObjectsDocumentation();
    }

    if (!(process?.env?.GENERATE_AUTOMATIONS_DOC === 'false')) {
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
    if (!(process?.env?.GENERATE_LWC_DOC === 'false')) {
      await this.generateLwcDocumentation();
    }

    // List VisualForce & generate doc
    if (!(process?.env?.GENERATE_VF_DOC === 'false')) {
      await this.generateVfDocumentation();
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
    uxLog("action", this, c.cyan("Calling ApexDocGen to initialize Apex documentation... (if you don't want it, define GENERATE_APEX_DOC=false in your environment variables)"));
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
        await fs.copy(path.join(tempDir, "miscellaneous"), apexDocFolder, { overwrite: true });
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
    const apexClassNames = apexFiles.map(file => path.basename(file, ".cls")).filter(name => !name.endsWith(".trigger"));

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
    WebSocketClient.sendProgressStartMessage("Generating Apex documentation...", apexFiles.length);
    let counter = 0;
    for (const apexFile of apexFiles) {
      const apexName = path.basename(apexFile, ".cls").replace(".trigger", "");
      const apexContent = await fs.readFile(apexFile, "utf8");
      const mdFile = path.join(this.outputMarkdownRoot, "apex", apexName + ".md");
      if (fs.existsSync(mdFile)) {
        const apexName = path.basename(apexFile, ".cls").replace(".trigger", "");
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
          const apexDocBuilder = new DocBuilderApex(apexName, apexContent, "", {
            "CLASS_NAME": apexName,
            "APEX_CODE": apexContent
          });
          apexDocBuilder.markdownDoc = apexMdContent;
          apexMdContent = await apexDocBuilder.completeDocWithAiDescription();
          await fs.writeFile(mdFile, getMetaHideLines() + apexMdContent);
        }
        uxLog("log", this, c.grey(`Generated markdown for Apex class ${apexName}`));
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(mdFile);
        }
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, apexFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();
    this.addNavNode("Apex", apexForMenu);

    // Write index file for apex folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "apex"));
    const apexIndexFile = path.join(this.outputMarkdownRoot, "apex", "index.md");
    await fs.writeFile(apexIndexFile, getMetaHideLines() + DocBuilderApex.buildIndexTable('', this.apexDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generatePackagesDocumentation() {
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
    WebSocketClient.sendProgressStartMessage("Generating Installed Packages documentation...", packages.length);
    let counter = 0;
    // Process packages
    for (const pckg of packages) {
      const packageName = pckg.SubscriberPackageName;
      const mdFile = path.join(this.outputMarkdownRoot, "packages", makeFileNameGitCompliant(packageName) + ".md");
      // Generate package page and add it to menu
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
      // Add Packages in documentation
      await new DocBuilderPackage(makeFileNameGitCompliant(packageName), pckg, mdFile, {
        "PACKAGE_METADATAS": packageMetadatas,
        "PACKAGE_FILE": tmpOutput
      }).generateMarkdownFileFromXml();
      if (this.withPdf) {
        await generatePdfFileFromMarkdown(mdFile);
      }
      // Recovery to save git repos: Kill existing file if it has been created with forbidden characters
      const mdFileBad = path.join(this.outputMarkdownRoot, "packages", packageName + ".md");
      if (mdFileBad !== mdFile && fs.existsSync(mdFileBad)) {
        await fs.remove(mdFileBad);
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, packages.length);
    }
    this.addNavNode("Packages", packagesForMenu);
    // Write index file for packages folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "packages"));
    const packagesIndexFile = path.join(this.outputMarkdownRoot, "packages", "index.md");
    await fs.writeFile(packagesIndexFile, getMetaHideLines() + DocBuilderPackage.buildIndexTable('', this.packageDescriptions).join("\n") + `\n\n${this.footer}\n`);
    WebSocketClient.sendProgressEndMessage();
  }

  private async generatePagesDocumentation() {
    const packageDirs = this.project?.getPackageDirectories() || [];
    const pageFiles = await listPageFiles(packageDirs);
    const pagesForMenu: any = { "All Lightning pages": "pages/index.md" }
    WebSocketClient.sendProgressStartMessage("Generating Lightning Pages documentation...", pageFiles.length);
    let counter = 0;
    for (const pagefile of pageFiles) {
      const pageName = path.basename(pagefile, ".flexipage-meta.xml");
      const mdFile = path.join(this.outputMarkdownRoot, "pages", pageName + ".md");
      pagesForMenu[pageName] = "pages/" + pageName + ".md";
      // Add Pages in documentation
      const pageXml = await fs.readFile(pagefile, "utf8");
      const pageXmlParsed = new XMLParser().parse(pageXml);
      this.pageDescriptions.push({
        name: pageName,
        type: prettifyFieldName(pageXmlParsed?.FlexiPage?.type || "Unknown"),
        impactedObjects: this.allObjectsNames.filter(objectName => pageXml.includes(`${objectName}`))
      });
      await new DocBuilderPage(pageName, pageXml, mdFile).generateMarkdownFileFromXml();
      if (this.withPdf) {
        await generatePdfFileFromMarkdown(mdFile);
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, pageFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();
    this.addNavNode("Lightning Pages", pagesForMenu);

    // Write index file for pages folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "pages"));
    const pagesIndexFile = path.join(this.outputMarkdownRoot, "pages", "index.md");
    await fs.writeFile(pagesIndexFile, getMetaHideLines() + DocBuilderPage.buildIndexTable('', this.pageDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generateProfilesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Profiles documentation... (if you don't want it, define GENERATE_PROFILES_DOC=false in your environment variables)"));
    const profilesForMenu: any = { "All Profiles": "profiles/index.md" };
    const profilesFiles = (await glob("**/profiles/**.profile-meta.xml", { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS }));
    sortCrossPlatform(profilesFiles);
    if (profilesFiles.length === 0) {
      uxLog("log", this, c.yellow("No profile found in the project"));
      return;
    }
    WebSocketClient.sendProgressStartMessage("Generating Profiles documentation...", profilesFiles.length);
    let counter = 0;
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
      // Add Profiles code in documentation
      await new DocBuilderProfile(profileName, profileXml, mdFile).generateMarkdownFileFromXml();
      if (this.withPdf) {
        await generatePdfFileFromMarkdown(mdFile);
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, profilesFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();
    this.addNavNode("Profiles", profilesForMenu);
    // Write index file for profiles folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "profiles"));
    const profilesIndexFile = path.join(this.outputMarkdownRoot, "profiles", "index.md");
    await fs.writeFile(profilesIndexFile, getMetaHideLines() + DocBuilderProfile.buildIndexTable('', this.profileDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generatePermissionSetsDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Permission Sets documentation... (if you don't want it, define GENERATE_PROFILES_DOC=false in your environment variables)"));
    const psForMenu: any = { "All Permission Sets": "permissionsets/index.md" };
    const psFiles = (await glob("**/permissionsets/**.permissionset-meta.xml", { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS }));
    sortCrossPlatform(psFiles);
    if (psFiles.length === 0) {
      uxLog("log", this, c.yellow("No permission set found in the project"));
      return;
    }
    WebSocketClient.sendProgressStartMessage("Generating Permission Sets documentation...", psFiles.length);
    let counter = 0;
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
      // Add Permission Sets code in documentation
      await new DocBuilderPermissionSet(psName, psXml, mdFile).generateMarkdownFileFromXml();
      // Permission Set Groups Table
      const relatedPsg = DocBuilderPermissionSetGroup.buildIndexTable('../permissionsetgroups/', this.permissionSetGroupsDescriptions, psName);
      await replaceInFile(mdFile, '<!-- Permission Set Groups table -->', relatedPsg.join("\n"));
      if (this.withPdf) {
        await generatePdfFileFromMarkdown(mdFile);
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, psFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();
    this.addNavNode("Permission Sets", psForMenu);
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
    WebSocketClient.sendProgressStartMessage("Generating Permission Set Groups documentation...", psgFiles.length);
    let counter = 0;
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
      await new DocBuilderPermissionSetGroup(psgName, psgXml, mdFile).generateMarkdownFileFromXml();
      if (this.withPdf) {
        await generatePdfFileFromMarkdown(mdFile);
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, psgFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();
    this.addNavNode("Permission Set Groups", psgForMenu);

    // Write index file for permission set groups folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "permissionsetgroups"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "permissionsetgroups", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderPermissionSetGroup.buildIndexTable('', this.permissionSetGroupsDescriptions).join("\n") + `\n${this.footer}\n`);
  }

  private async generateRolesDocumentation() {
    uxLog("action", this, c.cyan("Generating Roles documentation... (if you don't want it, define GENERATE_PROFILES_DOC=false in your environment variables)"));
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
    this.addNavNode("Roles", "roles.md");

    // Add Roles documentation
    const rolesIndexFile = path.join(this.outputMarkdownRoot, "roles.md");
    await DocBuilderRoles.generateMarkdownFileFromRoles(this.roleDescriptions, rolesIndexFile);
    if (this.withPdf) {
      await generatePdfFileFromMarkdown(rolesIndexFile);
    }
  }


  private async generateAssignmentRulesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Assignment Rules documentation... " +
      "(if you don't want it, define GENERATE_AUTOMATIONS_DOC=false in your environment variables)"));

    const assignmentRulesForMenu: any = { "All Assignment Rules": "assignmentRules/index.md" };
    const assignmentRulesFiles = (await glob("**/assignmentRules/**.assignmentRules-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(assignmentRulesFiles);
    const builder = new XMLBuilder();

    // Count total rules for progress tracking
    let totalRules = 0;
    for (const assignmentRulesFile of assignmentRulesFiles) {
      const assignmentRulesXml = await fs.readFile(assignmentRulesFile, "utf8");
      const assignmentRulesXmlParsed = new XMLParser().parse(assignmentRulesXml);
      let rulesList = assignmentRulesXmlParsed?.AssignmentRules?.assignmentRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }
      totalRules += rulesList.length;
    }

    if (totalRules === 0) {
      uxLog("log", this, c.yellow("No assignment rule found in the project"));
      return;
    }

    WebSocketClient.sendProgressStartMessage("Generating Assignment Rules documentation...", totalRules);
    let counter = 0;
    for (const assignmentRulesFile of assignmentRulesFiles) {

      const assignmentRulesXml = await fs.readFile(assignmentRulesFile, "utf8");
      const assignmentRulesXmlParsed = new XMLParser().parse(assignmentRulesXml);

      const assignmentRulesName = path.basename(assignmentRulesFile, ".assignmentRules-meta.xml");
      // parsing one singe XML file with all the Assignment Rules per object:
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

        await new DocBuilderAssignmentRules(currentRuleName, ruleXml, mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, totalRules);
      }
    }
    WebSocketClient.sendProgressEndMessage();

    this.addNavNode("Assignment Rules", assignmentRulesForMenu);

    await fs.ensureDir(path.join(this.outputMarkdownRoot, "assignmentRules"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "assignmentRules", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderAssignmentRules.buildIndexTable('', this.assignmentRulesDescriptions).join("\n") + `\n${this.footer}\n`);
  }

  private async generateApprovalProcessDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Approval Processes documentation... " +
      "(if you don't want it, define GENERATE_AUTOMATIONS_DOC=false in your environment variables)"));

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
    WebSocketClient.sendProgressStartMessage("Generating Approval Processes documentation...", approvalProcessFiles.length);
    let counter = 0;
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

      await new DocBuilderApprovalProcess(approvalProcessName, approvalProcessXml, mdFile).generateMarkdownFileFromXml();
      if (this.withPdf) {
        await generatePdfFileFromMarkdown(mdFile);
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, approvalProcessFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();

    this.addNavNode("Approval Processes", approvalProcessesForMenu);
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "approvalProcesses"));
    const approvalProcessesIndexFile = path.join(this.outputMarkdownRoot, "approvalProcesses", "index.md");
    await fs.writeFile(approvalProcessesIndexFile, getMetaHideLines() + DocBuilderApprovalProcess.buildIndexTable('', this.approvalProcessesDescriptions).join("\n") + `\n\n${this.footer}\n`);
  }

  private async generateAutoResponseRulesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of AutoResponse Rules documentation... " +
      "(if you don't want it, define GENERATE_AUTOMATIONS_DOC=false in your environment variables)"));

    const autoResponseRulesForMenu: any = { "All AutoResponse Rules": "autoResponseRules/index.md" };
    const autoResponseRulesFiles = (await glob("**/autoResponseRules/**.autoResponseRules-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(autoResponseRulesFiles);
    const builder = new XMLBuilder();
    // Count total rules for progress tracking
    let totalRules = 0;
    for (const autoResponseRulesFile of autoResponseRulesFiles) {
      const autoResponseRulesXml = await fs.readFile(autoResponseRulesFile, "utf8");
      const autoResponseRulesXmlParsed = new XMLParser().parse(autoResponseRulesXml);
      let rulesList = autoResponseRulesXmlParsed?.AutoResponseRules?.autoResponseRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }
      totalRules += rulesList.length;
    }

    if (totalRules === 0) {
      uxLog("log", this, c.yellow("No auto-response rules found in the project"));
      return;
    }

    WebSocketClient.sendProgressStartMessage("Generating AutoResponse Rules documentation...", totalRules);
    let counter = 0;
    for (const autoResponseRulesFile of autoResponseRulesFiles) {

      const autoResponseRulesXml = await fs.readFile(autoResponseRulesFile, "utf8");
      const autoResponseRulesXmlParsed = new XMLParser().parse(autoResponseRulesXml);

      const autoResponseRulesName = path.basename(autoResponseRulesFile, ".autoResponseRules-meta.xml");

      // parsing one single XML file with all the AutoResponse Rules per object:
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

        await new DocBuilderAutoResponseRules(currentRuleName, ruleXml, mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(mdFile);
        }
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, totalRules);
      }
    }
    WebSocketClient.sendProgressEndMessage();
    this.addNavNode("AutoResponse Rules", autoResponseRulesForMenu);

    // Write index file for permission set groups folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "autoResponseRules"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "autoResponseRules", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderAutoResponseRules.buildIndexTable('', this.autoResponseRulesDescriptions).join("\n") + `\n${this.footer}\n`);
  }

  private async generateEscalationRulesDocumentation() {
    uxLog("action", this, c.cyan("Preparing generation of Escalation Rules documentation... " +
      "(if you don't want it, define GENERATE_AUTOMATIONS_DOC=false in your environment variables)"));

    const escalationRulesForMenu: any = { "All Escalation Rules": "escalationRules/index.md" };
    const escalationRulesFiles = (await glob("**/escalationRules/**.escalationRules-meta.xml", {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    }));
    sortCrossPlatform(escalationRulesFiles);
    const builder = new XMLBuilder();

    // Count total rules for progress tracking
    let totalRules = 0;
    for (const escalationRulesFile of escalationRulesFiles) {
      const escalationRulesXml = await fs.readFile(escalationRulesFile, "utf8");
      const escalationRulesXmlParsed = new XMLParser().parse(escalationRulesXml);
      let rulesList = escalationRulesXmlParsed?.EscalationRules?.escalationRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }
      totalRules += rulesList.length;
    }

    if (totalRules === 0) {
      uxLog("log", this, c.yellow("No escalation rules found in the project"));
      return;
    }

    WebSocketClient.sendProgressStartMessage("Generating Escalation Rules documentation...", totalRules);

    let counter = 0;
    for (const escalationRulesFile of escalationRulesFiles) {

      const escalationRulesXml = await fs.readFile(escalationRulesFile, "utf8");
      const escalationRulesXmlParsed = new XMLParser().parse(escalationRulesXml);

      const escalationRulesName = path.basename(escalationRulesFile, ".escalationRules-meta.xml");

      // parsing one singe XML file with all the Escalation Rules for Case:
      let rulesList = escalationRulesXmlParsed?.EscalationRules?.escalationRule || [];
      if (!Array.isArray(rulesList)) {
        rulesList = [rulesList];
      }

      for (const rule of rulesList) {
        counter++;
        WebSocketClient.sendProgressStepMessage(counter);

        const currentRuleName = escalationRulesName + "." + rule?.fullName;
        escalationRulesForMenu[currentRuleName] = "escalationRules/" + currentRuleName + ".md";
        const mdFile = path.join(this.outputMarkdownRoot, "escalationRules", currentRuleName + ".md");

        this.escalationRulesDescriptions.push({
          name: currentRuleName,
          active: rule.active,
        });

        const ruleXml = builder.build({ escalationRule: rule });

        await new DocBuilderEscalationRules(currentRuleName, ruleXml, mdFile).generateMarkdownFileFromXml();
        if (this.withPdf) {
          await generatePdfFileFromMarkdown(mdFile);
        }
      }
    }

    WebSocketClient.sendProgressEndMessage();

    this.addNavNode("Escalation Rules", escalationRulesForMenu);

    await fs.ensureDir(path.join(this.outputMarkdownRoot, "escalationRules"));
    const psgIndexFile = path.join(this.outputMarkdownRoot, "escalationRules", "index.md");
    await fs.writeFile(psgIndexFile, getMetaHideLines() + DocBuilderEscalationRules.buildIndexTable('', this.escalationRulesDescriptions).join("\n") + `\n${this.footer}\n`);
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
      { menu: "Automations", subMenus: ["Approval Processes", "Assignment Rules", "AutoResponse Rules", "Escalation Rules", "Flows"] },
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
    uxLog("action", this, c.cyan("Preparing generation of Objects AI documentation... (if you don't want it, define GENERATE_OBJECTS_DOC=false in your environment variables)"));

    const objectLinksInfo = await this.generateLinksInfo();
    const objectsForMenu: any = { "All objects": "objects/index.md" }
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "objects"));
    WebSocketClient.sendProgressStartMessage("Generating Objects documentation...", this.objectFiles.length);
    let counter = 0;
    for (const objectFile of this.objectFiles) {
      const objectName = path.basename(objectFile, ".object");
      if ((objectName.endsWith("__dlm") || objectName.endsWith("__dll")) && !(process.env?.INCLUDE_DATA_CLOUD_DOC === "true")) {
        uxLog("log", this, c.grey(`Skip Data Cloud Object ${objectName}... (use INCLUDE_DATA_CLOUD_DOC=true to enforce it)`));
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, this.objectFiles.length);
        continue;
      }
      uxLog("log", this, c.grey(`Generating markdown for Object ${objectName}...`));
      const objectXml = (await fs.readFile(path.join(this.tempDir, objectFile), "utf8")).toString();
      const objectMdFile = path.join(this.outputMarkdownRoot, "objects", objectName + ".md");
      // Build filtered XML
      const objectXmlParsed = new XMLParser().parse(objectXml);
      // Main AI markdown
      await new DocBuilderObject(
        objectName,
        objectXml,
        objectMdFile, {
        "ALL_OBJECTS_LIST": this.allObjectsNames.join(","),
        "ALL_OBJECT_LINKS": objectLinksInfo
      }).generateMarkdownFileFromXml();
      // Fields table
      await this.buildAttributesTables(objectName, objectXmlParsed, objectMdFile);
      // Mermaid schema
      const mermaidSchema = await new ObjectModelBuilder(objectName).buildObjectsMermaidSchema();
      await replaceInFile(objectMdFile, '<!-- Mermaid schema -->', '## Schema\n\n```mermaid\n' + mermaidSchema + '\n```\n');
      if (this.withPdf) {
        /** Regenerate using Mermaid CLI to convert Mermaid code into SVG */
        await generateMarkdownFileWithMermaid(objectMdFile, objectMdFile, null, true);
      }
      // Flows Table
      const relatedObjectFlowsTable = DocBuilderFlow.buildIndexTable('../flows/', this.flowDescriptions, this.outputMarkdownRoot, objectName);
      await replaceInFile(objectMdFile, '<!-- Flows table -->', relatedObjectFlowsTable.join("\n"));
      // Apex Table
      const relatedApexTable = DocBuilderApex.buildIndexTable('../apex/', this.apexDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- Apex table -->', relatedApexTable.join("\n"));
      // Lightning Pages table
      const relatedPages = DocBuilderPage.buildIndexTable('../pages/', this.pageDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- Pages table -->', relatedPages.join("\n"));
      // Add Profiles table
      const relatedProfilesTable = DocBuilderProfile.buildIndexTable('../profiles/', this.profileDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- Profiles table -->', relatedProfilesTable.join("\n"));
      // Add Permission Sets table
      const relatedPermissionSetsTable = DocBuilderPermissionSet.buildIndexTable('../permissionsets/', this.permissionSetsDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- PermissionSets table -->', relatedPermissionSetsTable.join("\n"));
      // Add Approval Processes table
      const relatedApprovalProcessTable = DocBuilderApprovalProcess.buildIndexTable('../approvalProcesses/', this.approvalProcessesDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- ApprovalProcess table -->', relatedApprovalProcessTable.join("\n"));
      // Assignment Rules table
      const relatedAssignmentRulesTable = DocBuilderAssignmentRules.buildIndexTable('../assignmentRules/', this.assignmentRulesDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- AssignmentRules table -->', relatedAssignmentRulesTable.join("\n"));
      // AutoResponse Rules table
      const relatedAutoResponseRulesTable = DocBuilderAutoResponseRules.buildIndexTable('../autoResponseRules/', this.autoResponseRulesDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- AutoResponseRules table -->', relatedAutoResponseRulesTable.join("\n"));
      // Escalation Rules table
      const relatedEscalationRulesTable = DocBuilderEscalationRules.buildIndexTable('../escalationRules/', this.escalationRulesDescriptions, objectName);
      await replaceInFile(objectMdFile, '<!-- EscalationRules table -->', relatedEscalationRulesTable.join("\n"));

      this.objectDescriptions.push({
        name: objectName,
        label: objectXmlParsed?.CustomObject?.label || "",
        description: String(objectXmlParsed?.CustomObject?.description || ""),
      });
      objectsForMenu[objectName] = "objects/" + objectName + ".md";
      if (this.withPdf) {
        await generatePdfFileFromMarkdown(objectMdFile);
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, this.objectFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();
    this.addNavNode("Objects", objectsForMenu);

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
    uxLog("action", this, c.cyan("Preparing generation of Flows Visual documentation... (if you don't want it, define GENERATE_FLOW_DOC=false in your environment variables)"));
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
    WebSocketClient.sendProgressStartMessage("Generating Flows documentation...", flowFiles.length);
    let counter = 0;
    for (const flowFile of flowFiles) {
      const flowName = path.basename(flowFile, ".flow-meta.xml");
      const flowXml = (await fs.readFile(flowFile, "utf8")).toString();
      const flowContent = await parseXmlFile(flowFile);
      this.flowDescriptions.push({
        name: flowName,
        description: flowContent?.Flow?.description?.[0] || "",
        type: flowContent?.Flow?.processType?.[0] === "Flow" ? "ScreenFlow" : flowContent?.Flow?.start?.[0]?.triggerType?.[0] ?? (flowContent?.Flow?.processType?.[0] || "ERROR (Unknown)"),
        object: flowContent?.Flow?.start?.[0]?.object?.[0] || flowContent?.Flow?.processMetadataValues?.filter(pmv => pmv.name[0] === "ObjectType")?.[0]?.value?.[0]?.stringValue?.[0] || "",
        impactedObjects: this.allObjectsNames.filter(objectName => flowXml.includes(`>${objectName}<`))
      });
      flowsForMenu[flowName] = "flows/" + flowName + ".md";
      const outputFlowMdFile = path.join(this.outputMarkdownRoot, "flows", flowName + ".md");
      if (this.diffOnly && !updatedFlowNames.includes(flowName) && fs.existsSync(outputFlowMdFile)) {
        flowSkips.push(flowFile);
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, flowFiles.length);
        continue;
      }
      uxLog("log", this, c.grey(`Generating markdown for Flow ${flowFile}...`));
      const genRes = await generateFlowMarkdownFile(flowName, flowXml, outputFlowMdFile, { collapsedDetails: false, describeWithAi: true, flowDependencies: flowDeps });
      if (!genRes) {
        flowErrors.push(flowFile);
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, flowFiles.length);
        continue;
      }
      if (this.debugMode) {
        await fs.copyFile(outputFlowMdFile, outputFlowMdFile.replace(".md", ".mermaid.md"));
      }
      const gen2res = await generateMarkdownFileWithMermaid(outputFlowMdFile, outputFlowMdFile, null, this.withPdf);
      if (!gen2res) {
        flowWarnings.push(flowFile);
        counter++;
        WebSocketClient.sendProgressStepMessage(counter, flowFiles.length);
        continue;
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, flowFiles.length);
    }
    WebSocketClient.sendProgressEndMessage();
    this.flowDescriptions = sortArray(this.flowDescriptions, { by: ['object', 'name'], order: ['asc', 'asc'] }) as any[]

    // History
    if (this.withHistory) {
      WebSocketClient.sendProgressStartMessage("Generating Flows History documentation...", flowFiles.length);
      let counter1 = 0;
      for (const flowFile of flowFiles) {
        const flowName = path.basename(flowFile, ".flow-meta.xml");
        const diffMdFile = path.join("docs", "flows", path.basename(flowFile).replace(".flow-meta.xml", "-history.md"));
        if (this.diffOnly && !updatedFlowNames.includes(flowName) && fs.existsSync(diffMdFile)) {
          counter1++;
          WebSocketClient.sendProgressStepMessage(counter1, flowFiles.length);
          continue;
        }
        try {
          await generateHistoryDiffMarkdown(flowFile, this.debugMode);
        } catch (e: any) {
          uxLog("warning", this, c.yellow(`Error generating history diff markdown: ${e.message}`));
        }
        counter1++;
        WebSocketClient.sendProgressStepMessage(counter1, flowFiles.length);
      }
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
    const flowTableLinesForIndex = DocBuilderFlow.buildIndexTable('', this.flowDescriptions, this.outputMarkdownRoot);
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
    uxLog("action", this, c.cyan("Preparing generation of Lightning Web Components documentation... " +
      "(if you don't want it, define GENERATE_LWC_DOC=false in your environment variables)"));

    const lwcForMenu: any = { "All Lightning Web Components": "lwc/index.md" };
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "lwc"));

    const packageDirs = this.project?.getPackageDirectories() || [];

    // Count total LWC components for progress tracking
    let totalLwcComponents = 0;
    for (const packageDir of packageDirs) {
      const lwcMetaFiles = await glob(`${packageDir.path}/**/lwc/**/*.js-meta.xml`, {
        cwd: process.cwd(),
        ignore: GLOB_IGNORE_PATTERNS
      });
      totalLwcComponents += lwcMetaFiles.length;
    }
    if (totalLwcComponents === 0) {
      uxLog("log", this, c.yellow("No Lightning Web Component found in the project"));
      return;
    }

    WebSocketClient.sendProgressStartMessage("Generating Lightning Web Components documentation...", totalLwcComponents);

    let counter = 0;
    // Find all LWC components in all package directories
    for (const packageDir of packageDirs) {
      // Find LWC components (directories with .js-meta.xml files)
      const lwcMetaFiles = await glob(`${packageDir.path}/**/lwc/**/*.js-meta.xml`, {
        cwd: process.cwd(),
        ignore: GLOB_IGNORE_PATTERNS
      });

      for (const lwcMetaFile of lwcMetaFiles) {
        counter++;
        WebSocketClient.sendProgressStepMessage(counter);

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

        // Generate the documentation file
        await new DocBuilderLwc(lwcName, "", mdFile, {
          LWC_PATH: lwcDirPath,
          LWC_NAME: lwcName,
          LWC_JS_CODE: jsContent,
          LWC_HTML_CODE: htmlContent,
          LWC_JS_META: lwcMetaXml
        }).generateMarkdownFileFromXml();

        if (this.withPdf) {
          await generatePdfFileFromMarkdown(mdFile);
        }
      }
    }

    WebSocketClient.sendProgressEndMessage();

    this.addNavNode("Lightning Web Components", lwcForMenu);

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

  private async generateVfDocumentation() {
    uxLog(
      "action",
      this,
      c.cyan(
        "Preparing generation of Visualforce Pages documentation... " +
        "(if you don't want it, define GENERATE_VF_DOC=false in your environment variables)"
      )
    );

    const projectRoot = this.projectRoot || process.cwd();
    const outputRoot = this.outputMarkdownRoot;

    // Configuration for VF documentation
    const vfConfig: VfDocBuilderConfig = {
      enableSecurityAnalysis: process.env.DISABLE_VF_SECURITY_ANALYSIS !== 'true',
      enablePerformanceMetrics: process.env.DISABLE_VF_PERFORMANCE_METRICS !== 'true',
      enableBestPractices: process.env.DISABLE_VF_BEST_PRACTICES !== 'true',
      enableCrossReferences: true,
      maxApexClassesToParse: parseInt(process.env.VF_MAX_APEX_CLASSES || '10')
    };

    // Get all VF files
    const vfFilePaths = await listVfFiles(projectRoot);
    if (vfFilePaths.length === 0) {
      uxLog("log", this, c.yellow("No Visualforce page files found."));
      return;
    }

    const vfDocResults: VfDocGenerationResult[] = [];
    WebSocketClient.sendProgressStartMessage("Generating Visualforce documentation...", vfFilePaths.length);

    let counter = 0;

    for (const vfFilePath of vfFilePaths) {
      try {
        const pageName = path.basename(vfFilePath, ".page");

        // Create DocBuilderVf instance with enhanced configuration
        const vfBuilder = new DocBuilderVf(pageName, vfFilePath, outputRoot, projectRoot, vfConfig);

        // Delegate the entire generation to DocBuilderVf
        const result = await vfBuilder.build();

        vfDocResults.push(result);

        counter++;
        WebSocketClient.sendProgressStepMessage(counter, vfFilePaths.length);

        // Add small delay to avoid overwhelming the system with large projects
        if (vfFilePaths.length > 10) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (err: any) {
        uxLog("warning", this, c.yellow(`Failed to generate documentation for ${vfFilePath}: ${err.message}`));
        if (typeof this.debug === 'function') {
          this.debug(err.stack);
        }
      }
    }

    WebSocketClient.sendProgressEndMessage();

    // --- Build index.md based on collected results ---
    const indexLines = [
      '# Visualforce Pages',
      '',
      `*Automatically generated documentation for ${vfDocResults.length} Visualforce pages*`,
      '',
    ];

    // Sort results by name for consistent menu order
    const sortedResults = vfDocResults.sort((a, b) => a.name.localeCompare(b.name));

    // Generate summary statistics
    const totalComponents = sortedResults.reduce((sum, result) => {
      const componentMatch = result.markdownContent.match(/Component Count: (\d+)/);
      return sum + (componentMatch ? parseInt(componentMatch[1]) : 0);
    }, 0);

    const pagesWithSecurityConcerns = sortedResults.filter(result =>
      result.markdownContent.includes('Potential SOQL Injection: ⚠️ Yes') ||
      result.markdownContent.includes('Potential XSS: ⚠️ Yes')
    ).length;

    indexLines.push('## Summary');
    indexLines.push(`- **Total Pages:** ${sortedResults.length}`);
    indexLines.push(`- **Total Components:** ${totalComponents}`);
    indexLines.push(`- **Pages with Security Concerns:** ${pagesWithSecurityConcerns}`);
    indexLines.push('');

    // Use the static buildIndexTable method from DocBuilderVf
    const indexTableLines = DocBuilderVf.buildIndexTable(outputRoot, sortedResults);
    indexLines.push(...indexTableLines);

    indexLines.push('', this.footer);
    await fs.writeFile(path.join(outputRoot, 'vf', 'index.md'), indexLines.join("\n"), 'utf-8');

    // Update class properties with a more structured list for internal use
    this.vfDescriptions = sortedResults.map(r => ({
      name: r.name,
      description: r.shortDescription,
      path: r.outputPath,
      hasSecurityConcerns: r.markdownContent.includes('Potential SOQL Injection: ⚠️ Yes') ||
        r.markdownContent.includes('Potential XSS: ⚠️ Yes')
    }));

    // For addNavNode, transform the collected results
    const vfForMenuTransformed: Record<string, string> = {};
    for (const result of sortedResults) {
      vfForMenuTransformed[result.name] = path.relative(outputRoot, result.outputPath);
    }
    this.addNavNode("Visualforce Pages", vfForMenuTransformed);

    uxLog("success", this, c.green(`Successfully generated documentation for ${sortedResults.length} Visualforce pages.`));

    // Log security summary
    if (pagesWithSecurityConcerns > 0) {
      uxLog("warning", this, c.yellow(`${pagesWithSecurityConcerns} pages have potential security concerns. Review the generated documentation.`));
    }

    // --- Optional PDF generation ---
    if (this.withPdf) {
      uxLog("action", this, c.cyan("Generating PDF files for Visualforce documentation..."));

      for (const result of sortedResults) {
        if (await fs.pathExists(result.outputPath)) {
          try {
            await generatePdfFileFromMarkdown(result.outputPath);
            uxLog("log", this, c.green(`PDF generated for ${result.name}`));
          } catch (err: any) {
            uxLog("warning", this, c.yellow(`Failed to generate PDF for ${result.name}: ${err.message}`));
          }
        }
      }
      uxLog("success", this, c.green("All Visualforce PDFs generated successfully."));
    }
  }

}
