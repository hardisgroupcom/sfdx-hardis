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
import { CONSTANTS } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { MessageAttachment } from '@slack/web-api';
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { countPackageXmlItems, parsePackageXmlFile, writePackageXmlFile } from '../../../../common/utils/xmlUtils.js';
import Project2Markdown from '../../doc/project2markdown.js';

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

- Environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES (example: \`MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation\`): that will be applied to all monitoring branches.

## Full mode

Activate it with **--full** parameter, or variable MONITORING_BACKUP_MODE_FULL=true

Ignores filters (namespaces items & manifest/package-skip-items.xm) to retrieve ALL metadatas, including those you might not care about (reports, translations...)

As we can retrieve only 10000 files by call, the list of all metadatas will be chunked to make multiple calls (and take more time than filtered mode)

## In CI/CD

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-metadata-backup/) and can output Grafana, Slack and MsTeams Notifications.

## Documentation

[Doc generation (including visual flows)](${CONSTANTS.DOC_URL_ROOT}/hardis/doc/project2markdown/) is triggered at the end of the command.
`;

  public static examples = [
    '$ sf hardis:org:monitor:backup',
    '$ sf hardis:org:monitor:backup --full'
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
  protected excludeNamespaces: boolean = false;

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
    this.excludeNamespaces = flags["exclude-namespaces"] === true ? true : false;
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // Build target org full manifest
    uxLog(
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

    // Check if we have package-skip_items.xml
    if (this.full) {
      await this.extractMetadatasFull(packageXmlFullFile, flags);
    }
    else {
      await this.extractMetadatasFiltered(packageXmlFullFile, flags);
    }

    // Write installed packages
    uxLog(this, c.cyan(`Write installed packages ...`));
    const installedPackagesLog: any[] = [];
    const packageFolder = path.join(process.cwd(), 'installedPackages');
    await fs.ensureDir(packageFolder);
    for (const installedPackage of this.installedPackages) {
      const fileName = (installedPackage.SubscriberPackageName || installedPackage.SubscriberPackageId) + '.json';
      const fileNameNoSep = fileName.replace(/\//g, '_').replace(/:/g, '_'); // Handle case when package name contains slashes or colon
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
      this.outputFilesRes = await generateCsvFile(this.diffFilesSimplified, this.outputFile);
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
      uxLog(this, c.grey("No updated metadata for today's backup :)"));
    }

    // Post notifications
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
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
    try {
      await Project2Markdown.run(["--diff-only", "--with-history"]);
    } catch (e: any) {
      uxLog(this, c.yellow("Error while generating project documentation " + e.message));
    }

    return { outputString: 'BackUp processed on org ' + flags['target-org'].getConnection().instanceUrl };
  }

  private async extractMetadatasFull(packageXmlFullFile: string, flags) {
    let packageXmlToExtract = packageXmlFullFile;
    // Filter namespaces if requested in the command
    if (this.excludeNamespaces || process.env?.SFDX_HARDIS_BACKUP_EXCLUDE_NAMESPACES === "true") {
      const packageXmlFullFileWithoutNamespace = 'manifest/package-all-org-items-except-namespaces.xml';
      await filterPackageXml(packageXmlFullFile, packageXmlFullFileWithoutNamespace, {
        removeNamespaces: this.namespaces,
        removeStandard: false,
        updateApiVersion: CONSTANTS.API_VERSION,
      });
      packageXmlToExtract = packageXmlFullFileWithoutNamespace;
    }

    // Build packageXml chunks
    const packageElements = await parsePackageXmlFile(packageXmlToExtract);

    // Handle predefined chunks
    const predefinedChunkTypes = [
      { types: ["CustomLabel"], memberMode: "*" },
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
    uxLog(this, c.cyan(`Building package.xml files for ${packageXmlChunkFiles.length} chunks...`));
    for (const packageChunk of this.extractPackageXmlChunks) {
      const packageChunkFileName = path.join(chunksFolder, "chunk-" + pos + ".xml");
      await writePackageXmlFile(packageChunkFileName, packageChunk);
      packageXmlChunkFiles.push(packageChunkFileName);
      uxLog(this, c.grey(`Chunk ${pos} -> ${packageChunkFileName}:`))
      for (const mdType of Object.keys(packageChunk)) {
        uxLog(this, c.grey(`- ${mdType} (${packageChunk[mdType].length} elements)`));
      }
      uxLog(this, "");
      pos++;
    }

    // Retrieve metadatas for each chunk
    uxLog(this, c.cyan(`Starting the retrieve of ${packageXmlChunkFiles.length} chunks...`));
    for (const packageXmlChunkFile of packageXmlChunkFiles) {
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
    const packageXmlBackUpItemsFile = 'manifest/package-backup-items.xml';
    const packageXmlSkipItemsFile = 'manifest/package-skip-items.xml';
    let packageXmlToRemove: string | null = null;
    if (fs.existsSync(packageXmlSkipItemsFile)) {
      uxLog(
        this,
        c.grey(
          `${packageXmlSkipItemsFile} has been found and will be use to reduce the content of ${packageXmlFullFile} ...`
        )
      );
      packageXmlToRemove = packageXmlSkipItemsFile;
    }

    // Add more metadata types to ignore using global variable MONITORING_BACKUP_SKIP_METADATA_TYPES
    const additionalSkipMetadataTypes = process.env?.MONITORING_BACKUP_SKIP_METADATA_TYPES;
    if (additionalSkipMetadataTypes) {
      uxLog(
        this,
        c.grey(
          `En var MONITORING_BACKUP_SKIP_METADATA_TYPES has been found and will also be used to reduce the content of ${packageXmlFullFile} ...`
        )
      );
      let packageSkipItems = {};
      if (fs.existsSync(packageXmlToRemove || '')) {
        packageSkipItems = await parsePackageXmlFile(packageXmlToRemove || '');
      }
      for (const metadataType of additionalSkipMetadataTypes.split(',')) {
        packageSkipItems[metadataType] = ['*'];
      }
      packageXmlToRemove = 'manifest/package-skip-items-dynamic-do-not-update-manually.xml';
      await writePackageXmlFile(packageXmlToRemove, packageSkipItems);
    }

    // Apply filters to package.xml
    uxLog(this, c.cyan(`Reducing content of ${packageXmlFullFile} to generate ${packageXmlBackUpItemsFile} ...`));
    await filterPackageXml(packageXmlFullFile, packageXmlBackUpItemsFile, {
      removeNamespaces: this.namespaces,
      removeStandard: true,
      removeFromPackageXmlFile: packageXmlToRemove,
      updateApiVersion: CONSTANTS.API_VERSION,
    });

    // Retrieve sfdx sources in local git repo
    await this.retrievePackageXml(packageXmlBackUpItemsFile, flags);
  }

  private async retrievePackageXml(packageXmlBackUpItemsFile: string, flags: any) {
    const nbRetrievedItems = await countPackageXmlItems(packageXmlBackUpItemsFile);
    const packageXml = await parsePackageXmlFile(packageXmlBackUpItemsFile);
    uxLog(this, c.cyan(`Run the retrieve command for ${path.basename(packageXmlBackUpItemsFile)}, containing ${nbRetrievedItems} items:`));
    for (const mdType of Object.keys(packageXml)) {
      uxLog(this, c.cyan(`- ${mdType} (${packageXml[mdType].length})`));
    }
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
      uxLog(this, c.yellow('BackUp package.xml that failed to be retrieved:\n' + c.grey(failedPackageXmlContent)));
      if (this.full) {
        uxLog(
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
          this,
          c.red(
            c.bold(
              'Crash during backup. You may exclude more metadata types by updating file manifest/package-skip-items.xml then commit and push it, or use variable MONITORING_BACKUP_SKIP_METADATA_TYPES'
            )
          )
        );
      }
      uxLog(
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
