/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import fs, { ensureDir } from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { generatePackageXmlMarkdown } from '../../../common/utils/docUtils.js';
import { countPackageXmlItems } from '../../../common/utils/xmlUtils.js';
import { execSfdxJson, uxLog } from '../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Project2Markdown extends SfCommand<any> {
  public static title = 'SFDX Project to Markdown';

  public static description = `Generates a markdown documentation from a SFDX project`;

  public static examples = [
    '$ sf hardis:doc:project2markdown',
  ];

  public static flags: any = {
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

  protected packageXmlCandidates: any[];
  protected outputMarkdownIndexFile = "docs/index.md"
  protected mdLines: string[] = [];
  protected outputPackageXmlMarkdownFiles: any[] = [];
  protected debugMode = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Project2Markdown);
    this.debugMode = flags.debug || false;
    this.packageXmlCandidates = this.listPackageXmlCandidates();

    // General configuration
    const packageDirs = this.project?.getPackageDirectories();
    if (!(packageDirs?.length === 1 && packageDirs[0].name === "force-app" && fs.existsSync("manifest/package.xml"))) {
      for (const packageDir of packageDirs || []) {
        // Generate manifest from package folder
        const packageManifestFile = path.join("manifest", packageDir.name + '-package.xml');
        await ensureDir(path.dirname(packageManifestFile));
        await execSfdxJson("sf project generate manifest" +
          ` --source-dir ${packageDir.path}` +
          ` --name ${packageManifestFile}`, this, {});
        // Add package in available packages list
        this.packageXmlCandidates.push({
          path: packageManifestFile,
          description: `Package.xml generated from content of package ${packageDir.name} (folder ${packageDir.path})`
        });
      }
    }


    // List all packageXml files and generate related markdown
    await this.generatePackageXmlMarkdown(this.packageXmlCandidates);
    await this.writePackagesInIndex();

    // Write output index file
    await fs.ensureDir(path.dirname(this.outputMarkdownIndexFile));
    await fs.writeFile(this.outputMarkdownIndexFile, this.mdLines.join("\n") + "\n");
    uxLog(this, c.green(`Successfully generated doc index at ${this.outputMarkdownIndexFile}`));

    return { outputPackageXmlMarkdownFiles: this.outputPackageXmlMarkdownFiles };
  }

  private async writePackagesInIndex() {
    this.mdLines.push(...[
      "## Package XML files",
      "",
      "| Package name | Description |",
      "| :----------- | :---------- |"
    ]);

    for (const outputPackageXmlDef of this.outputPackageXmlMarkdownFiles) {
      const metadataNb = await countPackageXmlItems(outputPackageXmlDef.path);
      const packageMdFile = path.basename(outputPackageXmlDef.path) + ".md";
      const packageTableLine = `| [${path.basename(outputPackageXmlDef.path)}](${packageMdFile}) (${metadataNb}) | ${outputPackageXmlDef.description} |`;
      this.mdLines.push(packageTableLine);
    }
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
        description: "Contains the entire list of metadatas that are present in the monitored orgs (not all of them are in the git backup)"
      },
      {
        path: "manifest/package-backup-items.xml",
        description: "Contains the list of metadatas that are in the git backup"
      },
      {
        path: "manifest/package-skip-items.xml",
        description: "Contains the list of metadatas that are excluded from the backup.\n\nOther metadata types might be skipped using environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES"
      },
    ];
  }

}
