import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import fs from 'fs-extra';
import c from 'chalk';
import open from 'open';
import axios from 'axios';
import path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { execCommand, execSfdxJson, isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { parsePackageXmlFile, parseXmlFile, writePackageXmlFile } from '../../../../common/utils/xmlUtils.js';
import { getChromeExecutablePath } from '../../../../common/utils/orgConfigUtils.js';
import {
  deleteConnectedApps,
  retrieveConnectedApps,
  validateConnectedApps,
  findConnectedAppFile,
  selectConnectedAppsForProcessing,
  createConnectedAppSuccessResponse,
  handleConnectedAppError
} from '../../../../common/utils/refresh/connectedAppUtils.js';
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

export default class OrgRefreshBeforeRefresh extends SfCommand<AnyJson> {
  public static description = `
## Command Behavior

**Backs up all Connected Apps (including Consumer Secrets), certificates, custom settings, records and other metadata from a Salesforce org before a sandbox refresh, enabling full restoration after the refresh.**

This command prepares a complete backup prior to a sandbox refresh. It creates a dedicated project under \`scripts/sandbox-refresh/<sandbox-folder>\`, retrieves metadata and data, attempts to capture Connected App consumer secrets, and can optionally delete the apps so they can be reuploaded after the refresh.

Key functionalities:

- **Create a save project:** Generates a dedicated project folder to store all artifacts for the sandbox backup.
- **Find and select Connected Apps:** Lists Connected Apps in the org and lets you pick specific apps, use a name filter, or process all apps.
- **Save metadata for restore:** Builds a manifest and retrieves the metadata types you choose so they can be restored after the refresh.
- **Capture Consumer Secrets:** Attempts to capture Connected App consumer secrets automatically (opens a browser session when possible) and falls back to a short manual prompt when needed.
- **Collect certificates:** Saves certificate files and their definitions so they can be redeployed later.
- **Export custom settings & records:** Lets you pick custom settings to export as JSON and optionally export records using configured data workspaces.
- **Persist choices & report:** Stores your backup choices in project config and sends report files for traceability.
- **Optional cleanup:** Can delete backed-up Connected Apps from the org so they can be re-uploaded cleanly after the refresh.
- **Interactive safety checks:** Prompts you to confirm package contents and other potentially destructive actions; sensible defaults are chosen where appropriate.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is intended to be run before a sandbox refresh so that all credentials, certificates, metadata and data can be restored afterwards.

<details markdown="1">
<summary>Technical explanations</summary>

- **Salesforce CLI Integration:** Uses \`sf org list metadata\`, \`sf project retrieve start\`, \`sf project generate\`, \`sf project deploy start\`, and \`sf data tree export\`/\`import\` where applicable.
- **Metadata Handling:** Writes and reads package XML files under the generated project (\`manifest/\`), copies MDAPI certificate artifacts into \`force-app/main/default/certs\`, and produces \`package-metadata-to-restore.xml\` for post-refresh deployment.
- **Consumer Secret Handling:** Uses \`puppeteer-core\` with an executable path from \`getChromeExecutablePath()\` (env var \`PUPPETEER_EXECUTABLE_PATH\` may be required). Falls back to manual prompt when browser automation cannot be used.
- **Data & Records:** Exports custom settings to JSON and supports exporting records through SFDMU workspaces chosen interactively.
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

  public static flags = {
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
    this.refreshSandboxConfig = config?.refreshSandboxConfig || {};
    this.result = { success: true, message: t('beforeRefreshCommandPerformedSuccessfully') };

    uxLog("action", this, c.cyan(t('thisCommandWillSaveInformationRefresh')));

    // Check org is connected
    if (!accessToken) {
      throw new SfError(c.red('Access token is required to retrieve Connected Apps from the org. Please authenticate to a default org.'));
    }

    this.saveProjectPath = await this.createSaveProject();

    await this.retrieveCertificates();

    await this.saveMetadatas();

    await this.saveCustomSettings();

    await this.saveRecords();

    await this.retrieveDeleteConnectedApps(accessToken);

    return this.result;
  }

  private async createSaveProject(): Promise<string> {
    const folderName = this.conn.instanceUrl.replace(/https?:\/\//, '').replace("my.salesforce.com", "").replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const sandboxRefreshRootFolder = path.join(process.cwd(), 'scripts', 'sandbox-refresh');
    const projectPath = path.join(sandboxRefreshRootFolder, folderName);
    if (fs.existsSync(projectPath)) {
      uxLog("log", this, c.cyan(t('projectFolderAlreadyExistsReusingItDelete', { projectPath })));
      return projectPath;
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

  private async retrieveDeleteConnectedApps(accessToken: string): Promise<void> {
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

        // Step 4: Delete Connected Apps from org if required (default behavior)

        if (!isCI && !this.deleteApps) {
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

        if (this.deleteApps) {
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

        uxLog("success", this, c.cyan(t('savedRefreshSandboxConfigurationInConfigSfdx')));
        WebSocketClient.sendReportFileMessage(path.join(process.cwd(), 'config', '.sfdx-hardis.yml#refreshSandboxConfig'), "Sandbox refresh configuration", 'report');

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
      'Select Connected Apps that you will want to restore after org refresh',
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
      // Step 1: Retrieve the Connected Apps from org
      await this.retrieveConnectedAppsFromOrg(orgUsername, connectedApps, this.saveProjectPath);

      // Step 2: Query for applicationIds for all Connected Apps
      const connectedAppIdMap = await this.queryConnectedAppIds(orgUsername, connectedApps);

      // Step 3: Initialize browser for automation if access token is available
      uxLog("action", this, c.cyan(t('initializingBrowserForAutomatedConnectedAppSecrets')));
      try {
        browserContext = await this.initializeBrowser(instanceUrl, accessToken);
      } catch (e: any) {
        uxLog("error", this, c.red(t('errorInitializingBrowserConsumerSecret', { message: e.message })));
        // Continue without browser automation - will fall back to manual entry
      }

      // Step 4: Process each Connected App
      for (const app of connectedApps) {
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
  ): Promise<void> {
    uxLog("action", this, c.cyan(t('retrievingConnectedAppFrom', { connectedApps: connectedApps.length, orgUsername })));
    await retrieveConnectedApps(orgUsername, connectedApps, this, saveProjectPath);
    this.verifyConnectedAppsRetrieval(connectedApps);
  }

  private verifyConnectedAppsRetrieval(connectedApps: ConnectedApp[]): void {
    if (connectedApps.length === 0) return;

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

    // If any apps are missing, throw an error
    if (missingApps.length > 0) {
      const errorMsg = `Failed to retrieve the following Connected App(s): ${missingApps.join(', ')}`;
      uxLog("error", this, c.red(errorMsg));
      const dtlErrorMsg = "This could be due to:\n" +
        "  - Temporary Salesforce API issues\n" +
        "  - Permissions or profile issues in the org\n" +
        "  - Connected Apps that exist but are not accessible\n" +
        "Please exclude the app or check your permissions in the org then try again.";
      uxLog("warning", this, c.yellow(dtlErrorMsg));
      throw new Error(errorMsg);
    }
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
          uxLog("warning", this, c.yellow(t('skippingDueToMissingConsumerSecret', { app: app.fullName })));
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
    const response = await axios.get(url, {
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
  ): Promise<ConnectedApp> {
    const xmlString = await fs.readFile(connectedAppFile, 'utf8');

    if (xmlString.includes('<consumerSecret>')) {
      const updatedXmlString = xmlString.replace(
        /<consumerSecret>.*?<\/consumerSecret>/,
        `<consumerSecret>${consumerSecret}</consumerSecret>`
      );
      await fs.writeFile(connectedAppFile, updatedXmlString);
    } else {
      // Insert consumerSecret right after consumerKey
      const updatedXmlString = xmlString.replace(
        /<consumerKey>.*?<\/consumerKey>/,
        `$&\n        <consumerSecret>${consumerSecret}</consumerSecret>`
      );
      await fs.writeFile(connectedAppFile, updatedXmlString);
    }

    xmlData.ConnectedApp.consumerSecret = [consumerSecret];

    uxLog("success", this, c.green(t('successfullyAddedConsumerSecretToIn', { app: app.fullName, connectedAppFile })));

    return {
      ...app,
      consumerKey: consumerKey,
      consumerSecret: consumerSecret
    };
  }

  private async saveConfig(): Promise<void> {
    const config = await getConfig("project");
    if (!config.refreshSandboxConfig) {
      config.refreshSandboxConfig = {};
    }
    if (JSON.stringify(this.refreshSandboxConfig) !== JSON.stringify(config.refreshSandboxConfig)) {
      await setConfig("project", { refreshSandboxConfig: this.refreshSandboxConfig });
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
        description: 'This will overwrite the existing package-metadatas-to-save.xml file and related certificates and metadatas.',
        initial: false
      });
      if (!promptResponse.retrieveAgain) {
        uxLog("log", this, c.grey(t('skippingMetadataRetrievalAsItAlreadyExists', { saveProjectPath: this.saveProjectPath })));
        return;
      }
    }

    // Metadata package.Xml for backup
    uxLog("action", this, c.cyan(t('savingMetadataFilesBeforeSandboxRefresh')));
    const savePackageXml = await this.createSavePackageXml();

    // Retrieve metadata from org using the package XML
    if (!savePackageXml) {
      uxLog("log", this, c.grey(t('skippingMetadataRetrievalUserChoice')));
      return;
    }

    // Retrieve metadatas to save
    await this.retrieveMetadatasToSave(savePackageXml);

    // Generate new package.xml from saveProjectPath, and remove ConnectedApps from it
    await this.generatePackageXmlToRestore();
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
        description: 'This file is used to save the metadata that will be restored after org refresh.',
        initial: false
      });
      if (promptResponse.overwrite) {
        uxLog("log", this, c.grey(t('overwritingDefaultSavePackageXmlTo', { targetFile })));
        await fs.copy(sourceFile, targetFile, { overwrite: true });
      }
    }
    else {
      uxLog("log", this, c.grey(t('copyingDefaultPackageXmlTo', { targetFile })));
      await fs.copy(sourceFile, targetFile, { overwrite: true });
    }
    uxLog("log", this, c.grey(t('savePackageXmlIsLocatedAt', { targetFile })));
    WebSocketClient.sendReportFileMessage(targetFile, "Save package XML", 'report');
    // Prompt user to check packageXml content and update it if necessary
    const promptRes = await prompts({
      type: 'confirm',
      name: 'checkPackageXml',
      message: t('pleaseCheckPackageXmlFileBeforeRetrieving', { targetFile }),
      description: 'You can add or remove metadata types to save before proceeding.',
      initial: true
    });
    if (!promptRes.checkPackageXml) {
      uxLog("log", this, c.grey(`Skipping package XML retrieve`));
      return null;
    }
    return targetFile;
  }

  private async retrieveMetadatasToSave(savePackageXml: string) {
    uxLog("action", this, c.cyan(`Retrieving metadatas to save...`));
    await execCommand(
      `sf project retrieve start --manifest ${savePackageXml} --target-org ${this.orgUsername} --ignore-conflicts --json`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
  }

  private async generatePackageXmlToRestore() {
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
  }

  private async retrieveCertificates() {
    const promptCerts = await prompts({
      type: 'confirm',
      name: 'retrieveCerts',
      message: t('doYouWantToRetrieveCertificatesFrom', { instanceUrl: this.instanceUrl }),
      description: 'Certificates cannot be retrieved using Source API, so we will use Metadata API for that.',
      initial: true
    });
    if (!promptCerts.retrieveCerts) {
      uxLog("log", this, c.grey(`Skipping Certificates retrieval as per user choice`));
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
      `sf project retrieve start --manifest ${packageCertsXml} --target-org ${this.orgUsername} --target-metadata-dir ./mdapi_certs --unzip`,
      this,
      { output: true, fail: true, cwd: this.saveProjectPath }
    );
    // Copy the extracted certificates to the main directory
    const mdapiCertsDir = path.join(this.saveProjectPath, 'mdapi_certs', 'unpackaged', 'unpackaged', 'certs');
    const certsDir = path.join(this.saveProjectPath, 'force-app', 'main', 'default', 'certs');
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
  }

  private async saveCustomSettings(): Promise<void> {
    const customSettingsFolder = path.join(this.saveProjectPath, 'savedCustomSettings');
    // If savedCustomSettings is not empty, ask if we want to retrieve them again
    if (fs.existsSync(customSettingsFolder) && fs.readdirSync(customSettingsFolder).length > 0) {
      const confirmRetrieval = await prompts({
        type: 'confirm',
        name: 'retrieveAgain',
        message: t('customSettingsFolderIsNotEmptyDo'),
        description: `If you do not retrieve them again, the Custom Settings will not be updated with the latest changes from the org.`,
        initial: false
      });

      if (!confirmRetrieval.retrieveAgain) {
        uxLog("log", this, c.grey(t('skippingCustomSettingsRetrievalAsItAlready', { customSettingsFolder })));
        return;
      }
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
      description: 'You can select multiple Custom Settings to retrieve.',
      choices: customSettings.map(cs => ({ title: cs.name, value: cs.name })),
      initial: initialCs,
    });
    if (selectedSettings.settings.length === 0) {
      uxLog("warning", this, c.yellow(t('noCustomSettingsSelectedForRetrieval')));
      return;
    }
    this.refreshSandboxConfig.customSettings = selectedSettings.settings.sort();
    await this.saveConfig();
    uxLog("log", this, c.cyan(t('retrievingSelectedCustomSettings', { selectedSettings: selectedSettings.settings.length })));
    const successCs: any = [];
    const emptyCs: any = [];
    const errorCs: any = [];
    // Retrieve each selected Custom Setting
    for (const settingName of selectedSettings.settings) {
      try {
        uxLog("action", this, c.cyan(t('retrievingValuesOfCustomSetting', { settingName })));

        // List all fields of the Custom Setting using globalDesc
        const customSettingDesc = globalDesc.sobjects.find(sobject => sobject.name === settingName);
        if (!customSettingDesc) {
          uxLog("error", this, c.red(t('customSettingNotFoundInTheOrg', { settingName })));
          errorCs.push(settingName);
          continue;
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
          continue;
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
          continue;
        }
      } catch (error: any) {
        errorCs.push(settingName);
        uxLog("error", this, c.red(t('errorRetrievingCustomSetting', { settingName, error: error.message || error })));
      }
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
  }

  private async saveRecords(): Promise<void> {
    const hasDataWs = await hasDataWorkspaces();
    if (!hasDataWs) {
      uxLog("action", this, c.yellow(t('noDataWorkspacesFoundInTheProject')));
      uxLog("log", this, c.grey(t('youCanCreateDataWorkspacesUsingHardis', { CONSTANTS: CONSTANTS.DOC_URL_ROOT })));
      return;
    }

    const sfdmuWorkspaces = await selectDataWorkspace({
      selectDataLabel: 'Select data workspaces to use to export records before refreshing sandbox',
      multiple: true,
      initial: this?.refreshSandboxConfig?.dataWorkspaces || [],
    });
    if (!(Array.isArray(sfdmuWorkspaces) && sfdmuWorkspaces.length > 0)) {
      uxLog("warning", this, c.yellow(t('noDataWorkspaceSelectedSkippingRecordSaving')));
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
    }
  }
}
