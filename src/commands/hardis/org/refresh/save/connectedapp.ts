import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import fs from 'fs-extra';
import c from 'chalk';
import open from 'open';
import { execSync } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { execSfdxJson, uxLog } from '../../../../../common/utils/index.js';
import { prompts } from '../../../../../common/utils/prompts.js';
import { parseXmlFile } from '../../../../../common/utils/xmlUtils.js';
import { getChromeExecutablePath } from '../../../../../common/utils/orgConfigUtils.js';
import { 
  deleteConnectedApps, 
  retrieveConnectedApps,
  validateConnectedApps,
  findConnectedAppFile,
  selectConnectedAppsForProcessing
} from '../../../../../common/utils/refresh/connectedAppUtils.js';

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

export default class OrgRefreshSaveConnectedApp extends SfCommand<AnyJson> {
  public static title = 'Save Connected Apps before org refresh';

  public static examples = [
    `$ sf hardis:org:refresh:save:connectedapp`,
    `$ sf hardis:org:refresh:save:connectedapp --name "MyConnectedApp"`,
    `$ sf hardis:org:refresh:save:connectedapp --name "App1,App2,App3"`,
    `$ sf hardis:org:refresh:save:connectedapp --all`,
    `$ sf hardis:org:refresh:save:connectedapp --nodelete`,
  ];

  public static flags = {
    "target-org": Flags.requiredOrg(),
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
    nodelete: Flags.boolean({
      char: 'd',
      summary: 'Do not delete Connected Apps from org after saving',
      description: 'By default, Connected Apps are deleted from the org after saving. Set this flag to keep them in the org.'
    }),
    websocket: Flags.string({
     description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    })
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgRefreshSaveConnectedApp);
    const conn = flags["target-org"].getConnection();
    const orgUsername = flags["target-org"].getUsername() as string; // Cast to string to avoid TypeScript error
    const instanceUrl = conn.instanceUrl;
    const accessToken = conn.accessToken || ''; // Ensure accessToken is a string
    const processAll = flags.all || false;
    const nameFilter = processAll ? undefined : flags.name; // If --all is set, ignore --name

