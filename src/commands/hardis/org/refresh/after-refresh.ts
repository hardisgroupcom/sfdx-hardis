import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as path from 'path';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import { execSfdxJson, uxLog } from '../../../../common/utils/index.js';
import { parsePackageXmlFile, parseXmlFile, writePackageXmlFile } from '../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import {
  deleteConnectedApps,
  deployConnectedApps,
  toConnectedAppFormat,
  validateConnectedApps,
  selectConnectedAppsForProcessing,
  createConnectedAppSuccessResponse,
  handleConnectedAppError
} from '../../../../common/utils/refresh/connectedAppUtils.js';
import { getConfig } from '../../../../config/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { soqlQuery, soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { importData, selectDataWorkspace } from '../../../../common/utils/dataUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Interface to track Connected Apps in the project
interface ProjectConnectedApp {
  fullName: string;
  filePath: string;
  type: string;
}

export default class OrgRefreshAfterRefresh extends SfCommand<AnyJson> {
  public static title = 'Restore Connected Apps after org refresh';

  public static description = `
## Command Behavior

**Restores all previously backed-up Connected Apps (including Consumer Secrets), certificates, custom settings, records and other metadata to a Salesforce org after a sandbox refresh.**

This command is the second step in the sandbox refresh process. It scans the backup folder created before the refresh, allows interactive or flag-driven selection of items to restore, and automates cleanup and redeployment to the refreshed org while preserving credentials and configuration.

Key functionalities:

- **Choose a backup to restore:** Lets you pick the saved sandbox project that contains the artifacts to restore.
- **Select which items to restore:** Finds Connected App XMLs, certificates, custom settings and other artifacts and lets you pick what to restore (or restore all).
- **Safety checks and validation:** Confirms files exist and prompts before making changes to the target org.
- **Prepare org for restore:** Optionally cleans up existing Connected Apps so saved apps can be re-deployed without conflict.
- **Redeploy saved artifacts:** Restores Connected Apps (with saved secrets), certificates, SAML SSO configs, custom settings and other metadata.
- **Handle SAML configs:** Cleans and updates SAML XML files and helps you choose certificates to wire into restored configs.
- **Restore records:** Optionally runs data import from selected SFDMU workspaces to restore record data.
- **Reporting & persistence:** Sends restore reports and can update project config to record what was restored.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is intended to be run after a sandbox refresh to re-apply saved metadata, credentials and data.

<details markdown="1">
<summary>Technical explanations</summary>

- **Backup Folder Handling:** Reads the immediate subfolders of \`scripts/sandbox-refresh/\` and validates the chosen project contains the expected \`manifest/\` and \`force-app\` layout.
- **Metadata & Deployment APIs:** Uses \`sf project deploy start --manifest\` for package-based deploys, \`sf project deploy start --metadata-dir\` for MDAPI artifacts (certificates), and utility functions for Connected App deployment that preserve consumer secrets.
- **SAML Handling:** Queries active certificates via tooling API, updates SAML XML files, and deploys using \`sf project deploy start -m SamlSsoConfig\`.
- **Records Handling:** Uses interactive selection of SFDMU workspaces and runs data import utilities to restore records.
- **Error Handling & Summary:** Aggregates results, logs success/warnings/errors, and returns a structured result indicating which items were restored and any failures.

</details>
`;

  public static examples = [
    `$ sf hardis:org:refresh:after-refresh`,
    `$ sf hardis:org:refresh:after-refresh --name "MyConnectedApp" // Process specific app, no selection prompt`,
    `$ sf hardis:org:refresh:after-refresh --name "App1,App2,App3" // Process multiple apps, no selection prompt`,
    `$ sf hardis:org:refresh:after-refresh --all // Process all apps, no selection prompt`,
    `$ sf hardis:org:refresh:after-refresh --target-org myDevOrg`,
  ];

