import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as path from 'path';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import { execSfdxJson, uxLog } from '../../../../common/utils/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { parsePackageXmlFile, parseXmlFile, writePackageXmlFile } from '../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import {
  deleteConnectedApps,
  deployConnectedApps,
  getSandboxRefreshConfigForFolder,
  toConnectedAppFormat,
  validateConnectedApps,
  selectConnectedAppsForProcessing,
  createConnectedAppSuccessResponse,
  handleConnectedAppError
} from '../../../../common/utils/refresh/connectedAppUtils.js';
import {
  getEcaNames,
  getEcaNamesWithSavedSecret,
  listExternalClientAppNames,
  deployExternalClientApps,
  deleteExternalClientApps,
  deleteConflictingConnectedApps,
} from '../../../../common/utils/refresh/externalClientAppUtils.js';
import {
  loadManualRestoreInventory,
  MANUAL_RESTORE_INVENTORY_FILE,
  MANUAL_RESTORE_INVENTORY_CSV_FILE,
} from '../../../../common/utils/refresh/manualRestoreInventoryUtils.js';
import {
  AFTER_REFRESH_ACTIONS_HISTORY_FILE,
  mergeAndSaveRefreshActions,
} from '../../../../common/utils/refresh/refreshActionsReportUtils.js';
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

interface RefreshActionRow {
  step: string;
  type: string;
  name: string;
  status: string;
  details: string;
}

export default class OrgRefreshAfterRefresh extends SfCommand<AnyJson> {
  public static title = 'Restore Connected Apps after org refresh';

