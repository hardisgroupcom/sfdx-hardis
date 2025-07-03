import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as path from 'path';
import c from 'chalk';
import { glob } from 'glob';
import { execCommand, uxLog } from '../../../../../common/utils/index.js';
import { prompts } from '../../../../../common/utils/prompts.js';
import { parseXmlFile } from '../../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../../common/utils/projectUtils.js';
import { deleteConnectedApps, disableConnectedAppIgnore, restoreConnectedAppIgnore } from '../../../../../common/utils/refresh/orgRefreshUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Interface to track Connected Apps in the project
interface ProjectConnectedApp {
  fullName: string;
  filePath: string;
  type: string;
}

export default class OrgRefreshRestoreConnectedApp extends SfCommand<AnyJson> {
  public static title = 'Restore Connected Apps after org refresh';

  public static examples = [
    `$ sf hardis:org:refresh:restore:connectedapp`,
    `$ sf hardis:org:refresh:restore:connectedapp --name "MyConnectedApp" // Process specific app, no selection prompt`,
    `$ sf hardis:org:refresh:restore:connectedapp --name "App1,App2,App3" // Process multiple apps, no selection prompt`,
    `$ sf hardis:org:refresh:restore:connectedapp --target-org myDevOrg`,
  ];

  public static flags = {
    "target-org": Flags.requiredOrg(),
    name: Flags.string({
      char: 'n',
      summary: messages.getMessage('nameFilter'),
      description: 'Connected App name(s) to process (bypasses selection prompt). For multiple apps, separate with commas (e.g., "App1,App2")'
    }),
    websocket: Flags.string({
      summary: messages.getMessage('websocket'),
      description: 'Websocket host:port for VsCode SFDX Hardis UI integration'
    }),
    skipauth: Flags.boolean({
      default: false,
      summary: 'Skip authentication check when a default username is required',
      description: 'Skip authentication check when a default username is required'
    })
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgRefreshRestoreConnectedApp);
    const orgUsername = flags["target-org"].getUsername() as string;
    const nameFilter = flags.name;