  public static flags = {
    "target-org": Flags.requiredOrg(),
    name: Flags.string({
      char: 'n',
      summary: messages.getMessage('nameFilter'),
      description: 'Connected App name(s) to process (bypasses selection prompt). For multiple apps, separate with commas (e.g., "App1,App2")'
    }),
    all: Flags.boolean({
      char: 'a',
      summary: 'Process all Connected Apps without selection prompt',
      description: 'If set, all Connected Apps from the local repository will be processed. Takes precedence over --name if both are specified.'
    }),
    websocket: Flags.string({
      summary: messages.getMessage('websocket'),
      description: 'WebSocket host:port for VS Code SFDX Hardis UI integration'
    }),
    skipauth: Flags.boolean({
      default: false,
      summary: 'Skip authentication check when a default username is required',
      description: 'Skip authentication check when a default username is required'
    })
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  protected refreshSandboxConfig: any = {};
  protected saveProjectPath: string;
  protected result: any;
  protected orgUsername: string;
  protected nameFilter: string | undefined;
  protected processAll: boolean;
  protected conn: Connection;
  protected instanceUrl: any;
  protected orgId: string;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgRefreshAfterRefresh);
    this.orgUsername = flags["target-org"].getUsername() as string;
    this.conn = flags["target-org"].getConnection();
    this.orgId = flags["target-org"].getOrgId() as string;
    this.instanceUrl = this.conn.instanceUrl;
    /* jscpd:ignore-start */
    this.processAll = flags.all || false;
    this.nameFilter = this.processAll ? undefined : flags.name; // If --all is set, ignore --name
    const config = await getConfig("user");
    this.refreshSandboxConfig = config?.refreshSandboxConfig || {};
    this.result = {}
    /* jscpd:ignore-end */
    uxLog("action", this, c.cyan(t('thisCommandWillRestoreInformation', { instanceUrl: this.instanceUrl })));
    // Prompt user to select a save project path
    const saveProjectPathRoot = path.join(process.cwd(), 'scripts', 'sandbox-refresh');
    // Only get immediate subfolders of saveProjectPathRoot (not recursive)
    const subFolders = fs.readdirSync(saveProjectPathRoot, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const saveProjectPath = await prompts({
      type: 'select',
      name: 'path',
      message: t('selectTheProjectPathWhereTheSandbox'),
      description: t('pathWhereMetadatasSavedBeforeRefresh'),
      choices: subFolders.map(folder => ({
        title: folder,
        value: path.join(saveProjectPathRoot, folder)
      })),
    });
    this.saveProjectPath = saveProjectPath.path;


    // 1. Restore Certificates
    await this.restoreCertificates();

    // 2. Restore Other Metadata
    await this.restoreOtherMetadata();

    // 3. Restore SamlSsoConfig
    await this.restoreSamlSsoConfig();

    // 4. Restore Custom Settings
    await this.restoreCustomSettings();

    // 5. Restore saved records
    await this.restoreRecords();

    // 6. Restore Connected Apps
    await this.restoreConnectedApps();

    return this.result;
  }

  private async restoreCertificates(): Promise<void> {
    const certsDir = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'certs');
    const manifestDir = path.join(this.saveProjectPath, 'manifest');
    const certsPackageXml = path.join(manifestDir, 'package-certificates-to-save.xml');
    if (!fs.existsSync(certsDir) || !fs.existsSync(certsPackageXml)) {
      uxLog("log", this, c.yellow(t('noCertificatesBackupFoundSkippingCertificateRestore')));
      return;
    }
    // Copy certs to a temporary folder for deployment
    const mdApiCertsRestoreFolder = path.join(this.saveProjectPath, 'mdapi_certs_restore');
    await fs.ensureDir(mdApiCertsRestoreFolder);
    await fs.emptyDir(mdApiCertsRestoreFolder);
    await fs.copy(certsDir, path.join(mdApiCertsRestoreFolder, "certs"), { overwrite: true });
    // List certificates in the restore folder
    const certsFiles = fs.readdirSync(certsDir);
    if (certsFiles.length === 0) {
      uxLog("log", this, c.yellow(t('noCertificatesFoundInTheBackupFolder')));
      return;
    }
    // List .crt files and get their name, then check that each cert must have a .crt and a .crt-meta.xml file
    const certsToRestoreNames = certsFiles.filter(file => file.endsWith('.crt')).map(file => path.basename(file, '.crt'));
    const validCertsToRestoreNames = certsToRestoreNames.filter(name => {
      return fs.existsSync(path.join(certsDir, `${name}.crt-meta.xml`));
    });
    if (validCertsToRestoreNames.length === 0) {
      uxLog("log", this, c.yellow(t('noValidCertificatesFoundInTheBackup')));
      return;
    }

    // Prompt certificates to restore (all by default)
    const promptCerts = await prompts({
      type: 'multiselect',
      name: 'certs',
      message: t('selectCertificatesToRestore'),
      description: t('selectCertificatesToRestoreFromBackup'),
      choices: validCertsToRestoreNames.map(name => ({
        title: name,
        value: name
      })),
      initial: validCertsToRestoreNames, // Select all by default
    });
    const selectedCerts = promptCerts.certs;
    if (selectedCerts.length === 0) {
      uxLog("log", this, c.yellow(t('noCertificatesSelectedForRestoreSkippingCertificate')));
      return;
    }

