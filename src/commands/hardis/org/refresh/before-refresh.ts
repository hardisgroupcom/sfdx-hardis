import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import fs from '../../../../common/utils/fsUtils.js';
import c from 'chalk';
import { open } from '../../../../common/utils/openUtils.js';
import { httpGet } from '../../../../common/utils/httpUtils.js';
import path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { createTempDir, execCommand, execSfdxJson, isCI, removeTempDir, uxLog } from '../../../../common/utils/index.js';
import { createBlankSfdxProject } from '../../../../common/utils/projectUtils.js';
import { generateCsvFile, generateReportPath, uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { parsePackageXmlFile, parseXmlFile, writePackageXmlFile } from '../../../../common/utils/xmlUtils.js';
import { getChromeExecutablePath } from '../../../../common/utils/orgConfigUtils.js';
import {
  deleteConnectedApps,
  retrieveConnectedApps,
  validateConnectedApps,
  findConnectedAppFile,
  getSandboxRefreshConfigForFolder,
  selectConnectedAppsForProcessing,
  createConnectedAppSuccessResponse,
  handleConnectedAppError
} from '../../../../common/utils/refresh/connectedAppUtils.js';
import {
  ECA_METADATA_TYPES,
  getEcaNames,
  getEcaNamesWithSavedSecret,
  listExternalClientAppNames,
  retrieveExternalClientApps,
  verifyEcaCredentials,
  deleteExternalClientApps,
  deleteConflictingConnectedApps,
} from '../../../../common/utils/refresh/externalClientAppUtils.js';
import {
  collectManualRestoreInventory,
  generateRescheduleApexScripts,
  saveManualRestoreInventory,
} from '../../../../common/utils/refresh/manualRestoreInventoryUtils.js';
import {
  BEFORE_REFRESH_ACTIONS_HISTORY_FILE,
  mergeAndSaveRefreshActions,
} from '../../../../common/utils/refresh/refreshActionsReportUtils.js';
import { CONSTANTS, getConfig, setConfig } from '../../../../config/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';
import { exportData, hasDataWorkspaces, selectDataWorkspace } from '../../../../common/utils/dataUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Define interface for Connected App metadata
interface ConnectedApp {
  fullName: string;
  fileName: string;
  type: string;
  consumerKey?: string;
  consumerSecret?: string;
}

// Interface for browser-related operations
interface BrowserContext {
  browser: Browser;
  instanceUrl: string;
  accessToken: string;
}

interface RefreshActionRow {
  step: string;
  type: string;
  name: string;
  status: string;
  details: string;
}

export default class OrgRefreshBeforeRefresh extends SfCommand<AnyJson> {
  public static description = `
## Command Behavior

> **This command must always be run by a human. It is intentionally interactive and must not be called by an AI agent.**

**Backs up all Connected Apps (including Consumer Secrets), External Client Apps (including credentials), certificates, custom settings, records and other metadata from a Salesforce org before a sandbox refresh, enabling full restoration after the refresh.**

This command prepares a complete backup prior to a sandbox refresh. It creates a dedicated project under \`scripts/sandbox-refresh/<sandbox-folder>\`, retrieves metadata and data, attempts to capture Connected App and External Client App consumer secrets, and can optionally delete the apps so they can be reuploaded after the refresh.

Key functionalities:

- **Create a save project:** Generates a dedicated project folder to store all artifacts for the sandbox backup. When a backup folder already exists for the sandbox, you choose between continuing with it or restarting from scratch (the existing folder is then deleted, after an explicit confirmation).
- **Check Connected Apps conversion:** Since Spring '26, Connected Apps can not be re-created after a refresh (unless Salesforce Support enables it via a Case), while External Client Apps can be restored with their credentials. The command lists the Connected Apps that have no matching External Client App, warns that they will probably be lost, and pauses so you can convert them in Setup (App Manager). Once you confirm the conversion, the newly converted External Client Apps are saved like the others. Vendor-owned apps (whose metadata belongs to the app vendor's org, like OwnBackup or Microsoft Power Platform) can not be converted: they are excluded from this list and handled by the manual actions inventory.
- **Save External Client Apps:** Retrieves all External Client App metadata (ExternalClientApplication, ExtlClntAppOauthSettings, ExtlClntAppGlobalOauthSettings, ExtlClntAppOauthConfigurablePolicies, ExtlClntAppConfigurablePolicies), verifies that credentials (Consumer Key & Consumer Secret) are present in the retrieved Global OAuth settings, attempts to extract missing Consumer Secrets automatically via OAuth Credentials REST API or prompts for manual entry, and optionally deletes External Client Apps from the org so they can be recreated with the same credentials after the refresh.
- **Find and select Connected Apps (discouraged):** Lists Connected Apps in the org and lets you pick specific apps, use a name filter, or process all apps. Saving them is discouraged (declined by default) since they can not be restored after the refresh without a Salesforce Case: convert them to External Client Apps instead.
- **Save metadata for restore:** Builds a manifest and retrieves the metadata types you choose so they can be restored after the refresh.
- **Capture Consumer Secrets:** Attempts to capture Connected App consumer secrets automatically (opens a browser session when possible) and falls back to a short manual prompt when needed.
- **Collect certificates:** Saves certificate files and their definitions so they can be redeployed later.
- **Inventory manual actions:** Detects everything that can NOT be restored automatically and saves it in a \`manual-restore-inventory.json\` file: external OAuth authentications (apps like OwnBackup or Microsoft Power Platform authorized via "Log in with Salesforce", whose metadata belongs to the vendor org), Auth Providers, Named & External Credentials (their secrets are never included in metadata), and active scheduled jobs (deactivated by a refresh). The inventory is also exported as \`manual-restore-inventory.csv\` and \`xls/manual-restore-inventory.xlsx\` for human reading, and one Apex script per user is generated in \`apex-scripts/\` to reschedule the Scheduled Apex jobs with their original owners. The after-refresh command turns this file into a manual actions checklist.
- **Export custom settings & records:** Lets you pick custom settings to export as JSON and optionally export records using configured data workspaces.
- **Persist choices & report:** Stores your backup choices in project config and sends report files for traceability.
- **Optional cleanup:** Can delete backed-up Connected Apps and External Client Apps from the org so they can be re-uploaded cleanly after the refresh.
- **Interactive safety checks:** Prompts you to confirm package contents and other potentially destructive actions; sensible defaults are chosen where appropriate.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is intended to be run before a sandbox refresh so that all credentials, certificates, metadata and data can be restored afterwards.

<iframe width="560" height="315" src="https://www.youtube.com/embed/cMzzWDIARbo" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

- **Salesforce CLI Integration:** Uses \`sf org list metadata\`, \`sf project retrieve start\`, \`sf project generate\`, \`sf project deploy start\`, and \`sf data tree export\`/\`import\` where applicable.
- **Metadata Handling:** Writes and reads package XML files under the generated project (\`manifest/\`), copies MDAPI certificate artifacts into \`force-app/main/default/certs\`, and produces \`package-metadata-to-restore.xml\` for post-refresh deployment.
- **External Client App Handling:** Retrieves all 5 ECA metadata types, scans \`extlClntAppGlobalOauthSets/\` files for credentials (\`consumerKey\`, \`consumerSecret\`), extracts missing secrets via OAuth Credentials REST API or manual input, writes them back into the XML files, and deletes ECAs from the org using destructive changes so they can be recreated after refresh.
- **Consumer Secret Handling:** Uses \`puppeteer-core\` with an executable path from \`getChromeExecutablePath()\` (env var \`PUPPETEER_EXECUTABLE_PATH\` may be required) for Connected Apps. Falls back to manual prompt when browser automation cannot be used.
- **Data & Records:** Exports custom settings to JSON and supports exporting records through SFDMU workspaces chosen interactively.
- **Manual Actions Inventory:** Connected Apps listed by the Metadata API but not retrievable (owned by an external org) are excluded from the save instead of failing the command, and inventoried through SOQL queries on \`ConnectedApplication\` and \`OauthToken\` (aggregated client-side by app, with users and last used date). Auth Providers, External Credentials, Named Credentials (SOQL + Tooling API) and active \`CronTrigger\` jobs complete the inventory, stored as \`manual-restore-inventory.json\` in the save project.
- **Config & Reporting:** Updates project/user config under \`config/.sfdx-hardis.yml#refreshSandboxConfig\` and reports artifacts to the WebSocket client.
- **Error Handling:** Provides clear error messages and a summary response object indicating success/failure and which secrets were captured.

</details>
`;


  public static examples: string[] = [
    "$ sf hardis:org:refresh:before-refresh",
    "$ sf hardis:org:refresh:before-refresh --name \"MyConnectedApp\"",
    "$ sf hardis:org:refresh:before-refresh --name \"App1,App2,App3\"",
    "$ sf hardis:org:refresh:before-refresh --all",
    "$ sf hardis:org:refresh:before-refresh --delete",
  ];

  public static flags: any = {
    "target-org": Flags.requiredOrg(),
    delete: Flags.boolean({
      char: 'd',
      summary: 'Delete Connected Apps from org after saving',
      description: 'By default, Connected Apps are not deleted from the org after saving. Set this flag to force their deletion so they will be able to be reuploaded again after refreshing the org.',
      default: false
    }),
    name: Flags.string({
      char: 'n',
      summary: messages.getMessage('nameFilter'),
      description: 'Connected App name(s) to process. For multiple apps, separate with commas (e.g., "App1,App2")'
    }),
    all: Flags.boolean({
      char: 'a',
      summary: 'Process all Connected Apps without selection prompt',
      description: 'If set, all Connected Apps from the org will be processed. Takes precedence over --name if both are specified.'
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    })
  };

  public static requiresProject = true;

  protected conn: Connection;
  protected saveProjectPath: string = '';
  protected orgUsername: string = '';
  protected instanceUrl: string = '';
  protected refreshSandboxConfig: any = {};
  protected result: any;
  protected processAll: boolean;
  protected nameFilter: string | undefined;
  protected deleteApps: boolean;
  protected refreshActions: RefreshActionRow[] = [];
  protected unretrievableConnectedApps: string[] = [];
  protected connectedAppsSavedWithSecret: string[] = [];
  protected runStartDate: string = new Date().toISOString();

  // Sections that rebuild their backup data from scratch when re-executed:
  // their rows from previous runs are replaced instead of accumulated
  private static readonly REPORT_REPLACE_STEPS = ['Create Save Project', 'Retrieve Certificates', 'Save Custom Settings', 'Check Connected Apps Conversion', 'List Manual Actions'];


  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgRefreshBeforeRefresh);
    this.conn = flags["target-org"].getConnection();
    this.orgUsername = flags["target-org"].getUsername() as string; // Cast to string to avoid TypeScript error
    this.instanceUrl = this.conn.instanceUrl;
    this.deleteApps = flags.delete || false;
    const accessToken = this.conn.accessToken; // Ensure accessToken is a string
    this.processAll = flags.all || false;
    this.nameFilter = this.processAll ? undefined : flags.name; // If --all is set, ignore --name
    const config = await getConfig("user");
    this.result = { success: true, message: t('beforeRefreshCommandPerformedSuccessfully') };

    uxLog("action", this, c.cyan(t('thisCommandWillSaveInformationRefresh')));
    // The backup files contain secrets in clear text: warn from the very beginning
    uxLog("warning", this, c.yellow(c.bold(t('sandboxRefreshBackupNeverCommit'))));

    // Check org is connected
    if (!accessToken) {
      throw new SfError(c.red('Access token is required to retrieve Connected Apps from the org. Please authenticate to a default org.'));
    }

    this.saveProjectPath = await this.createSaveProject();
    // Selections are stored per sandbox, so preparing several sandbox refreshes does not overwrite each other's choices
    this.refreshSandboxConfig = getSandboxRefreshConfigForFolder(config?.refreshSandboxConfig || {}, path.basename(this.saveProjectPath));
    this.refreshActions.push({ step: "Create Save Project", type: "Project", name: path.basename(this.saveProjectPath), status: "Success", details: this.saveProjectPath });

    // The actions report must be produced even when a step throws: it is the audit trail.
    // A checkpoint is saved after each step so an interrupted run (killed process,
    // cancelled prompt exiting the process) still leaves its completed actions in the history.
    try {
      const steps = [
        () => this.retrieveCertificates(),
        () => this.saveMetadatas(),
        () => this.saveCustomSettings(),
        () => this.saveRecords(),
        () => this.checkConnectedAppsConversion(),
        () => this.saveExternalClientApps(),
        () => this.retrieveDeleteConnectedApps(accessToken),
        () => this.saveManualActionsInventory(),
      ];
      for (const step of steps) {
        await step();
        await this.saveActionsCheckpoint();
      }
    } finally {
      await this.generateActionsReport();
    }

    return this.result;
  }

  private async createSaveProject(): Promise<string> {
    const folderName = this.conn.instanceUrl.replace(/https?:\/\//, '').replace("my.salesforce.com", "").replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const sandboxRefreshRootFolder = path.join(process.cwd(), 'scripts', 'sandbox-refresh');
    const projectPath = path.join(sandboxRefreshRootFolder, folderName);
    if (fs.existsSync(projectPath)) {
      if (fs.existsSync(path.join(projectPath, "sfdx-project.json"))) {
        // A previous run exists for this sandbox: let the user continue with it or restart from scratch
        if (isCI) {
          uxLog("log", this, c.cyan(t('projectFolderAlreadyExistsReusingItDelete', { projectPath })));
          return projectPath;
        }
        const promptExistingBackup = await prompts({
          type: 'select',
          name: 'action',
          message: t('backupFolderAlreadyExistsContinueOrRestart', { projectPath }),
          description: t('backupFolderAlreadyExistsDescription'),
          choices: [
            { title: t('choiceContinuePreviousBackup'), value: 'continue' },
            { title: t('choiceRestartBackupFromScratch'), value: 'restart' },
          ],
        });
        if (promptExistingBackup.action !== 'restart') {
          uxLog("action", this, c.cyan(t('projectFolderAlreadyExistsReusingItDelete', { projectPath })));
          return projectPath;
        }
        // Deleting a backup destroys saved credentials: require an explicit second confirmation
        const confirmDeleteBackup = await prompts({
          type: 'confirm',
          name: 'confirmDelete',
          message: t('confirmDeleteExistingBackup'),
          description: t('confirmDeleteExistingBackupDescription'),
          initial: false
        });
        if (!confirmDeleteBackup.confirmDelete) {
          uxLog("action", this, c.cyan(t('projectFolderAlreadyExistsReusingItDelete', { projectPath })));
          return projectPath;
        }
        await fs.remove(projectPath);
        uxLog("warning", this, c.yellow(t('deletedExistingBackupFolder', { projectPath })));
        this.refreshActions.push({ step: "Create Save Project", type: "Project", name: folderName, status: "Warning", details: "Previous backup deleted: restarted from scratch" });
      }
      else {
        fs.removeSync(projectPath);
      }
    }
    await fs.ensureDir(projectPath);
    uxLog("action", this, c.cyan(`Creating sfdx-project for sandbox info storage`));
    const createCommand = `sf project generate --name "${folderName}"`;
    await execCommand(createCommand, this, {
      output: true,
      fail: true,
    });
    uxLog("log", this, c.grey(t('movingSfdxProjectToRoot')));
    await fs.copy(folderName, projectPath, { overwrite: true });
    await fs.remove(folderName);
    uxLog("log", this, c.grey(t('saveProjectCreatedInFolder', { projectPath })));
    return projectPath;
  }

  // Vendor-owned Connected Apps (their metadata belongs to the app vendor's org) are listed
  // by the Metadata API but not retrievable, and can not be converted to External Client Apps.
  // A metadata retrieve probe identifies them so they are not proposed for manual conversion.
  private async listUnmigratableConnectedApps(candidateNames: string[]): Promise<Set<string>> {
    const unmigratableLower = new Set<string>();
    if (candidateNames.length === 0) {
      return unmigratableLower;
    }
    uxLog("action", this, c.cyan(t('checkingWhichConnectedAppsAreMigratable')));
    // Probe in a temporary blank project, so nothing is written into the backup project
    const tmpDir = await createTempDir();
    try {
      const probeProjectPath = await createBlankSfdxProject(tmpDir);
      const probeManifest = path.join(probeProjectPath, 'manifest', 'package-connected-apps-probe.xml');
      await fs.ensureDir(path.dirname(probeManifest));
      await writePackageXmlFile(probeManifest, { ConnectedApp: candidateNames });
      const probeRes = await execSfdxJson(
        `sf project retrieve start --manifest "${probeManifest}" --target-org ${this.orgUsername} --ignore-conflicts --json`,
        this,
        { output: false, fail: false, cwd: probeProjectPath }
      );
      if (probeRes?.status === 0) {
        // Non-retrievable apps are reported in the retrieve warnings:
        // "Load of metadata from db failed ... file name:X" or "Entity of type 'ConnectedApp' named 'X' cannot be found"
        const problemNamesLower = new Set<string>();
        for (const message of probeRes?.result?.messages || []) {
          const problem = String(message.problem || '');
          const problemMatch = problem.match(/file name:([A-Za-z0-9_]+)/) || problem.match(/named '([^']+)' cannot be found/);
          if (problemMatch) {
            problemNamesLower.add(problemMatch[1].toLowerCase());
          }
        }
        const retrievedFiles = probeRes?.result?.files || [];
        const retrievedNamesLower = new Set(
          retrievedFiles
            .filter((file: any) => file.type === 'ConnectedApp')
            .map((file: any) => String(file.fullName || '').toLowerCase())
        );
        // Conclude only when the response shape is recognized, to never exclude apps by mistake
        if (problemNamesLower.size > 0 || retrievedNamesLower.size > 0) {
          for (const name of candidateNames) {
            const nameLower = name.toLowerCase();
            if (problemNamesLower.has(nameLower) || (retrievedNamesLower.size > 0 && !retrievedNamesLower.has(nameLower))) {
              unmigratableLower.add(nameLower);
            }
          }
        }
      }
    } catch (e: any) {
      uxLog("warning", this, c.yellow(t('unableToCheckMigratableConnectedApps', { error: e.message || e })));
    } finally {
      // Cleanup of a throwaway probe folder must never break the backup
      await removeTempDir(tmpDir);
    }
    return unmigratableLower;
  }

  // Since Spring '26, Connected Apps can not be re-created after a refresh (unless a Salesforce
  // Case enabled it), while External Client Apps can be restored with the same credentials.
  // List the Connected Apps not yet converted to ECAs and pause so the user can convert them
  // in Setup: the following ECA save step then captures the newly converted apps.
  private async checkConnectedAppsConversion(): Promise<void> {
    uxLog("action", this, c.cyan(t('listingConnectedAppsNotConvertedToEca')));
    let unmigratableAppsLower: Set<string> | null = null;
    while (true) {
      let connectedAppsProperties: any[] = [];
      try {
        const listRes = await execSfdxJson(`sf org list metadata --metadata-type ConnectedApp --target-org ${this.orgUsername}`, this, { output: false });
        connectedAppsProperties = listRes?.result && Array.isArray(listRes.result) ? listRes.result : [];
      } catch (e: any) {
        uxLog("warning", this, c.yellow(t('unableToQueryConnectedApplications', { error: e.message || e })));
        return;
      }
      if (connectedAppsProperties.length === 0) {
        uxLog("log", this, c.grey(t('noConnectedAppsWereFoundInThe2')));
        return;
      }
      let ecaNames: string[] = [];
      try {
        ecaNames = await listExternalClientAppNames(this.orgUsername, this);
      } catch {
        // No ECA in org yet
      }
      const ecaNamesLower = new Set(ecaNames.map(name => name.toLowerCase()));
      let unconvertedAppsProperties = connectedAppsProperties
        .filter((app: any) => !ecaNamesLower.has((app.fullName || '').toLowerCase()))
        .sort((a: any, b: any) => (a.fullName || '').localeCompare(b.fullName || ''));

      // Exclude vendor-owned apps: they can not be converted to External Client Apps,
      // and are handled by the manual actions inventory instead
      if (unmigratableAppsLower === null) {
        unmigratableAppsLower = await this.listUnmigratableConnectedApps(unconvertedAppsProperties.map((app: any) => app.fullName));
        const notMigratableApps = unconvertedAppsProperties.filter((app: any) => unmigratableAppsLower!.has((app.fullName || '').toLowerCase()));
        if (notMigratableApps.length > 0) {
          const appsList = notMigratableApps.map((app: any) => `- ${app.fullName}`).join('\n');
          uxLog("log", this, c.grey(t('connectedAppsNotMigratable', { count: notMigratableApps.length, appsList })));
        }
      }
      unconvertedAppsProperties = unconvertedAppsProperties.filter((app: any) => !unmigratableAppsLower!.has((app.fullName || '').toLowerCase()));

      const unconvertedApps = unconvertedAppsProperties.map((app: any) => app.fullName);
      if (unconvertedApps.length === 0) {
        if (unmigratableAppsLower.size === 0) {
          uxLog("success", this, c.green(t('allConnectedAppsConverted')));
        }
        return;
      }

      uxLog("warning", this, c.yellow(t('connectedAppsNotConvertedWarning', { count: unconvertedApps.length })));
      await uxLogTableWithReport(
        this,
        unconvertedAppsProperties.map((app: any) => ({
          'Name': app.fullName,
          'Last Updated Date': app.lastModifiedDate ? String(app.lastModifiedDate).replace('T', ' ').substring(0, 16) : '',
          'Last Updated By': app.lastModifiedByName || '',
        })),
        ['Name', 'Last Updated Date', 'Last Updated By'],
        { fileNamePrefix: 'connected-apps-not-converted', fileTitle: 'Connected Apps not converted to External Client Apps' }
      );
      uxLog("warning", this, c.yellow(t('convertConnectedAppsNowInstructions')));

      if (isCI) {
        return;
      }
      const promptConversion = await prompts({
        type: 'select',
        name: 'action',
        message: t('haveYouConvertedConnectedApps'),
        description: t('convertConnectedAppsNowDescription'),
        choices: [
          { title: t('choiceConvertedRecheck'), value: 'recheck' },
          { title: t('choiceOpenAppManager'), value: 'open' },
          { title: t('choiceContinueWithoutConverting'), value: 'continue' },
        ],
      });
      if (promptConversion.action === 'open') {
        await open(`${this.instanceUrl}/lightning/setup/NavigationMenus/home`);
        // Wait until the user has finished converting before re-checking the org
        await prompts({
          type: 'confirm',
          name: 'converted',
          message: t('confirmFinishedConvertingConnectedApps'),
          description: t('convertConnectedAppsNowDescription'),
          initial: true
        });
        continue;
      }
      if (promptConversion.action === 'recheck') {
        continue;
      }
      // Continue without converting: these apps will probably be lost after the refresh
      for (const name of unconvertedApps) {
        this.refreshActions.push({ step: "Check Connected Apps Conversion", type: "ConnectedApp", name, status: "Warning", details: "Not converted to External Client App: will probably be lost after refresh (Connected App creation requires a Salesforce Case)" });
      }
      return;
    }
  }

  private async saveExternalClientApps(): Promise<void> {
    uxLog("action", this, c.cyan(t('savingExternalClientAppsBeforeSandboxRefresh')));

    // List available ECAs in the org
    uxLog("action", this, c.cyan(t('listingExternalClientAppsInOrg')));
    let availableEcaNames: string[] = [];
    try {
      availableEcaNames = await listExternalClientAppNames(this.orgUsername, this);
    } catch (_e: any) {
      uxLog("warning", this, c.yellow(t('noExternalClientAppsFoundInTheOrg')));
      return;
    }

    if (availableEcaNames.length === 0) {
      uxLog("log", this, c.grey(t('noExternalClientAppsFoundInTheOrg')));
      return;
    }

    uxLog("log", this, c.grey(t('foundExternalClientAppsInTheOrg', { count: availableEcaNames.length })));

    // Multiselect which ECAs to save (pre-select previously chosen ones)
    const initialSelection: string[] =
      this.refreshSandboxConfig.externalClientApps && this.refreshSandboxConfig.externalClientApps.length > 0
        ? this.refreshSandboxConfig.externalClientApps
        : availableEcaNames;

    const selectPrompt = await prompts({
      type: 'multiselect',
      name: 'selectedApps',
      message: t('selectExternalClientAppsToSave'),
      description: t('selectExternalClientAppsToSaveDescription'),
      choices: availableEcaNames.map(name => ({ title: name, value: name })),
      initial: initialSelection,
    });

    const selectedEcaNames: string[] = selectPrompt.selectedApps || [];
    if (selectedEcaNames.length === 0) {
      uxLog("action", this, c.cyan(t('noExternalClientAppsSelected')));
      this.refreshActions.push({ step: "Save External Client Apps", type: "ExternalClientApp", name: "N/A", status: "Skipped", details: "No External Client Apps selected" });
      return;
    }

    // Persist selection
    this.refreshSandboxConfig.externalClientApps = selectedEcaNames.sort();
    await this.saveConfig();

    // Check if ECA folder already has content
    const ecaFolder = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'externalClientApps');
    if (fs.existsSync(ecaFolder) && fs.readdirSync(ecaFolder).length > 0) {
      const confirmRetrieval = await prompts({
        type: 'confirm',
        name: 'retrieveAgain',
        message: t('externalClientAppsFolderIsNotEmptyDo'),
        description: t('externalClientAppsWillBeHandledSeparately'),
        initial: false
      });
      if (!confirmRetrieval.retrieveAgain) {
        return;
      }
    }

    try {
      const ecaCount = await retrieveExternalClientApps(this.orgUsername, this.saveProjectPath, this, selectedEcaNames);

      if (ecaCount > 0) {
        uxLog("success", this, c.green(t('externalClientAppsSavedSuccessfully', { count: ecaCount })));
        uxLog("log", this, c.grey(t('externalClientAppsWillBeHandledSeparately')));

        // Verify and capture credentials in Global OAuth settings files using OAuth Credentials REST API
        await verifyEcaCredentials(this.saveProjectPath, this.instanceUrl, this.conn, this);

        // Delete ECAs from org so they can be recreated with same credentials after refresh.
        // Only the apps the user selected are candidates, not every file present in the backup folder.
        const ecaNames = getEcaNames(this.saveProjectPath).filter(name => selectedEcaNames.includes(name));
        let deleteEcas = this.deleteApps;
        if (!isCI && !this.deleteApps) {
          const ecaNamesStr = ecaNames.join(', ');
          const deletePrompt = await prompts({
            type: 'confirm',
            name: 'delete',
            message: t('doYouWantToDeleteExternalClientApps', { ecaNames: ecaNamesStr }),
            description: t('ifNotDeletedEcasWillRemainInOrg'),
            initial: false
          });
          deleteEcas = deletePrompt.delete;
        }
        let deletedEcaNames: string[] = [];
        if (deleteEcas) {
          uxLog("action", this, c.cyan(t('deletingExternalClientAppsFromOrg')));
          deletedEcaNames = await deleteExternalClientApps(this.orgUsername, ecaNames, this.saveProjectPath, this, true);
          for (const name of deletedEcaNames) {
            this.refreshActions.push({ step: "Delete External Client Apps", type: "ExternalClientApp", name, status: "Success", details: "Deleted from org before refresh" });
          }
          // Apps whose Consumer Secret is missing in the backup are protected from deletion
          const namesWithSecret = await getEcaNamesWithSavedSecret(this.saveProjectPath);
          const notDeletedEcas = ecaNames.filter(n => !deletedEcaNames.includes(n));
          for (const name of notDeletedEcas) {
            if (!namesWithSecret.includes(name)) {
              this.refreshActions.push({ step: "Delete External Client Apps", type: "ExternalClientApp", name, status: "Manual", details: "Not deleted: Consumer Secret missing in backup" });
            } else {
              this.refreshActions.push({ step: "Delete External Client Apps", type: "ExternalClientApp", name, status: "Error", details: "Deletion failed" });
            }
          }
          // Also delete Connected Apps with the same name as deleted ECAs
          const deletedConflictingApps = await deleteConflictingConnectedApps(this.orgUsername, deletedEcaNames, this.saveProjectPath, this);
          for (const name of deletedConflictingApps) {
            this.refreshActions.push({ step: "Delete Conflicting Connected Apps", type: "ConnectedApp", name, status: "Success", details: "Deleted from org before refresh" });
          }
        }
        for (const ecaName of selectedEcaNames) {
          const deletedInfo = deleteEcas && deletedEcaNames.includes(ecaName) ? "Saved and deleted from org" : "Saved";
          this.refreshActions.push({ step: "Save External Client Apps", type: "ExternalClientApp", name: ecaName, status: "Success", details: deletedInfo });
        }
      } else {
        uxLog("action", this, c.cyan(t('noExternalClientAppsFoundInTheOrg')));
        this.refreshActions.push({ step: "Save External Client Apps", type: "ExternalClientApp", name: "N/A", status: "Warning", details: "No External Client Apps retrieved from org" });
      }
    } catch (_error: any) {
      uxLog("warning", this, c.yellow(t('noExternalClientAppsFoundInTheOrg')));
      for (const ecaName of selectedEcaNames) {
        this.refreshActions.push({ step: "Save External Client Apps", type: "ExternalClientApp", name: ecaName, status: "Error", details: "Retrieval failed" });
      }
    }
  }

  private async retrieveDeleteConnectedApps(accessToken: string): Promise<void> {
    // Warn about Connected Apps deprecation since Spring '26
    uxLog("warning", this, c.yellow(t('connectedAppsDeprecatedWarning')));
    uxLog("action", this, c.cyan(t('convertConnectedAppsToExternalClientApps')));

    // Saving Connected Apps is discouraged: they can not be restored after the refresh
    // unless Salesforce Support enabled Connected App creation via a Case
    if (!isCI && !this.processAll && !this.nameFilter) {
      const promptSaveAnyway = await prompts({
        type: 'confirm',
        name: 'saveAnyway',
        message: t('doYouStillWantToSaveConnectedApps'),
        description: t('savingConnectedAppsDiscouragedDescription'),
        initial: false
      });
      if (!promptSaveAnyway.saveAnyway) {
        uxLog("action", this, c.cyan(t('skippingConnectedAppsSave')));
        this.refreshActions.push({ step: "Save Connected Apps", type: "ConnectedApp", name: "All", status: "Skipped", details: "User choice: Connected Apps cannot be restored after refresh without a Salesforce Case" });
        return;
      }
    }

    // If metadatas folder is not empty, ask if we want to retrieve them again
    let retrieveConnectedApps = true;
    const connectedAppsFolder = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'connectedApps');
    if (fs.existsSync(connectedAppsFolder) && fs.readdirSync(connectedAppsFolder).length > 0) {
      const confirmRetrieval = await prompts({
        type: 'confirm',
        name: 'retrieveAgain',
        message: t('connectedAppsFolderIsNotEmptyDo'),
        description: t('ifNotRetrievedConnectedAppsNotUpdated'),
        initial: false
      });

      if (!confirmRetrieval.retrieveAgain) {
        retrieveConnectedApps = false;
      }
    }

    if (retrieveConnectedApps) {
      try {
        // Step 1: Get Connected Apps from org or based on provided name filter
        const connectedApps = await this.getConnectedApps(this.orgUsername, this.nameFilter, this.processAll);

        if (connectedApps.length === 0) {
          uxLog("warning", this, c.yellow(t('noConnectedAppsFound')));
          this.result = Object.assign(this.result, { success: false, message: t('noConnectedAppsFound') })
          return;
        }

        // Step 2: Determine which apps to process (all, filtered, or user-selected)
        const selectedApps = await this.selectConnectedApps(connectedApps, this.processAll, this.nameFilter);

        if (selectedApps.length === 0) {
          uxLog("warning", this, c.yellow(t('noConnectedAppsSelected')));
          this.result = Object.assign(this.result, { success: false, message: t('noConnectedAppsSelected') });
          return;
        }
        this.refreshSandboxConfig.connectedApps = selectedApps.map(app => app.fullName).sort();
        await this.saveConfig();

        // Step 3: Process the selected Connected Apps
        const updatedApps = await this.processConnectedApps(this.orgUsername, selectedApps, this.instanceUrl, accessToken);
        this.connectedAppsSavedWithSecret = updatedApps.filter(app => app.consumerSecret).map(app => app.fullName);

        // Step 4: Delete Connected Apps from org if required (default behavior)

        if (!isCI && !this.deleteApps && updatedApps.length > 0) {
          const connectedAppNames = updatedApps.map(app => app.fullName).join(', ');
          const deletePrompt = await prompts({
            type: 'confirm',
            name: 'delete',
            message: t('doYouWantToDeleteTheConnected', { connectedAppNames }),
            description: t('ifNotDeletedTheyWillRemainInOrg'),
            initial: false
          });
          this.deleteApps = deletePrompt.delete;
        }

        if (this.deleteApps && updatedApps.length > 0) {
          uxLog("action", this, c.cyan(t('deletingConnectedAppsFrom', { updatedApps: updatedApps.length, conn: this.conn.instanceUrl })));
          await deleteConnectedApps(this.orgUsername, updatedApps, this, this.saveProjectPath);
          uxLog("success", this, c.green(t('connectedAppsWereSuccessfullyDeletedFromThe')));
        }

        const summaryMessage = this.deleteApps
          ? t('readyToRefreshSandboxOrg')
          : t('dryRunSuccessful');
        uxLog("action", this, c.cyan(summaryMessage));
        // Add a summary message at the end
        if (updatedApps.length > 0) {
          uxLog("success", this, c.green(t('successfullySavedLocallyConnectedAppWithTheir', { updatedApps: updatedApps.length })));
        }

        for (const app of updatedApps) {
          this.refreshActions.push({ step: "Save Connected Apps", type: "ConnectedApp", name: app.fullName, status: "Success", details: app.consumerSecret ? "Consumer Secret captured" : "No Consumer Secret" });
        }
        const appsWithoutSecret = selectedApps.filter((a: ConnectedApp) =>
          !updatedApps.some((u: ConnectedApp) => u.fullName === a.fullName) &&
          !this.unretrievableConnectedApps.includes(a.fullName));
        for (const app of appsWithoutSecret) {
          this.refreshActions.push({ step: "Save Connected Apps", type: "ConnectedApp", name: app.fullName, status: "Warning", details: "Saved but Consumer Secret not captured" });
        }
        for (const appName of this.unretrievableConnectedApps) {
          this.refreshActions.push({ step: "Save Connected Apps", type: "ConnectedApp", name: appName, status: "Manual", details: "External OAuth app: credentials cannot be saved, re-authorize manually after refresh" });
        }

        uxLog("success", this, c.cyan(t('savedRefreshSandboxConfigurationInConfigSfdx')));
        WebSocketClient.sendReportFileMessage(path.join(process.cwd(), 'config', '.sfdx-hardis.yml#refreshSandboxConfig'), t('sandboxRefreshConfiguration'), 'report');

        const connectedAppRes = createConnectedAppSuccessResponse(
          `Successfully processed ${updatedApps.length} Connected App(s)`,
          updatedApps.map(app => app.fullName),
          {
            consumerSecretsAdded: updatedApps.map(app => app.consumerSecret ? app.fullName : null).filter(Boolean)
          }
        );
        this.result = Object.assign(this.result || {}, connectedAppRes);

      } catch (error: any) {
        this.result = Object.assign(this.result || {}, handleConnectedAppError(error, this));
      }
    }
  }

  private async getConnectedApps(
    orgUsername: string,
    nameFilter: string | undefined,
    processAll: boolean
  ): Promise<ConnectedApp[]> {
    // Set appropriate log message based on flags
    if (processAll) {
      uxLog("action", this, c.cyan(t('processingAllConnectedAppsFromOrgSelection')));
    } else if (nameFilter) {
      uxLog("action", this, c.cyan(t('processingSpecifiedConnectedAppSelectionPromptBypassed', { nameFilter })));
    } else {
      uxLog("action", this, c.cyan(t('listingConnectedAppsInOrg', { conn: this.conn.instanceUrl })));
    }

    const command = `sf org list metadata --metadata-type ConnectedApp --target-org ${orgUsername}`;
    const result = await execSfdxJson(command, this, { output: true });

    const availableApps: ConnectedApp[] = result?.result && Array.isArray(result.result) ? result.result : [];

    if (availableApps.length === 0) {
      uxLog("warning", this, c.yellow(t('noConnectedAppsWereFoundInThe2')));
      return [];
    }
    availableApps.sort((a, b) => a.fullName.localeCompare(b.fullName));

    const availableAppNames = availableApps.map(app => app.fullName);
    uxLog("log", this, c.grey(t('foundConnectedAppInTheOrg', { availableApps: availableApps.length })));

    // If name filter is provided, validate and filter the requested apps
    if (nameFilter) {
      const appNames = nameFilter.split(',').map(name => name.trim());
      uxLog("action", this, c.cyan(t('validatingSpecifiedConnectedApp', { appNames: appNames.join(', ') })));

      validateConnectedApps(appNames, availableAppNames, this, 'org');

      // Filter available apps to only include the ones specified in the name filter (case-insensitive)
      const connectedApps = availableApps.filter(app =>
        appNames.some(name => name.toLowerCase() === app.fullName.toLowerCase())
      );

      uxLog("success", this, c.green(t('successfullyValidatedConnectedAppInTheOrg', { connectedApps: connectedApps.length })));
      return connectedApps;
    }

    // If no name filter, return all available apps
    return availableApps;
  }

  private async selectConnectedApps(
    connectedApps: ConnectedApp[],
    processAll: boolean,
    nameFilter: string | undefined
  ): Promise<ConnectedApp[]> {
    const initialSelection: string[] = [];
    if (this.refreshSandboxConfig.connectedApps && this.refreshSandboxConfig.connectedApps.length > 0) {
      initialSelection.push(...this.refreshSandboxConfig.connectedApps);
    }
    return selectConnectedAppsForProcessing(
      connectedApps,
      initialSelection,
      processAll,
      nameFilter,
      'Select Connected Apps that you will want to restore after org refresh (SPOILERS: you probably can not since Spring 26!)',
      this
    );
  }

  private async processConnectedApps(
    orgUsername: string | undefined,
    connectedApps: ConnectedApp[],
    instanceUrl: string,
    accessToken: string = ''
  ): Promise<ConnectedApp[]> {
    if (!orgUsername) {
      throw new Error('Organization username is required');
    }

    const updatedApps: ConnectedApp[] = [];
    let browserContext: BrowserContext | null = null;

    try {
      // Step 1: Retrieve the Connected Apps from org (apps owned by external orgs are not retrievable)
      const retrievableApps = await this.retrieveConnectedAppsFromOrg(orgUsername, connectedApps, this.saveProjectPath);
      if (retrievableApps.length === 0) {
        return updatedApps;
      }

      // Step 2: Query for applicationIds for all Connected Apps
      const connectedAppIdMap = await this.queryConnectedAppIds(orgUsername, retrievableApps);

      // Step 3: Initialize browser for automation if access token is available
      uxLog("action", this, c.cyan(t('initializingBrowserForAutomatedConnectedAppSecrets')));
      try {
        browserContext = await this.initializeBrowser(instanceUrl, accessToken);
      } catch (e: any) {
        uxLog("error", this, c.red(t('errorInitializingBrowserConsumerSecret', { message: e.message })));
        // Continue without browser automation - will fall back to manual entry
      }

      // Step 4: Process each Connected App
      for (const app of retrievableApps) {
        try {
          const updatedApp = await this.processIndividualApp(
            app,
            connectedAppIdMap,
            browserContext,
            instanceUrl,
            this.saveProjectPath
          );

          if (updatedApp) {
            updatedApps.push(updatedApp);
          }
        } catch (error: any) {
          uxLog("warning", this, c.yellow(t('errorProcessing', { app: app.fullName, error: error.message || error })));
        }
      }

      return updatedApps;
    } finally {
      // Close browser if it was opened
      if (browserContext?.browser) {
        uxLog("log", this, c.cyan(t('closingBrowser')));
        await browserContext.browser.close();
      }
    }
  }

  private async retrieveConnectedAppsFromOrg(
    orgUsername: string,
    connectedApps: ConnectedApp[],
    saveProjectPath: string
  ): Promise<ConnectedApp[]> {
    uxLog("action", this, c.cyan(t('retrievingConnectedAppFrom', { connectedApps: connectedApps.length, orgUsername })));
    await retrieveConnectedApps(orgUsername, connectedApps, this, saveProjectPath);
    return this.classifyRetrievedConnectedApps(connectedApps);
  }

  private classifyRetrievedConnectedApps(connectedApps: ConnectedApp[]): ConnectedApp[] {
    if (connectedApps.length === 0) return [];

    // Check if the Connected App files exist in the project
    const missingApps: string[] = [];

    for (const app of connectedApps) {
      // Try to find the app in the standard location
      const appPath = path.join(this.saveProjectPath, `force-app/main/default/connectedApps/${app.fullName}.connectedApp-meta.xml`);

      if (!fs.existsSync(appPath)) {
        // Also check in alternative locations where it might have been retrieved
        const altPaths = [
          path.join(this.saveProjectPath, `force-app/main/default/connectedApps/${app.fileName}.connectedApp-meta.xml`),
          path.join(this.saveProjectPath, `force-app/main/default/connectedApps/${app.fullName.replace(/\s/g, '_')}.connectedApp-meta.xml`)
        ];

        const found = altPaths.some(path => fs.existsSync(path));
        if (!found) {
          missingApps.push(app.fullName);
        }
      }
    }

    // Apps whose metadata is owned by an external org (authorized via "Log in with Salesforce",
    // like OwnBackup or Microsoft Power Platform) are listed by the Metadata API but not retrievable.
    // They cannot be saved: route them to the manual actions inventory instead of failing.
    if (missingApps.length > 0) {
      this.unretrievableConnectedApps.push(...missingApps);
      uxLog("warning", this, c.yellow(t('someConnectedAppsCouldNotBeRetrieved', { missingApps: missingApps.join(', ') })));
      uxLog("warning", this, c.yellow(t('externalConnectedAppsCannotBeSaved')));
    }

    return connectedApps.filter(app => !missingApps.includes(app.fullName));
  }

  private async queryConnectedAppIds(
    orgUsername: string,
    connectedApps: ConnectedApp[]
  ): Promise<Record<string, string>> {
    const connectedAppIdMap: Record<string, string> = {};
    const appNamesForQuery = connectedApps.map(app => `'${app.fullName}'`).join(',');

    if (appNamesForQuery.length === 0) {
      return connectedAppIdMap;
    }

    uxLog("action", this, c.cyan(t('retrievingApplicationidsForAllConnectedApps')));
    const queryCommand = `SELECT Id, Name FROM ConnectedApplication WHERE Name IN (${appNamesForQuery})`;

    try {
      const appQueryRes = await soqlQuery(queryCommand, this.conn);

      if (appQueryRes?.records?.length > 0) {
        // Populate the map with applicationIds
        let logMsg = `Found ${appQueryRes.records.length} applicationId(s) for Connected Apps:`;
        for (const record of appQueryRes.records) {
          connectedAppIdMap[record.Name] = record.Id;
          logMsg += `\n  - ${record.Name}: ${record.Id}`;
        }
        uxLog("log", this, c.grey(logMsg));
      } else {
        uxLog("warning", this, c.yellow(t('noApplicationidsFoundInTheOrgWill')));
      }
    } catch (queryError) {
      uxLog("error", this, c.yellow(t('errorRetrievingApplicationids', { queryError })));
    }

    return connectedAppIdMap;
  }

  private async initializeBrowser(
    instanceUrl: string,
    accessToken: string
  ): Promise<BrowserContext> {
    // Get chrome/chromium executable path using shared utility
    const chromeExecutablePath = getChromeExecutablePath();
    uxLog("log", this, c.cyan(t('chromeexecutablepath', { chromeExecutablePath })));

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: false, // Always show the browser window
      executablePath: chromeExecutablePath,
      timeout: 60000 // Increase timeout for browser launch
    });

    // Log in once for the session
    const loginUrl = `${instanceUrl}/secur/frontdoor.jsp?sid=${accessToken}`;
    uxLog("log", this, c.cyan(t('logInViaBrowserFrontdoor')));
    const page = await browser.newPage();
    await page.goto(loginUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });
    await page.close();

    return { browser, instanceUrl, accessToken };
  }

  private async processIndividualApp(
    app: ConnectedApp,
    connectedAppIdMap: Record<string, string>,
    browserContext: BrowserContext | null,
    instanceUrl: string,
    saveProjectPath: string
  ): Promise<ConnectedApp | undefined> {
    const connectedAppFile = await findConnectedAppFile(app.fullName, this, saveProjectPath);

    if (!connectedAppFile) {
      uxLog("warning", this, c.yellow(t('connectedAppFileNotFoundFor', { app: app.fullName })));
      return undefined;
    }

    const connectedAppId = connectedAppIdMap[app.fullName];
    let consumerSecretValue: string | null = null;
    let viewLink: string;

    // Try to extract application ID and view link
    if (connectedAppId) {
      try {
        uxLog("action", this, c.cyan(t('extractingInfoForConnectedApp', { app: app.fullName })));
        const applicationId = await this.extractApplicationId(instanceUrl, connectedAppId, app.fullName, browserContext?.accessToken ?? '');
        viewLink = `${instanceUrl}/app/mgmt/forceconnectedapps/forceAppDetail.apexp?applicationId=${applicationId}`;
        uxLog("success", this, c.green(t('successfullyExtractedApplicationIdViewlink', { applicationId, viewLink })));

        // Try automated extraction if browser is available
        if (browserContext?.browser) {
          uxLog("log", this, c.cyan(t('attemptingToAutomaticallyExtractConsumerSecretFor', { app: app.fullName })));
          try {
            consumerSecretValue = await this.extractConsumerSecret(
              browserContext.browser,
              viewLink
            );
          } catch (puppeteerError) {
            uxLog("warning", this, c.yellow(t('errorExtractingConsumerSecretWithPuppeteer', { puppeteerError })));
            consumerSecretValue = null;
          }
        }
      } catch (error) {
        uxLog("error", this, c.red(t('couldNotExtractApplicationIdForError', { app: app.fullName, error })));
        viewLink = `${instanceUrl}/lightning/setup/NavigationMenus/home`;
        uxLog("action", this, c.cyan(t('openingApplicationListPagePleaseManuallyFind', { app: app.fullName })));
      }
    } else {
      // Fallback to the connected apps list page if applicationId can't be found
      uxLog("warning", this, c.yellow(t('noApplicationidFoundForOpeningApplicationList', { app: app.fullName })));
      viewLink = `${instanceUrl}/lightning/setup/NavigationMenus/home`;
    }

    try {
      // If consumer secret was automatically extracted
      if (consumerSecretValue) {
        const xmlData = await parseXmlFile(connectedAppFile);
        if (xmlData && xmlData.ConnectedApp) {
          const consumerKey = xmlData.ConnectedApp.consumerKey ? xmlData.ConnectedApp.consumerKey[0] : 'unknown';
          return await this.updateConnectedAppWithSecret(
            connectedAppFile,
            xmlData,
            consumerSecretValue,
            app,
            consumerKey
          );
        }
      } else {
        // Manual entry flow - open browser and prompt for secret
        const msg = [
          `Unable to automatically extract Consumer Secret for Connected App ${app.fullName}.`,
          `- Open Connected App detail page of ${app.fullName} (Contextual menu -> View)`,
          '- Click "Manage Consumer Details" button',
          `- Copy the ${c.green('Consumer Secret')} value`
        ].join('\n');
        uxLog("action", this, c.cyan(msg));
        await open(viewLink);

        // Prompt for the Consumer Secret (manual entry)
        const secretPromptResponse = await prompts({
          type: 'text',
          name: 'consumerSecret',
          message: t('enterTheConsumerSecretFor', { app: app.fullName }),
          description: t('youCanFindThisInTheBrowser'),
          validate: (value) => value && value.trim() !== '' ? true : 'Consumer Secret is required'
        });

        if (!secretPromptResponse.consumerSecret) {
          uxLog("action", this, c.cyan(t('skippingDueToMissingConsumerSecret', { app: app.fullName })));
          return undefined;
        }

        // Parse the Connected App XML file
        const xmlData = await parseXmlFile(connectedAppFile);
        if (xmlData && xmlData.ConnectedApp) {
          // Store the consumer secret
          const consumerSecret = secretPromptResponse.consumerSecret;
          const consumerKey = xmlData.ConnectedApp.consumerKey ? xmlData.ConnectedApp.consumerKey[0] : 'unknown';
          return await this.updateConnectedAppWithSecret(
            connectedAppFile,
            xmlData,
            consumerSecret,
            app,
            consumerKey
          );
        } else {
          uxLog("warning", this, c.yellow(t('couldNotParseXmlFor', { app: app.fullName })));
        }
      }
    } catch (error: any) {
      uxLog("warning", this, c.yellow(t('errorProcessing2', { app: app.fullName, error: error.message })));
    }

    return undefined;
  }

  private async extractApplicationId(
    instanceUrl: string,
    connectedAppId: string,
    connectedAppName: string,
    accessToken: string
  ): Promise<string> {
    uxLog("log", this, c.cyan(t('extractingApplicationIdForConnectedAppWith', { connectedAppName })));

    const url = `${instanceUrl}/${connectedAppId}`;
    const response = await httpGet(url, {
      responseType: 'text',
      headers: {
        Cookie: `sid=${accessToken}`
      }
    });
    const html = response.data;
    const appIdMatch = html.match(/applicationId=([a-zA-Z0-9]+)/i);

    if (!appIdMatch || !appIdMatch[1]) {
      throw new Error('Could not extract application ID from HTML');
    }

    return appIdMatch[1];
  }

  private async extractConsumerSecret(
    browser: Browser,
    appUrl: string
  ): Promise<string | null> {
    let page: Page | undefined;
    try {
      page = await browser.newPage();

      uxLog("log", this, c.grey(`Navigating to Connected App detail page...`));
      await page.goto(appUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });
      uxLog("log", this, c.grey(`Attempting to extract Consumer Secret...`));

      // Click Manage Consumer Details button
      const manageBtnId = 'input[id="appsetup:setupForm:details:oauthSettingsSection:manageConsumerKeySecretSection:manageConsumer"]';
      await page.waitForSelector(manageBtnId, { timeout: 60000 });
      await page.click(manageBtnId);
      await page.waitForNavigation();

      // Extract Consumer Secret value
      const consumerSecretSpanId = '#appsetup\\:setupForm\\:consumerDetails\\:oauthConsumerSection\\:consumerSecretSection\\:consumerSecret';
      await page.waitForSelector(consumerSecretSpanId, { timeout: 60000 });
      const consumerSecretValue = await page.$eval(consumerSecretSpanId, element => element.textContent);
      uxLog("success", this, c.green(t('successfullyExtractedConsumerSecret')));

      return consumerSecretValue || null;
    } catch (error) {
      uxLog("error", this, c.red(t('errorExtractingConsumerSecret', { error })));
      return null;
    } finally {
      if (page) await page.close();
    }
  }

  private async updateConnectedAppWithSecret(
    connectedAppFile: string,
    xmlData: any,
    consumerSecret: string,
    app: ConnectedApp,
    consumerKey: string
  ): Promise<ConnectedApp | undefined> {
    // The secret ends up in an XML file and comes from a browser DOM or a manual paste:
    // trim whitespace and escape XML special characters
    const trimmedSecret = (consumerSecret || '').trim();
    const escapedSecret = trimmedSecret.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const xmlString = await fs.readFile(connectedAppFile, 'utf8');

    let updatedXmlString: string;
    if (xmlString.includes('<consumerSecret>')) {
      updatedXmlString = xmlString.replace(
        /<consumerSecret>.*?<\/consumerSecret>/,
        `<consumerSecret>${escapedSecret}</consumerSecret>`
      );
    } else if (xmlString.includes('<consumerKey>')) {
      // Insert consumerSecret right after consumerKey
      updatedXmlString = xmlString.replace(
        /<consumerKey>.*?<\/consumerKey>/,
        `$&\n        <consumerSecret>${escapedSecret}</consumerSecret>`
      );
    } else {
      // No OAuth block in the retrieved XML: insert before the closing tag
      updatedXmlString = xmlString.replace(
        /<\/ConnectedApp>/,
        `    <consumerSecret>${escapedSecret}</consumerSecret>\n</ConnectedApp>`
      );
    }
    await fs.writeFile(connectedAppFile, updatedXmlString);

    // Verify the secret really is in the file before the app can be considered safe to delete
    const verifyXmlData = await parseXmlFile(connectedAppFile);
    const writtenSecret = verifyXmlData?.ConnectedApp?.consumerSecret?.[0] || '';
    if (writtenSecret !== trimmedSecret || trimmedSecret === '') {
      uxLog("error", this, c.red(t('consumerSecretVerificationFailed', { app: app.fullName, connectedAppFile })));
      return undefined;
    }

    xmlData.ConnectedApp.consumerSecret = [trimmedSecret];

    uxLog("success", this, c.green(t('successfullyAddedConsumerSecretToIn', { app: app.fullName, connectedAppFile })));

    return {
      ...app,
      consumerKey: consumerKey,
      consumerSecret: trimmedSecret
    };
  }

  private async saveConfig(): Promise<void> {
    const config = await getConfig("project");
    const existingRefreshConfig = config.refreshSandboxConfig || {};
    const sandboxFolderName = path.basename(this.saveProjectPath);
    const sandboxes = Object.assign({}, existingRefreshConfig.sandboxes || {});
    if (JSON.stringify(this.refreshSandboxConfig) !== JSON.stringify(sandboxes[sandboxFolderName] || {})) {
      sandboxes[sandboxFolderName] = this.refreshSandboxConfig;
      // Only the per-sandbox format is written: legacy top-level keys are dropped on first save
      await setConfig("project", { refreshSandboxConfig: { sandboxes } });
      uxLog("log", this, c.cyan(t('refreshSandboxConfigurationHasBeenSavedSuccessfully')));
    }
  }

  private async saveMetadatas(): Promise<void> {
    const metadataToSave = path.join(this.saveProjectPath, "manifest", 'package-metadatas-to-save.xml');
    if (fs.existsSync(metadataToSave)) {
      const promptResponse = await prompts({
        type: 'confirm',
        name: 'retrieveAgain',
        message: t('itSeemsYouAlreadyHaveMetadatasSaved'),
        description: t('thisWillOverwriteExistingPackageMetadatasFile'),
        initial: false
      });
      if (!promptResponse.retrieveAgain) {
        uxLog("action", this, c.cyan(t('skippingMetadataRetrievalAsItAlreadyExists', { saveProjectPath: this.saveProjectPath })));
        this.refreshActions.push({ step: "Save Metadata", type: "Metadata", name: "package-metadatas-to-save.xml", status: "Skipped", details: "Already exists - user skipped" });
        // Make sure the restore manifest exists even when the retrieve is skipped,
        // otherwise after-refresh would silently skip the whole "Restore Other Metadata" phase
        if (!fs.existsSync(path.join(this.saveProjectPath, 'manifest', 'package-metadata-to-restore.xml'))) {
          await this.generatePackageXmlToRestore();
        }
        return;
      }
    }

    // Metadata package.Xml for backup
    uxLog("action", this, c.cyan(t('savingMetadataFilesBeforeSandboxRefresh')));
    const savePackageXml = await this.createSavePackageXml();

    // Retrieve metadata from org using the package XML
    if (!savePackageXml) {
      uxLog("log", this, c.grey(t('skippingMetadataRetrievalUserChoice')));
      this.refreshActions.push({ step: "Save Metadata", type: "Metadata", name: "package-metadatas-to-save.xml", status: "Skipped", details: "User choice" });
      // Keep the restore manifest consistent with already retrieved sources, if any
      if (!fs.existsSync(path.join(this.saveProjectPath, 'manifest', 'package-metadata-to-restore.xml')) &&
        fs.existsSync(path.join(this.saveProjectPath, 'force-app', 'main', 'default'))) {
        await this.generatePackageXmlToRestore();
      }
      return;
    }

    // Retrieve metadatas to save
    await this.retrieveMetadatasToSave(savePackageXml);

    // Generate new package.xml from saveProjectPath, and remove ConnectedApps from it
    const restoredPackage = await this.generatePackageXmlToRestore();
    for (const [metadataType, items] of Object.entries(restoredPackage)) {
      const itemList = Array.isArray(items) ? items : [String(items)];
      for (const itemName of itemList) {
        this.refreshActions.push({ step: "Save Metadata", type: metadataType, name: itemName, status: "Success", details: "" });
      }
    }
    if (Object.keys(restoredPackage).length === 0) {
      this.refreshActions.push({ step: "Save Metadata", type: "Metadata", name: "package-metadatas-to-save.xml", status: "Success", details: "" });
    }
  }

  private async createSavePackageXml(): Promise<string | null> {
    uxLog("log", this, c.cyan(`Managing "package-metadatas-to-save.xml" file, that will be used to retrieve the metadatas before refreshing the org.`));
    // Copy default package xml to the save project path
    const sourceFile = path.join(PACKAGE_ROOT_DIR, 'defaults/refresh-sandbox', 'package-metadatas-to-save.xml');
    const targetFile = path.join(this.saveProjectPath, "manifest", 'package-metadatas-to-save.xml');
    await fs.ensureDir(path.dirname(targetFile));
    if (fs.existsSync(targetFile)) {
      const promptResponse = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: t('theFileAlreadyExistsDoYouWant', { targetFile }),
        description: t('thisFileIsUsedToSaveMetadataForOrgRefresh'),
        initial: false
      });
      if (promptResponse.overwrite) {
        uxLog("action", this, c.cyan(t('overwritingDefaultSavePackageXmlTo', { targetFile })));
        await fs.copy(sourceFile, targetFile, { overwrite: true });
      }
    }
    else {
      uxLog("log", this, c.grey(t('copyingDefaultPackageXmlTo', { targetFile })));
      await fs.copy(sourceFile, targetFile, { overwrite: true });
    }
    uxLog("log", this, c.grey(t('savePackageXmlIsLocatedAt', { targetFile })));
    WebSocketClient.sendReportFileMessage(targetFile, t('savePackageXml'), 'report');
    // Prompt user to check packageXml content and update it if necessary
    const promptRes = await prompts({
      type: 'confirm',
      name: 'checkPackageXml',
      message: t('pleaseCheckPackageXmlFileBeforeRetrieving', { targetFile }),
      description: t('youCanAddOrRemoveMetadataTypesToSave'),
      initial: true
    });
    if (!promptRes.checkPackageXml) {
      uxLog("action", this, c.cyan(`Skipping package XML retrieve`));
      return null;
    }
    return targetFile;
  }

  private async retrieveMetadatasToSave(savePackageXml: string) {
    uxLog("action", this, c.cyan(`Retrieving metadatas to save...`));
    await execCommand(
      `sf project retrieve start --manifest "${savePackageXml}" --target-org ${this.orgUsername} --ignore-conflicts --json`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
  }

  private async generatePackageXmlToRestore(): Promise<Record<string, string[]>> {
    uxLog("action", this, c.cyan(t('generatingNewPackageXmlFromSavedProject', { saveProjectPath: this.saveProjectPath })));
    const restorePackageXmlFileName = 'package-metadata-to-restore.xml';
    const restorePackageXmlFile = path.join(this.saveProjectPath, 'manifest', restorePackageXmlFileName);
    await execCommand(
      `sf project generate manifest --source-dir force-app --output-dir manifest --name ${restorePackageXmlFileName} --json`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
    uxLog("success", this, c.grey(t('generatedPackageXmlForRestoreAt', { restorePackageXmlFile })));
    const restorePackage = await parsePackageXmlFile(restorePackageXmlFile);
    if (restorePackage?.["ConnectedApp"]) {
      delete restorePackage["ConnectedApp"];
      await writePackageXmlFile(restorePackageXmlFile, restorePackage);
      uxLog("log", this, c.grey(t('removedConnectedappsFromAsTheyWillBe', { restorePackageXmlFileName })));
    }
    if (restorePackage?.["Certificate"]) {
      delete restorePackage["Certificate"];
      await writePackageXmlFile(restorePackageXmlFile, restorePackage);
      uxLog("log", this, c.grey(t('removedCertificatesFromAsTheyWillBe', { restorePackageXmlFileName })));
    }
    if (restorePackage?.["SamlSsoConfig"]) {
      delete restorePackage["SamlSsoConfig"];
      await writePackageXmlFile(restorePackageXmlFile, restorePackage);
      uxLog("log", this, c.grey(t('removedSamlssoconfigFromAsTheyWillBe', { restorePackageXmlFileName })));
    }
    // Remove External Client App metadata types (handled separately)
    let ecaRemoved = false;
    for (const ecaType of ECA_METADATA_TYPES) {
      if (restorePackage?.[ecaType]) {
        delete restorePackage[ecaType];
        ecaRemoved = true;
      }
    }
    if (ecaRemoved) {
      await writePackageXmlFile(restorePackageXmlFile, restorePackage);
      uxLog("log", this, c.grey(t('removedExternalClientAppsFromRestorePackage', { restorePackageXmlFileName })));
    }
    return restorePackage;
  }

  private async retrieveCertificates() {
    // Detect a previous run: default is then to keep the existing backup
    const certsDirForCheck = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'certs');
    const certsAlreadySaved = fs.existsSync(certsDirForCheck) &&
      fs.readdirSync(certsDirForCheck).some(file => file.endsWith('.crt'));
    const promptCerts = await prompts({
      type: 'confirm',
      name: 'retrieveCerts',
      message: certsAlreadySaved
        ? t('certificatesAlreadySavedRetrieveAgain')
        : t('doYouWantToRetrieveCertificatesFrom', { instanceUrl: this.instanceUrl }),
      description: certsAlreadySaved
        ? t('previousCertificatesWillBeReplaced')
        : t('certificatesCannotBeRetrievedUsingSourceApi'),
      initial: !certsAlreadySaved
    });
    if (!promptCerts.retrieveCerts) {
      uxLog("action", this, c.cyan(`Skipping Certificates retrieval as per user choice`));
      this.refreshActions.push({ step: "Retrieve Certificates", type: "Certificate", name: "All", status: "Skipped", details: certsAlreadySaved ? "Kept backup from previous run" : "User choice" });
      return;
    }

    uxLog("action", this, c.cyan(t('retrievingCertificatesCrtFromOrg')));
    // Retrieve certificates using metadata api coz with source api it does not work
    const certificatesPackageXml = path.join(PACKAGE_ROOT_DIR, 'defaults/refresh-sandbox', 'package-certificates-to-save.xml');
    const packageCertsXml = path.join(this.saveProjectPath, 'manifest', 'package-certificates-to-save.xml');
    uxLog("log", this, c.grey(t('copyingDefaultPackageXmlForCertificatesTo', { packageCertsXml })));
    await fs.copy(certificatesPackageXml, packageCertsXml, { overwrite: true });
    uxLog("log", this, c.grey(t('retrievingCertificatesFromOrgUsingMetadataApi', { instanceUrl: this.instanceUrl })));
    await execSfdxJson(
      `sf project retrieve start --manifest "${packageCertsXml}" --target-org ${this.orgUsername} --target-metadata-dir ./mdapi_certs --unzip`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
    // Copy the extracted certificates to the main directory
    const mdapiCertsDir = path.join(this.saveProjectPath, 'mdapi_certs', 'unpackaged', 'unpackaged', 'certs');
    const certsDir = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'certs');
    if (!fs.existsSync(mdapiCertsDir)) {
      // No certificates in the org: do not crash the whole backup
      uxLog("log", this, c.grey(t('noCertificatesFoundInOrgSkipping')));
      this.refreshActions.push({ step: "Retrieve Certificates", type: "Certificate", name: "All", status: "Skipped", details: "No certificates found in org" });
      await fs.remove(path.join(this.saveProjectPath, 'mdapi_certs'));
      return;
    }
    // Replace the previous run's certificates so no stale file lingers in the backup
    if (certsAlreadySaved) {
      uxLog("log", this, c.grey(t('deletingPreviousSavedItems', { folder: certsDir })));
      await fs.emptyDir(certsDir);
    }
    uxLog("log", this, c.grey(t('copyingCertificatesFromTo', { mdapiCertsDir, certsDir })));
    await fs.ensureDir(certsDir);
    await fs.copy(mdapiCertsDir, certsDir, { overwrite: true });
    await fs.remove(path.join(this.saveProjectPath, 'mdapi_certs'));
    uxLog("success", this, c.green(t('successfullyRetrievedCertificatesFromOrgAndSaved', { certsDir })));
    uxLog("action", this, c.cyan(t('retrievingCertificatesDefinitionsCrtMetaXmlFrom')));
    // Retrieve certificates definitions using source api
    await execCommand(
      `sf project retrieve start -m Certificate --target-org ${this.orgUsername} --ignore-conflicts --json`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
    const savedCertNames = fs.readdirSync(certsDir)
      .filter(f => f.endsWith('.crt'))
      .map(f => path.basename(f, '.crt'));
    if (savedCertNames.length > 0) {
      for (const certName of savedCertNames) {
        this.refreshActions.push({ step: "Retrieve Certificates", type: "Certificate", name: certName, status: "Success", details: "" });
      }
    } else {
      this.refreshActions.push({ step: "Retrieve Certificates", type: "Certificate", name: "All", status: "Success", details: "" });
    }
  }

  private async saveCustomSettings(): Promise<void> {
    const customSettingsFolder = path.join(this.saveProjectPath, 'savedCustomSettings');
    // If savedCustomSettings is not empty, ask if we want to retrieve them again
    if (fs.existsSync(customSettingsFolder) && fs.readdirSync(customSettingsFolder).length > 0) {
      const confirmRetrieval = await prompts({
        type: 'confirm',
        name: 'retrieveAgain',
        message: t('customSettingsFolderIsNotEmptyDo'),
        description: t('ifYouDoNotRetrieveThemAgainCustomSettingsWillNotBeUpdated'),
        initial: false
      });

      if (!confirmRetrieval.retrieveAgain) {
        uxLog("action", this, c.cyan(t('skippingCustomSettingsRetrievalAsItAlready', { customSettingsFolder })));
        return;
      }
      // Replace the previous run's export so no stale custom setting lingers in the backup
      uxLog("log", this, c.grey(t('deletingPreviousSavedItems', { folder: customSettingsFolder })));
      await fs.emptyDir(customSettingsFolder);
    }
    // List custom settings in the org
    uxLog("action", this, c.cyan(`Listing Custom Settings in the org...`));
    const globalDesc = await this.conn.describeGlobal();
    const customSettings = globalDesc.sobjects.filter(sobject => sobject.customSetting);
    if (customSettings.length === 0) {
      uxLog("warning", this, c.yellow(t('noCustomSettingsFoundInTheOrg')));
      return;
    }
    const customSettingsNames = customSettings.map(cs => `- ${cs.name}`).sort().join('\n');
    uxLog("log", this, c.grey(t('foundCustomSettingInTheOrg', { customSettings: customSettings.length, customSettingsNames })));
    // Ask user to select which Custom Settings to retrieve
    const initialCs = this.refreshSandboxConfig.customSettings || customSettings.map(cs => cs.name);
    const selectedSettings = await prompts({
      type: 'multiselect',
      name: 'settings',
      message: t('selectCustomSettingsToRetrieve'),
      description: t('youCanSelectMultipleCustomSettingsToRetrieve'),
      choices: customSettings.map(cs => ({ title: cs.name, value: cs.name })),
      initial: initialCs,
    });
    if (selectedSettings.settings.length === 0) {
      uxLog("action", this, c.cyan(t('noCustomSettingsSelectedForRetrieval')));
      this.refreshActions.push({ step: "Save Custom Settings", type: "CustomSetting", name: "N/A", status: "Skipped", details: "No custom settings selected" });
      return;
    }
    this.refreshSandboxConfig.customSettings = selectedSettings.settings.sort();
    await this.saveConfig();
    const successCs: any = [];
    const emptyCs: any = [];
    const errorCs: any = [];
    WebSocketClient.sendProgressStartMessage(t('retrievingSelectedCustomSettings', { selectedSettings: selectedSettings.settings.length }), selectedSettings.settings.length);
    let csCounter = 0;

    const retrieveOneCustomSetting = async (settingName: string): Promise<void> => {
      try {
        uxLog("log", this, c.cyan(t('retrievingValuesOfCustomSetting', { settingName })));

        // List all fields of the Custom Setting using globalDesc
        const customSettingDesc = globalDesc.sobjects.find(sobject => sobject.name === settingName);
        if (!customSettingDesc) {
          uxLog("error", this, c.red(t('customSettingNotFoundInTheOrg', { settingName })));
          errorCs.push(settingName);
          return;
        }
        const csDescribe = await this.conn.sobject(settingName).describe();
        const fieldList = csDescribe.fields.map(field => field.name).join(', ');
        uxLog("log", this, c.grey(t('fieldsInCustomSetting', { settingName, fieldList })));

        // Use data tree export to retrieve the Custom Setting
        uxLog("log", this, c.cyan(t('runningTreeExportForCustomSetting', { settingName })));
        const retrieveCommand = `sf data tree export --query "SELECT ${fieldList} FROM ${settingName}" --target-org ${this.orgUsername} --json`;
        const csFolder = path.join(customSettingsFolder, settingName);
        await fs.ensureDir(csFolder);
        const result = await execSfdxJson(retrieveCommand, this, {
          output: true,
          fail: true,
          cwd: csFolder
        });
        if (!(result?.status === 0)) {
          uxLog("error", this, c.red(t('failedToRetrieveCustomSetting', { settingName, JSON: JSON.stringify(result) })));
          errorCs.push(settingName);
          return;
        }
        const resultFile = path.join(csFolder, `${settingName}.json`);
        if (fs.existsSync(resultFile)) {
          uxLog("log", this, c.grey(t('customSettingHasBeenDownloadedTo', { settingName, resultFile })));
          successCs.push(settingName);
        }
        else if (result?.result?.records && result.result.records?.length === 0) {
          uxLog("warning", this, c.yellow(t('customSettingHasNoRecordsInThe', { settingName })));
          emptyCs.push(settingName);
        }
        else {
          uxLog("error", this, c.red(t('customSettingWasNotRetrievedCorrectlyNo', { settingName, resultFile })));
          errorCs.push(settingName);
        }
      } catch (error: any) {
        errorCs.push(settingName);
        uxLog("error", this, c.red(t('errorRetrievingCustomSetting', { settingName, error: error.message || error })));
      } finally {
        csCounter++;
        WebSocketClient.sendProgressStepMessage(csCounter, selectedSettings.settings.length);
      }
    };

    // Retrieve the selected Custom Settings, up to 4 in parallel
    try {
      const settingsQueue: string[] = [...selectedSettings.settings];
      const parallelWorkers = Array.from(
        { length: Math.min(4, settingsQueue.length) },
        async () => {
          while (settingsQueue.length > 0) {
            const settingName = settingsQueue.shift();
            if (!settingName) break;
            await retrieveOneCustomSetting(settingName);
          }
        }
      );
      await Promise.all(parallelWorkers);
    } finally {
      WebSocketClient.sendProgressEndMessage();
    }
    uxLog("action", this, c.cyan(t('customSettingsRetrievalCompletedSuccessfulEmptyFailed', { successCs: successCs.length, emptyCs: emptyCs.length, errorCs: errorCs.length })));
    if (successCs.length > 0) {
      const successCsNames = successCs.map(cs => "- " + cs).join('\n');
      uxLog("success", this, c.green(t('successfullyRetrievedCustomSettings', { successCsNames })));
    }
    if (emptyCs.length > 0) {
      const emptyCsNames = emptyCs.map(cs => "- " + cs).join('\n');
      uxLog("warning", this, c.yellow(t('customSettingsWithNoRecords', { emptyCsNames })));
    }
    if (errorCs.length > 0) {
      const errorCsNames = errorCs.map(cs => "- " + cs).join('\n');
      uxLog("error", this, c.red(t('failedToRetrieveCustomSettings', { errorCsNames })));
    }
    for (const cs of successCs) {
      this.refreshActions.push({ step: "Save Custom Settings", type: "CustomSetting", name: cs, status: "Success", details: "" });
    }
    for (const cs of emptyCs) {
      this.refreshActions.push({ step: "Save Custom Settings", type: "CustomSetting", name: cs, status: "Warning", details: "No records in org" });
    }
    for (const cs of errorCs) {
      this.refreshActions.push({ step: "Save Custom Settings", type: "CustomSetting", name: cs, status: "Error", details: "Retrieval failed" });
    }
  }

  private async saveRecords(): Promise<void> {
    const hasDataWs = await hasDataWorkspaces();
    if (!hasDataWs) {
      uxLog("action", this, c.yellow(t('noDataWorkspacesFoundInTheProject')));
      uxLog("log", this, c.grey(t('youCanCreateDataWorkspacesUsingHardis', { CONSTANTS: CONSTANTS.DOC_URL_ROOT })));
      this.refreshActions.push({ step: "Save Records", type: "Records", name: "N/A", status: "Skipped", details: "No data workspaces in project" });
      return;
    }

    const sfdmuWorkspaces = await selectDataWorkspace({
      selectDataLabel: 'Select data workspaces to use to export records before refreshing sandbox',
      multiple: true,
      initial: this?.refreshSandboxConfig?.dataWorkspaces || [],
    });
    if (!(Array.isArray(sfdmuWorkspaces) && sfdmuWorkspaces.length > 0)) {
      uxLog("warning", this, c.yellow(t('noDataWorkspaceSelectedSkippingRecordSaving')));
      this.refreshActions.push({ step: "Save Records", type: "Records", name: "N/A", status: "Skipped", details: "No data workspace selected" });
      return;
    }
    this.refreshSandboxConfig.dataWorkspaces = sfdmuWorkspaces.sort();
    await this.saveConfig();

    // Copy data templates in saveProjectPath
    for (const sfdmuPath of sfdmuWorkspaces) {
      const sourcePath = path.join(process.cwd(), sfdmuPath);
      const targetPath = path.join(this.saveProjectPath, sfdmuPath);
      await fs.ensureDir(path.dirname(targetPath));
      if (fs.existsSync(targetPath)) {
        uxLog("log", this, c.grey(t('overwritingDataWorkspaceFromTo', { sourcePath, targetPath })));
        await fs.copy(sourcePath, targetPath, { overwrite: true });
      } else {
        uxLog("log", this, c.grey(t('copyingDataWorkspaceFromTo', { sourcePath, targetPath })));
        await fs.copy(sourcePath, targetPath, { overwrite: true });
      }
    }

    for (const sfdmuPath of sfdmuWorkspaces) {
      await exportData(sfdmuPath || '', this, {
        sourceUsername: this.orgUsername,
        cwd: this.saveProjectPath
      });
      this.refreshActions.push({ step: "Save Records", type: "Records", name: sfdmuPath, status: "Success", details: "" });
    }
  }

  private async saveManualActionsInventory(): Promise<void> {
    uxLog("action", this, c.cyan(t('collectingManualActionsInventory')));

    // Apps saved with their credentials are restorable: exclude them from the manual list.
    // Built from what was ACTUALLY captured (secret verified in the backup files), not from the selection.
    const savedWithCredentials = [
      ...this.connectedAppsSavedWithSecret,
      ...(await getEcaNamesWithSavedSecret(this.saveProjectPath)),
    ];
    const inventory = await collectManualRestoreInventory(this.conn, savedWithCredentials, this.unretrievableConnectedApps, this);
    inventory.rescheduleScripts = await generateRescheduleApexScripts(this.saveProjectPath, inventory);
    const inventoryFile = await saveManualRestoreInventory(this.saveProjectPath, inventory, this);

    const externalTools = inventory.externalOauthApps.filter(app => !app.isStandardApp);
    const standardAppsCount = inventory.externalOauthApps.length - externalTools.length;
    if (externalTools.length > 0) {
      const appsList = externalTools.map(app => {
        const usersInfo = app.users.length > 0 ? `, users: ${app.users.slice(0, 5).join(', ')}${app.users.length > 5 ? ', ...' : ''}` : '';
        return `- ${app.appName} (${app.tokenCount} OAuth token(s)${usersInfo})`;
      }).join('\n');
      uxLog("warning", this, c.yellow(t('externalOauthAppsDetected', { count: externalTools.length, appsList })));
      for (const app of externalTools) {
        const usersInfo = app.users.length > 0 ? `, users: ${app.users.join(', ')}` : '';
        this.refreshActions.push({ step: "List Manual Actions", type: "ExternalOauthApp", name: app.appName, status: "Manual", details: `Re-authorize manually after refresh (${app.tokenCount} OAuth token(s)${usersInfo})` });
      }
    }
    if (standardAppsCount > 0) {
      uxLog("log", this, c.grey(t('standardOauthAppsAlsoRevoked', { count: standardAppsCount })));
    }

    const credentialsCount = inventory.authProviders.length + inventory.externalCredentials.length + inventory.namedCredentials.length;
    if (credentialsCount > 0) {
      uxLog("warning", this, c.yellow(t('credentialSecretsNotSaved', { count: credentialsCount })));
      for (const authProvider of inventory.authProviders) {
        this.refreshActions.push({ step: "List Manual Actions", type: "AuthProvider", name: authProvider.developerName, status: "Manual", details: "Consumer Secret must be re-entered manually after restore" });
      }
      for (const externalCredential of inventory.externalCredentials) {
        this.refreshActions.push({ step: "List Manual Actions", type: "ExternalCredential", name: externalCredential.developerName, status: "Manual", details: "Principals must be re-authenticated or secrets re-entered after restore" });
      }
      for (const namedCredential of inventory.namedCredentials) {
        this.refreshActions.push({ step: "List Manual Actions", type: "NamedCredential", name: namedCredential.developerName, status: "Manual", details: "Check endpoint and re-enter secrets after restore" });
      }
    }

    if (inventory.scheduledJobs.length > 0) {
      uxLog("log", this, c.grey(t('scheduledJobsInventoried', { count: inventory.scheduledJobs.length })));
      const jobTypesForReport = ['Scheduled Apex', 'Batch Job', 'Scheduled Flow', 'Data Export'];
      for (const job of inventory.scheduledJobs.filter(j => jobTypesForReport.includes(j.jobType))) {
        const ownerInfo = job.ownerUsername ? `, owner: ${job.ownerUsername}` : '';
        this.refreshActions.push({ step: "List Manual Actions", type: "ScheduledJob", name: job.name, status: "Manual", details: `${job.jobType} (${job.cronExpression}${ownerInfo}): re-schedule after refresh if missing` });
      }
    }

    if ((inventory.rescheduleScripts || []).length > 0) {
      const scriptsList = (inventory.rescheduleScripts || []).map(script =>
        `- ${script.file} (${script.jobsCount} job(s), to run as ${script.ownerUsername})`).join('\n');
      uxLog("warning", this, c.yellow(t('generatedRescheduleApexScripts', { count: (inventory.rescheduleScripts || []).length, list: scriptsList })));
      for (const script of inventory.rescheduleScripts || []) {
        this.refreshActions.push({ step: "List Manual Actions", type: "ApexScript", name: script.file, status: "Manual", details: `Run as ${script.ownerUsername} after refresh to reschedule ${script.jobsCount} Scheduled Apex job(s)` });
      }
    }

    uxLog("success", this, c.green(t('manualActionsInventorySavedIn', { inventoryFile })));
    WebSocketClient.sendReportFileMessage(inventoryFile, t('manualActionsInventoryTitle') + ' (JSON)', 'report');
  }

  // Flush the actions history after each step, so an interrupted run still leaves
  // its completed actions in the history. Merging is idempotent for a same run.
  private async saveActionsCheckpoint(): Promise<void> {
    if (!this.saveProjectPath || this.refreshActions.length === 0) {
      return;
    }
    try {
      await mergeAndSaveRefreshActions(
        this.saveProjectPath,
        BEFORE_REFRESH_ACTIONS_HISTORY_FILE,
        this.refreshActions,
        OrgRefreshBeforeRefresh.REPORT_REPLACE_STEPS,
        this.runStartDate
      );
    } catch {
      // A checkpoint failure must never break the backup itself
    }
  }

  private async generateActionsReport(): Promise<void> {
    if (this.refreshActions.length === 0) {
      return;
    }
    uxLog("action", this, c.cyan(t('generatingSandboxRefreshActionsReport')));
    // The report is cumulative across runs: actions of previous runs are kept, except for
    // sections that rebuild their backup from scratch when re-executed
    const combinedActions = await mergeAndSaveRefreshActions(
      this.saveProjectPath,
      BEFORE_REFRESH_ACTIONS_HISTORY_FILE,
      this.refreshActions,
      OrgRefreshBeforeRefresh.REPORT_REPLACE_STEPS,
      this.runStartDate
    );
    if (combinedActions.length > this.refreshActions.length) {
      uxLog("log", this, c.grey(t('reportIncludesPreviousRuns')));
    }
    // Include the sandbox folder in the file name so reports of different sandboxes do not overwrite each other
    const reportPath = await generateReportPath(`sandbox-refresh-before-actions-${path.basename(this.saveProjectPath)}`, '');
    await generateCsvFile(combinedActions, reportPath, {
      fileTitle: t('sandboxRefreshActionsReport')
    });
  }
}