    try {
      // Find Connected Apps in project
      uxLog(this, c.cyan('Scanning project for Connected Apps...'));
      const connectedApps = await this.findConnectedAppsInProject(nameFilter);
      
      if (connectedApps.length === 0) {
        uxLog(this, c.yellow('No Connected Apps found in the project'));
        return { success: false, message: 'No Connected Apps found in the project' };
      }
      
      uxLog(this, c.cyan(`Found ${connectedApps.length} Connected App(s) in project`));
      connectedApps.forEach(app => {
        uxLog(this, `${c.green(app.fullName)} (${app.filePath})`);
      });
      
      // Determine which Connected Apps to process
      let selectedApps: ProjectConnectedApp[] = [];
      
      // If name is provided, use all connected apps from the list without prompting
      if (nameFilter) {
        // Use all connected apps from the list (which is already filtered by nameFilter)
        selectedApps = connectedApps;
        uxLog(this, c.cyan(`Processing ${selectedApps.length} Connected App(s)`));
      } else {
        // Always prompt for selection when no name filter is provided
        const choices = connectedApps.map(app => {
          return { title: app.fullName, value: app.fullName };
        });
        
        const promptResponse = await prompts({
          type: 'multiselect',
          name: 'selectedApps',
          message: 'Select Connected Apps to restore:',
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
      
      // First, delete existing Connected Apps - necessary step for clean deployment
      uxLog(this, c.cyan(`For a clean deployment, the ${selectedApps.length} Connected App(s) will be deleted from the org before deployment...`));
      
      // Convert to the ConnectedApp interface format required by deleteConnectedApps
      const appsToDelete = selectedApps.map(app => {
        return {
          fullName: app.fullName,
          fileName: path.basename(app.filePath, '.connectedApp-meta.xml'),
          type: 'ConnectedApp'
        };
      });
      
      // Delete the apps without prompting
      await deleteConnectedApps(orgUsername, appsToDelete, this);
      uxLog(this, c.green('Connected Apps were successfully deleted from the org.'));
      
      // Now deploy the Connected Apps
      uxLog(this, c.cyan(`Deploying ${selectedApps.length} Connected App(s) to org...`));
      await this.deployConnectedApps(orgUsername, selectedApps);
      
      // Return the result
      uxLog(this, c.green(`Successfully restored ${selectedApps.length} Connected App(s) to the org`));
      return {
        success: true, 
        message: `Successfully restored ${selectedApps.length} Connected App(s) to the org`,
        connectedAppsProcessed: selectedApps.map(app => app.fullName)
      };
      
    } catch (error: any) {
      uxLog(this, c.red(`Error: ${error.message || JSON.stringify(error)}`));
      return { success: false, error: error.message || error };
    }
  }
  

  
  /**
   * Find Connected App files in the project
   * @param nameFilter Optional filter for app names
   * @returns Array of Connected Apps found in the project
   */
  private async findConnectedAppsInProject(nameFilter?: string): Promise<ProjectConnectedApp[]> {
    try {
      // Get all Connected App files in the project
      const connectedAppFiles = await glob('**/*.connectedApp-meta.xml', { 
        ignore: GLOB_IGNORE_PATTERNS,
        cwd: process.cwd()
      });
      
      if (connectedAppFiles.length === 0) {
        return [];
      }
      
      // Create ConnectedApp objects from the files
      const connectedApps: ProjectConnectedApp[] = [];
      for (const filePath of connectedAppFiles) {
        try {
          const xmlData = await parseXmlFile(filePath);
          if (xmlData && xmlData.ConnectedApp) {
            // Get the name from the fullName property in the XML or from the filename
            const fullName = xmlData.ConnectedApp.fullName?.[0] || path.basename(filePath, '.connectedApp-meta.xml');
            
            // Filter by name if specified
            if (nameFilter) {
              const appNames = nameFilter.split(',').map(name => name.trim());
              if (!appNames.some(name => name.toLowerCase() === fullName.toLowerCase())) {
                continue;
              }
            }
            
            connectedApps.push({
              fullName: fullName,
              filePath: filePath,
              type: 'ConnectedApp'
            });
          }
        } catch (error) {
          uxLog(this, c.yellow(`Error parsing ${filePath}: ${error}`));
          // Continue with the next file
        }
      }
      
      return connectedApps;
    } catch (error) {
      uxLog(this, c.red(`Error searching for Connected App files: ${error}`));
      return [];
    }
  }
  
  /**
   * Deploy Connected Apps to the org
   * @param orgUsername Username of the target org
   * @param connectedApps Connected Apps to deploy
   * @returns Promise<void>
   */
  private async deployConnectedApps(orgUsername: string, connectedApps: ProjectConnectedApp[]): Promise<void> {
    if (connectedApps.length === 0) return;
    
    // Temporarily modify .forceignore to allow Connected App deployment
    const backupInfo = await disableConnectedAppIgnore(this);
    
    try {
      // Deploy each Connected App separately to handle any failures
      for (const app of connectedApps) {
        uxLog(this, c.cyan(`Deploying Connected App: ${app.fullName}`));
        
        // Use sf project deploy to deploy the Connected App
        await execCommand(
          `sf project deploy start -s -m "ConnectedApp:${app.fullName}" --target-org ${orgUsername} --ignore-warnings --json`,
          this,
          { output: true, fail: false } // Continue even if deployment fails
        );
      }
      
      uxLog(this, c.green(`Deployment of Connected Apps completed`));
    } catch (error) {
      uxLog(this, c.red(`Error deploying Connected Apps: ${error}`));
      throw error;
    } finally {
      // Restore original .forceignore
      await restoreConnectedAppIgnore(backupInfo, this);
    }
  }
}