    // Ask user confirmation before restoring certificates
    const prompt = await prompts({
      type: 'confirm',
      name: 'restore',
      message: t('doYouConfirmYouWantToRestore', { selectedCerts: selectedCerts.length }),
      description: t('deployAllCertFilesSavedBeforeRefresh'),
      initial: true
    });
    if (!prompt.restore) {
      return;
    }

    // Create manifest/package.xml within mdApiCertsRestoreFolder
    const packageXmlCerts = {
      "Certificate": selectedCerts
    }
    await writePackageXmlFile(path.join(mdApiCertsRestoreFolder, 'package.xml'), packageXmlCerts);

    // Deploy using metadata API
    uxLog("log", this, c.grey(t('deployingCertificatesInOrgUsingMetadataApi', { instanceUrl: this.instanceUrl })));
    await execSfdxJson(
      `sf project deploy start --metadata-dir ${mdApiCertsRestoreFolder} --target-org ${this.orgUsername}`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
    uxLog("success", this, c.green(t('certificatesRestoredSuccessfullyInOrg', { instanceUrl: this.instanceUrl })));
  }

  private async restoreOtherMetadata(): Promise<void> {
    const manifestDir = path.join(this.saveProjectPath, 'manifest');
    const restorePackageXml = path.join(manifestDir, 'package-metadata-to-restore.xml');
    // Check if the restore package.xml exists
    if (!fs.existsSync(restorePackageXml)) {
      uxLog("log", this, c.yellow(t('noPackageMetadataToRestoreXmlFound')));
      return;
    }
    // Warn user about the restore package.xml that needs to be manually checked
    WebSocketClient.sendReportFileMessage(restorePackageXml, "Restore Metadatas package.xml", "report");
    uxLog("action", this, c.cyan(t('nowHandlingTheRestoreOfOtherMetadata', { restorePackageXml })));
    const metadataRestore = await parsePackageXmlFile(restorePackageXml);
    const metadataSummary = Object.keys(metadataRestore).map(key => {
      return `${key}(${Array.isArray(metadataRestore[key]) ? metadataRestore[key].length : 0})`;
    }).join(', ');
    uxLog("warning", this, c.yellow(t('lookAtThePackageMetadataToRestore', { saveProjectPath: c.bold(this.saveProjectPath) })));
    uxLog("warning", this, c.yellow(t('confirmItContentOrRemoveCommentPart', { metadataSummary })));

    const prompt = await prompts({
      type: 'confirm',
      name: 'restore',
      message: t('pleaseDoubleCheckPackageMetadataToRestore', { metadataSummary }),
      description: t('warningCheckAndValidateFileBefore'),
      initial: true
    });
    if (!prompt.restore) {
      uxLog("warning", this, c.yellow(t('metadataRestoreCancelledByUser')));
      this.result = Object.assign(this.result, { success: false, message: t('metadataRestoreCancelledByUser') });
      return;
    }
    // Deploy the metadata using the package.xml
    uxLog("action", this, c.cyan(t('deployingOtherMetadatasToOrg')));
    const deployCmd = `sf project deploy start --manifest ${restorePackageXml} --target-org ${this.orgUsername} --json`;
    const deployResult = await execSfdxJson(deployCmd, this, { output: true, fail: true, cwd: this.saveProjectPath });
    if (deployResult.status === 0) {
      uxLog("success", this, c.green(t('otherMetadataRestoredSuccessfullyInOrg', { instanceUrl: this.instanceUrl })));
    }
    else {
      uxLog("error", this, c.red(t('failedToRestoreOtherMetadataInOrg', { instanceUrl: this.instanceUrl, deployResult: deployResult.error })));
      this.result = Object.assign(this.result, { success: false, message: t('failedToRestoreOtherMetadata', { deployResult: deployResult.error }) });
      throw new Error(`Failed to restore other metadata:\n${JSON.stringify(deployResult, null, 2)}`);
    }
  }