  public static description = `
## Command Behavior

> **This command requires human interaction and must be called manually, preferably from the [VS Code SFDX Hardis UI](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis). It is not suitable for automation or AI agent usage.**

**Restores all previously backed-up Connected Apps (including Consumer Secrets), External Client Apps (including credentials), certificates, custom settings, records and other metadata to a Salesforce org after a sandbox refresh.**

This command is the second step in the sandbox refresh process. It scans the backup folder created before the refresh, allows interactive or flag-driven selection of items to restore, and automates cleanup and redeployment to the refreshed org while preserving credentials and configuration.

Key functionalities:

- **Choose a backup to restore:** Lets you pick the saved sandbox project that contains the artifacts to restore.
- **Restore External Client Apps:** Detects saved External Client App metadata (ExternalClientApplication, ExtlClntAppOauthSettings, ExtlClntAppGlobalOauthSettings, ExtlClntAppOauthConfigurablePolicies, ExtlClntAppConfigurablePolicies) and deploys them back to the org, including their saved OAuth credentials (Consumer Key and Consumer Secret).
- **Select which items to restore:** Finds Connected App XMLs, certificates, custom settings and other artifacts and lets you pick what to restore (or restore all).
- **Safety checks and validation:** Confirms files exist and prompts before making changes to the target org.
- **Prepare org for restore:** Optionally cleans up existing Connected Apps so saved apps can be re-deployed without conflict.
- **Redeploy saved artifacts:** Restores External Client Apps (with saved credentials), certificates, SAML SSO configs, custom settings and other metadata. Restoring Connected Apps is discouraged (declined by default): since Spring '26 their deploy is rejected unless Salesforce Support has enabled Connected App creation in the org via a Case. Convert them to External Client Apps before the refresh instead.
- **Handle SAML configs:** Cleans and updates SAML XML files and helps you choose certificates to wire into restored configs.
- **Restore records:** Optionally runs data import from selected SFDMU workspaces to restore record data.
- **Manual actions checklist:** Reads the \`manual-restore-inventory.json\` file saved before the refresh and lists everything that must be redone by hand: external OAuth authentications (OwnBackup, Microsoft Power Platform and other tools connected via "Log in with Salesforce"), Auth Provider secrets, Named & External Credential secrets and principals, and scheduled jobs to re-enable. A scheduled job runs as the user who scheduled it, so among the per-user Apex reschedule scripts generated by the before-refresh command, only the current user's own script can be executed directly (the command offers it); for the other users, it displays "Login As" + Developer Console Execute Anonymous instructions so each script is run by its own user. Also reminds org-level settings reset by the refresh (email deliverability, .invalid user emails, endpoint URLs, Experience Cloud sites, Shield tenant secret rotation).
- **Reporting & persistence:** Sends restore reports and can update project config to record what was restored.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is intended to be run after a sandbox refresh to re-apply saved metadata, credentials and data.

<iframe width="560" height="315" src="https://www.youtube.com/embed/cMzzWDIARbo" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

- **Backup Folder Handling:** Reads the immediate subfolders of \`scripts/sandbox-refresh/\` and validates the chosen project contains the expected \`manifest/\` and \`force-app\` layout.
- **External Client App Handling:** Checks for saved ECA metadata in \`force-app/main/default/externalClientApps/\` and related folders, builds a package manifest for all 5 ECA metadata types, and deploys them using \`sf project deploy start --manifest\` to recreate the apps with their original credentials in the refreshed org.
- **Metadata & Deployment APIs:** Uses \`sf project deploy start --manifest\` for package-based deploys, \`sf project deploy start --metadata-dir\` for MDAPI artifacts (certificates), and utility functions for Connected App deployment that preserve consumer secrets.
- **SAML Handling:** Queries active certificates via tooling API, updates SAML XML files, and deploys using \`sf project deploy start -m SamlSsoConfig\`.
- **Records Handling:** Uses interactive selection of SFDMU workspaces and runs data import utilities to restore records.
- **Manual Actions Checklist:** Loads \`manual-restore-inventory.json\` from the backup project (produced by the before-refresh command) and reports each entry in the actions CSV with status \`Manual\`, so the report doubles as a post-refresh handover checklist.
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

  public static flags: any = {
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
  protected refreshActions: RefreshActionRow[] = [];
  protected runStartDate: string = new Date().toISOString();

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

    // Compute the backup folder expected for the target org (same transformation as before-refresh),
    // to protect against restoring the backup of another sandbox into this org
    const expectedFolderName = this.instanceUrl.replace(/https?:\/\//, '').replace("my.salesforce.com", "").replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const expectedFolderIndex = Math.max(subFolders.indexOf(expectedFolderName), 0);

    const saveProjectPath = await prompts({
      type: 'select',
      name: 'path',
      message: t('selectTheProjectPathWhereTheSandbox'),
      description: t('pathWhereMetadatasSavedBeforeRefresh'),
      choices: subFolders.map(folder => ({
        title: folder,
        value: path.join(saveProjectPathRoot, folder)
      })),
      initial: expectedFolderIndex,
    });
    this.saveProjectPath = saveProjectPath.path;

    // Hard guard: restoring another sandbox's backup would corrupt both orgs
    const selectedFolderName = path.basename(this.saveProjectPath);
    const inventoryForCheck = await loadManualRestoreInventory(this.saveProjectPath);
    const folderMatchesOrg = selectedFolderName === expectedFolderName;
    const inventoryMatchesOrg = !inventoryForCheck?.instanceUrl || inventoryForCheck.instanceUrl === this.instanceUrl;
    if (!folderMatchesOrg || !inventoryMatchesOrg) {
      uxLog("warning", this, c.yellow(t('backupFolderOrgMismatch', { folder: selectedFolderName, instanceUrl: this.instanceUrl })));
      const confirmMismatch = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: t('confirmRestoreDifferentOrg', { instanceUrl: this.instanceUrl }),
        description: t('confirmRestoreDifferentOrgDescription'),
        initial: false
      });
      if (!confirmMismatch.confirm) {
        throw new SfError(t('restoreCancelledWrongBackupFolder'));
      }
    }

    // Selections are stored per sandbox: use the ones matching the selected backup folder
    this.refreshSandboxConfig = getSandboxRefreshConfigForFolder(this.refreshSandboxConfig, path.basename(this.saveProjectPath));

    // The actions report must be produced even when a step throws: it is the audit trail
    try {
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

      // 6. Restore External Client Apps
      await this.restoreExternalClientApps();

      // 7. Restore Connected Apps
      await this.restoreConnectedApps();

      // 8. Display the checklist of manual actions that cannot be automated
      await this.displayManualActionsChecklist();
    } finally {
      await this.generateActionsReport();
    }

    return this.result;
  }

  private async restoreCertificates(): Promise<void> {
    const certsDir = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'certs');
    const manifestDir = path.join(this.saveProjectPath, 'manifest');
    const certsPackageXml = path.join(manifestDir, 'package-certificates-to-save.xml');
    if (!fs.existsSync(certsDir) || !fs.existsSync(certsPackageXml)) {
      uxLog("log", this, c.yellow(t('noCertificatesBackupFoundSkippingCertificateRestore')));
      this.refreshActions.push({ step: "Restore Certificates", type: "Certificate", name: "N/A", status: "Skipped", details: "No backup found" });
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
      this.refreshActions.push({ step: "Restore Certificates", type: "Certificate", name: "N/A", status: "Skipped", details: "No certificates selected" });
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
      for (const cert of selectedCerts) {
        this.refreshActions.push({ step: "Restore Certificates", type: "Certificate", name: cert, status: "Skipped", details: "User cancelled" });
      }
      return;
    }
    const packageXmlCerts = {
      "Certificate": selectedCerts
    }
    await writePackageXmlFile(path.join(mdApiCertsRestoreFolder, 'package.xml'), packageXmlCerts);

    // Deploy using metadata API
    uxLog("log", this, c.grey(t('deployingCertificatesInOrgUsingMetadataApi', { instanceUrl: this.instanceUrl })));
    await execSfdxJson(
      `sf project deploy start --metadata-dir "${mdApiCertsRestoreFolder}" --target-org ${this.orgUsername}`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
    uxLog("success", this, c.green(t('certificatesRestoredSuccessfullyInOrg', { instanceUrl: this.instanceUrl })));
    for (const cert of selectedCerts) {
      this.refreshActions.push({ step: "Restore Certificates", type: "Certificate", name: cert, status: "Success", details: "" });
    }
  }

  private async restoreOtherMetadata(): Promise<void> {
    const manifestDir = path.join(this.saveProjectPath, 'manifest');
    const restorePackageXml = path.join(manifestDir, 'package-metadata-to-restore.xml');
    // Check if the restore package.xml exists
    if (!fs.existsSync(restorePackageXml)) {
      uxLog("log", this, c.yellow(t('noPackageMetadataToRestoreXmlFound')));
      this.refreshActions.push({ step: "Restore Other Metadata", type: "Metadata", name: "package-metadata-to-restore.xml", status: "Skipped", details: "No backup found" });
      return;
    }
    // Warn user about the restore package.xml that needs to be manually checked
    WebSocketClient.sendReportFileMessage(restorePackageXml, t('restoreMetadatasPackageXml'), "report");
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
      this.refreshActions.push({ step: "Restore Other Metadata", type: "Metadata", name: "package-metadata-to-restore.xml", status: "Skipped", details: "User cancelled" });
      return;
    }
    // Deploy the metadata using the package.xml
    uxLog("action", this, c.cyan(t('deployingOtherMetadatasToOrg')));
    const deployCmd = `sf project deploy start --manifest "${restorePackageXml}" --target-org ${this.orgUsername} --json`;
    // fail: false so a deploy failure is recorded per item in the actions report before throwing
    const deployResult = await execSfdxJson(deployCmd, this, { output: true, fail: false, cwd: this.saveProjectPath });
    if (deployResult.status === 0) {
      uxLog("success", this, c.green(t('otherMetadataRestoredSuccessfullyInOrg', { instanceUrl: this.instanceUrl })));
      for (const [metadataType, items] of Object.entries(metadataRestore)) {
        const itemList = Array.isArray(items) ? items : [String(items)];
        for (const itemName of itemList) {
          this.refreshActions.push({ step: "Restore Other Metadata", type: metadataType, name: itemName, status: "Success", details: "" });
        }
      }
      if (Object.keys(metadataRestore).length === 0) {
        this.refreshActions.push({ step: "Restore Other Metadata", type: "Metadata", name: "package-metadata-to-restore.xml", status: "Success", details: metadataSummary });
      }
    }
    else {
      uxLog("error", this, c.red(t('failedToRestoreOtherMetadataInOrg', { instanceUrl: this.instanceUrl, deployResult: deployResult.error })));
      this.result = Object.assign(this.result, { success: false, message: t('failedToRestoreOtherMetadata', { deployResult: deployResult.error }) });
      for (const [metadataType, items] of Object.entries(metadataRestore)) {
        const itemList = Array.isArray(items) ? items : [String(items)];
        for (const itemName of itemList) {
          this.refreshActions.push({ step: "Restore Other Metadata", type: metadataType, name: itemName, status: "Error", details: deployResult.error || "Deployment failed" });
        }
      }
      if (Object.keys(metadataRestore).length === 0) {
        this.refreshActions.push({ step: "Restore Other Metadata", type: "Metadata", name: "package-metadata-to-restore.xml", status: "Error", details: deployResult.error || "Deployment failed" });
      }
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
    for (const name of updated) {
      this.refreshActions.push({ step: "Restore SAML SSO Configs", type: "SamlSsoConfig", name, status: "Success", details: "" });
    }
    for (const errMsg of errors) {
      const name = errMsg.split(':')[0].replace('No certificate selected for ', '').replace('Deployment cancelled for ', '').trim();
      this.refreshActions.push({ step: "Restore SAML SSO Configs", type: "SamlSsoConfig", name, status: "Error", details: errMsg });
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
      this.refreshActions.push({ step: "Restore Custom Settings", type: "CustomSetting", name: "N/A", status: "Skipped", details: "No custom settings selected" });
      return;
    }

    // Ask last confirmation to user
    const prompt = await prompts({
      type: 'confirm',
      name: 'restore',
      message: t('doYouConfirmYouWantToRestore2', { selectedSettings: selectedSettings.length }),
      description: t('thisWillImportAllCustomSettingsDataSavedBeforeRefresh'),
      initial: true
    });
    if (!prompt.restore) {
      uxLog("warning", this, c.yellow(t('customSettingsRestoreCancelledByUser')));
      this.refreshActions.push({ step: "Restore Custom Settings", type: "CustomSetting", name: "N/A", status: "Skipped", details: "User cancelled" });
      return;
    }
    uxLog("action", this, c.cyan(t('restoringCustomSettings', { selectedSettings: selectedSettings.length })));
    const successSettings: string[] = []
    const failedSettings: string[] = []
    WebSocketClient.sendProgressStartMessage(t('restoringCustomSettings', { selectedSettings: selectedSettings.length }), selectedSettings.length);
    let csCounter = 0;
    try {
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
            if (key === 'SetupOwnerId') {
              // Org-level record: replace the old Org Id with the refreshed org one.
              // Profile/User-level records of hierarchy custom settings keep their SetupOwnerId,
              // as ids are preserved by a sandbox copy from production.
              if (String(record[key]).startsWith('00D')) {
                newRecord[key] = this.orgId;
              }
              deleteExistingCsBefore = true; // Delete existing records before import
            }
          }
          return newRecord;
        });
        // Write the new JSON file without standard fields
        await fs.writeJson(jsonFileForImport, jsonData, { spaces: 2 });

        // Delete existing custom settings before import if needed.
        // Any failure counts the setting as failed and moves to the next one: one bad
        // custom setting must not abort the whole restore
        try {
          if (deleteExistingCsBefore) {
            uxLog("log", this, c.grey(t('deletingExistingCustomSettingsForInOrg', { folder, orgUsername: this.orgUsername })));
            // Query existing records of every owner being imported (org, profiles, users),
            // so hierarchy custom settings do not fail on duplicate SetupOwnerId
            const setupOwnerIds: string[] = [...new Set(
              (jsonData.records || []).map((record: any) => record.SetupOwnerId).filter(Boolean)
            )] as string[];
            const queryRes = setupOwnerIds.length > 0
              ? await soqlQuery(`SELECT Id FROM ${folder} WHERE SetupOwnerId IN (${setupOwnerIds.map(id => `'${id}'`).join(',')})`, this.conn)
              : { records: [] as any[] };
            if (queryRes.records.length > 0) {
              const idsToDelete = (queryRes?.records.map(record => record.Id) || []).filter((id): id is string => typeof id === 'string');
              uxLog("log", this, c.grey(t('foundExistingCustomSettingsToDeleteFor', { idsToDelete: idsToDelete.length, folder, orgUsername: this.orgUsername })));
              const deleteResults = await this.conn.sobject(folder).destroy(idsToDelete, { allOrNone: true });
              const deletedSuccessFullyIds = deleteResults.filter(result => result.success).map(result => "- " + result.id).join('\n');
              uxLog("log", this, c.grey(t('deletedExistingCustomSettingsForInOrg', { deletedSuccessFullyIds: deletedSuccessFullyIds.length, folder, orgUsername: this.orgUsername, deletedSuccessFullyIds1: deletedSuccessFullyIds })));
              const deletedErrorIds = deleteResults.filter(result => !result.success).map(result => "- " + result.id).join('\n');
              if (deletedErrorIds.length > 0) {
                uxLog("warning", this, c.yellow(t('failedToDeleteExistingCustomSettingsFor', { folder, orgUsername: this.orgUsername, deletedErrorIds })));
                failedSettings.push(folder);
                continue; // Skip to next setting if deletion failed
              }
            } else {
              uxLog("log", this, c.grey(t('noExistingCustomSettingsFoundForIn', { folder, orgUsername: this.orgUsername })));
            }
          }
          // Import the custom setting using sf data tree import
          const importCmd = `sf data tree import --files "${jsonFileForImport}" --target-org ${this.orgUsername} --json`;
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
        } finally {
          csCounter++;
          WebSocketClient.sendProgressStepMessage(csCounter, selectedSettings.length);
        }
      }
    } finally {
      WebSocketClient.sendProgressEndMessage();
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
    for (const cs of successSettings) {
      this.refreshActions.push({ step: "Restore Custom Settings", type: "CustomSetting", name: cs, status: "Success", details: "" });
    }
    for (const cs of failedSettings) {
      this.refreshActions.push({ step: "Restore Custom Settings", type: "CustomSetting", name: cs, status: "Error", details: "Restore failed" });
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
      this.refreshActions.push({ step: "Restore Records", type: "Records", name: "N/A", status: "Skipped", details: "No data workspace found" });
      return;
    }

    const confirmRestore = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: t('beforeLaunchingTheDataLoadingPleaseMake', { orgUsername: this.orgUsername }),
      initial: true,
      description: t('onceConfirmedTheDataLoadingWillStart')
    });
    if (!confirmRestore.confirm) {
      uxLog("warning", this, c.yellow(t('recordRestoreCancelledByUser')));
      this.refreshActions.push({ step: "Restore Records", type: "Records", name: "N/A", status: "Skipped", details: "User cancelled" });
      return;
    }

    for (const sfdmuPath of sfdmuWorkspaces) {
      await importData(sfdmuPath || '', this, {
        targetUsername: this.orgUsername,
        cwd: this.saveProjectPath,
      });
      this.refreshActions.push({ step: "Restore Records", type: "Records", name: sfdmuPath, status: "Success", details: "" });
    }
  }

  private async restoreExternalClientApps(): Promise<void> {
    // Check if there are External Client Apps in the backup
    const ecaNames = getEcaNames(this.saveProjectPath);
    if (ecaNames.length === 0) {
      uxLog("log", this, c.grey(t('noExternalClientAppsFoundInBackup')));
      this.refreshActions.push({ step: "Restore External Client Apps", type: "ExternalClientApp", name: "N/A", status: "Skipped", details: "No backup found" });
      return;
    }

    uxLog("log", this, c.cyan(t('foundExternalClientAppsInTheOrg', { count: ecaNames.length })));

    // Multiselect which ECAs to restore (all selected by default)
    const promptSelect = await prompts({
      type: 'multiselect',
      name: 'selectedApps',
      message: t('selectExternalClientAppsToRestore'),
      description: t('selectExternalClientAppsToRestoreDescription'),
      choices: ecaNames.map(name => ({ title: name, value: name })),
      initial: ecaNames,
    });
    let selectedEcaNames: string[] = promptSelect.selectedApps || [];
    if (selectedEcaNames.length === 0) {
      uxLog("warning", this, c.yellow(t('noExternalClientAppsSelected')));
      this.refreshActions.push({ step: "Restore External Client Apps", type: "ExternalClientApp", name: "N/A", status: "Skipped", details: "No External Client Apps selected" });
      return;
    }

    // ECAs whose Consumer Secret is missing in the backup can not be restored with their
    // original credentials: exclude them and report a manual action instead of a deploy failure
    const ecaNamesWithSecret = await getEcaNamesWithSavedSecret(this.saveProjectPath);
    const ecasWithoutSecret = selectedEcaNames.filter(name => !ecaNamesWithSecret.includes(name));
    if (ecasWithoutSecret.length > 0) {
      uxLog("warning", this, c.yellow(t('ecasWithoutSecretNotRestored', { count: ecasWithoutSecret.length, ecaNames: ecasWithoutSecret.join(', ') })));
      for (const name of ecasWithoutSecret) {
        this.refreshActions.push({ step: "Restore External Client Apps", type: "ExternalClientApp", name, status: "Manual", details: "Not restored: Consumer Secret missing in backup" });
      }
      selectedEcaNames = selectedEcaNames.filter(name => !ecasWithoutSecret.includes(name));
      if (selectedEcaNames.length === 0) {
        return;
      }
    }

    // Delete ECAs that already exist in the org with the same name to avoid conflicts
    const existingEcaNamesInOrg = await listExternalClientAppNames(this.orgUsername, this);
    const ecasToDelete = selectedEcaNames.filter(name =>
      existingEcaNamesInOrg.some(orgName => orgName.toLowerCase() === name.toLowerCase())
    );
    if (ecasToDelete.length > 0) {
      uxLog("warning", this, c.yellow(t('existingEcasFoundInOrgWillBeDeleted', { count: ecasToDelete.length, names: ecasToDelete.join(', ') })));
      const deletedEcaNames = await deleteExternalClientApps(this.orgUsername, ecasToDelete, this.saveProjectPath, this, true);
      for (const name of deletedEcaNames) {
        this.refreshActions.push({ step: "Delete Existing ECAs", type: "ExternalClientApp", name, status: "Success", details: "Deleted before ECA restore" });
      }
      const notDeletedEcas = ecasToDelete.filter(n => !deletedEcaNames.includes(n));
      for (const name of notDeletedEcas) {
        this.refreshActions.push({ step: "Delete Existing ECAs", type: "ExternalClientApp", name, status: "Error", details: "Deletion failed" });
      }
    }

    // Delete Connected Apps that conflict with External Client Apps before deploying
    const deletedConflictingApps = await deleteConflictingConnectedApps(this.orgUsername, selectedEcaNames, this.saveProjectPath, this);
    for (const name of deletedConflictingApps) {
      this.refreshActions.push({ step: "Delete Conflicting Connected Apps", type: "ConnectedApp", name, status: "Success", details: "Deleted before ECA restore" });
    }

    try {
      const deployedItems = await deployExternalClientApps(this.orgUsername, this.instanceUrl, this.saveProjectPath, this, selectedEcaNames);
      for (const [metadataType, members] of Object.entries(deployedItems)) {
        for (const memberName of members) {
          this.refreshActions.push({ step: "Restore External Client Apps", type: metadataType, name: memberName, status: "Success", details: "" });
        }
      }
    } catch (error: any) {
      uxLog("error", this, c.red(t('errorProcessing', { app: 'External Client Apps', error: error.message || error })));
      for (const ecaName of selectedEcaNames) {
        this.refreshActions.push({ step: "Restore External Client Apps", type: "ExternalClientApp", name: ecaName, status: "Error", details: error.message || String(error) });
      }
    }
  }

  private async restoreConnectedApps(): Promise<void> {
    // Check early if there are any Connected Apps in the backup before prompting
    const connectedAppsFolder = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'connectedApps');
    if (!fs.existsSync(connectedAppsFolder) || fs.readdirSync(connectedAppsFolder).length === 0) {
      uxLog("log", this, c.grey(t('noConnectedAppsFoundInBackupSkipping')));
      this.refreshActions.push({ step: "Restore Connected Apps", type: "ConnectedApp", name: "N/A", status: "Skipped", details: "No backup found" });
      return;
    }

    // Warn about Connected Apps deprecation since Spring '26
    uxLog("warning", this, c.yellow(t('connectedAppsDeprecatedRestoreWarning')));
    uxLog("action", this, c.cyan(t('noConnectedAppsCreationRestricted')));

    let restoreConnectedApps = false;
    // Discouraged: since Spring '26 this deploy will be rejected unless Salesforce Support
    // enabled Connected App creation in the org via a Case, so default to "no"
    const promptRestoreConnectedApps = await prompts({
      type: 'confirm',
      name: 'confirmRestore',
      message: t('doYouWantToRestoreConnectedApps', { saveProjectPath: c.bold(this.saveProjectPath) }),
      initial: false,
      description: t('thisWillRestoreAllConnectedAppsFromBackup')
    });
    if (promptRestoreConnectedApps.confirmRestore) {
      restoreConnectedApps = true;
    } else {
      this.refreshActions.push({ step: "Restore Connected Apps", type: "ConnectedApp", name: "All", status: "Skipped", details: "User choice: Connected Apps restore is discouraged (creation restricted since Spring '26)" });
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

        // Step 3: Apps without a Consumer Secret in the backup can not be restored identically:
        // deleting then redeploying them would generate brand new credentials
        let appsToRestore: ProjectConnectedApp[] = [];
        const appsWithoutSecret: ProjectConnectedApp[] = [];
        for (const app of selectedApps) {
          const xmlData = await parseXmlFile(app.filePath);
          const secret = xmlData?.ConnectedApp?.consumerSecret?.[0] || '';
          if (secret && String(secret).trim() !== '') {
            appsToRestore.push(app);
          } else {
            appsWithoutSecret.push(app);
          }
        }
        if (appsWithoutSecret.length > 0) {
          const appNamesWithoutSecret = appsWithoutSecret.map(app => app.fullName).join(', ');
          uxLog("warning", this, c.yellow(t('connectedAppsWithoutSecretInBackup', { count: appsWithoutSecret.length, appNames: appNamesWithoutSecret })));
          const promptIncludeWithoutSecret = await prompts({
            type: 'confirm',
            name: 'include',
            message: t('includeConnectedAppsWithoutSecretPrompt'),
            description: t('includeConnectedAppsWithoutSecretDescription'),
            initial: false
          });
          if (promptIncludeWithoutSecret.include) {
            appsToRestore = appsToRestore.concat(appsWithoutSecret);
          } else {
            for (const app of appsWithoutSecret) {
              this.refreshActions.push({ step: "Restore Connected Apps", type: "ConnectedApp", name: app.fullName, status: "Manual", details: "Not restored: Consumer Secret missing in backup" });
            }
          }
        }
        if (appsToRestore.length === 0) {
          uxLog("warning", this, c.yellow(t('noConnectedAppsSelected')));
          return;
        }

        // Step 4: Delete existing Connected Apps from the org for clean deployment
        await this.deleteExistingConnectedApps(this.orgUsername, appsToRestore);

        // Step 5: Deploy the Connected Apps to the org
        try {
          await this.deployConnectedApps(this.orgUsername, appsToRestore);
        } catch (deployError: any) {
          for (const app of appsToRestore) {
            this.refreshActions.push({ step: "Restore Connected Apps", type: "ConnectedApp", name: app.fullName, status: "Error", details: deployError.message || String(deployError) });
          }
          throw deployError;
        }

        // Return the result
        uxLog("action", this, c.cyan(t('summary')));
        const appNames = appsToRestore.map(app => `- ${app.fullName}`).join('\n');
        uxLog("success", this, c.green(t('successfullyRestoredConnectedAppTo', { selectedApps: appsToRestore.length, conn: this.conn.instanceUrl, appNames })));
        const restoreResult = createConnectedAppSuccessResponse(
          `Successfully restored ${appsToRestore.length} Connected App(s) to the org`,
          appsToRestore.map(app => app.fullName)
        );
        this.result = Object.assign(this.result, restoreResult);
        for (const app of appsToRestore) {
          this.refreshActions.push({ step: "Restore Connected Apps", type: "ConnectedApp", name: app.fullName, status: "Success", details: "" });
        }
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
      description: t('thisStepIsNecessaryToEnsureConnectedAppsCanBeRedeployed'),
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
      description: t('thisStepWillDeployConnectedAppsWithSavedCredentials'),
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

  private async displayManualActionsChecklist(): Promise<void> {
    uxLog("action", this, c.cyan(t('nowDisplayingManualActionsChecklist')));

    const inventory = await loadManualRestoreInventory(this.saveProjectPath);
    if (inventory) {
      const externalTools = inventory.externalOauthApps.filter(app => !app.isStandardApp);
      const standardAppsCount = inventory.externalOauthApps.length - externalTools.length;
      if (externalTools.length > 0) {
        const appsList = externalTools.map(app => {
          const usersInfo = app.users.length > 0 ? `, users: ${app.users.join(', ')}` : '';
          const lastUsedInfo = app.lastUsedDate ? `, last used: ${app.lastUsedDate.substring(0, 10)}` : '';
          return `- ${app.appName}${usersInfo}${lastUsedInfo}`;
        }).join('\n');
        uxLog("warning", this, c.yellow(t('reauthorizeExternalOauthAppsAfterRefresh', { count: externalTools.length, appsList })));
        for (const app of externalTools) {
          const usersInfo = app.users.length > 0 ? ` (users: ${app.users.join(', ')})` : '';
          this.refreshActions.push({ step: "Manual Actions", type: "ExternalOauthApp", name: app.appName, status: "Manual", details: `Re-authorize from the external tool with "Log in with Salesforce"${usersInfo}` });
        }
      }
      if (standardAppsCount > 0) {
        uxLog("log", this, c.grey(t('standardOauthAppsAlsoRevoked', { count: standardAppsCount })));
      }
      if (inventory.authProviders.length > 0) {
        const list = inventory.authProviders.map(item => `- ${item.developerName} (${item.typeInfo})`).join('\n');
        uxLog("warning", this, c.yellow(t('reenterAuthProviderSecretsAfterRefresh', { count: inventory.authProviders.length, list })));
        for (const item of inventory.authProviders) {
          this.refreshActions.push({ step: "Manual Actions", type: "AuthProvider", name: item.developerName, status: "Manual", details: "Re-enter Consumer Secret manually" });
        }
      }
      if (inventory.externalCredentials.length > 0) {
        const list = inventory.externalCredentials.map(item => `- ${item.developerName} (${item.typeInfo})`).join('\n');
        uxLog("warning", this, c.yellow(t('reauthenticateExternalCredentialsAfterRefresh', { count: inventory.externalCredentials.length, list })));
        for (const item of inventory.externalCredentials) {
          this.refreshActions.push({ step: "Manual Actions", type: "ExternalCredential", name: item.developerName, status: "Manual", details: "Re-authenticate principals or re-enter secrets" });
        }
      }
      if (inventory.namedCredentials.length > 0) {
        const list = inventory.namedCredentials.map(item => `- ${item.developerName} (${item.typeInfo})`).join('\n');
        uxLog("warning", this, c.yellow(t('checkNamedCredentialsAfterRefresh', { count: inventory.namedCredentials.length, list })));
        for (const item of inventory.namedCredentials) {
          this.refreshActions.push({ step: "Manual Actions", type: "NamedCredential", name: item.developerName, status: "Manual", details: "Check endpoint and re-enter secrets" });
        }
      }
      if (inventory.scheduledJobs.length > 0) {
        const jobTypesForReport = ['Scheduled Apex', 'Batch Job', 'Scheduled Flow', 'Data Export'];
        const jobsToDisplay = inventory.scheduledJobs.filter(job => jobTypesForReport.includes(job.jobType));
        if (jobsToDisplay.length > 0) {
          const list = jobsToDisplay.map(job => {
            const ownerInfo = job.ownerUsername ? `, owner: ${job.ownerUsername}` : '';
            return `- ${job.name} (${job.jobType}, ${job.cronExpression}${ownerInfo})`;
          }).join('\n');
          uxLog("warning", this, c.yellow(t('rescheduleJobsAfterRefresh', { count: jobsToDisplay.length, list })));
        }
        if (inventory.scheduledJobs.some(job => job.jobType === 'Scheduled Flow')) {
          uxLog("warning", this, c.yellow(t('scheduledFlowsReminder')));
        }
        const rescheduledJobNames = await this.runRescheduleApexScripts(inventory);
        for (const job of jobsToDisplay) {
          const ownerInfo = job.ownerUsername ? `, owner: ${job.ownerUsername}` : '';
          if (rescheduledJobNames.includes(job.name)) {
            this.refreshActions.push({ step: "Manual Actions", type: "ScheduledJob", name: job.name, status: "Success", details: `${job.jobType} (${job.cronExpression}${ownerInfo}): rescheduled via generated Apex script` });
          } else {
            this.refreshActions.push({ step: "Manual Actions", type: "ScheduledJob", name: job.name, status: "Manual", details: `${job.jobType} (${job.cronExpression}${ownerInfo}): re-schedule if missing` });
          }
        }
      }
      WebSocketClient.sendReportFileMessage(path.join(this.saveProjectPath, MANUAL_RESTORE_INVENTORY_FILE), t('manualActionsInventoryTitle'), 'report');
      const inventoryCsvFile = path.join(this.saveProjectPath, MANUAL_RESTORE_INVENTORY_CSV_FILE);
      if (fs.existsSync(inventoryCsvFile)) {
        WebSocketClient.sendReportFileMessage(inventoryCsvFile, t('manualActionsInventoryTitle') + ' (CSV)', 'report');
      }
      const inventoryXlsxFile = path.join(this.saveProjectPath, 'xls', MANUAL_RESTORE_INVENTORY_CSV_FILE.replace('.csv', '.xlsx'));
      if (fs.existsSync(inventoryXlsxFile)) {
        WebSocketClient.sendReportFileMessage(inventoryXlsxFile, t('manualActionsInventoryTitle') + ' (XLSX)', 'report');
      }
    } else {
      uxLog("warning", this, c.yellow(t('noManualActionsInventoryFound', { file: MANUAL_RESTORE_INVENTORY_FILE })));
    }

    // Org-level settings reset by a sandbox refresh, not restorable from a backup
    uxLog("warning", this, c.yellow(t('sandboxRefreshPostChecksReminder')));
    this.refreshActions.push({ step: "Manual Actions", type: "Reminder", name: "Post-refresh org checks", status: "Manual", details: "Email deliverability, .invalid user emails, endpoint URLs, Experience Cloud sites, scheduled jobs, Shield tenant secret" });
  }

  // Handle the reschedule Apex scripts generated by before-refresh (one per job submitter).
  // A scheduled job runs as the user who scheduled it, and "sf apex run" executes as the
  // current CLI user: only the current user's own script can be executed directly without
  // changing job ownership. The other scripts must be run by their user, typically with
  // "Login As" + Developer Console Execute Anonymous.
  // Returns the names of the jobs that have been rescheduled.
  private async runRescheduleApexScripts(inventory: any): Promise<string[]> {
    const rescheduleScripts = (inventory.rescheduleScripts || []).filter((script: any) =>
      fs.existsSync(path.join(this.saveProjectPath, script.file)));
    if (rescheduleScripts.length === 0) {
      return [];
    }
    const scriptsList = rescheduleScripts.map((script: any) =>
      `- ${script.file} (${script.jobsCount} job(s), to run as ${script.ownerUsername})`).join('\n');
    uxLog("action", this, c.cyan(t('foundRescheduleApexScripts', { count: rescheduleScripts.length, list: scriptsList })));

    const rescheduledJobNames: string[] = [];

    // Exact username match only: the backup was taken on the same sandbox, so usernames are identical.
    // Fuzzy matching could run another user's script and silently change job ownership.
    const currentUserScript =
      rescheduleScripts.find((script: any) => script.ownerUsername.toLowerCase() === this.orgUsername.toLowerCase());
    if (currentUserScript) {
      const promptRunOwn = await prompts({
        type: 'confirm',
        name: 'runOwn',
        message: t('runOwnRescheduleScriptPrompt', { count: currentUserScript.jobsCount, username: this.orgUsername }),
        description: t('runOwnRescheduleScriptDescription'),
        initial: true
      });
      if (promptRunOwn.runOwn) {
        const scriptFullPath = path.join(this.saveProjectPath, currentUserScript.file);
        uxLog("action", this, c.cyan(t('executingRescheduleApexScript', { script: currentUserScript.file })));
        try {
          const runRes = await execSfdxJson(
            `sf apex run --file "${scriptFullPath}" --target-org ${this.orgUsername}`,
            this,
            { output: true, fail: false, cwd: this.saveProjectPath }
          );
          if (runRes?.status === 0 && runRes?.result?.success !== false) {
            uxLog("success", this, c.green(t('rescheduleApexScriptExecuted', { script: currentUserScript.file })));
            this.refreshActions.push({ step: "Manual Actions", type: "ApexScript", name: currentUserScript.file, status: "Success", details: `Executed as ${this.orgUsername} (${currentUserScript.jobsCount} job(s) rescheduled)` });
            // Use the exact job list of the script, not a re-derivation that could diverge
            rescheduledJobNames.push(...(currentUserScript.jobNames || []));
          } else {
            const errorDetail = runRes?.result?.compileProblem || runRes?.result?.exceptionMessage || runRes?.error || JSON.stringify(runRes?.result || runRes);
            uxLog("error", this, c.red(t('rescheduleApexScriptFailed', { script: currentUserScript.file, error: errorDetail })));
            this.refreshActions.push({ step: "Manual Actions", type: "ApexScript", name: currentUserScript.file, status: "Error", details: `Execution failed: ${errorDetail}` });
          }
        } catch (e: any) {
          uxLog("error", this, c.red(t('rescheduleApexScriptFailed', { script: currentUserScript.file, error: e.message || e })));
          this.refreshActions.push({ step: "Manual Actions", type: "ApexScript", name: currentUserScript.file, status: "Error", details: `Execution failed: ${e.message || e}` });
        }
      } else {
        this.refreshActions.push({ step: "Manual Actions", type: "ApexScript", name: currentUserScript.file, status: "Manual", details: `Run as ${currentUserScript.ownerUsername}: sf apex run --file "${currentUserScript.file}"` });
      }
    }

    // Other users' scripts: never executed automatically, ownership must be preserved
    const otherScripts = rescheduleScripts.filter((script: any) => script !== currentUserScript);
    if (otherScripts.length > 0) {
      const otherScriptsList = otherScripts.map((script: any) =>
        `- ${script.ownerUsername}: ${script.file}`).join('\n');
      uxLog("warning", this, c.yellow(t('rescheduleScriptsLoginAsInstructions', { list: otherScriptsList })));
      for (const script of otherScripts) {
        this.refreshActions.push({ step: "Manual Actions", type: "ApexScript", name: script.file, status: "Manual", details: `Login As ${script.ownerUsername} (Setup > Users), open Developer Console > Execute Anonymous, and paste the script content (${script.jobsCount} job(s))` });
      }
    }
    return rescheduledJobNames;
  }

  private async generateActionsReport(): Promise<void> {
    if (this.refreshActions.length === 0 || !this.saveProjectPath) {
      return;
    }
    uxLog("action", this, c.cyan(t('generatingSandboxRefreshActionsReport')));
    // The report is cumulative across runs: restores done by a previous run are kept,
    // the manual actions checklist is rebuilt every run
    const combinedActions = await mergeAndSaveRefreshActions(
      this.saveProjectPath,
      AFTER_REFRESH_ACTIONS_HISTORY_FILE,
      this.refreshActions,
      ['Manual Actions'],
      this.runStartDate
    );
    if (combinedActions.length > this.refreshActions.length) {
      uxLog("log", this, c.grey(t('reportIncludesPreviousRuns')));
    }
    // Include the sandbox folder in the file name so reports of different sandboxes do not overwrite each other
    const reportPath = await generateReportPath(`sandbox-refresh-after-actions-${path.basename(this.saveProjectPath)}`, '');
    await generateCsvFile(combinedActions, reportPath, {
      fileTitle: t('sandboxRefreshActionsReport')
    });
  }
}
