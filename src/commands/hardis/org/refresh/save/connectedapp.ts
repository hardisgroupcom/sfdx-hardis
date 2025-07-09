import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import open from 'open';
import { glob } from 'glob';
import { execSync } from 'child_process';
import puppeteer, { Browser } from 'puppeteer-core';
import * as chromeLauncher from 'chrome-launcher';
import { execCommand, execSfdxJson, uxLog } from '../../../../../common/utils/index.js';
import { prompts } from '../../../../../common/utils/prompts.js';
import { parseXmlFile } from '../../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../../common/utils/projectUtils.js';
import { deleteConnectedApps, disableConnectedAppIgnore, restoreConnectedAppIgnore } from '../../../../../common/utils/refresh/orgRefreshUtils.js';

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
      // Get Connected Apps based on parameters
      if (processAll) {
        uxLog(this, c.cyan('Processing all Connected Apps from org (selection prompt bypassed)'));
      } else if (nameFilter) {
        uxLog(this, c.cyan(`Processing specified Connected App(s): ${nameFilter} (selection prompt bypassed)`));
      } else {
        uxLog(this, c.cyan('Retrieving list of Connected Apps from org...'));
      }
      const connectedApps = await this.listConnectedApps(orgUsername, nameFilter || undefined);
      
      if (connectedApps.length === 0) {
        uxLog(this, c.yellow('No Connected Apps found'));
        return { success: false, message: 'No Connected Apps found' };
      }
      
      uxLog(this, c.cyan(`Found ${connectedApps.length} Connected App(s) from org`));
      connectedApps.forEach(app => {
        uxLog(this, `${c.green(app.fullName)} (${app.fileName})`);
      });
      
      let selectedApps: ConnectedApp[] = [];
      if (processAll || nameFilter) {
        selectedApps = connectedApps;
        const selectionReason = processAll ? 'all flag' : 'name filter';
        uxLog(this, c.cyan(`Processing ${selectedApps.length} Connected App(s) based on ${selectionReason}`));
      } else {
        const choices = connectedApps.map(app => {
          return { title: app.fullName, value: app.fullName };
        });
        
        const promptResponse = await prompts({
          type: 'multiselect',
          name: 'selectedApps',
          message: 'Select Connected Apps to save:',
          choices: choices
        });
        
        if (!promptResponse.selectedApps || promptResponse.selectedApps.length === 0) {
          uxLog(this, c.yellow('No Connected Apps selected'));
          return { success: false, message: 'No Connected Apps selected' };
        }
        
        selectedApps = connectedApps.filter(app => 
          promptResponse.selectedApps.includes(app.fullName)
        );
        uxLog(this, c.cyan(`Processing ${selectedApps.length} Connected App(s) from selection`));
      }
      const updatedApps = await this.processConnectedApps(orgUsername, selectedApps, instanceUrl, accessToken);
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
  
  private async listConnectedApps(orgUsername: string, nameFilter: string | undefined): Promise<ConnectedApp[]> {
    if (nameFilter) {
      const appNames = nameFilter.split(',').map(name => name.trim());
      uxLog(this, c.cyan(`Directly processing specified Connected App(s): ${appNames.join(', ')}`));

      const connectedApps = appNames.map(name => {
        return {
          fullName: name,
          fileName: name,
          type: 'ConnectedApp'
        };
      });
      
      return connectedApps;
    }
    
    // If no name filter, list all Connected Apps from the org
    const command = `sf org list metadata --metadata-type ConnectedApp --target-org ${orgUsername}`;
    const result = await execSfdxJson(command, this, { output: true });
    
    if (!result || !result.result || !Array.isArray(result.result) || result.result.length === 0) {
      return [];
    }
    
    return result.result;
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
    
    const connectedAppIdMap: Record<string, string> = {};
    let browser: Browser | null = null;
    const updatedApps: ConnectedApp[] = [];
    
    // Temporarily modify .forceignore to allow Connected App retrieval
    const backupInfo = await disableConnectedAppIgnore(this);
    
    try {
      // STEP 1: Retrieve all Connected Apps using multiple -m flags
      uxLog(this, c.cyan(`Retrieving ${connectedApps.length} Connected App(s)...`));
      
      // Build the command with multiple -m flags for each Connected App
      let retrieveCommand = `sf project retrieve start`;
      connectedApps.forEach(app => {
        retrieveCommand += ` -m "ConnectedApp:${app.fullName}"`;
      });
      retrieveCommand += ` --target-org ${orgUsername} --ignore-conflicts --json`;
      
      uxLog(this, c.grey(`Running command: ${retrieveCommand}`));
      await execCommand(
        retrieveCommand,
        this,
        { output: true, fail: true }
      );
      
      uxLog(this, c.grey('Waiting for files to be written to disk...'));
      await new Promise(resolve => setTimeout(resolve, 1000));
      const retrievedFiles = await glob('**/*.connectedApp-meta.xml', { ignore: GLOB_IGNORE_PATTERNS, cwd: process.cwd() });
      uxLog(this, c.cyan(`Found ${retrievedFiles.length} Connected App files`));
      
      // STEP 2: Query for applicationIds for all Connected Apps
      const appNamesForQuery = connectedApps.map(app => `'${app.fullName}'`).join(',');
      if (appNamesForQuery.length > 0) {
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
      }
      
      // STEP 3: Initialize browser ONLY AFTER all CLI operations are complete
      if (accessToken) {
        try {
          // Get chrome/chromium executable path
          let chromeExecutablePath = process.env?.PUPPETEER_EXECUTABLE_PATH || "";
          if (chromeExecutablePath === "" || !fs.existsSync(chromeExecutablePath)) {
            const chromePaths = chromeLauncher.Launcher.getInstallations();
            if (chromePaths && chromePaths.length > 0) {
              chromeExecutablePath = chromePaths[0];
            }
          }
          uxLog(this, c.cyan(`chromeExecutablePath: ${chromeExecutablePath}`));
          
          browser = await puppeteer.launch({
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
        } catch (e: any) {
          uxLog(this, c.red("Error initializing browser for automated Consumer Secret extraction:"));
          uxLog(this, c.red(e.message));
          uxLog(this, c.red("You might need to set variable PUPPETEER_EXECUTABLE_PATH with the target of a Chrome/Chromium path. example: /usr/bin/chromium-browser"));
          // Continue without browser automation - will fall back to manual entry
        }
      }
    
      // STEP 4: Process each Connected App
      for (const app of connectedApps) {
        try {
          const packageDirectories = this.project?.getPackageDirectories() || [];
          const connectedAppFile = await this.findConnectedAppFile(packageDirectories, app.fullName);
          
          if (!connectedAppFile) {
            uxLog(this, c.yellow(`Connected App file not found for ${app.fullName}`));
            continue;
          }
          
          const connectedAppId = connectedAppIdMap[app.fullName];
          
          if (connectedAppId) {
            uxLog(this, c.cyan(`Retrieving application ID for Connected App: ${app.fullName}...`));
            let viewLink: string;
            
            try {
              const curlCommand = accessToken 
                ? `curl --silent --location --request GET "${instanceUrl}/${connectedAppId}" --header "Cookie: sid=${accessToken}"`
                : `curl --silent --location --request GET "${instanceUrl}/${connectedAppId}"`;
            
              const html = execSync(curlCommand).toString();
              const appIdMatch = html.match(/applicationId=([a-zA-Z0-9]+)/i);
              
              if (!appIdMatch || !appIdMatch[1]) {
                throw new Error('Could not extract application ID from HTML');
              }
            
              const applicationId = appIdMatch[1];
              viewLink = `${instanceUrl}/app/mgmt/forceconnectedapps/forceAppDetail.apexp?applicationId=${applicationId}`;
              uxLog(this, c.green(`Successfully extracted application ID: ${applicationId}`));
              uxLog(this, c.green(`viewLink: ${viewLink}`));
              
              let consumerSecretValue: string | null = null;
              if (browser) {
                uxLog(this, c.cyan(`Attempting to automatically extract Consumer Secret for ${app.fullName}...`));
                try {
                  consumerSecretValue = await this.extractConsumerSecret(
                    browser,
                    instanceUrl,
                    applicationId
                  );
                } catch (puppeteerError) {
                  uxLog(this, c.yellow(`Error extracting Consumer Secret with Puppeteer: ${puppeteerError}`));
                  consumerSecretValue = null;
                }
              } else {
                uxLog(this, c.yellow(`No browser instance available to extract Consumer Secret for ${app.fullName}`));
              }
              
              if (consumerSecretValue) {
                const xmlData = await parseXmlFile(connectedAppFile);
                if (xmlData && xmlData.ConnectedApp) {
                  const consumerKey = xmlData.ConnectedApp.consumerKey ? xmlData.ConnectedApp.consumerKey[0] : 'unknown';
                  await this.updateConnectedAppXml(connectedAppFile, xmlData, consumerSecretValue, app, consumerKey, updatedApps);
                  continue; // Skip the manual prompt flow
                }
              } else {
                uxLog(this, c.yellow(`Could not automatically extract Consumer Secret for ${app.fullName}. Falling back to manual entry.`));
                
                // If automated extraction failed, open the browser for manual entry
                uxLog(this, c.cyan(`Opening Connected App detail page in your browser for: ${app.fullName}`));
                uxLog(this, c.cyan('Please follow these steps:'));
                uxLog(this, c.cyan('1. Click "Manage Consumer Details" button'));
                uxLog(this, c.cyan('2. Copy the ' + c.green('Consumer Secret') + ' value'));
                
                await open(viewLink);
              }
            } catch (error) {
              uxLog(this, c.yellow(`Could not extract application ID for ${app.fullName}. Using fallback approach.`));
              viewLink = `${instanceUrl}/lightning/setup/ConnectedApplication/home`;
              uxLog(this, c.cyan(`Opening Connected App list page. Please manually find ${app.fullName}.`));
              
              await open(viewLink);
            }
          } else {
            // Fallback to the connected apps list page if applicationId can't be found
            uxLog(this, c.yellow(`No applicationId found for ${app.fullName}, opening general Connected Apps page instead`));
            const fallbackUrl = `${instanceUrl}/lightning/setup/ConnectedApplication/home`;
            await open(fallbackUrl);
          }
          
          // Prompt for the Consumer Secret (manual entry)
          const secretPromptResponse = await prompts({
            type: 'text',
            name: 'consumerSecret',
            message: `Enter the Consumer Secret for ${app.fullName}:`,
            validate: (value) => value && value.trim() !== '' ? true : 'Consumer Secret is required'
          });
          
          if (!secretPromptResponse.consumerSecret) {
            uxLog(this, c.yellow(`Skipping ${app.fullName} due to missing Consumer Secret`));
            continue;
          }
          
          // Parse the Connected App XML file
          const xmlData = await parseXmlFile(connectedAppFile);
          if (xmlData && xmlData.ConnectedApp) {
            // Store the consumer secret
            const consumerSecret = secretPromptResponse.consumerSecret;
            const consumerKey = xmlData.ConnectedApp.consumerKey ? xmlData.ConnectedApp.consumerKey[0] : 'unknown';
            await this.updateConnectedAppXml(connectedAppFile, xmlData, consumerSecret, app, consumerKey, updatedApps);
          } else {
            uxLog(this, c.yellow(`Could not parse XML for ${app.fullName}`));
          }
        } catch (error: any) {
          uxLog(this, c.yellow(`Error processing ${app.fullName}: ${error.message || error}`));
        }
      }
      
      return updatedApps;
    } catch (e: any) {
      uxLog(this, c.red(`Error processing Connected Apps: ${e.message}`));
      throw e;
    } finally {
      // Close browser if it was opened
      if (browser) {
        uxLog(this, c.cyan('Closing browser...'));
        await browser.close();
      }
      
      // Make sure .forceignore is restored
      if (backupInfo) {
        await restoreConnectedAppIgnore(backupInfo, this);
      }
    }
  }
  
  private async extractConsumerSecret(
    browser: Browser,
    instanceUrl: string,
    applicationId: string
  ): Promise<string | null> {
    let page;
    try {
      page = await browser.newPage();
      
      const appUrl = `${instanceUrl}/app/mgmt/forceconnectedapps/forceAppDetail.apexp?applicationId=${applicationId}`;
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
      await page.close();
      
      return consumerSecretValue || null;
    } catch (error) {
      uxLog(this, c.red(`Error extracting Consumer Secret: ${error}`));
      if (page) await page.close();
      return null;
    }
  }
  
  // Simple method to find Connected App files throughout the project
  private async findConnectedAppFile(packageDirectories: any[], appName: string): Promise<string | null> {
    uxLog(this, c.cyan(`Searching for Connected App: ${appName}`));
    
    try {
      // First, try an exact case-sensitive match
      const exactPattern = `**/${appName}.connectedApp-meta.xml`;
      const exactMatches = await glob(exactPattern, { ignore: GLOB_IGNORE_PATTERNS });
      
      if (exactMatches.length > 0) {
        uxLog(this, c.green(`✓ Found Connected App: ${exactMatches[0]}`));
        return exactMatches[0];
      }
      
      // If no exact match, try case-insensitive search by getting all ConnectedApp files
      uxLog(this, c.yellow(`No exact match found, trying case-insensitive search...`));
      const allConnectedAppFiles = await glob('**/*.connectedApp-meta.xml', { ignore: GLOB_IGNORE_PATTERNS });
      
      if (allConnectedAppFiles.length === 0) {
        uxLog(this, c.red(`No Connected App files found in the project.`));
        return null;
      }
      
      // Find a case-insensitive match
      const caseInsensitiveMatch = allConnectedAppFiles.find(file => 
        path.basename(file).toLowerCase() === `${appName.toLowerCase()}.connectedapp-meta.xml`
      );
      
      if (caseInsensitiveMatch) {
        uxLog(this, c.green(`✓ Found case-insensitive match: ${caseInsensitiveMatch}`));
        return caseInsensitiveMatch;
      }
      
      // If still not found, list available Connected Apps
      uxLog(this, c.red(`✗ Could not find Connected App "${appName}"`));
      uxLog(this, c.yellow(`Available Connected Apps in the project:`));
      allConnectedAppFiles.forEach(file => {
        uxLog(this, c.grey(`  - ${path.basename(file, '.connectedApp-meta.xml')}`));
      });
      
    } catch (error) {
      uxLog(this, c.red(`Error searching for Connected App files: ${error}`));
    }
    
    return null;
  }
  
  private async updateConnectedAppXml(
    connectedAppFile: string,
    xmlData: any,
    consumerSecret: string,
    app: ConnectedApp,
    consumerKey: string,
    updatedApps: ConnectedApp[]
  ): Promise<void> {

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
    
    const updatedApp: ConnectedApp = { 
      ...app, 
      consumerKey: consumerKey,
      consumerSecret: consumerSecret
    };
    updatedApps.push(updatedApp);
  }

}