  private async restoreSamlSsoConfig(): Promise<void> {
    // 0. List all samlssoconfigs in the project, prompt user to select which to restore
    const samlDir = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'samlssoconfigs');
    if (!fs.existsSync(samlDir)) {
      uxLog("action", this, c.cyan(t('noSamlSsoConfigsFoundSkippingSaml')));
      return;
    }
    const allSamlFiles = fs.readdirSync(samlDir).filter(f => f.endsWith('.samlssoconfig-meta.xml'));
    if (allSamlFiles.length === 0) {
      uxLog("action", this, c.yellow(t('noSamlSsoConfigXmlFilesFound')));
      return;
    }
    // Prompt user to select which SAML SSO configs to restore
    const promptSaml = await prompts({
      type: 'multiselect',
      name: 'samlFiles',
      message: t('selectSamlSsoConfigsToRestore'),
      description: t('selectSamlSsoConfigsToRestore'),
      choices: allSamlFiles.map(f => ({ title: f.replace('.samlssoconfig-meta.xml', ''), value: f })),
      initial: allSamlFiles // select all by default
    });
    const selectedSamlFiles: string[] = promptSaml.samlFiles;
    if (!selectedSamlFiles || selectedSamlFiles.length === 0) {
      uxLog("log", this, c.yellow(t('noSamlSsoConfigsSelectedForRestore')));
      return;
    }

