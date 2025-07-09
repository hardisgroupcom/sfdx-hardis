import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import open from 'open';
import { glob } from 'glob';
import { execSync } from 'child_process';
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
  ];

  public static flags = {
    "target-org": Flags.requiredOrg(),
    name: Flags.string({
      char: 'n',
      summary: messages.getMessage('nameFilter'),
      description: 'Connected App name(s) to process. For multiple apps, separate with commas (e.g., "App1,App2")'
    }),
    websocket: Flags.string({
     description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    })
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgRefreshSaveConnectedApp);
    const conn = flags["target-org"].getConnection();
    const orgUsername = flags["target-org"].getUsername() as string; // Cast to string to avoid TypeScript error
    const instanceUrl = conn.instanceUrl;
    const accessToken = conn.accessToken || ''; // Ensure accessToken is a string
    const nameFilter = flags.name;

    try {
      // Get Connected Apps based on name parameter or list from org
      if (nameFilter) {
        uxLog(this, c.cyan(`Processing specified Connected App(s): ${nameFilter} (selection prompt bypassed)`));
      } else {
        uxLog(this, c.cyan('Retrieving list of Connected Apps from org...'));
      }
      
      // Get Connected Apps to process
      const connectedApps = await this.listConnectedApps(orgUsername, nameFilter || undefined);
      
      if (connectedApps.length === 0) {
        uxLog(this, c.yellow('No Connected Apps found'));
        return { success: false, message: 'No Connected Apps found' };
      }
      
      uxLog(this, c.cyan(`Found ${connectedApps.length} Connected App(s) from org`));
      connectedApps.forEach(app => {
        uxLog(this, `${c.green(app.fullName)} (${app.fileName})`);
      });
      
      // Determine which Connected Apps to process
      let selectedApps: ConnectedApp[] = [];
      
      // If name is provided, use all connected apps from the list
      if (nameFilter) {
        // Use all connected apps from the list (which is already filtered by nameFilter)
        selectedApps = connectedApps;
        uxLog(this, c.cyan(`Processing ${selectedApps.length} Connected App(s)`));
      } else {
        // Prompt user to select Connected Apps
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
        uxLog(this, c.cyan(`Processing ${selectedApps.length} Connected App(s)`));
      }
      
      // Process the selected Connected Apps
      const updatedApps = await this.processConnectedApps(orgUsername, selectedApps, instanceUrl, accessToken);
      
      // Always ask if the user wants to delete the Connected Apps from the org
      const deletePromptResponse = await prompts({
        type: 'confirm',
        name: 'confirmDelete',
        message: 'Do you want to delete the selected Connected Apps from the org?',
        initial: false
      });
      
      if (deletePromptResponse.confirmDelete) {
        await deleteConnectedApps(orgUsername, updatedApps, this);
        uxLog(this, c.green('Connected Apps were successfully deleted from the org.'));
      } else {
        uxLog(this, c.blue('Connected Apps will remain in the org. Operation completed.'));
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
    // If name filter is provided, directly prepare those specific Connected Apps
    if (nameFilter) {
      // Split by comma and trim each item
      const appNames = nameFilter.split(',').map(name => name.trim());
      uxLog(this, c.cyan(`Directly processing specified Connected App(s): ${appNames.join(', ')}`));
      
      // Create ConnectedApp objects for each name
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
  
  private async processConnectedApps(orgUsername: string | undefined, connectedApps: ConnectedApp[], instanceUrl: string, accessToken: string = ''): Promise<ConnectedApp[]> {
    if (!orgUsername) {
      throw new Error('Organization username is required');
    }
    
    // Retrieve all Connected Apps using multiple -m flags
    uxLog(this, c.cyan(`Retrieving ${connectedApps.length} Connected App(s)...`));
    
    // Temporarily modify .forceignore to allow Connected App retrieval
    const backupInfo = await disableConnectedAppIgnore(this);
    
    try {
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
      
      // Wait a moment to ensure files are written to disk
      uxLog(this, c.grey('Waiting for files to be written to disk...'));
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if any files were retrieved by doing a quick search
      const retrievedFiles = await glob('**/*.connectedApp-meta.xml', { ignore: GLOB_IGNORE_PATTERNS, cwd: process.cwd() });
      uxLog(this, c.cyan(`Found ${retrievedFiles.length} Connected App files `));
      
    } catch (error) {
      uxLog(this, c.yellow(`Error retrieving Connected Apps: ${error}`));
      uxLog(this, c.cyan('Will attempt to continue with available files...'));
    } finally {
      // Restore original .forceignore
      await restoreConnectedAppIgnore(backupInfo, this);
    }
    
    // Create a map of applicationIds for all Connected Apps
    const connectedAppIdMap: Record<string, string> = {};
    
    // Build a comma-separated list of app names for the query
    const appNamesForQuery = connectedApps.map(app => `'${app.fullName}'`).join(',');
    
    // Query for all applicationIds at once
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
    
    // Find and update the retrieved Connected Apps
    const updatedApps: ConnectedApp[] = [];
    for (const app of connectedApps) {
      try {
        // Locate the retrieved XML file - search in project directories
        const packageDirectories = this.project?.getPackageDirectories() || [];
        
        // Use our helper method to find the Connected App file
        const connectedAppFile = await this.findConnectedAppFile(packageDirectories, app.fullName);
        
        if (!connectedAppFile) {
          uxLog(this, c.yellow(`Connected App file not found for ${app.fullName}`));
          continue;
        }
        
        // Use the connectedAppId from our map
        const connectedAppId = connectedAppIdMap[app.fullName];
        
        if (connectedAppId) {
          // Construct the direct URL to the Connected App detail page
          uxLog(this, c.cyan(`Retrieving application ID for Connected App: ${app.fullName}...`));
          let viewLink: string;
          
          try {
            // Build the curl command, adding the authorization header only if we have an accessToken
            const curlCommand = accessToken 
              ? `curl --silent --location --request GET "${instanceUrl}/${connectedAppId}" --header "Cookie: sid=${accessToken}"`
              : `curl --silent --location --request GET "${instanceUrl}/${connectedAppId}"`;
            
            // Execute curl command to get the HTML content
            const html = execSync(curlCommand).toString();
            
            // Extract the application ID using a more flexible regex pattern
            const appIdMatch = html.match(/applicationId=([a-zA-Z0-9]+)/i);
            
            if (!appIdMatch || !appIdMatch[1]) {
              throw new Error('Could not extract application ID from HTML');
            }
            
            // Successfully extracted the application ID
            const applicationId = appIdMatch[1];
            viewLink = `${instanceUrl}/app/mgmt/forceconnectedapps/forceAppDetail.apexp?applicationId=${applicationId}`;
            uxLog(this, c.green(`Successfully extracted application ID: ${applicationId}`));
          } catch (error) {
            uxLog(this, c.yellow(`Could not extract application ID for ${app.fullName}. Using fallback approach.`));
            viewLink = `${instanceUrl}/${connectedAppId}`;
            uxLog(this, c.cyan(`Opening Connected App list page. Please manually find ${app.fullName}.`));
          }
          uxLog(this, c.cyan(`Opening Connected App detail page in your browser for: ${app.fullName}`));
          uxLog(this, c.cyan('Please follow these steps:'));
          uxLog(this, c.cyan('1.Click "Manage Consumer Details" button'));
          uxLog(this, c.cyan('2. Copy the ' + c.green('Consumer Secret') + ' value'));
          uxLog(this, c.cyan('The Consumer Secret will be added to the Connected App XML file.'));
          
          await open(viewLink);
        } else {
          // Fallback to the connected apps list page if applicationId can't be found
          uxLog(this, c.yellow(`No applicationId found for ${app.fullName}, opening general Connected Apps page instead`));
          const fallbackUrl = `${instanceUrl}/lightning/setup/ConnectedApplication/home`;
          await open(fallbackUrl);
        }
        
        // Prompt for the Consumer Secret
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
        
        // Add the Consumer Secret to the ConnectedApp XML
        if (xmlData && xmlData.ConnectedApp) {
          // Store the consumer secret
          const consumerSecret = secretPromptResponse.consumerSecret;
          
          // Read the existing consumer key for reference
          const consumerKey = xmlData.ConnectedApp.consumerKey ? xmlData.ConnectedApp.consumerKey[0] : 'unknown';
          
          // We need to properly order the XML elements by creating a new XML content string
          // First, convert XML to string
          const xmlString = await fs.readFile(connectedAppFile, 'utf8');
          
          // Check if the consumerSecret already exists
          if (xmlString.includes('<consumerSecret>')) {
            // Replace the existing consumerSecret value
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
          
          // Also update our in-memory XML object for further processing
          xmlData.ConnectedApp.consumerSecret = [consumerSecret];
          
          // Log success message - using files already retrieved
          uxLog(this, c.green(`Successfully added Consumer Secret to ${app.fullName} in ${connectedAppFile}`));
          
          const updatedApp: ConnectedApp = { 
            ...app, 
            consumerKey: consumerKey,
            consumerSecret: secretPromptResponse.consumerSecret
          };
          updatedApps.push(updatedApp);
        } else {
          uxLog(this, c.yellow(`Could not parse XML for ${app.fullName}`));
        }
      } catch (error: any) {
        uxLog(this, c.yellow(`Error processing ${app.fullName}: ${error.message || error}`));
      }
    }
    
    return updatedApps;
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
  

}