    try {
      // Step 1: Get Connected Apps from org or based on provided name filter
      const connectedApps = await this.getConnectedApps(orgUsername, nameFilter, processAll);
      
      if (connectedApps.length === 0) {
        uxLog(this, c.yellow('No Connected Apps found'));
        return { success: false, message: 'No Connected Apps found' };
      }
      
      // Step 2: Determine which apps to process (all, filtered, or user-selected)
      const selectedApps = await this.selectConnectedApps(connectedApps, processAll, nameFilter);
      
      if (selectedApps.length === 0) {
        uxLog(this, c.yellow('No Connected Apps selected'));
        return { success: false, message: 'No Connected Apps selected' };
      }
      
      // Step 3: Process the selected Connected Apps
      const updatedApps = await this.processConnectedApps(orgUsername, selectedApps, instanceUrl, accessToken);
      
      // Step 4: Delete Connected Apps from org if required (default behavior)
      const noDelete = flags.nodelete || false;
      if (noDelete) {
        uxLog(this, c.blue('Connected Apps will remain in the org (--nodelete flag specified).'));
      } else {
        uxLog(this, c.cyan('Deleting Connected Apps from the org (default behavior)...'));
        await deleteConnectedApps(orgUsername, updatedApps, this);
        uxLog(this, c.green('Connected Apps were successfully deleted from the org.'));
      }
      
      // Add a summary message at the end
      if (updatedApps.length > 0) {
        uxLog(this, c.green(`Summary: Successfully updated ${updatedApps.length} Connected App(s) with their Consumer Secrets`));
      }
      
      return {
        success: true, 
        message: `Successfully processed ${updatedApps.length} Connected App(s)`,
        connectedAppsProcessed: updatedApps.map(app => app.fullName),
        consumerSecretsAdded: updatedApps.map(app => app.consumerSecret ? app.fullName : null).filter(Boolean)
      };
      
    } catch (error: any) {
      uxLog(this, c.red(`Error: ${error.message || JSON.stringify(error)}`));
      return { success: false, error: error.message || error };
    }
  }

  private async getConnectedApps(
    orgUsername: string, 
    nameFilter: string | undefined,
    processAll: boolean
  ): Promise<ConnectedApp[]> {
    // Set appropriate log message based on flags
    if (processAll) {
      uxLog(this, c.cyan('Processing all Connected Apps from org (selection prompt bypassed)'));
    } else if (nameFilter) {
      uxLog(this, c.cyan(`Processing specified Connected App(s): ${nameFilter} (selection prompt bypassed)`));
    } else {
      uxLog(this, c.cyan('Retrieving list of Connected Apps from org...'));
    }
    
    const command = `sf org list metadata --metadata-type ConnectedApp --target-org ${orgUsername}`;
    const result = await execSfdxJson(command, this, { output: true });
    
    const availableApps: ConnectedApp[] = result?.result && Array.isArray(result.result) ? result.result : [];
    
    if (availableApps.length === 0) {
      uxLog(this, c.yellow('No Connected Apps were found in the org.'));
      return [];
    }
    
    const availableAppNames = availableApps.map(app => app.fullName);
    uxLog(this, c.grey(`Found ${availableApps.length} Connected App(s) in the org`));
    
    // If name filter is provided, validate and filter the requested apps
    if (nameFilter) {
      const appNames = nameFilter.split(',').map(name => name.trim());
      uxLog(this, c.cyan(`Validating specified Connected App(s): ${appNames.join(', ')}`));
      
      validateConnectedApps(appNames, availableAppNames, this, 'org');
      
      // Filter available apps to only include the ones specified in the name filter (case-insensitive)
      const connectedApps = availableApps.filter(app => 
        appNames.some(name => name.toLowerCase() === app.fullName.toLowerCase())
      );
      
      uxLog(this, c.green(`Successfully validated ${connectedApps.length} Connected App(s) in the org`));
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
    return selectConnectedAppsForProcessing(
      connectedApps,
      processAll,
      nameFilter,
      'Select Connected Apps to save:',
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
      await this.retrieveConnectedAppsFromOrg(orgUsername, connectedApps);
      
      // Step 2: Query for applicationIds for all Connected Apps
      const connectedAppIdMap = await this.queryConnectedAppIds(orgUsername, connectedApps);
      
      // Step 3: Initialize browser for automation if access token is available
      if (accessToken) {
        try {
          browserContext = await this.initializeBrowser(instanceUrl, accessToken);
        } catch (e: any) {
          uxLog(this, c.red("Error initializing browser for automated Consumer Secret extraction:"));
          uxLog(this, c.red(e.message));
          uxLog(this, c.red("You might need to set variable PUPPETEER_EXECUTABLE_PATH with the target of a Chrome/Chromium path. example: /usr/bin/chromium-browser"));
          // Continue without browser automation - will fall back to manual entry
        }
      }
    
      // Step 4: Process each Connected App
      for (const app of connectedApps) {
        try {
          const updatedApp = await this.processIndividualApp(
            app, 
            connectedAppIdMap, 
            browserContext, 
            instanceUrl
          );
          
          if (updatedApp) {
            updatedApps.push(updatedApp);
          }
        } catch (error: any) {
          uxLog(this, c.yellow(`Error processing ${app.fullName}: ${error.message || error}`));
        }
      }
      
      return updatedApps;
    } finally {
      // Close browser if it was opened
      if (browserContext?.browser) {
        uxLog(this, c.cyan('Closing browser...'));
        await browserContext.browser.close();
      }
    }
  }

  private async retrieveConnectedAppsFromOrg(
    orgUsername: string, 
    connectedApps: ConnectedApp[]
  ): Promise<void> {
    uxLog(this, c.cyan(`Retrieving ${connectedApps.length} Connected App(s)...`));
    await retrieveConnectedApps(orgUsername, connectedApps, this);
    this.verifyConnectedAppsRetrieval(connectedApps);
  }
  
  private verifyConnectedAppsRetrieval(connectedApps: ConnectedApp[]): void {
    if (connectedApps.length === 0) return;
    
    // Check if the Connected App files exist in the project
    const missingApps: string[] = [];
    
    for (const app of connectedApps) {
      // Try to find the app in the standard location
      const appPath = `force-app/main/default/connectedApps/${app.fullName}.connectedApp-meta.xml`;
      
      if (!fs.existsSync(appPath)) {
        // Also check in alternative locations where it might have been retrieved
        const altPaths = [
          `force-app/main/default/connectedApps/${app.fileName}.connectedApp-meta.xml`,
          `force-app/main/default/connectedApps/${app.fullName.replace(/\s/g, '_')}.connectedApp-meta.xml`
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
      uxLog(this, c.red(errorMsg));
      uxLog(this, c.yellow('This could be due to:'));
      uxLog(this, c.grey('  - Temporary Salesforce API issues'));
      uxLog(this, c.grey('  - Permissions or profile issues in the org'));
      uxLog(this, c.grey('  - Connected Apps that exist but are not accessible'));
      uxLog(this, c.yellow('Please try again or check your permissions in the org.'));
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
    
    uxLog(this, c.cyan('Retrieving applicationIds for all Connected Apps...'));
    const queryCommand = `sf data query --query "SELECT Id, Name FROM ConnectedApplication WHERE Name IN (${appNamesForQuery})" --target-org ${orgUsername} --json`;
    
    try {
      const queryResult = await execSfdxJson(queryCommand, this, { output: false });
      
      if (queryResult?.result?.records?.length > 0) {
        // Populate the map with applicationIds
        queryResult.result.records.forEach((record: any) => {
          connectedAppIdMap[record.Name] = record.Id;
          uxLog(this, c.grey(`Found applicationId for ${record.Name}: ${record.Id}`));
        });
      } else {
        uxLog(this, c.yellow('No applicationIds found in the org. Will use the fallback URL.'));
      }
    } catch (queryError) {
      uxLog(this, c.yellow(`Error retrieving applicationIds: ${queryError}`));
    }
    
    return connectedAppIdMap;
  }

  private async initializeBrowser(
    instanceUrl: string, 
    accessToken: string
  ): Promise<BrowserContext> {
    // Get chrome/chromium executable path using shared utility
    const chromeExecutablePath = getChromeExecutablePath();
    uxLog(this, c.cyan(`chromeExecutablePath: ${chromeExecutablePath}`));
    
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: false, // Always show the browser window
      executablePath: chromeExecutablePath
    });
    
    // Log in once for the session
    const loginUrl = `${instanceUrl}/secur/frontdoor.jsp?sid=${accessToken}`;
    uxLog(this, c.cyan(`Logging in to Salesforce via frontdoor.jsp...`));
    const page = await browser.newPage();
    await page.goto(loginUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });
    await page.close();
    
    return { browser, instanceUrl, accessToken };
  }
  
  private async processIndividualApp(
    app: ConnectedApp, 
    connectedAppIdMap: Record<string, string>, 
    browserContext: BrowserContext | null,
    instanceUrl: string
  ): Promise<ConnectedApp | undefined> {
    const connectedAppFile = await findConnectedAppFile(app.fullName, this);
    
    if (!connectedAppFile) {
      uxLog(this, c.yellow(`Connected App file not found for ${app.fullName}`));
      return undefined;
    }
    
    const connectedAppId = connectedAppIdMap[app.fullName];
    let consumerSecretValue: string | null = null;
    let viewLink: string;
    
    // Try to extract application ID and view link
    if (connectedAppId) {
      try {
        const applicationId = await this.extractApplicationId(instanceUrl, connectedAppId, browserContext?.accessToken);
        viewLink = `${instanceUrl}/app/mgmt/forceconnectedapps/forceAppDetail.apexp?applicationId=${applicationId}`;
        uxLog(this, c.green(`Successfully extracted application ID: ${applicationId}`));
        uxLog(this, c.green(`viewLink: ${viewLink}`));
        
        // Try automated extraction if browser is available
        if (browserContext?.browser) {
          uxLog(this, c.cyan(`Attempting to automatically extract Consumer Secret for ${app.fullName}...`));
          try {
            consumerSecretValue = await this.extractConsumerSecret(
              browserContext.browser,
              viewLink
            );
          } catch (puppeteerError) {
            uxLog(this, c.yellow(`Error extracting Consumer Secret with Puppeteer: ${puppeteerError}`));
            consumerSecretValue = null;
          }
        }
      } catch (error) {
        uxLog(this, c.red(`Could not extract application ID for :  ${app.fullName}. Error message : ${error}`));
        viewLink = `${instanceUrl}/lightning/setup/NavigationMenus/home`;
        uxLog(this, c.cyan(`Opening application list page. Please manually find ${app.fullName}.`));
      }
    } else {
      // Fallback to the connected apps list page if applicationId can't be found
      uxLog(this, c.yellow(`No applicationId found for ${app.fullName}, opening application list page instead`));
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
        uxLog(this, c.cyan(`Opening Connected App detail page in your browser for: ${app.fullName}`));
        uxLog(this, c.cyan('Please follow these steps:'));
        uxLog(this, c.cyan('1. Click "Manage Consumer Details" button'));
        uxLog(this, c.cyan('2. Copy the ' + c.green('Consumer Secret') + ' value'));
        
        await open(viewLink);
        
        // Prompt for the Consumer Secret (manual entry)
        const secretPromptResponse = await prompts({
          type: 'text',
          name: 'consumerSecret',
          message: `Enter the Consumer Secret for ${app.fullName}:`,
          validate: (value) => value && value.trim() !== '' ? true : 'Consumer Secret is required'
        });
        
        if (!secretPromptResponse.consumerSecret) {
          uxLog(this, c.yellow(`Skipping ${app.fullName} due to missing Consumer Secret`));
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
          uxLog(this, c.yellow(`Could not parse XML for ${app.fullName}`));
        }
      }
    } catch (error: any) {
      uxLog(this, c.yellow(`Error processing ${app.fullName}: ${error.message}`));
    }
    
    return undefined;
  }
  
  private async extractApplicationId(
    instanceUrl: string,
    connectedAppId: string,
    accessToken?: string
  ): Promise<string> {
    uxLog(this, c.cyan(`Extracting application ID for Connected App with ID: ${connectedAppId}`));
    
    const curlCommand = accessToken 
      ? `curl --silent --location --request GET "${instanceUrl}/${connectedAppId}" --header "Cookie: sid=${accessToken}"`
      : `curl --silent --location --request GET "${instanceUrl}/${connectedAppId}"`;
  
    const html = execSync(curlCommand).toString();
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
      
      uxLog(this, c.cyan(`Navigating to Connected App detail page...`));
      await page.goto(appUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });
      uxLog(this, c.cyan(`Attempting to extract Consumer Secret...`));
      
      // Click Manage Consumer Details button
      const manageBtnId = 'input[id="appsetup:setupForm:details:oauthSettingsSection:manageConsumerKeySecretSection:manageConsumer"]';
      await page.waitForSelector(manageBtnId, { timeout: 60000 });
      await page.click(manageBtnId);
      await page.waitForNavigation();
      
      // Extract Consumer Secret value
      const consumerSecretSpanId = '#appsetup\\:setupForm\\:consumerDetails\\:oauthConsumerSection\\:consumerSecretSection\\:consumerSecret';
      await page.waitForSelector(consumerSecretSpanId, { timeout: 60000 });
      const consumerSecretValue = await page.$eval(consumerSecretSpanId, element => element.textContent);
      uxLog(this, c.green(`Successfully extracted Consumer Secret`));
      
      return consumerSecretValue || null;
    } catch (error) {
      uxLog(this, c.red(`Error extracting Consumer Secret: ${error}`));
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
        `$&\n    <consumerSecret>${consumerSecret}</consumerSecret>`
      );
      await fs.writeFile(connectedAppFile, updatedXmlString);
    }
    
    xmlData.ConnectedApp.consumerSecret = [consumerSecret];
  
    uxLog(this, c.green(`Successfully added Consumer Secret to ${app.fullName} in ${connectedAppFile}`));
    
    return { 
      ...app, 
      consumerKey: consumerKey,
      consumerSecret: consumerSecret
    };
  }
}
