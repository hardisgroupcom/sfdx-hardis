/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { buildOrgManifest } from '../../../../common/utils/deployUtils.js';
import { execCommand, filterPackageXml, uxLog } from '../../../../common/utils/index.js';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { CONSTANTS, getApiVersion, getConfig, getEnvVar } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { countPackageXmlItems, parsePackageXmlFile, writePackageXmlFile } from '../../../../common/utils/xmlUtils.js';
import Project2Markdown from '../../doc/project2markdown.js';
import MkDocsToSalesforce from '../../doc/mkdocs-to-salesforce.js';
import MkDocsToCloudflare from '../../doc/mkdocs-to-cf.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { makeFileNameGitCompliant } from '../../../../common/utils/gitUtils.js';
import { updateSfdxProjectApiVersion } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MonitorBackup extends SfCommand<any> {
  public static title = 'Backup DX sources';

  public static description = `Retrieve sfdx sources in the context of a monitoring backup

The command exists in 2 modes: filtered(default & recommended) and full.

## Filtered mode (default, better performances)

Automatically skips metadatas from installed packages with namespace.  

You can remove more metadata types from backup, especially in case you have too many metadatas and that provokes a crash, using:

- Manual update of \`manifest/package-skip-items.xml\` config file (then commit & push in the same branch)

  - Works with full wildcard (\`<members>*</members>\`) , named metadata (\`<members>Account.Name</members>\`) or partial wildcards names (\`<members>pi__*</members>\` , \`<members>*__dlm</members>\` , or \`<members>prefix*suffix</members>\`)

- Environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES (example: \`MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation\`): that will be applied to all monitoring branches.

## Full mode

Activate it with **--full** parameter, or variable MONITORING_BACKUP_MODE_FULL=true

Ignores filters (namespaces items & manifest/package-skip-items.xml) to retrieve ALL metadatas, including those you might not care about (reports, translations...)

As we can retrieve only 10000 files by call, the list of all metadatas will be chunked to make multiple calls (and take more time than filtered mode)

- if you use \`--full-apply-filters\` , manifest/package-skip-items.xml and MONITORING_BACKUP_SKIP_METADATA_TYPES filters will be applied anyway
- if you use \`--exclude-namespaces\` , namespaced items will be ignored

_With those both options, it's like if you are not using --full, but with chunked metadata download_

## In CI/CD

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-metadata-backup/) and can output Grafana, Slack and MsTeams Notifications.

## Troubleshooting

If you have unknown errors (it happens !), you can investigate using the full command with smaller chunks.

Example: \`sf hardis:org:monitor:backup --full --exclude-namespaces --full-apply-filters --max-by-chunk 500\`

It will allow you the identify the responsible metadata and ignore it using package-skip-items.xml or MONITORING_BACKUP_SKIP_METADATA_TYPES env variable.

## Documentation

[Doc generation (including visual flows)](${CONSTANTS.DOC_URL_ROOT}/hardis/doc/project2markdown/) is triggered at the end of the command.

If you want to also upload HTML Documentation on your Salesforce Org as static resource, use variable **SFDX_HARDIS_DOC_DEPLOY_TO_ORG="true"**

If you want to also upload HTML Documentation on Cloudflare, use variable **SFDX_HARDIS_DOC_DEPLOY_TO_CLOUDFLARE="true"**

- If you want to generate the documentation in multiple languages, define variable SFDX_DOC_LANGUAGES (ex: SFDX_DOC_LANGUAGES=en,fr,de)
- You can define one Cloudflare site by language, for example with the following variables:
  - CLOUDFLARE_PROJECT_NAME_EN=cloudity-demo-english
  - CLOUDFLARE_PROJECT_NAME_FR=cloudity-demo-french
  - CLOUDFLARE_PROJECT_NAME_DE=cloudity-demo-german

If Flow history doc always display a single state, you probably need to update your workflow configuration:

- on Gitlab: Env variable [\`GIT_FETCH_EXTRA_FLAGS: --depth 10000\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.gitlab-ci.yml#L11)
- on GitHub: [\`fetch-depth: 0\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.github/workflows/org-monitoring.yml#L58)
- on Azure: [\`fetchDepth: "0"\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/azure-pipelines.yml#L39)
- on Bitbucket: [\`step: clone: depth: full\`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/bitbucket-pipelines.yml#L18)
`;

  public static examples = [
    '$ sf hardis:org:monitor:backup',
    '$ sf hardis:org:monitor:backup --full',
    '$ sf hardis:org:monitor:backup --full --exclude-namespaces',
    '$ sf hardis:org:monitor:backup --full --exclude-namespaces --full-apply-filters'
  ];

  public static flags: any = {
    full: Flags.boolean({
      description: 'Dot not take in account filtering using package-skip-items.xml and MONITORING_BACKUP_SKIP_METADATA_TYPES. Efficient but much much slower !',
    }),
    "max-by-chunk": Flags.integer({
      char: "m",
      default: 3000,
      description: 'If mode --full is activated, maximum number of metadatas in a package.xml chunk',
    }),
    "exclude-namespaces": Flags.boolean({
      char: "e",
      default: false,
      description: 'If mode --full is activated, exclude namespaced metadatas',
    }),
    "full-apply-filters": Flags.boolean({
      char: "z",
      default: false,
      description: 'If mode --full is activated, apply filters of manifest/package-skip-items.xml and MONITORING_BACKUP_SKIP_METADATA_TYPES anyway',
    }),
    "start-chunk": Flags.integer({
      default: 1,
      description: 'Use this parameter to troubleshoot a specific chunk. It will be used as the first chunk to retrieve',
    }),
    "skip-doc": Flags.boolean({
      default: false,
      description: 'Skip the generation of project documentation at the end of the command',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  protected diffFiles: any[] = [];
  protected diffFilesSimplified: any[] = [];
  protected full: boolean = false;
  protected maxByChunk: number = 3000;
  protected startChunk: number = 1;
  protected excludeNamespaces: boolean = false;
  protected fullApplyFilters: boolean = false;
  protected skipDoc: boolean = false;

  protected packageXmlToRemove: string | null = null;
  protected extractPackageXmlChunks: any[] = [];
  protected currentPackage: any = {};
  protected currentPackageLen = 0;

  protected namespaces: string[];
  protected installedPackages: any[];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MonitorBackup);
    this.full = flags.full || (process.env?.MONITORING_BACKUP_MODE_FULL === "true" ? true : false);
    this.maxByChunk = flags["max-by-chunk"] || 3000;
    this.startChunk = flags["start-chunk"] || 1;
    this.excludeNamespaces = flags["exclude-namespaces"] === true ? true : false;
    this.fullApplyFilters = flags["full-apply-filters"] === true ? true : false;
    this.skipDoc = flags["skip-doc"] === true ? true : false;
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // Update apiVersion if necessary
    await updateSfdxProjectApiVersion();

    // Build target org full manifest
    uxLog(
      "action",
      this,
      c.cyan('Building full manifest for org ' + c.bold(flags['target-org'].getConnection().instanceUrl)) + ' ...'
    );
    const packageXmlFullFile = 'manifest/package-all-org-items.xml';
    await buildOrgManifest('', packageXmlFullFile, flags['target-org'].getConnection());

    // List namespaces used in the org
    this.namespaces = [];
    this.installedPackages = await MetadataUtils.listInstalledPackages(null, this);
    for (const installedPackage of this.installedPackages) {
      if (installedPackage?.SubscriberPackageNamespace !== '' && installedPackage?.SubscriberPackageNamespace != null) {
        this.namespaces.push(installedPackage.SubscriberPackageNamespace);
      }
    }

    // Create force-app/main/default if not exists
    await fs.ensureDir(path.join(process.cwd(), 'force-app', 'main', 'default'));

    // Check if we have package-skip_items.xml
    if (this.full) {
      await this.extractMetadatasFull(packageXmlFullFile, flags);
    }
    else {
      await this.extractMetadatasFiltered(packageXmlFullFile, flags);
    }

    // Write installed packages
    uxLog("action", this, c.cyan(`Write installed packages ...`));
    const installedPackagesLog: any[] = [];
    const packageFolder = path.join(process.cwd(), 'installedPackages');
    await fs.ensureDir(packageFolder);
    for (const installedPackage of this.installedPackages) {
      const fileName = (installedPackage.SubscriberPackageName || installedPackage.SubscriberPackageId) + '.json';
      const fileNameNoSep = makeFileNameGitCompliant(fileName); // Handle case when package name contains slashes or colon
      delete installedPackage.Id; // Not needed for diffs
      await fs.writeFile(path.join(packageFolder, fileNameNoSep), JSON.stringify(installedPackage, null, 2));
      const installedPackageLog = {
        SubscriberPackageName: installedPackage.SubscriberPackageName,
        SubscriberPackageNamespace: installedPackage.SubscriberPackageNamespace,
        SubscriberPackageVersionId: installedPackage.SubscriberPackageVersionId,
        SubscriberPackageVersionName: installedPackage.SubscriberPackageVersionName,
        SubscriberPackageVersionNumber: installedPackage.SubscriberPackageVersionNumber,
      };
      installedPackagesLog.push(installedPackageLog);
      // Clean repo: Remove previous versions of file names
      const fileNameNoSepBad1 = fileName.replace(/\//g, '_').replace(/:/g, '_');
      const fileNameNoSepBad2 = fileName;
      for (const oldFileName of [fileNameNoSepBad1, fileNameNoSepBad2]) {
        if (oldFileName === fileNameNoSep) {
          continue;
        }
        const oldFilePath = path.join(packageFolder, oldFileName);
        if (fs.existsSync(oldFilePath)) {
          await fs.remove(oldFilePath);
        }
      }

    }

    this.diffFiles = await MetadataUtils.listChangedFiles();

    // Write output file
    if (this.diffFiles.length > 0) {
      const filesHumanUnformatted = MetadataUtils.getMetadataPrettyNames(this.diffFiles.map((diffFile) => diffFile.path), false);
      const severityIconLog = getSeverityIcon('log');
      this.outputFile = await generateReportPath('backup-updated-files', this.outputFile);
      this.diffFilesSimplified = this.diffFiles.map((diffFile) => {
        return {
          File: diffFile.path.replace('force-app/main/default/', ''),
          ChangeType: diffFile.index === '?' ? 'A' : diffFile.index,
          FileHuman: filesHumanUnformatted.get(diffFile.path) || diffFile.path.replace('force-app/main/default/', ''),
          WorkingDir: diffFile.working_dir === '?' ? '' : diffFile.working_dir,
          PrevName: diffFile?.from || '',
          severity: 'log',
          severityIcon: severityIconLog,
        };
      });
      this.outputFilesRes = await generateCsvFile(this.diffFilesSimplified, this.outputFile, { fileTitle: 'Updated Metadatas' });
    }

    // Build notifications
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No updates detected in ${orgMarkdown}`;
    let notifAttachments: MessageAttachment[] = [];
    if (this.diffFiles.length > 0) {
      const filesHumanFormatted = MetadataUtils.getMetadataPrettyNames(this.diffFiles.map((diffFile) => diffFile.path), true);
      notifSeverity = 'info';
      notifText = `Updates detected in ${orgMarkdown}`;
      notifAttachments = [
        {
          text: this.diffFiles
            .map((diffFile) => {
              let flag = '';
              if (diffFile.index && diffFile.index !== ' ') {
                flag = ` (${diffFile.index === '?' ? 'A' : diffFile.index})`;
              }
              const line = `• ${filesHumanFormatted.get(diffFile.path)}` + flag;
              return line;
            })
            .join('\n'),
        },
      ];
    } else {
      uxLog("log", this, c.grey("No updated metadata for today's backup 😊"));
    }

    // Post notifications
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'BACKUP',
      text: notifText,
      buttons: notifButtons,
      attachments: notifAttachments,
      severity: notifSeverity,
      sideImage: 'backup',
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.diffFilesSimplified,
      data: {
        metric: this.diffFilesSimplified.length,
        installedPackages: installedPackagesLog,
      },
      metrics: {
        UpdatedMetadatas: this.diffFilesSimplified.length,
      },
    });

    // Run project documentation generation
    if (this.skipDoc !== true) {
      try {
        const docLanguages = (getEnvVar('SFDX_DOC_LANGUAGES') || getEnvVar('PROMPTS_LANGUAGE') || 'en').split(",").reverse(); // Can be 'fr,en,de' for example
        const prevPromptsLanguage = getEnvVar('PROMPTS_LANGUAGE') || 'en';
        for (const langKey of docLanguages) {
          uxLog("action", this, c.cyan("Generating doc in language " + c.bold(langKey)));
          process.env.PROMPTS_LANGUAGE = langKey;
          await Project2Markdown.run(["--diff-only", "--with-history"]);
          uxLog("action", this, c.cyan("Documentation generated from retrieved sources. If you want to skip it, use option --skip-doc"));
          const config = await getConfig("user");
          if (config.docDeployToOrg || process.env?.SFDX_HARDIS_DOC_DEPLOY_TO_ORG === "true") {
            await MkDocsToSalesforce.run(["--type", "Monitoring"]);
          }
          else if (config.docDeployToCloudflare || process.env?.SFDX_HARDIS_DOC_DEPLOY_TO_CLOUDFLARE === "true") {
            await MkDocsToCloudflare.run([]);
          }
        }
        process.env.PROMPTS_LANGUAGE = prevPromptsLanguage;
      } catch (e: any) {
        uxLog("warning", this, c.yellow("Error while generating project documentation " + e.message));
        uxLog("log", this, c.grey(e.stack));
      }
    }

    return { outputString: 'BackUp processed on org ' + flags['target-org'].getConnection().instanceUrl };
  }

  private async extractMetadatasFull(packageXmlFullFile: string, flags) {
    let packageXmlToExtract = packageXmlFullFile;
    // Filter namespaces if requested in the command
    if (this.excludeNamespaces || process.env?.SFDX_HARDIS_BACKUP_EXCLUDE_NAMESPACES === "true" || this.fullApplyFilters) {
      packageXmlToExtract = await this.buildFilteredManifestsForRetrieve(packageXmlFullFile);
      const packageXmlFullFileWithoutNamespace = 'manifest/package-all-org-items-except-namespaces.xml';
      const namespacesToFilter = (this.excludeNamespaces || process.env?.SFDX_HARDIS_BACKUP_EXCLUDE_NAMESPACES === "true") ? this.namespaces : [];
      await filterPackageXml(packageXmlFullFile, packageXmlFullFileWithoutNamespace, {
        removeNamespaces: namespacesToFilter,
        removeStandard: this.fullApplyFilters,
        removeFromPackageXmlFile: this.packageXmlToRemove,
        updateApiVersion: getApiVersion(),
      });
      packageXmlToExtract = packageXmlFullFileWithoutNamespace;
    }

    // Build packageXml chunks
    const packageElements = await parsePackageXmlFile(packageXmlToExtract);

    // Handle predefined chunks
    const predefinedChunkTypes = [
      { types: ["CustomLabel"], memberMode: "*" },
      // { types: ["CustomObject", "Profile"] },
      { types: ["SharingRules", "SharingOwnerRule", "SharingCriteriaRule"] },
      { types: ["Workflow", "WorkflowAlert", "WorkflowFieldUpdate", "WorkflowRule"] }
    ]
    for (const predefinedChunkType of predefinedChunkTypes) {
      if (predefinedChunkType.types.some(mdType => Object.keys(packageElements).includes(mdType))) {
        for (const mdType of predefinedChunkType.types) {
          if (predefinedChunkType.memberMode === "*") {
            this.currentPackage[mdType] = "*";
          }
          else {
            this.currentPackage[mdType] = packageElements[mdType];
          }
          delete packageElements[mdType];
        }
        this.manageAddCurrentPackageInChunks();
      }
    }

    // Handle other chunks
    for (const metadataType of Object.keys(packageElements)) {
      const members = packageElements[metadataType];
      // If current chunk would be too big, store it then create a new one
      if ((this.currentPackageLen + members.length) > this.maxByChunk) {
        this.manageAddCurrentPackageInChunks();
      }
      // If a metadata type has too many members for a single chunk: split it into chunks !
      if (members.length > this.maxByChunk) {
        this.manageAddCurrentPackageInChunks();
        const memberChunks = Array.from({ length: Math.ceil(members.length / this.maxByChunk) }, (_, i) => members.slice(i * this.maxByChunk, (i + 1) * this.maxByChunk));
        for (const memberChunk of memberChunks) {
          this.currentPackage[metadataType] = memberChunk;
          this.manageAddCurrentPackageInChunks();
        }
      }
      // Add to current chunk
      else {
        this.currentPackage[metadataType] = members;
        this.currentPackageLen += members.length
      }
    }
    this.manageAddCurrentPackageInChunks();

    // Write chunks into package.xml files
    let pos = 0;
    const packageXmlChunkFiles: string[] = [];
    const chunksFolder = path.join("manifest", "chunks");
    await fs.ensureDir(chunksFolder);
    uxLog("action", this, c.cyan(`Building package.xml files for ${this.extractPackageXmlChunks.length} chunks...`));
    for (const packageChunk of this.extractPackageXmlChunks) {
      pos++;
      const packageChunkFileName = path.join(chunksFolder, "chunk-" + pos + ".xml");
      await writePackageXmlFile(packageChunkFileName, packageChunk);
      packageXmlChunkFiles.push(packageChunkFileName);
      uxLog("log", this, c.grey(`Chunk ${pos} -> ${packageChunkFileName}:`))
      for (const mdType of Object.keys(packageChunk)) {
        uxLog("log", this, c.grey(`- ${mdType} (${packageChunk?.[mdType]?.length || 0} elements)`));
      }
      uxLog("other", this, "");
    }

    // Retrieve metadatas for each chunk
    uxLog("action", this, c.cyan(`Starting the retrieve of ${packageXmlChunkFiles.length} chunks...`));
    let posChunk = 0;
    for (const packageXmlChunkFile of packageXmlChunkFiles) {
      posChunk++;
      if (this.startChunk > posChunk) {
        uxLog("log", this, c.grey(`Skipping chunk ${posChunk} (${packageXmlChunkFile}) according to --start-chunk option`));
        continue;
      }
      await this.retrievePackageXml(packageXmlChunkFile, flags);
    }
  }

  private manageAddCurrentPackageInChunks() {
    if (Object.keys(this.currentPackage).length > 0) {
      this.extractPackageXmlChunks.push(Object.assign({}, this.currentPackage));
      this.currentPackage = {};
      this.currentPackageLen = 0;
    }
  }

  private async extractMetadatasFiltered(packageXmlFullFile: string, flags) {
    const packageXmlBackUpItemsFile = await this.buildFilteredManifestsForRetrieve(packageXmlFullFile);

    // Apply filters to package.xml
    uxLog("action", this, c.cyan(`Reducing content of ${packageXmlFullFile} to generate ${packageXmlBackUpItemsFile} ...`));
    await filterPackageXml(packageXmlFullFile, packageXmlBackUpItemsFile, {
      removeNamespaces: this.namespaces,
      removeStandard: true,
      removeFromPackageXmlFile: this.packageXmlToRemove,
      updateApiVersion: getApiVersion(),
    });

    // Retrieve sfdx sources in local git repo
    await this.retrievePackageXml(packageXmlBackUpItemsFile, flags);
  }

  private async buildFilteredManifestsForRetrieve(packageXmlFullFile: string) {
    const packageXmlBackUpItemsFile = 'manifest/package-backup-items.xml';
    const packageXmlSkipItemsFile = 'manifest/package-skip-items.xml';
    if (fs.existsSync(packageXmlSkipItemsFile)) {
      uxLog(
        "log",
        this,
        c.grey(
          `${packageXmlSkipItemsFile} has been found and will be use to reduce the content of ${packageXmlFullFile} ...`
        )
      );
      this.packageXmlToRemove = packageXmlSkipItemsFile;
    }

    // Add more metadata types to ignore using global variable MONITORING_BACKUP_SKIP_METADATA_TYPES
    const additionalSkipMetadataTypes = process.env?.MONITORING_BACKUP_SKIP_METADATA_TYPES;
    if (additionalSkipMetadataTypes) {
      uxLog(
        "log",
        this,
        c.grey(
          `En var MONITORING_BACKUP_SKIP_METADATA_TYPES has been found and will also be used to reduce the content of ${packageXmlFullFile} ...`
        )
      );
      let packageSkipItems = {};
      if (fs.existsSync(this.packageXmlToRemove || '')) {
        packageSkipItems = await parsePackageXmlFile(this.packageXmlToRemove || '');
      }
      for (const metadataType of additionalSkipMetadataTypes.split(',')) {
        packageSkipItems[metadataType] = ['*'];
      }
      this.packageXmlToRemove = 'manifest/package-skip-items-dynamic-do-not-update-manually.xml';
      await writePackageXmlFile(this.packageXmlToRemove, packageSkipItems);
    }
    return packageXmlBackUpItemsFile;
  }

  private async retrievePackageXml(packageXmlBackUpItemsFile: string, flags: any) {
    const nbRetrievedItems = await countPackageXmlItems(packageXmlBackUpItemsFile);
    const packageXml = await parsePackageXmlFile(packageXmlBackUpItemsFile);
    uxLog("action", this, c.cyan(`Run the retrieve command for ${path.basename(packageXmlBackUpItemsFile)}, containing ${nbRetrievedItems} items:`));
    const mdTypesString = Object.keys(packageXml).map((mdType) => {
      return `- ${mdType} (${packageXml?.[mdType]?.length || 0})`;
    }).join('\n');
    uxLog("log", this, c.grey(mdTypesString));
    try {
      await execCommand(
        `sf project retrieve start -x "${packageXmlBackUpItemsFile}" -o ${flags['target-org'].getUsername()} --ignore-conflicts --wait 120`,
        this,
        {
          fail: true,
          output: true,
          debug: this.debugMode,
        }
      );
    } catch (e) {
      const failedPackageXmlContent = await fs.readFile(packageXmlBackUpItemsFile, 'utf8');
      uxLog("warning", this, c.yellow('BackUp package.xml that failed to be retrieved:\n' + c.grey(failedPackageXmlContent)));
      if (this.full) {
        uxLog(
          "error",
          this,
          c.red(
            c.bold(
              'This should not happen: Please report the issue on sfdx-hardis repository: https://github.com/hardisgroupcom/sfdx-hardis/issues'
            )
          )
        );
      }
      else {
        uxLog(
          "error",
          this,
          c.red(
            c.bold(
              'Crash during backup. You may exclude more metadata types by updating file manifest/package-skip-items.xml then commit and push it, or use variable MONITORING_BACKUP_SKIP_METADATA_TYPES'
            )
          )
        );
      }
      uxLog(
        "warning",
        this,
        c.yellow(
          c.bold(
            `See troubleshooting doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-config-home/#troubleshooting`
          )
        )
      );
      throw e;
    }
  }
}
