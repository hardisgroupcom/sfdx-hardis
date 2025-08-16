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
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
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
import { getConfig, setConfig } from '../../../../config/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

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
  public static title = 'Save info to restore before org refresh';

  public static description = `
## Command Behavior

**Backs up all Connected Apps and their secrets from a Salesforce org before a sandbox refresh, enabling full restoration after the refresh.**

This command is essential for Salesforce sandbox refresh operations where Connected Apps (and their Consumer Secrets) would otherwise be lost. It automates the extraction, secure storage, and (optionally) deletion of Connected Apps, ensuring that all credentials and configuration can be restored post-refresh.

Key functionalities:

- **Connected App Discovery:** Lists all Connected Apps in the org, with options to filter by name or process all.
- **User Selection:** Allows interactive or flag-based selection of which Connected Apps to back up.
- **Metadata Retrieval:** Retrieves Connected App metadata and saves it in a dedicated project folder for the sandbox instance.
- **Consumer Secret Extraction:** Attempts to extract Consumer Secrets automatically using browser automation (Puppeteer), or prompts for manual entry if automation fails.
- **Config Persistence:** Stores the list of selected apps in the project config for use during restoration.
- **Optional Deletion:** Can delete the Connected Apps from the org after backup, as required for re-upload after refresh.
- **Summary and Reporting:** Provides a summary of actions, including which apps were saved and whether secrets were captured.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is designed to be run before a sandbox refresh. It ensures that all Connected Apps and their secrets are safely stored for later restoration.

<details markdown="1">
<summary>Technical explanations</summary>

- **Salesforce CLI Integration:** Uses \`sf org list metadata\` and other CLI commands to discover and retrieve Connected Apps.
- **Metadata Handling:** Saves Connected App XML files in a dedicated folder under \`scripts / sandbox - refresh / <sandbox-folder > \`.
- **Consumer Secret Handling:** Uses Puppeteer to automate browser login and extraction of Consumer Secrets, falling back to manual prompts if needed.
- **Config Management:** Updates \`config /.sfdx - hardis.yml\` with the list of selected apps for later use.
- **Deletion Logic:** Optionally deletes Connected Apps from the org (required for re-upload after refresh), with user confirmation unless running in CI or with \`--delete \` flag.
- **Error Handling:** Provides detailed error messages and guidance if retrieval or extraction fails.

</details>
`;

  public static examples = [
    `$ sf hardis:org:refresh:before-refresh`,
    `$ sf hardis:org:refresh:before-refresh --name "MyConnectedApp"`,
    `$ sf hardis:org:refresh:before-refresh --name "App1,App2,App3"`,
    `$ sf hardis:org:refresh:before-refresh --all`,
    `$ sf hardis:org:refresh:before-refresh --delete`,
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
  protected refreshSandboxConfig: any = {};

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgRefreshBeforeRefresh);
    this.conn = flags["target-org"].getConnection();
    const orgUsername = flags["target-org"].getUsername() as string; // Cast to string to avoid TypeScript error
    const instanceUrl = this.conn.instanceUrl;
    const accessToken = this.conn.accessToken; // Ensure accessToken is a string
    const processAll = flags.all || false;
    const nameFilter = processAll ? undefined : flags.name; // If --all is set, ignore --name
    const config = await getConfig("user");
    this.refreshSandboxConfig = config?.refreshSandboxConfig || {};

    uxLog("action", this, c.cyan(`This command with save information that will need to be restored after org refresh`));

    // Check org is connected
    if (!accessToken) {
      throw new SfError(c.red('Access token is required to retrieve Connected Apps from the org. Please authenticate to a default org.'));
    }

    this.saveProjectPath = await this.createSaveProject();

    try {
      // Step 1: Get Connected Apps from org or based on provided name filter
      const connectedApps = await this.getConnectedApps(orgUsername, nameFilter, processAll);

      if (connectedApps.length === 0) {
        uxLog("warning", this, c.yellow('No Connected Apps found'));
        return { success: false, message: 'No Connected Apps found' };
      }

      // Step 2: Determine which apps to process (all, filtered, or user-selected)
      const selectedApps = await this.selectConnectedApps(connectedApps, processAll, nameFilter);

      if (selectedApps.length === 0) {
        uxLog("warning", this, c.yellow('No Connected Apps selected'));
        return { success: false, message: 'No Connected Apps selected' };
      }
      this.refreshSandboxConfig.connectedApps = selectedApps.map(app => app.fullName).sort();
      await this.saveConfig();

      // Step 3: Process the selected Connected Apps
      const updatedApps = await this.processConnectedApps(orgUsername, selectedApps, instanceUrl, accessToken);

      // Step 4: Delete Connected Apps from org if required (default behavior)
      let deleteApps = flags.delete || false;
      if (!isCI && !deleteApps) {
        const connectedAppNames = updatedApps.map(app => app.fullName).join(', ');
        const deletePrompt = await prompts({
          type: 'confirm',
          name: 'delete',
          message: `Do you want to delete the Connected Apps from the org after saving? ${connectedAppNames}`,
          description: 'If you do not delete them, they will remain in the org and can be re-uploaded after refreshing the org.',
          initial: false
        });
        deleteApps = deletePrompt.delete;
      }

      if (deleteApps) {
        uxLog("action", this, c.cyan(`Deleting ${updatedApps.length} Connected Apps from ${this.conn.instanceUrl} ...`));
        await deleteConnectedApps(orgUsername, updatedApps, this, this.saveProjectPath);
        uxLog("success", this, c.green('Connected Apps were successfully deleted from the org.'));
      }

      const summaryMessage = deleteApps
        ? `You are now ready to refresh your sandbox org, as you will be able to re-upload the Connected Apps after the refresh.`
        : `Dry-run successful, run again the command with Connected Apps deletion to be able to refresh your org and re-upload the Connected Apps after the refresh.`;
      uxLog("action", this, c.cyan(summaryMessage));
      // Add a summary message at the end
      if (updatedApps.length > 0) {
        uxLog("success", this, c.green(`Successfully saved locally ${updatedApps.length} Connected App(s) with their Consumer Secrets`));
      }

      uxLog("success", this, c.cyan('Saved refresh sandbox configuration in config/.sfdx-hardis.yml'));
      WebSocketClient.sendReportFileMessage(path.join(process.cwd(), 'config', '.sfdx-hardis.yml#refreshSandboxConfig'), "Sandbox refresh configuration", 'report');

      return createConnectedAppSuccessResponse(
        `Successfully processed ${updatedApps.length} Connected App(s)`,
        updatedApps.map(app => app.fullName),
        {
          consumerSecretsAdded: updatedApps.map(app => app.consumerSecret ? app.fullName : null).filter(Boolean)
        }
      );

    } catch (error: any) {
      return handleConnectedAppError(error, this);
    }
  }

  private async createSaveProject(): Promise<string> {
    const folderName = this.conn.instanceUrl.replace(/https?:\/\//, '').replace("my.salesforce.com", "").replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const sandboxRefreshRootFolder = path.join(process.cwd(), 'scripts', 'sandbox-refresh');
    const projectPath = path.join(sandboxRefreshRootFolder, folderName);
    await fs.ensureDir(projectPath);
    uxLog("action", this, c.cyan(`Creating sfdx-project for sandbox info storage in ${projectPath}`));
    const createCommand = `sf project generate --name "${folderName}"`;
    await execCommand(createCommand, this, {
      output: true,
      fail: true,
    });
    uxLog("log", this, c.grey('Moving sfdx-project to root...'));
    await fs.copy(folderName, projectPath, { overwrite: true });
    await fs.remove(folderName);
    return projectPath;
  }

  private async getConnectedApps(
    orgUsername: string,
    nameFilter: string | undefined,
    processAll: boolean
  ): Promise<ConnectedApp[]> {
    // Set appropriate log message based on flags
    if (processAll) {
      uxLog("action", this, c.cyan('Processing all Connected Apps from org (selection prompt bypassed)'));
    } else if (nameFilter) {
      uxLog("action", this, c.cyan(`Processing specified Connected App(s): ${nameFilter} (selection prompt bypassed)`));
    } else {
      uxLog("action", this, c.cyan(`Retrieving list of Connected Apps from org ${this.conn.instanceUrl} ...`));
    }

    const command = `sf org list metadata --metadata-type ConnectedApp --target-org ${orgUsername}`;
    const result = await execSfdxJson(command, this, { output: true });

    const availableApps: ConnectedApp[] = result?.result && Array.isArray(result.result) ? result.result : [];

    if (availableApps.length === 0) {
      uxLog("warning", this, c.yellow('No Connected Apps were found in the org.'));
      return [];
    }
    availableApps.sort((a, b) => a.fullName.localeCompare(b.fullName));

    const availableAppNames = availableApps.map(app => app.fullName);
    uxLog("log", this, c.grey(`Found ${availableApps.length} Connected App(s) in the org`));

    // If name filter is provided, validate and filter the requested apps
    if (nameFilter) {
      const appNames = nameFilter.split(',').map(name => name.trim());
      uxLog("action", this, c.cyan(`Validating specified Connected App(s): ${appNames.join(', ')}`));

      validateConnectedApps(appNames, availableAppNames, this, 'org');

      // Filter available apps to only include the ones specified in the name filter (case-insensitive)
      const connectedApps = availableApps.filter(app =>
        appNames.some(name => name.toLowerCase() === app.fullName.toLowerCase())
      );

      uxLog("success", this, c.green(`Successfully validated ${connectedApps.length} Connected App(s) in the org`));
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
      uxLog("action", this, c.cyan('Initializing browser for automated Connected App Secrets extraction...'));
      try {
        browserContext = await this.initializeBrowser(instanceUrl, accessToken);
      } catch (e: any) {
        uxLog("error", this, c.red(`Error initializing browser for automated Consumer Secret extraction: ${e.message}.
You might need to set variable PUPPETEER_EXECUTABLE_PATH with the target of a Chrome/Chromium path. example: /usr/bin/chromium-browser`));
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
          uxLog("warning", this, c.yellow(`Error processing ${app.fullName}: ${error.message || error}`));
        }
      }

      return updatedApps;
    } finally {
      // Close browser if it was opened
      if (browserContext?.browser) {
        uxLog("log", this, c.cyan('Closing browser...'));
        await browserContext.browser.close();
      }
    }
  }

  private async retrieveConnectedAppsFromOrg(
    orgUsername: string,
    connectedApps: ConnectedApp[],
    saveProjectPath: string
  ): Promise<void> {
    uxLog("action", this, c.cyan(`Retrieving ${connectedApps.length} Connected App(s) from ${orgUsername}`));
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

    uxLog("action", this, c.cyan('Retrieving applicationIds for all Connected Apps...'));
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
        uxLog("warning", this, c.yellow('No applicationIds found in the org. Will use the fallback URL.'));
      }
    } catch (queryError) {
      uxLog("error", this, c.yellow(`Error retrieving applicationIds: ${queryError}`));
    }

    return connectedAppIdMap;
  }

  private async initializeBrowser(
    instanceUrl: string,
    accessToken: string
  ): Promise<BrowserContext> {
    // Get chrome/chromium executable path using shared utility
    const chromeExecutablePath = getChromeExecutablePath();
    uxLog("log", this, c.cyan(`chromeExecutablePath: ${chromeExecutablePath}`));

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: false, // Always show the browser window
      executablePath: chromeExecutablePath,
      timeout: 60000 // Increase timeout for browser launch
    });

    // Log in once for the session
    const loginUrl = `${instanceUrl}/secur/frontdoor.jsp?sid=${accessToken}`;
    uxLog("log", this, c.cyan(`Log in via browser using frontdoor.jsp...`));
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
      uxLog("warning", this, c.yellow(`Connected App file not found for ${app.fullName}`));
      return undefined;
    }

    const connectedAppId = connectedAppIdMap[app.fullName];
    let consumerSecretValue: string | null = null;
    let viewLink: string;

    // Try to extract application ID and view link
    if (connectedAppId) {
      try {
        uxLog("action", this, c.cyan(`Extracting info for Connected App ${app.fullName}...`));
        const applicationId = await this.extractApplicationId(instanceUrl, connectedAppId, app.fullName, browserContext?.accessToken ?? '');
        viewLink = `${instanceUrl}/app/mgmt/forceconnectedapps/forceAppDetail.apexp?applicationId=${applicationId}`;
        uxLog("success", this, c.green(`Successfully extracted application ID: ${applicationId} (viewLink: ${viewLink})`));

        // Try automated extraction if browser is available
        if (browserContext?.browser) {
          uxLog("log", this, c.cyan(`Attempting to automatically extract Consumer Secret for ${app.fullName}...`));
          try {
            consumerSecretValue = await this.extractConsumerSecret(
              browserContext.browser,
              viewLink
            );
          } catch (puppeteerError) {
            uxLog("warning", this, c.yellow(`Error extracting Consumer Secret with Puppeteer: ${puppeteerError}`));
            consumerSecretValue = null;
          }
        }
      } catch (error) {
        uxLog("error", this, c.red(`Could not extract application ID for :  ${app.fullName}. Error message : ${error}`));
        viewLink = `${instanceUrl}/lightning/setup/NavigationMenus/home`;
        uxLog("action", this, c.cyan(`Opening application list page. Please manually find ${app.fullName}.`));
      }
    } else {
      // Fallback to the connected apps list page if applicationId can't be found
      uxLog("warning", this, c.yellow(`No applicationId found for ${app.fullName}, opening application list page instead`));
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
          message: `Enter the Consumer Secret for ${app.fullName}:`,
          description: 'You can find this in the browser after clicking "Manage Consumer Details"',
          validate: (value) => value && value.trim() !== '' ? true : 'Consumer Secret is required'
        });

        if (!secretPromptResponse.consumerSecret) {
          uxLog("warning", this, c.yellow(`Skipping ${app.fullName} due to missing Consumer Secret`));
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
          uxLog("warning", this, c.yellow(`Could not parse XML for ${app.fullName}`));
        }
      }
    } catch (error: any) {
      uxLog("warning", this, c.yellow(`Error processing ${app.fullName}: ${error.message}`));
    }

    return undefined;
  }

  private async extractApplicationId(
    instanceUrl: string,
    connectedAppId: string,
    connectedAppName: string,
    accessToken: string
  ): Promise<string> {
    uxLog("log", this, c.cyan(`Extracting application ID for Connected App with ID: ${connectedAppName}`));

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
      uxLog("success", this, c.green(`Successfully extracted Consumer Secret`));

      return consumerSecretValue || null;
    } catch (error) {
      uxLog("error", this, c.red(`Error extracting Consumer Secret: ${error}`));
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

    uxLog("success", this, c.green(`Successfully added Consumer Secret to ${app.fullName} in ${connectedAppFile}`));

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
      uxLog("log", this, c.cyan('Refresh sandbox configuration has been saved successfully.'));
    }
  }
}
