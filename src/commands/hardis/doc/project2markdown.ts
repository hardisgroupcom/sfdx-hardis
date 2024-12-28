/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import sortArray from 'sort-array';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { generatePackageXmlMarkdown } from '../../../common/utils/docUtils.js';
import { countPackageXmlItems, parseXmlFile } from '../../../common/utils/xmlUtils.js';
import { bool2emoji, execSfdxJson, getCurrentGitBranch, getGitRepoName, uxLog } from '../../../common/utils/index.js';
import { CONSTANTS, getConfig } from '../../../config/index.js';
import { listMajorOrgs } from '../../../common/utils/orgConfigUtils.js';
import { glob } from 'glob';
import { listFlowFiles } from '../../../common/utils/projectUtils.js';
import { generateFlowMarkdownFile, generateHistoryDiffMarkdown, generateMarkdownFileWithMermaid } from '../../../common/utils/mermaidUtils.js';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import { PACKAGE_ROOT_DIR } from '../../../settings.js';
import yaml from 'js-yaml';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Project2Markdown extends SfCommand<any> {
  public static title = 'SFDX Project to Markdown';

  public static htmlInstructions = `## Doc HTML Pages

To read the documentation as HTML pages, run the following code (you need python on your computer)

\`\`\`python
pip install mkdocs-material mdx_truly_sane_lists
mkdocs serve
\`\`\`

To just generate HTML pages that you can host anywhere, run \`mkdocs build\`
`

  public static description = `Generates a markdown documentation from a SFDX project

- Package.xml files
- Source Packages
- sfdx-hardis configuration
- Installed packages

Can work on any sfdx project, no need for it to be a sfdx-hardis flavored one.

Generates markdown files will be written in **docs** folder (except README.md where a link to doc index is added)

To generate Flow documentations, this command requires @mermaid-js/mermaid-cli

- Run \`npm install @mermaid-js/mermaid-cli --global\` if puppeteer works in your environment
- It can also be run as a docker image

Both modes will be tried by default, but you can also force one of them by defining environment variable \`MERMAID_MODES=docker\` or \`MERMAID_MODES=cli\`

_sfdx-hardis docker image is alpine-based and does not succeed to run mermaid/puppeteer: if you can help, please submit a PR !_

![Screenshot flow doc](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-flow-doc.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc-2.jpg)

${this.htmlInstructions}
`;

  public static examples = [
    '$ sf hardis:doc:project2markdown',
  ];

  public static flags: any = {
    "diff-only": Flags.boolean({
      default: false,
      description: "Generate documentation only for changed files (used for monitoring)",
    }),
    "with-history": Flags.boolean({
      char: 'd',
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
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Project2Markdown);
    this.diffOnly = flags["diff-only"] === true ? true : false;
    this.withHistory = flags["with-history"] === true ? true : false;
    this.debugMode = flags.debug || false;

    await fs.ensureDir(this.outputMarkdownRoot);
    const currentBranch = await getCurrentGitBranch()
    this.footer = `_Documentation generated from branch ${currentBranch} with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) command [\`sf hardis:doc:project2markdown\`](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/)_`;

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
    await this.generatePackageXmlMarkdown(this.packageXmlCandidates);
    const packageLines = await this.buildPackagesIndex();
    this.mdLines.push(...packageLines);
    await fs.writeFile(path.join(this.outputMarkdownRoot, "manifests.md"), packageLines.join("\n") + `\n${this.footer}\n`);

    // List managed packages
    const installedPackages = await this.buildInstalledPackages();
    this.mdLines.push(...installedPackages);
    await fs.writeFile(path.join(this.outputMarkdownRoot, "installed-packages.md"), installedPackages.join("\n") + `\n${this.footer}\n`);
    this.mkDocsNavNodes["Installed Packages"] = "installed-packages.md";

    // List flows & generate doc
    if (!(process?.env?.GENERATE_FLOW_DOC === 'false')) {
      await this.generateFlowsDocumentation();
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
    const mkdocsYml: any = yaml.load(
      fs
        .readFileSync(mkdocsYmlFile, 'utf-8')
        .replace('!!python/name:materialx.emoji.twemoji', "'!!python/name:materialx.emoji.twemoji'")
        .replace('!!python/name:materialx.emoji.to_svg', "'!!python/name:materialx.emoji.to_svg'")
    );
    if (!mkdocsYml.nav) {
      mkdocsYml.nav = {}
    }
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
    /* jscpd:ignore-start */
    const mkdocsYmlStr = yaml
      .dump(mkdocsYml)
      .replace("'!!python/name:materialx.emoji.twemoji'", '!!python/name:materialx.emoji.twemoji')
      .replace("'!!python/name:materialx.emoji.to_svg'", '!!python/name:materialx.emoji.to_svg');
    await fs.writeFile(mkdocsYmlFile, mkdocsYmlStr);
    uxLog(this, c.cyan(`Updated ${c.green(mkdocsYmlFile)}`));
    uxLog(this, c.cyan(`To generate a HTML WebSite with this documentation with a single command, see instructions at ${CONSTANTS.DOC_URL_ROOT}/hardis/doc/project2markdown/`));
    /* jscpd:ignore-end */
  }

  private async generateFlowsDocumentation() {
    uxLog(this, c.cyan("Generating Flows Visual documentation... (if you don't want it, define GENERATE_FLOW_DOC=false in your environment variables)"));
    const flowsForMenu: any = { "All flows": "flows/index.md" }
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "flows"));
    const packageDirs = this.project?.getPackageDirectories();
    const updatedFlowNames = !this.diffOnly ?
      [] :
      (await MetadataUtils.listChangedFiles()).filter(f => f?.path?.endsWith(".flow-meta.xml")).map(f => path.basename(f.path, ".flow-meta.xml"));
    const flowFiles = await listFlowFiles(packageDirs);
    const flowErrors: string[] = [];
    const flowWarnings: string[] = [];
    const flowSkips: string[] = [];
    const flowDescriptions: any[] = [];
    for (const flowFile of flowFiles) {
      const flowName = path.basename(flowFile, ".flow-meta.xml");
      uxLog(this, c.grey(`Generating markdown for Flow ${flowFile}...`));
      const flowXml = (await fs.readFile(flowFile, "utf8")).toString();
      const flowContent = await parseXmlFile(flowFile);
      flowDescriptions.push({
        name: flowName,
        description: flowContent?.Flow?.description?.[0] || "",
        type: flowContent?.Flow?.processType?.[0] === "Flow" ? "ScreenFlow" : flowContent?.Flow?.start?.[0]?.triggerType?.[0] ?? (flowContent?.Flow?.processType?.[0] || "ERROR (Unknown)"),
        object: flowContent?.Flow?.start?.[0]?.object?.[0] || flowContent?.Flow?.processMetadataValues?.filter(pmv => pmv.name[0] === "ObjectType")?.[0]?.value?.[0]?.stringValue?.[0] || ""
      });
      flowsForMenu[flowName] = "flows/" + flowName + ".md";
      if (this.diffOnly && !updatedFlowNames.includes(flowName)) {
        flowSkips.push(flowFile);
        continue;
      }
      const outputFlowMdFile = path.join(this.outputMarkdownRoot, "flows", flowName + ".md");
      const genRes = await generateFlowMarkdownFile(flowFile, flowXml, outputFlowMdFile, { collapsedDetails: false });
      if (!genRes) {
        flowErrors.push(flowFile);
        continue;
      }
      if (this.debugMode) {
        await fs.copyFile(outputFlowMdFile, outputFlowMdFile.replace(".md", ".mermaid.md"));
      }
      const gen2res = await generateMarkdownFileWithMermaid(outputFlowMdFile);
      if (!gen2res) {
        flowWarnings.push(flowFile);
        continue;
      }
    }
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

    // History
    if (this.withHistory) {
      uxLog(this, c.cyan("Generating Flows Visual Git Diff History documentation..."));
      for (const flowFile of flowFiles) {
        try {
          await generateHistoryDiffMarkdown(flowFile, this.debugMode);
        } catch (e: any) {
          uxLog(this, c.yellow(`Error generating history diff markdown: ${e.message}`));
        }
      }
    }

    // Write table on doc index
    const flowTableLines = await this.buildFlowsTable(flowDescriptions, 'flows/');
    this.mdLines.push(...flowTableLines);
    this.mdLines.push(...["___", ""]);

    // Write index file for flow folder
    await fs.ensureDir(path.join(this.outputMarkdownRoot, "flows"));
    const flowTableLinesForIndex = await this.buildFlowsTable(flowDescriptions, '');
    const flowIndexFile = path.join(this.outputMarkdownRoot, "flows", "index.md");
    await fs.writeFile(flowIndexFile, flowTableLinesForIndex.join("\n") + `\n${this.footer}\n`);

    this.mkDocsNavNodes["Flows"] = flowsForMenu;
    uxLog(this, c.green(`Successfully generated doc index for Flows at ${flowIndexFile}`));
  }

  private humanDisplay(flows) {
    return flows.map(flow => path.basename(flow, ".flow-meta.xml")).join(", ");
  }

  private async buildFlowsTable(flowDescriptions: any[], prefix: string) {
    const lines: string[] = [];
    lines.push(...[
      "## Flows",
      "",
      "| Object | Name      | Type | Description |",
      "| :----  | :-------- | :--: | :---------- | "
    ]);
    for (const flow of sortArray(flowDescriptions, { by: ['object', 'name'], order: ['asc', 'asc'] }) as any[]) {
      const outputFlowHistoryMdFile = path.join(this.outputMarkdownRoot, "flows", flow.name + "-history.md");
      const flowNameCell = fs.existsSync(outputFlowHistoryMdFile) ?
        `[${flow.name}](${prefix}${flow.name}.md) [🕒](${prefix}${flow.name}-history.md)` :
        `[${flow.name}](${prefix}${flow.name}.md)`;
      lines.push(...[
        `| ${flow.object} | ${flowNameCell} | ${flow.type} | ${flow.description} |`
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
      const matchingPackageFiles = await glob(findManagedPattern, { cwd: packageFolder });
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
    sfdxParamsTableLines.push(`| installPackagesDuringCheckDeploy | ${bool2emoji(installPackagesDuringCheckDeploy)} | [Install 1GP & 2GP packages during deployment check CI/CD job](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/#packages-installation) |`);
    const useDeltaDeployment = this.sfdxHardisConfig?.useDeltaDeployment ?? false;
    sfdxParamsTableLines.push(`| useDeltaDeployment | ${bool2emoji(useDeltaDeployment)} | [Deploys only updated metadatas , only when a MR/PR is from a minor branch to a major branch](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-delta-deployment/#delta-mode) |`);
    const useSmartDeploymentTests = this.sfdxHardisConfig?.useSmartDeploymentTests ?? false;
    sfdxParamsTableLines.push(`| useSmartDeploymentTests | ${bool2emoji(useSmartDeploymentTests)} | [Skip Apex test cases if delta metadatas can not impact them, only when a MR/PR is from a minor branch to a major branch](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/#smart-deployments-tests) |`);
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
        "## Major branches and orgs",
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

  private async generatePackageXmlMarkdown(packageXmlCandidates) {
    // Generate packageXml doc when found
    for (const packageXmlCandidate of packageXmlCandidates) {
      if (fs.existsSync(packageXmlCandidate.path)) {
        // Generate markdown for package.xml
        const packageMarkdownFile = await generatePackageXmlMarkdown(packageXmlCandidate.path, null, packageXmlCandidate);
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