    // 1. Clean up XML and prompt for cert
    // Query active certificates
    const soql = "SELECT Id, MasterLabel FROM Certificate WHERE ExpirationDate > TODAY  LIMIT 200";
    let certs: { Id: string, MasterLabel: string }[] = [];
    try {
      const res = await soqlQueryTooling(soql, this.conn);
      certs = res.records as any;
    } catch (e) {
      uxLog("error", this, c.red(t('failedToQueryActiveCertificates', { val: e })));
      return;
    }
    if (!certs.length) {
      uxLog("error", this, c.yellow('No active certificates found in org. You\'ll need to update manually field requestSigningCertId with the id of a valid certificate.'));
      return;
    }
    const updated: string[] = [];
    const errors: string[] = [];
    for (const samlFile of selectedSamlFiles) {
      const samlName = samlFile.replace('.samlssoconfig-meta.xml', '');
      // Prompt user to select a certificate
      const certPrompt = await prompts({
        type: 'select',
        name: 'certId',
        message: t('selectTheCertificateToUseForSaml', { samlName }),
        description: t('willUpdateRequestSigningCertId'),
        choices: certs.map(cert => ({
          title: cert.MasterLabel,
          value: cert.Id.substring(0, 15)
        })),
      });
      const selectedCertId = certPrompt.certId;
      if (!selectedCertId) {
        uxLog("warning", this, c.yellow(t('noCertificateSelectedSkippingSamlSsoConfig')));
        errors.push(`No certificate selected for ${samlName}`);
        continue;
      }
      const filePath = path.join(samlDir, samlFile);
      let xml = await fs.readFile(filePath, 'utf8');
      // Remove <oauthTokenEndpoint>...</oauthTokenEndpoint>
      xml = xml.replace(/<oauthTokenEndpoint>.*?<\/oauthTokenEndpoint>\s*/gs, '');
      // Remove <salesforceLoginUrl>...</salesforceLoginUrl>
      xml = xml.replace(/<salesforceLoginUrl>.*?<\/salesforceLoginUrl>\s*/gs, '');
      // Replace <requestSigningCertId>...</requestSigningCertId>
      if (/<requestSigningCertId>.*?<\/requestSigningCertId>/s.test(xml)) {
        xml = xml.replace(/<requestSigningCertId>.*?<\/requestSigningCertId>/s, `<requestSigningCertId>${selectedCertId}</requestSigningCertId>`);
      }
      await fs.writeFile(filePath, xml, 'utf8');
      uxLog("log", this, c.grey(t('updatedSamlSsoConfigWithCertificateAnd', { samlFile, selectedCertId })));
      // 2. Prompt user to confirm deployment
      const promptDeploy = await prompts({
        type: 'confirm',
        name: 'deploy',
        message: t('doYouConfirmYouWantToDeploy', { samlFile }),
        description: t('deploySelectedSamlSsoConfigs'),
        initial: true
      });
      if (!promptDeploy.deploy) {
        uxLog("warning", this, c.yellow(t('samlSsoConfigDeploymentCancelledByUser', { samlFile })));
        errors.push(`Deployment cancelled for ${samlFile}`);
        continue;
      }
      const deployCommand = `sf project deploy start -m SamlSsoConfig:${samlName} --target-org ${this.orgUsername}`;
      try {
        uxLog("action", this, c.cyan(t('deployingSamlSsoConfigToOrg', { samlName, instanceUrl: this.instanceUrl })));
        const deployResult = await execSfdxJson(deployCommand, this, { output: true, fail: true, cwd: this.saveProjectPath });
        if (deployResult.status === 0) {
          uxLog("success", this, c.green(t('samlSsoConfigDeployedSuccessfullyInOrg', { samlName, instanceUrl: this.instanceUrl })));
          updated.push(samlName);
        } else {
          uxLog("error", this, c.red(t('failedToDeploySamlSsoConfig', { samlName, deployResult: deployResult.error })));
          errors.push(`Failed to deploy ${samlName}: ${deployResult.error}`);
        }
      } catch (e: any) {
        uxLog("error", this, c.red(t('errorDeployingSamlSsoConfig', { samlName, message: e.message })));
        errors.push(`Error deploying ${samlName}: ${e.message}`);
      }
    }
    // 3. Summary of results
    uxLog("action", this, c.cyan(t('samlSsoConfigProcessingCompleted')));
    if (updated.length > 0) {
      uxLog("success", this, c.green(t('successfullyUpdatedAndDeployedSamlSsoConfigs', { updated: updated.join(', ') })));
    }
    if (errors.length > 0) {
      uxLog("error", this, c.red(t('errorsOccurredDuringSamlSsoConfigProcessing', { errors: errors.join('\n') })));
      this.result = Object.assign(this.result, { success: false, message: t('samlSsoConfigProcessingErrors', { errors: errors.join('\n') }) });
    }
  }

  private async restoreCustomSettings(): Promise<void> {
    // Check there are custom settings to restore
    const csDir = path.join(this.saveProjectPath, 'savedCustomSettings');
    if (!fs.existsSync(csDir)) {
      uxLog("log", this, c.yellow(t('noSavedcustomsettingsFolderFoundSkippingCustomSettings')));
      return;
    }
    const csFolders = fs.readdirSync(csDir).filter(f => fs.statSync(path.join(csDir, f)).isDirectory());
    if (csFolders.length === 0) {
      uxLog("log", this, c.yellow(t('noCustomSettingsDataFoundSkippingCustom')));
      return;
    }
    // List custom settings to restore so users can select them. Keep only folders that have a .json file
    const csToRestore = csFolders.filter(folder => {
      const jsonFile = path.join(csDir, folder, `${folder}.json`);
      return fs.existsSync(jsonFile);
    });
    if (csToRestore.length === 0) {
      uxLog("log", this, c.yellow(t('noCustomSettingsDataFoundToRestore')));
      return;
    }
    // Prompt custom settings to restore: All by default
    const promptRestore = await prompts({
      type: 'multiselect',
      name: 'settings',
      message: t('selectCustomSettingsToRestore'),
      description: t('selectCustomSettingsToRestoreFromBackup'),
      choices: csToRestore.map(folder => ({
        title: folder,
        value: folder
      })),
      initial: csToRestore // Select all by default
    });
    const selectedSettings = promptRestore.settings;
    if (selectedSettings.length === 0) {
      uxLog("log", this, c.yellow(t('noCustomSettingsSelectedForRestoreSkipping')));
      return;
    }

    // Ask last confirmation to user
    const prompt = await prompts({
      type: 'confirm',
      name: 'restore',
      message: t('doYouConfirmYouWantToRestore2', { selectedSettings: selectedSettings.length }),
      description: 'This will import all custom settings data saved before the refresh.',
      initial: true
    });
    if (!prompt.restore) {
      uxLog("warning", this, c.yellow(t('customSettingsRestoreCancelledByUser')));
      return;
    }
    uxLog("action", this, c.cyan(t('restoringCustomSettings', { selectedSettings: selectedSettings.length })));
    const successSettings: string[] = []
    const failedSettings: string[] = []
    for (const folder of selectedSettings) {
      const jsonFile = path.join(csDir, folder, `${folder}.json`);
      if (!fs.existsSync(jsonFile)) {
        uxLog("warning", this, c.yellow(t('noDataFileForCustomSetting', { folder })));
        failedSettings.push(folder);
        continue;
      }
      // Remove standard fields from the JSON file and create a new file without them, and replace Org Id with the current org one
      const jsonFileForImport = path.join(csDir, folder, `${folder}-without-standard-fields.json`);
      const jsonData = await fs.readJson(jsonFile);
      const standardFields = ['LastModifiedDate', 'IsDeleted', 'CreatedById', 'CreatedDate', 'LastModifiedById', 'SystemModstamp'];
      let deleteExistingCsBefore = false;
      jsonData.records = (jsonData?.records || []).map((record: any) => {
        const newRecord: any = {};
        for (const key in record) {
          // Remove standard fields
          if (!standardFields.includes(key)) {
            newRecord[key] = record[key];
          }
          // Replace Org Id with the current org one
          if (key === 'SetupOwnerId') {
            newRecord[key] = this.orgId; // Replace with current org Id
            deleteExistingCsBefore = true; // Use upsert if SetupOwnerId is present
          }
        }
        return newRecord;
      });
      // Write the new JSON file without standard fields
      await fs.writeJson(jsonFileForImport, jsonData, { spaces: 2 });

      // Delete existing custom settings before import if needed
      if (deleteExistingCsBefore) {
        uxLog("log", this, c.grey(t('deletingExistingCustomSettingsForInOrg', { folder, orgUsername: this.orgUsername })));
        // Query existing custom settings to delete
        const query = `SELECT Id FROM ${folder} WHERE SetupOwnerId = '${this.orgId}'`;
        const queryRes = await soqlQuery(query, this.conn);
        if (queryRes.records.length > 0) {
          const idsToDelete = (queryRes?.records.map(record => record.Id) || []).filter((id): id is string => typeof id === 'string');
          uxLog("log", this, c.grey(t('foundExistingCustomSettingsToDeleteFor', { idsToDelete: idsToDelete.length, folder, orgUsername: this.orgUsername })));
          const deleteResults = await this.conn.sobject(folder).destroy(idsToDelete, { allOrNone: true });
          const deletedSuccessFullyIds = deleteResults.filter(result => result.success).map(result => "- " + result.id).join('\n');
          uxLog("log", this, c.grey(t('deletedExistingCustomSettingsForInOrg', { deletedSuccessFullyIds: deletedSuccessFullyIds.length, folder, orgUsername: this.orgUsername, deletedSuccessFullyIds1: deletedSuccessFullyIds })));
          const deletedErrorIds = deleteResults.filter(result => !result.success).map(result => "- " + result.id).join('\n');
          if (deletedErrorIds.length > 0) {
            uxLog("warning", this, c.yellow(t('failedToDeleteExistingCustomSettingsFor', { folder, orgUsername: this.orgUsername, deletedErrorIds })));
            continue; // Skip to next setting if deletion failed
          }
        } else {
          uxLog("log", this, c.grey(t('noExistingCustomSettingsFoundForIn', { folder, orgUsername: this.orgUsername })));
        }
      }
      // Import the custom setting using sf data tree import
      const importCmd = `sf data tree import --files ${jsonFileForImport} --target-org ${this.orgUsername} --json`;
      try {
        const importRes = await execSfdxJson(importCmd, this, { output: true, fail: true, cwd: this.saveProjectPath });
        if (importRes.status === 0) {
          uxLog("success", this, c.green(t('customSettingRestored', { folder })));
          successSettings.push(folder);
        }
        else {
          uxLog("error", this, c.red(t('failedToRestoreCustomSetting2', { folder, JSON: JSON.stringify(importRes, null, 2) })));
          failedSettings.push(folder);
        }
      } catch (e) {
        uxLog("error", this, c.red(t('customSettingRestoreFailed', { folder, JSON: JSON.stringify(e) })));
        failedSettings.push(folder);
        continue;
      }
    }
    uxLog("action", this, c.cyan(t('customSettingsRestoreCompleteSuccessfulFailed', { successSettings: successSettings.length, failedSettings: failedSettings.length })));
    if (successSettings.length > 0) {
      const successSettingsNames = successSettings.map(name => "- " + name).join('\n');
      uxLog("success", this, c.green(t('successfullyRestoredCustomSetting', { successSettings: successSettings.length, successSettingsNames })));
    }
    if (failedSettings.length > 0) {
      const failedSettingsNames = failedSettings.map(name => "- " + name).join('\n');
      uxLog("error", this, c.red(t('failedToRestoreCustomSetting', { failedSettings: failedSettings.length, failedSettingsNames })));
    }
  }

  private async restoreRecords(): Promise<void> {
    const sfdmuWorkspaces = await selectDataWorkspace({
      selectDataLabel: 'Select data workspaces to use to restore records after sandbox refresh',
      multiple: true,
      initial: "all",
      cwd: this.saveProjectPath
    });
    if (!(Array.isArray(sfdmuWorkspaces) && sfdmuWorkspaces.length > 0)) {
      uxLog("warning", this, c.yellow(t('noDataWorkspaceFoundSkippingRecordRestore')));
      return;
    }

    const confirmRestore = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: t('beforeLaunchingTheDataLoadingPleaseMake', { orgUsername: this.orgUsername }),
      initial: true,
      description: 'Once confirmed, the data loading will start'
    });
    if (!confirmRestore.confirm) {
      uxLog("warning", this, c.yellow(t('recordRestoreCancelledByUser')));
      return;
    }

    for (const sfdmuPath of sfdmuWorkspaces) {
      await importData(sfdmuPath || '', this, {
        targetUsername: this.orgUsername,
        cwd: this.saveProjectPath,
      });
    }
  }

  private async restoreConnectedApps(): Promise<void> {
    let restoreConnectedApps = false;
    const promptRestoreConnectedApps = await prompts({
      type: 'confirm',
      name: 'confirmRestore',
      message: t('doYouWantToRestoreConnectedApps', { saveProjectPath: c.bold(this.saveProjectPath) }),
      initial: true,
      description: 'This will restore all Connected Apps (including Consumer Secrets) from the backup created before the org refresh.'
    });
    if (promptRestoreConnectedApps.confirmRestore) {
      restoreConnectedApps = true;
    }

    if (restoreConnectedApps) {

      try {
        // Step 1: Find Connected Apps in the project
        const connectedApps = await this.findConnectedAppsInProject(this.nameFilter, this.processAll);

        if (connectedApps.length === 0) {
          uxLog("warning", this, c.yellow(t('noConnectedAppsFoundInTheProject')));
          this.result = Object.assign(this.result, { success: false, message: t('noConnectedAppsFoundInTheProject') });
          return;
        }

        /* jscpd:ignore-start */
        // Step 2: Select which Connected Apps to process
        const selectedApps = await this.selectConnectedApps(connectedApps, this.processAll, this.nameFilter);

        if (selectedApps.length === 0) {
          uxLog("warning", this, c.yellow(t('noConnectedAppsSelected')));
          this.result = Object.assign(this.result, { success: false, message: t('noConnectedAppsSelected') });
          return;
        }
        /* jscpd:ignore-end */

        // Step 3: Delete existing Connected Apps from the org for clean deployment
        await this.deleteExistingConnectedApps(this.orgUsername, selectedApps);

        // Step 4: Deploy the Connected Apps to the org
        await this.deployConnectedApps(this.orgUsername, selectedApps);

        // Return the result
        uxLog("action", this, c.cyan(t('summary')));
        const appNames = selectedApps.map(app => `- ${app.fullName}`).join('\n');
        uxLog("success", this, c.green(t('successfullyRestoredConnectedAppTo', { selectedApps: selectedApps.length, conn: this.conn.instanceUrl, appNames })));
        const restoreResult = createConnectedAppSuccessResponse(
          `Successfully restored ${selectedApps.length} Connected App(s) to the org`,
          selectedApps.map(app => app.fullName)
        );
        this.result = Object.assign(this.result, restoreResult);
      } catch (error: any) {
        const restoreResult = handleConnectedAppError(error, this);
        this.result = Object.assign(this.result, restoreResult);
      }
    }
  }

  private async findConnectedAppsInProject(
    nameFilter?: string,
    processAll?: boolean
  ): Promise<ProjectConnectedApp[]> {
    if (processAll) {
      uxLog("action", this, c.cyan(t('processingAllConnectedAppsFromLocalRepository')));
    } else if (nameFilter) {
      uxLog("action", this, c.cyan(t('processingSpecifiedConnectedAppSelectionPromptBypassed', { nameFilter })));
    } else {
      uxLog("action", this, c.cyan(t('scanningProjectForConnectedApps')));
    }

    try {
      // Get all Connected App files in the project once
      const connectedAppFilesRaw = await glob('**/*.connectedApp-meta.xml', {
        ignore: GLOB_IGNORE_PATTERNS,
        cwd: this.saveProjectPath
      })

      const connectedAppFiles = connectedAppFilesRaw.map(file => path.join(this.saveProjectPath, file));

      if (connectedAppFiles.length === 0) {
        uxLog("warning", this, c.yellow(t('noConnectedAppFilesFoundInThe')));
        return [];
      }

      // Create ConnectedApp objects from the files
      const connectedApps: ProjectConnectedApp[] = [];
      const allFoundApps: { fullName: string; filePath: string }[] = [];

      // First, collect all available Connected Apps in the project in one pass
      for (const filePath of connectedAppFiles) {
        try {
          const xmlData = await parseXmlFile(filePath);
          if (xmlData && xmlData.ConnectedApp) {
            const fullName = xmlData.ConnectedApp.fullName?.[0] || path.basename(filePath, '.connectedApp-meta.xml');
            allFoundApps.push({ fullName, filePath });
          }
        } catch (error) {
          uxLog("warning", this, c.yellow(t('errorParsing', { filePath, error })));
          // Continue with the next file
        }
      }

      if (allFoundApps.length === 0) {
        uxLog("warning", this, c.yellow(t('noValidConnectedAppsFoundInThe')));
        return [];
      }

      // If name filter is specified, validate that all requested apps exist
      if (nameFilter) {
        const appNames = nameFilter.split(',').map(name => name.trim());
        const availableAppNames = allFoundApps.map(app => app.fullName);

        // Case-insensitive matching for app names
        validateConnectedApps(appNames, availableAppNames, this, 'project');

        // Filter apps based on name filter
        for (const app of allFoundApps) {
          const matchesFilter = appNames.some(name =>
            name.toLowerCase() === app.fullName.toLowerCase()
          );

          if (matchesFilter) {
            connectedApps.push({
              fullName: app.fullName,
              filePath: app.filePath,
              type: 'ConnectedApp'
            });
          }
        }
      } else {
        // No filter - add all apps
        for (const app of allFoundApps) {
          connectedApps.push({
            fullName: app.fullName,
            filePath: app.filePath,
            type: 'ConnectedApp'
          });
        }
      }

      // Display results
      if (connectedApps.length > 0) {
        const appNamesAndPaths = connectedApps.map(app => `- ${app.fullName} (${app.filePath})`).join('\n');
        uxLog("log", this, c.cyan(t('foundConnectedAppInProject', { connectedApps: connectedApps.length, appNamesAndPaths })));
      } else if (nameFilter) {
        uxLog("warning", this, c.yellow(t('noConnectedAppsMatchingTheFilterFound', { nameFilter })));
      }

      return connectedApps;
    } catch (error) {
      uxLog("error", this, c.red(t('errorSearchingForConnectedAppFiles', { error })));
      return [];
    }
  }

  /* jscpd:ignore-start */
  private async selectConnectedApps(
    connectedApps: ProjectConnectedApp[],
    processAll: boolean,
    nameFilter?: string
  ): Promise<ProjectConnectedApp[]> {
    const initialSelection: string[] = [];
    if (this.refreshSandboxConfig.connectedApps && this.refreshSandboxConfig.connectedApps.length > 0) {
      initialSelection.push(...this.refreshSandboxConfig.connectedApps);
    }
    return selectConnectedAppsForProcessing(
      connectedApps,
      initialSelection,
      processAll,
      nameFilter,
      'Select Connected Apps to restore',
      this
    );
  }
  /* jscpd:ignore-end */

  private async deleteExistingConnectedApps(
    orgUsername: string,
    connectedApps: ProjectConnectedApp[]
  ): Promise<void> {
    if (connectedApps.length === 0) return;

    const promptResponse = await prompts({
      type: 'confirm',
      name: 'confirmDelete',
      message: t('nowWeNeedToDeleteConnectedApp', { connectedApps: connectedApps.length }),
      description: 'This step is necessary to ensure that the Connected Apps can be re-deployed with their saved credentials.',
      initial: true
    });
    if (!promptResponse.confirmDelete) {
      throw new Error('Connected Apps deletion cancelled by user.');
    }

    // Convert ProjectConnectedApp to the format required by deleteConnectedApps
    const appsToDelete = toConnectedAppFormat(connectedApps);

    // Delete the apps without prompting
    await deleteConnectedApps(orgUsername, appsToDelete, this, this.saveProjectPath);
    uxLog("success", this, c.green(t('connectedAppsWereSuccessfullyDeletedFromThe')));
  }

  private async deployConnectedApps(
    orgUsername: string,
    connectedApps: ProjectConnectedApp[]
  ): Promise<void> {
    if (connectedApps.length === 0) return;

    const promptResponse = await prompts({
      type: 'confirm',
      name: 'confirmDeploy',
      message: t('nowWeWillDeployConnectedAppTo', { connectedApps: connectedApps.length }),
      description: 'This step will deploy the Connected Apps with their saved credentials.',
      initial: true
    });

    if (!promptResponse.confirmDeploy) {
      throw new Error('Connected Apps deployment cancelled by user.');
    }

    // Convert ProjectConnectedApp to the format needed by deployConnectedApps
    const connectedAppsList = toConnectedAppFormat(connectedApps);
    await deployConnectedApps(orgUsername, connectedAppsList, this, this.saveProjectPath);

    uxLog("success", this, c.green(t('deploymentOfConnectedAppCompletedSuccessfully', { connectedApps: connectedApps.length })));
  }
}
