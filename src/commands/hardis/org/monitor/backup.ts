/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { buildOrgManifest } from '../../../../common/utils/deployUtils.js';
import { execCommand, filterPackageXml, isCI, uxLog } from '../../../../common/utils/index.js';
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
import MkDocsToConfluence from '../../doc/mkdocs-to-confluence.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { makeFileNameGitCompliant } from '../../../../common/utils/gitUtils.js';
import { updateSfdxProjectApiVersion } from '../../../../common/utils/projectUtils.js';
import { reinitI18n, t } from '../../../../common/utils/i18n.js';
import { prompts } from '../../../../common/utils/prompts.js';

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

## Data Cloud objects backup

When the org contains Data Cloud objects (\`__dlm\` and \`__dll\` suffix on CustomObjects), they are backed up by default in a **separate retrieve call**.

To skip Data Cloud objects backup, use config property \`monitoringBackupSkipDataCloud: true\` or environment variable \`MONITORING_BACKUP_SKIP_DATA_CLOUD=true\`.

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

If you want to also publish Documentation on Confluence, use variable **SFDX_HARDIS_DOC_DEPLOY_TO_CONFLUENCE="true"** (see [configuration](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-doc-confluence/))

By default, only changed files are used to generate the documentation (diff-only). If you want to force the full documentation rebuild, use option **--rebuild-full-doc** or set env variable **MONITORING_BACKUP_REBUILD_FULL_DOC="true"**

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

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:monitor:backup --agent --target-org myorg@example.com
\`\`\`

In agent mode:

- Documentation generation proceeds without prompting.
- The rebuild mode defaults to diff-only (changed files only) unless \`--rebuild-full-doc\` or \`MONITORING_BACKUP_REBUILD_FULL_DOC=true\` is set.
- All other interactive prompts are skipped.
`;

  public static examples = [
    '$ sf hardis:org:monitor:backup',
    '$ sf hardis:org:monitor:backup --full',
    '$ sf hardis:org:monitor:backup --full --exclude-namespaces',
    '$ sf hardis:org:monitor:backup --full --exclude-namespaces --full-apply-filters',
    '$ sf hardis:org:monitor:backup --rebuild-full-doc',
    '$ sf hardis:org:monitor:backup --agent',
    '$ FULL_ORG_MANIFEST_PATH=manifest/package-all-org-items.xml sf hardis:org:monitor:backup'
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
    "rebuild-full-doc": Flags.boolean({
      default: false,
      description: 'Rebuild the full project documentation, not just the diff. Can also be activated using env variable MONITORING_BACKUP_REBUILD_FULL_DOC=true',
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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
  protected rebuildFullDoc: boolean = false;

  protected packageXmlToRemove: string | null = null;
  protected extractPackageXmlChunks: any[] = [];
  protected currentPackage: any = {};
  protected currentPackageLen = 0;

  protected namespaces: string[];
  protected installedPackages: any[];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected debugMode = false;

  protected static isDataCloudObjectName(objectName: string): boolean {
    return objectName.endsWith('__dlm') || objectName.endsWith('__dll');
  }

  // Salesforce Metadata API includes dedicated Data Cloud metadata types
  // that are not expressed as __dlm/__dll objects or fields.
  protected static dataCloudMetadataTypes = new Set<string>([
    'CustomerDataPlatformSettings',
    'PartyDataModelSettings',
    'DataPackageKitDefinition',
    'DataPackageKitObject',
    'DataSource',
    'DataSourceBundleDefinition',
    'DataSourceObject',
    'DataSourceTenant',
    'DataSrcDataModelFieldMap',
    'DataStreamDefinition',
    'DataStreamTemplate',
  ]);

  protected static isDataCloudMetadataType(metadataType: string): boolean {
    if (MonitorBackup.dataCloudMetadataTypes.has(metadataType)) {
      return true;
    }
    // Future-proofing for new Data Cloud metadata types with known naming families.
    return /^(CustomerDataPlatform|PartyDataModel|DataPackageKit|DataSrcDataModel|DataSource|DataStream)/.test(metadataType);
  }

  protected static getObjectNameFromFieldMember(member: string): string {
    const [objectName] = member.split('.');
    return objectName || '';
  }

  private isManagedPackageNamespacedMember(member: string): boolean {
    const namespaces = this.namespaces || [];
    return namespaces.some((ns: string) => {
      const nsPrefix = `${ns}__`;
      return member.startsWith(nsPrefix) || member.includes(`.${nsPrefix}`);
    });
  }

  private filterManagedPackageNamespacedDataCloudMetadata(metadata: {
    objects: string[];
    fields: string[];
    metadataByType: Record<string, string[]>;
  }): {
    objects: string[];
    fields: string[];
    metadataByType: Record<string, string[]>;
  } {
    const filteredObjects = metadata.objects.filter((member: string) => !this.isManagedPackageNamespacedMember(member));
    const filteredFields = metadata.fields.filter((member: string) => !this.isManagedPackageNamespacedMember(member));
    const filteredMetadataByType: Record<string, string[]> = {};
    for (const metadataType of Object.keys(metadata.metadataByType || {})) {
      const members = metadata.metadataByType[metadataType] || [];
      filteredMetadataByType[metadataType] = members.filter(
        (member: string) => member === '*' || !this.isManagedPackageNamespacedMember(member)
      );
    }
    return {
      objects: filteredObjects,
      fields: filteredFields,
      metadataByType: filteredMetadataByType,
    };
  }

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MonitorBackup);
    const agentMode = flags.agent === true;
    this.full = flags.full || (process.env?.MONITORING_BACKUP_MODE_FULL === "true" ? true : false);
    this.maxByChunk = flags["max-by-chunk"] || 3000;
    this.startChunk = flags["start-chunk"] || 1;
    this.excludeNamespaces = flags["exclude-namespaces"] === true ? true : false;
    this.fullApplyFilters = flags["full-apply-filters"] === true ? true : false;
    this.skipDoc = flags["skip-doc"] === true ? true : false;
    this.rebuildFullDoc = flags["rebuild-full-doc"] === true || process.env?.MONITORING_BACKUP_REBUILD_FULL_DOC === "true";
    const skipDocFlagProvided = process.argv.includes("--skip-doc");
    const rebuildFullDocFlagProvided = process.argv.includes("--rebuild-full-doc");
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // Update apiVersion if necessary
    await updateSfdxProjectApiVersion();

    // Build target org full manifest
    uxLog(
      "action",
      this,
      c.cyan(t('buildingFullManifestForOrg', { orgAlias: c.bold(flags['target-org'].getConnection().instanceUrl) }))
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
    uxLog("action", this, c.cyan(t('writeInstalledPackages')));
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
      uxLog("log", this, c.grey(t('noUpdatedMetadataForBackup')));
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

    // Ask interactively only after backup is done and just before doc generation.
    if (!isCI && !agentMode && !skipDocFlagProvided) {
      const generateDocRes = await prompts({
        type: 'confirm',
        name: 'generateDoc',
        message: t('doYouWantToGenerateProjectDocumentation'),
        description: t('documentationGeneratedFromRetrievedSourcesIfYou'),
        initial: true,
      });
      this.skipDoc = generateDocRes.generateDoc !== true;
    }

    // Ask interactively if the user wants to rebuild the full documentation or just the diff.
    if (!isCI && !agentMode && !this.skipDoc && !rebuildFullDocFlagProvided && process.env?.MONITORING_BACKUP_REBUILD_FULL_DOC == null) {
      const rebuildFullDocRes = await prompts({
        type: 'confirm',
        name: 'rebuildFullDoc',
        message: t('doYouWantToRebuildFullDocumentation'),
        description: t('rebuildFullDocDescription'),
        initial: false,
      });
      this.rebuildFullDoc = rebuildFullDocRes.rebuildFullDoc === true;
    }

    // Run project documentation generation
    if (this.skipDoc !== true) {
      const prevPromptsLanguage = getEnvVar('PROMPTS_LANGUAGE') || 'en';
      const prevSfdxHardisLang = getEnvVar('SFDX_HARDIS_LANG') || 'en';
      try {
        const config = await getConfig("user");
        const docLanguages = (getEnvVar('SFDX_DOC_LANGUAGES') || getEnvVar('PROMPTS_LANGUAGE') || config.promptsLanguage || 'en').split(",").reverse(); // Can be 'fr,en,de' for example
        for (const langKey of docLanguages) {
          uxLog("action", this, c.cyan(t('generatingDocInLanguage') + c.bold(langKey)));
          process.env.PROMPTS_LANGUAGE = langKey;
          process.env.SFDX_HARDIS_LANG = langKey;
          reinitI18n();

          await Project2Markdown.run(this.rebuildFullDoc ? ["--with-history"] : ["--diff-only", "--with-history"]);
          uxLog("action", this, c.cyan(t('documentationGeneratedFromRetrievedSourcesIfYou')));

          if (config.docDeployToOrg || process.env?.SFDX_HARDIS_DOC_DEPLOY_TO_ORG === "true") {
            await MkDocsToSalesforce.run(["--type", "Monitoring"]);
          }
          else if (config.docDeployToCloudflare || process.env?.SFDX_HARDIS_DOC_DEPLOY_TO_CLOUDFLARE === "true") {
            await MkDocsToCloudflare.run([]);
          }
          if (config.docDeployToConfluence || process.env?.SFDX_HARDIS_DOC_DEPLOY_TO_CONFLUENCE === "true") {
            await MkDocsToConfluence.run([]);
          }
        }
      } catch (e: any) {
        uxLog("warning", this, c.yellow(t('errorWhileGeneratingProjectDocumentation') + e.message));
        uxLog("log", this, c.grey(e.stack));
      } finally {
        process.env.PROMPTS_LANGUAGE = prevPromptsLanguage;
        process.env.SFDX_HARDIS_LANG = prevSfdxHardisLang;
        reinitI18n();
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

    // Extract Data Cloud objects/fields (__dlm / __dll) so they are retrieved separately
    const dataCloudMetadataToRetrieve = await this.extractDataCloudMetadataFromElements(packageElements);

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
    uxLog("action", this, c.cyan(t('buildingPackageXmlFilesForChunks', { extractPackageXmlChunks: this.extractPackageXmlChunks.length })));
    for (const packageChunk of this.extractPackageXmlChunks) {
      pos++;
      const packageChunkFileName = path.join(chunksFolder, "chunk-" + pos + ".xml");
      await writePackageXmlFile(packageChunkFileName, packageChunk);
      packageXmlChunkFiles.push(packageChunkFileName);
      uxLog("log", this, c.grey(t('chunk', { pos, packageChunkFileName })))
      for (const mdType of Object.keys(packageChunk)) {
        uxLog("log", this, c.grey(`- ${mdType} (${packageChunk?.[mdType]?.length || 0} elements)`));
      }
      uxLog("other", this, "");
    }

    // Retrieve metadatas for each chunk
    uxLog("action", this, c.cyan(t('startingTheRetrieveOfChunks', { packageXmlChunkFiles: packageXmlChunkFiles.length })));
    let posChunk = 0;
    for (const packageXmlChunkFile of packageXmlChunkFiles) {
      posChunk++;
      if (this.startChunk > posChunk) {
        uxLog("log", this, c.grey(t('skippingChunkAccordingToStartChunkOption', { posChunk, packageXmlChunkFile })));
        continue;
      }
      await this.retrievePackageXml(packageXmlChunkFile, flags);
    }

    // Retrieve Data Cloud objects/fields (__dlm / __dll) in a separate call after chunks
    await this.handleDataCloudRetrieve(null, dataCloudMetadataToRetrieve, flags);
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
    uxLog("action", this, c.cyan(t('reducingContentOfToGenerate', { packageXmlFullFile, packageXmlBackUpItemsFile })));
    await filterPackageXml(packageXmlFullFile, packageXmlBackUpItemsFile, {
      removeNamespaces: this.namespaces,
      removeStandard: true,
      removeFromPackageXmlFile: this.packageXmlToRemove,
      updateApiVersion: getApiVersion(),
    });

    // Retrieve sfdx sources in local git repo
    await this.retrievePackageXml(packageXmlBackUpItemsFile, flags);

    // Retrieve Data Cloud objects/fields (__dlm / __dll) in a separate call
    await this.handleDataCloudRetrieve(packageXmlFullFile, null, flags);
  }

  private async buildFilteredManifestsForRetrieve(packageXmlFullFile: string) {
    const packageXmlBackUpItemsFile = 'manifest/package-backup-items.xml';
    const packageXmlSkipItemsFile = 'manifest/package-skip-items.xml';
    if (fs.existsSync(packageXmlSkipItemsFile)) {
      uxLog(
        "log",
        this,
        c.grey(t('packageSkipItemsFoundReducing', { packageXmlSkipItemsFile, packageXmlFullFile }))
      );
      this.packageXmlToRemove = packageXmlSkipItemsFile;
    }

    // Add more metadata types to ignore using global variable MONITORING_BACKUP_SKIP_METADATA_TYPES
    const additionalSkipMetadataTypes = process.env?.MONITORING_BACKUP_SKIP_METADATA_TYPES;
    if (additionalSkipMetadataTypes) {
      uxLog(
        "log",
        this,
        c.grey(t('monitoringBackupSkipMetadataTypesFound', { types: additionalSkipMetadataTypes, packageXmlFullFile }))
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

  private async isDataCloudBackupExcluded(): Promise<boolean> {
    if (process.env?.MONITORING_BACKUP_SKIP_DATA_CLOUD === 'true') {
      return true;
    }
    const config = await getConfig('branch');
    return config.monitoringBackupSkipDataCloud === true;
  }

  // For full mode: extract Data Cloud-related metadata from packageElements in place
  private async extractDataCloudMetadataFromElements(
    packageElements: any
  ): Promise<{ objects: string[]; fields: string[]; metadataByType: Record<string, string[]> }> {
    if (await this.isDataCloudBackupExcluded()) {
      uxLog("log", this, c.grey(t('skippingDataCloudBackup')));
      return { objects: [], fields: [], metadataByType: {} };
    }
    const customObjects: string[] = packageElements['CustomObject'] || [];
    const customFields: string[] = packageElements['CustomField'] || [];
    const dataCloudObjects = customObjects.filter((obj: string) =>
      MonitorBackup.isDataCloudObjectName(obj) && !this.isManagedPackageNamespacedMember(obj)
    );
    const dataCloudFields = customFields.filter((fieldMember: string) =>
      MonitorBackup.isDataCloudObjectName(MonitorBackup.getObjectNameFromFieldMember(fieldMember)) && !this.isManagedPackageNamespacedMember(fieldMember)
    );
    const dataCloudMetadataByType: Record<string, string[]> = {};
    for (const metadataType of Object.keys(packageElements)) {
      if (MonitorBackup.isDataCloudMetadataType(metadataType)) {
        dataCloudMetadataByType[metadataType] = (packageElements[metadataType] || []).filter(
          (member: string) => !this.isManagedPackageNamespacedMember(member)
        );
      }
    }

    if (dataCloudObjects.length === 0 && dataCloudFields.length === 0 && Object.keys(dataCloudMetadataByType).length === 0) {
      return { objects: [], fields: [], metadataByType: {} };
    }
    packageElements['CustomObject'] = customObjects.filter((obj: string) => !MonitorBackup.isDataCloudObjectName(obj));
    if (packageElements['CustomObject'].length === 0) {
      delete packageElements['CustomObject'];
    }
    packageElements['CustomField'] = customFields.filter((fieldMember: string) =>
      !MonitorBackup.isDataCloudObjectName(MonitorBackup.getObjectNameFromFieldMember(fieldMember))
    );
    if (packageElements['CustomField'].length === 0) {
      delete packageElements['CustomField'];
    }
    for (const metadataType of Object.keys(dataCloudMetadataByType)) {
      delete packageElements[metadataType];
    }
    return { objects: dataCloudObjects, fields: dataCloudFields, metadataByType: dataCloudMetadataByType };
  }

  // Orchestrate Data Cloud retrieve: for filtered mode reads from full manifest, for full mode uses already-extracted members
  private async handleDataCloudRetrieve(
    packageXmlFullFile: string | null,
    dataCloudMetadata: { objects: string[]; fields: string[]; metadataByType: Record<string, string[]> } | null,
    flags: any
  ): Promise<void> {
    if (await this.isDataCloudBackupExcluded()) {
      return;
    }
    let metadata = dataCloudMetadata;
    if (!metadata) {
      // Filtered mode: read from the full manifest
      const fullPackage = await parsePackageXmlFile(packageXmlFullFile!);
      const customObjects: string[] = fullPackage['CustomObject'] || [];
      const customFields: string[] = fullPackage['CustomField'] || [];
      const metadataByType: Record<string, string[]> = {};
      for (const metadataType of Object.keys(fullPackage)) {
        if (MonitorBackup.isDataCloudMetadataType(metadataType)) {
          metadataByType[metadataType] = fullPackage[metadataType] || [];
        }
      }
      metadata = {
        objects: customObjects.filter((obj: string) =>
          MonitorBackup.isDataCloudObjectName(obj) && !this.isManagedPackageNamespacedMember(obj)
        ),
        fields: customFields.filter((fieldMember: string) =>
          MonitorBackup.isDataCloudObjectName(MonitorBackup.getObjectNameFromFieldMember(fieldMember)) && !this.isManagedPackageNamespacedMember(fieldMember)
        ),
        metadataByType: Object.fromEntries(
          Object.entries(metadataByType).map(([metadataType, members]) => [
            metadataType,
            members.filter((member: string) => !this.isManagedPackageNamespacedMember(member)),
          ])
        ),
      };
    }
    metadata = this.filterManagedPackageNamespacedDataCloudMetadata(metadata);

    const dedicatedMetadataCount = Object.values(metadata.metadataByType || {}).reduce(
      (sum: number, members: string[]) => sum + (members?.length || 0),
      0
    );
    if (metadata.objects.length === 0 && metadata.fields.length === 0 && dedicatedMetadataCount === 0) {
      return;
    }
    uxLog(
      "action",
      this,
      c.cyan(
        t('backingUpDataCloudObjectsSeparately', {
          count: metadata.objects.length + metadata.fields.length + dedicatedMetadataCount,
        })
      )
    );
    const dataCloudPackageXmlFile = 'manifest/package-backup-datacloud-items.xml';
    const dataCloudPackageXmlContent: any = {};
    if (metadata.objects.length > 0) {
      dataCloudPackageXmlContent.CustomObject = metadata.objects;
    }
    if (metadata.fields.length > 0) {
      dataCloudPackageXmlContent.CustomField = metadata.fields;
    }
    for (const metadataType of Object.keys(metadata.metadataByType || {})) {
      const members = metadata.metadataByType[metadataType] || [];
      if (members.length > 0) {
        dataCloudPackageXmlContent[metadataType] = members;
      }
    }
    await writePackageXmlFile(dataCloudPackageXmlFile, dataCloudPackageXmlContent);
    await this.retrievePackageXml(dataCloudPackageXmlFile, flags);
  }

  private async retrievePackageXml(packageXmlBackUpItemsFile: string, flags: any) {
    const nbRetrievedItems = await countPackageXmlItems(packageXmlBackUpItemsFile);
    const packageXml = await parsePackageXmlFile(packageXmlBackUpItemsFile);
    uxLog("action", this, c.cyan(t('runTheRetrieveCommandForContainingItems', { path: path.basename(packageXmlBackUpItemsFile), nbRetrievedItems })));
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
          output: this.debugMode ? true : false,
          debug: this.debugMode,
        }
      );
    } catch (e) {
      const failedPackageXmlContent = await fs.readFile(packageXmlBackUpItemsFile, 'utf8');
      uxLog("warning", this, c.yellow(t('backupPackageXmlThatFailedToBe') + c.grey(failedPackageXmlContent)));
      if (this.full) {
        uxLog(
          "error",
          this,
          c.red(
            c.bold(
              t('unexpectedBackupError')
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
              t('crashDuringBackupExcludeMetadataTypes')
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
