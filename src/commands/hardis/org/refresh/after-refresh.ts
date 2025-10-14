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
    uxLog("action", this, c.cyan(`This command will restore information after the refresh of org ${this.instanceUrl}
  Certificates
  Other metadata
  SAML SSO Config
  Custom Settings
  Records (using SFDMU projects)
  Connected Apps`));
    // Prompt user to select a save project path
    const saveProjectPathRoot = path.join(process.cwd(), 'scripts', 'sandbox-refresh');
    // Only get immediate subfolders of saveProjectPathRoot (not recursive)
    const subFolders = fs.readdirSync(saveProjectPathRoot, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const saveProjectPath = await prompts({
      type: 'select',
      name: 'path',
      message: 'Select the project path where the sandbox info has been saved',
      description: 'This is the path where the metadatas were saved before the org refresh',
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
      uxLog("log", this, c.yellow('No certificates backup found, skipping certificate restore.'));
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
      uxLog("log", this, c.yellow('No certificates found in the backup folder, skipping certificate restore.'));
      return;
    }
    // List .crt files and get their name, then check that each cert must have a .crt and a .crt-meta.xml file
    const certsToRestoreNames = certsFiles.filter(file => file.endsWith('.crt')).map(file => path.basename(file, '.crt'));
    const validCertsToRestoreNames = certsToRestoreNames.filter(name => {
      return fs.existsSync(path.join(certsDir, `${name}.crt-meta.xml`));
    });
    if (validCertsToRestoreNames.length === 0) {
      uxLog("log", this, c.yellow('No valid certificates found in the backup folder (with .crt + .crt-meta.xml), skipping certificate restore.'));
      return;
    }

    // Prompt certificates to restore (all by default)
    const promptCerts = await prompts({
      type: 'multiselect',
      name: 'certs',
      message: `Select certificates to restore`,
      description: 'Select the certificates you want to restore from the backup. You can select multiple certificates.',
      choices: validCertsToRestoreNames.map(name => ({
        title: name,
        value: name
      })),
      initial: validCertsToRestoreNames, // Select all by default
    });
    const selectedCerts = promptCerts.certs;
    if (selectedCerts.length === 0) {
      uxLog("log", this, c.yellow('No certificates selected for restore, skipping certificate restore.'));
      return;
    }

    // Ask user confirmation before restoring certificates
    const prompt = await prompts({
      type: 'confirm',
      name: 'restore',
      message: `Do you confirm you want to restore ${selectedCerts.length} certificate(s) ?`,
      description: 'This will deploy all certificate files and definitions saved before the refresh.',
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
    uxLog("log", this, c.grey(`Deploying certificates in org ${this.instanceUrl} using Metadata API (Source Api does not support it)...`));
    await execSfdxJson(
      `sf project deploy start --metadata-dir ${mdApiCertsRestoreFolder} --target-org ${this.orgUsername}`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
    uxLog("success", this, c.green(`Certificates restored successfully in org ${this.instanceUrl}`));
  }

  private async restoreOtherMetadata(): Promise<void> {
    const manifestDir = path.join(this.saveProjectPath, 'manifest');
    const restorePackageXml = path.join(manifestDir, 'package-metadata-to-restore.xml');
    // Check if the restore package.xml exists
    if (!fs.existsSync(restorePackageXml)) {
      uxLog("log", this, c.yellow('No package-metadata-to-restore.xml found, skipping metadata restore.'));
      return;
    }
    // Warn user about the restore package.xml that needs to be manually checked
    WebSocketClient.sendReportFileMessage(restorePackageXml, "Restore Metadatas package.xml", "report");
    uxLog("action", this, c.cyan(`Now handling the restore of other metadata from ${restorePackageXml}...`));
    const metadataRestore = await parsePackageXmlFile(restorePackageXml);
    const metadataSummary = Object.keys(metadataRestore).map(key => {
      return `${key}(${Array.isArray(metadataRestore[key]) ? metadataRestore[key].length : 0})`;
    }).join(', ');
    uxLog("warning", this, c.yellow(`Look at the package-metadata-to-restore.xml file in ${c.bold(this.saveProjectPath)} to see what will be restored.`));
    uxLog("warning", this, c.yellow(`Confirm it's content, or remove/comment part of it if you don't want some metadata to be restored\n${metadataSummary}`));

    const prompt = await prompts({
      type: 'confirm',
      name: 'restore',
      message: `Please double check package-metadata-to-restore.xml. Do you confirm you want to restore all these metadatas ?\n${metadataSummary}`,
      description: `WARNING: Check and validate/update file ${restorePackageXml} BEFORE it is deployed !`,
      initial: true
    });
    if (!prompt.restore) {
      uxLog("warning", this, c.yellow('Metadata restore cancelled by user.'));
      this.result = Object.assign(this.result, { success: false, message: 'Metadata restore cancelled by user.' });
      return;
    }
    // Deploy the metadata using the package.xml
    uxLog("action", this, c.cyan('Deploying other metadatas to org...'));
    const deployCmd = `sf project deploy start --manifest ${restorePackageXml} --target-org ${this.orgUsername} --json`;
    const deployResult = await execSfdxJson(deployCmd, this, { output: true, fail: true, cwd: this.saveProjectPath });
    if (deployResult.status === 0) {
      uxLog("success", this, c.green(`Other metadata restored successfully in org ${this.instanceUrl}`));
    }
    else {
      uxLog("error", this, c.red(`Failed to restore other metadata in org ${this.instanceUrl}: ${deployResult.error}`));
      this.result = Object.assign(this.result, { success: false, message: `Failed to restore other metadata: ${deployResult.error}` });
      throw new Error(`Failed to restore other metadata:\n${JSON.stringify(deployResult, null, 2)}`);
    }
  }

  private async restoreSamlSsoConfig(): Promise<void> {
    // 0. List all samlssoconfigs in the project, prompt user to select which to restore
    const samlDir = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'samlssoconfigs');
    if (!fs.existsSync(samlDir)) {
      uxLog("action", this, c.cyan('No SAML SSO Configs found, skipping SAML SSO config restore.'));
      return;
    }
    const allSamlFiles = fs.readdirSync(samlDir).filter(f => f.endsWith('.samlssoconfig-meta.xml'));
    if (allSamlFiles.length === 0) {
      uxLog("action", this, c.yellow('No SAML SSO Config XML files found., skipping SAML SSO config restore.'));
      return;
    }
    // Prompt user to select which SAML SSO configs to restore
    const promptSaml = await prompts({
      type: 'multiselect',
      name: 'samlFiles',
      message: 'Select SAML SSO Configs to restore',
      description: 'Select the SAML SSO Configs you want to restore from the backup. You can select multiple configs.',
      choices: allSamlFiles.map(f => ({ title: f.replace('.samlssoconfig-meta.xml', ''), value: f })),
      initial: allSamlFiles // select all by default
    });
    const selectedSamlFiles: string[] = promptSaml.samlFiles;
    if (!selectedSamlFiles || selectedSamlFiles.length === 0) {
      uxLog("log", this, c.yellow('No SAML SSO Configs selected for restore, skipping.'));
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
      uxLog("error", this, c.red(`Failed to query active certificates: ${e}`));
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
        message: `Select the certificate to use for SAML SSO config ${samlName}`,
        description: `This will update <requestSigningCertId> in ${samlFile}.`,
        choices: certs.map(cert => ({
          title: cert.MasterLabel,
          value: cert.Id.substring(0, 15)
        })),
      });
      const selectedCertId = certPrompt.certId;
      if (!selectedCertId) {
        uxLog("warning", this, c.yellow('No certificate selected. Skipping SAML SSO config update.'));
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
      uxLog("log", this, c.grey(`Updated SAML SSO config ${samlFile} with certificate ${selectedCertId} and removed readonly tags oauthTokenEndpoint & salesforceLoginUrl`));
      // 2. Prompt user to confirm deployment
      const promptDeploy = await prompts({
        type: 'confirm',
        name: 'deploy',
        message: `Do you confirm you want to deploy ${samlFile} SAML SSO Config to the org?`,
        description: 'This will deploy the selected SAML SSO Configs to the org using SFDX',
        initial: true
      });
      if (!promptDeploy.deploy) {
        uxLog("warning", this, c.yellow(`SAML SSO Config ${samlFile} deployment cancelled by user.`));
        errors.push(`Deployment cancelled for ${samlFile}`);
        continue;
      }
      const deployCommand = `sf project deploy start -m SamlSsoConfig:${samlName} --target-org ${this.orgUsername}`;
      try {
        uxLog("action", this, c.cyan(`Deploying SAML SSO Config ${samlName} to org ${this.instanceUrl}...`));
        const deployResult = await execSfdxJson(deployCommand, this, { output: true, fail: true, cwd: this.saveProjectPath });
        if (deployResult.status === 0) {
          uxLog("success", this, c.green(`SAML SSO Config ${samlName} deployed successfully in org ${this.instanceUrl}`));
          updated.push(samlName);
        } else {
          uxLog("error", this, c.red(`Failed to deploy SAML SSO Config ${samlName}: ${deployResult.error}`));
          errors.push(`Failed to deploy ${samlName}: ${deployResult.error}`);
        }
      } catch (e: any) {
        uxLog("error", this, c.red(`Error deploying SAML SSO Config ${samlName}: ${e.message}`));
        errors.push(`Error deploying ${samlName}: ${e.message}`);
      }
    }
    // 3. Summary of results
    uxLog("action", this, c.cyan(`SAML SSO Config processing completed.`));
    if (updated.length > 0) {
      uxLog("success", this, c.green(`Successfully updated and deployed SAML SSO Configs: ${updated.join(', ')}`));
    }
    if (errors.length > 0) {
      uxLog("error", this, c.red(`Errors occurred during SAML SSO Config processing:\n${errors.join('\n')}`));
      this.result = Object.assign(this.result, { success: false, message: `SAML SSO Config processing errors:\n${errors.join('\n')}` });
    }
  }

  private async restoreCustomSettings(): Promise<void> {
    // Check there are custom settings to restore
    const csDir = path.join(this.saveProjectPath, 'savedCustomSettings');
    if (!fs.existsSync(csDir)) {
      uxLog("log", this, c.yellow('No savedCustomSettings folder found, skipping custom settings restore.'));
      return;
    }
    const csFolders = fs.readdirSync(csDir).filter(f => fs.statSync(path.join(csDir, f)).isDirectory());
    if (csFolders.length === 0) {
      uxLog("log", this, c.yellow('No custom settings data found, skipping custom settings restore.'));
      return;
    }
    // List custom settings to restore so users can select them. Keep only folders that have a .json file
    const csToRestore = csFolders.filter(folder => {
      const jsonFile = path.join(csDir, folder, `${folder}.json`);
      return fs.existsSync(jsonFile);
    });
    if (csToRestore.length === 0) {
      uxLog("log", this, c.yellow('No custom settings data found to restore, skipping custom settings restore.'));
      return;
    }
    // Prompt custom settings to restore: All by default
    const promptRestore = await prompts({
      type: 'multiselect',
      name: 'settings',
      message: `Select custom settings to restore`,
      description: 'Select the custom settings you want to restore from the backup. You can select multiple settings.',
      choices: csToRestore.map(folder => ({
        title: folder,
        value: folder
      })),
      initial: csToRestore // Select all by default
    });
    const selectedSettings = promptRestore.settings;
    if (selectedSettings.length === 0) {
      uxLog("log", this, c.yellow('No custom settings selected for restore, skipping custom settings restore.'));
      return;
    }

    // Ask last confirmation to user
    const prompt = await prompts({
      type: 'confirm',
      name: 'restore',
      message: `Do you confirm you want to restore ${selectedSettings.length} Custom Settings values from backup?`,
      description: 'This will import all custom settings data saved before the refresh.',
      initial: true
    });
    if (!prompt.restore) {
      uxLog("warning", this, c.yellow('Custom settings restore cancelled by user.'));
      return;
    }
    uxLog("action", this, c.cyan(`Restoring ${selectedSettings.length} Custom Settings...`));
    const successSettings: string[] = []
    const failedSettings: string[] = []
    for (const folder of selectedSettings) {
      const jsonFile = path.join(csDir, folder, `${folder}.json`);
      if (!fs.existsSync(jsonFile)) {
        uxLog("warning", this, c.yellow(`No data file for custom setting ${folder}`));
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
        uxLog("log", this, c.grey(`Deleting existing custom settings for ${folder} in org ${this.orgUsername} before import...`));
        // Query existing custom settings to delete
        const query = `SELECT Id FROM ${folder} WHERE SetupOwnerId = '${this.orgId}'`;
        const queryRes = await soqlQuery(query, this.conn);
        if (queryRes.records.length > 0) {
          const idsToDelete = (queryRes?.records.map(record => record.Id) || []).filter((id): id is string => typeof id === 'string');
          uxLog("log", this, c.grey(`Found ${idsToDelete.length} existing custom settings to delete for ${folder} in org ${this.orgUsername}`));
          const deleteResults = await this.conn.sobject(folder).destroy(idsToDelete, { allOrNone: true });
          const deletedSuccessFullyIds = deleteResults.filter(result => result.success).map(result => "- " + result.id).join('\n');
          uxLog("log", this, c.grey(`Deleted ${deletedSuccessFullyIds.length} existing custom settings for ${folder} in org ${this.orgUsername}\n${deletedSuccessFullyIds}`));
          const deletedErrorIds = deleteResults.filter(result => !result.success).map(result => "- " + result.id).join('\n');
          if (deletedErrorIds.length > 0) {
            uxLog("warning", this, c.yellow(`Failed to delete existing custom settings for ${folder} in org ${this.orgUsername}\n${deletedErrorIds}`));
            continue; // Skip to next setting if deletion failed
          }
        } else {
          uxLog("log", this, c.grey(`No existing custom settings found for ${folder} in org ${this.orgUsername}.`));
        }
      }
      // Import the custom setting using sf data tree import
      const importCmd = `sf data tree import --files ${jsonFileForImport} --target-org ${this.orgUsername} --json`;
      try {
        const importRes = await execSfdxJson(importCmd, this, { output: true, fail: true, cwd: this.saveProjectPath });
        if (importRes.status === 0) {
          uxLog("success", this, c.green(`Custom setting ${folder} restored.`));
          successSettings.push(folder);
        }
        else {
          uxLog("error", this, c.red(`Failed to restore custom setting ${folder}:\n${JSON.stringify(importRes, null, 2)}`));
          failedSettings.push(folder);
        }
      } catch (e) {
        uxLog("error", this, c.red(`Custom setting ${folder} restore failed:\n${JSON.stringify(e)}`));
        failedSettings.push(folder);
        continue;
      }
    }
    uxLog("action", this, c.cyan(`Custom settings restore complete (${successSettings.length} successful, ${failedSettings.length} failed)`));
    if (successSettings.length > 0) {
      const successSettingsNames = successSettings.map(name => "- " + name).join('\n');
      uxLog("success", this, c.green(`Successfully restored ${successSettings.length} Custom Setting(s):\n ${successSettingsNames}`));
    }
    if (failedSettings.length > 0) {
      const failedSettingsNames = failedSettings.map(name => "- " + name).join('\n');
      uxLog("error", this, c.red(`Failed to restore ${failedSettings.length} Custom Setting(s): ${failedSettingsNames}`));
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
      uxLog("warning", this, c.yellow('No data workspace found, skipping record restore'));
      return;
    }

    const confirmRestore = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `Before launching the data loading, please make sure your user ${this.orgUsername} has the appropriate ByPasses / Activation Settings / Custom Permissions / Whatever you need to do before starting the data load.`,
      initial: true,
      description: 'Once confirmed, the data loading will start'
    });
    if (!confirmRestore.confirm) {
      uxLog("warning", this, c.yellow('Record restore cancelled by user.'));
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
      message: `Do you want to restore Connected Apps from the backup in ${c.bold(this.saveProjectPath)}?`,
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
          uxLog("warning", this, c.yellow('No Connected Apps found in the project'));
          this.result = Object.assign(this.result, { success: false, message: 'No Connected Apps found in the project' });
          return;
        }

        /* jscpd:ignore-start */
        // Step 2: Select which Connected Apps to process
        const selectedApps = await this.selectConnectedApps(connectedApps, this.processAll, this.nameFilter);

        if (selectedApps.length === 0) {
          uxLog("warning", this, c.yellow('No Connected Apps selected'));
          this.result = Object.assign(this.result, { success: false, message: 'No Connected Apps selected' });
          return;
        }
        /* jscpd:ignore-end */

        // Step 3: Delete existing Connected Apps from the org for clean deployment
        await this.deleteExistingConnectedApps(this.orgUsername, selectedApps);

        // Step 4: Deploy the Connected Apps to the org
        await this.deployConnectedApps(this.orgUsername, selectedApps);

        // Return the result
        uxLog("action", this, c.cyan(`Summary`));
        const appNames = selectedApps.map(app => `- ${app.fullName}`).join('\n');
        uxLog("success", this, c.green(`Successfully restored ${selectedApps.length} Connected App(s) to ${this.conn.instanceUrl}\n${appNames}`));
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
      uxLog("action", this, c.cyan('Processing all Connected Apps from local repository (selection prompt bypassed)'));
    } else if (nameFilter) {
      uxLog("action", this, c.cyan(`Processing specified Connected App(s): ${nameFilter} (selection prompt bypassed)`));
    } else {
      uxLog("action", this, c.cyan('Scanning project for Connected Apps...'));
    }

    try {
      // Get all Connected App files in the project once
      const connectedAppFilesRaw = await glob('**/*.connectedApp-meta.xml', {
        ignore: GLOB_IGNORE_PATTERNS,
        cwd: this.saveProjectPath
      })

      const connectedAppFiles = connectedAppFilesRaw.map(file => path.join(this.saveProjectPath, file));

      if (connectedAppFiles.length === 0) {
        uxLog("warning", this, c.yellow('No Connected App files found in the project'));
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
          uxLog("warning", this, c.yellow(`Error parsing ${filePath}: ${error}`));
          // Continue with the next file
        }
      }

      if (allFoundApps.length === 0) {
        uxLog("warning", this, c.yellow('No valid Connected Apps found in the project'));
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
        uxLog("log", this, c.cyan(`Found ${connectedApps.length} Connected App(s) in project\n${appNamesAndPaths}`));
      } else if (nameFilter) {
        uxLog("warning", this, c.yellow(`No Connected Apps matching the filter "${nameFilter}" found in the project`));
      }

      return connectedApps;
    } catch (error) {
      uxLog("error", this, c.red(`Error searching for Connected App files: ${error}`));
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
      message: `Now we need to delete ${connectedApps.length} Connected App(s) from the refreshed sandbox, to be able to reupload them with saved credentials. Proceed ?`,
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
    uxLog("success", this, c.green('Connected Apps were successfully deleted from the org.'));
  }

  private async deployConnectedApps(
    orgUsername: string,
    connectedApps: ProjectConnectedApp[]
  ): Promise<void> {
    if (connectedApps.length === 0) return;

    const promptResponse = await prompts({
      type: 'confirm',
      name: 'confirmDeploy',
      message: `Now we will deploy ${connectedApps.length} Connected App(s) to the org to restore the original credentials. Proceed ?`,
      description: 'This step will deploy the Connected Apps with their saved credentials.',
      initial: true
    });

    if (!promptResponse.confirmDeploy) {
      throw new Error('Connected Apps deployment cancelled by user.');
    }

    // Convert ProjectConnectedApp to the format needed by deployConnectedApps
    const connectedAppsList = toConnectedAppFormat(connectedApps);
    await deployConnectedApps(orgUsername, connectedAppsList, this, this.saveProjectPath);

    uxLog("success", this, c.green(`Deployment of ${connectedApps.length} Connected App(s) completed successfully`));
  }
}
