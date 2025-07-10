import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as path from 'path';
import c from 'chalk';
import { glob } from 'glob';
import { uxLog } from '../../../../../common/utils/index.js';
import { parseXmlFile } from '../../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../../common/utils/projectUtils.js';
import { 
  deleteConnectedApps, 
  deployConnectedApps, 
  toConnectedAppFormat,
  validateConnectedApps,
  selectConnectedAppsForProcessing
} from '../../../../../common/utils/refresh/connectedAppUtils.js';

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
    `$ sf hardis:org:refresh:restore:connectedapp --all // Process all apps, no selection prompt`,
    `$ sf hardis:org:refresh:restore:connectedapp --target-org myDevOrg`,
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
    const processAll = flags.all || false;
    const nameFilter = processAll ? undefined : flags.name; // If --all is set, ignore --name

    try {
      // Step 1: Find Connected Apps in the project
      const connectedApps = await this.findConnectedAppsInProject(nameFilter, processAll);
      
      if (connectedApps.length === 0) {
        uxLog(this, c.yellow('No Connected Apps found in the project'));
        return { success: false, message: 'No Connected Apps found in the project' };
      }
      
      // Step 2: Select which Connected Apps to process
      const selectedApps = await this.selectConnectedApps(connectedApps, processAll, nameFilter);
      
      if (selectedApps.length === 0) {
        uxLog(this, c.yellow('No Connected Apps selected'));
        return { success: false, message: 'No Connected Apps selected' };
      }
      
      // Step 3: Delete existing Connected Apps from the org for clean deployment
      await this.deleteExistingConnectedApps(orgUsername, selectedApps);
      
      // Step 4: Deploy the Connected Apps to the org
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
  
  private async findConnectedAppsInProject(
    nameFilter?: string, 
    processAll?: boolean
  ): Promise<ProjectConnectedApp[]> {
    if (processAll) {
      uxLog(this, c.cyan('Processing all Connected Apps from local repository (selection prompt bypassed)'));
    } else if (nameFilter) {
      uxLog(this, c.cyan(`Processing specified Connected App(s): ${nameFilter} (selection prompt bypassed)`));
    } else {
      uxLog(this, c.cyan('Scanning project for Connected Apps...'));
    }
    
    try {
      // Get all Connected App files in the project once
      const connectedAppFiles = await glob('**/*.connectedApp-meta.xml', { 
        ignore: GLOB_IGNORE_PATTERNS,
        cwd: process.cwd()
      });
      
      if (connectedAppFiles.length === 0) {
        uxLog(this, c.yellow('No Connected App files found in the project'));
        return [];
      }
      
      uxLog(this, c.grey(`Found ${connectedAppFiles.length} Connected App files in the project`));
      
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
          uxLog(this, c.yellow(`Error parsing ${filePath}: ${error}`));
          // Continue with the next file
        }
      }
      
      if (allFoundApps.length === 0) {
        uxLog(this, c.yellow('No valid Connected Apps found in the project'));
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
        uxLog(this, c.cyan(`Found ${connectedApps.length} Connected App(s) in project`));
        connectedApps.forEach(app => {
          uxLog(this, `${c.green(app.fullName)} (${app.filePath})`);
        });
      } else if (nameFilter) {
        uxLog(this, c.yellow(`No Connected Apps matching the filter "${nameFilter}" found in the project`));
      }
      
      return connectedApps;
    } catch (error) {
      uxLog(this, c.red(`Error searching for Connected App files: ${error}`));
      return [];
    }
  }

  private async selectConnectedApps(
    connectedApps: ProjectConnectedApp[],
    processAll: boolean,
    nameFilter?: string
  ): Promise<ProjectConnectedApp[]> {
    return selectConnectedAppsForProcessing(
      connectedApps,
      processAll,
      nameFilter,
      'Select Connected Apps to restore:',
      this
    );
  }
  
  private async deleteExistingConnectedApps(
    orgUsername: string, 
    connectedApps: ProjectConnectedApp[]
  ): Promise<void> {
    if (connectedApps.length === 0) return;
    
    uxLog(this, c.cyan(`For a clean deployment, the ${connectedApps.length} Connected App(s) will be deleted from the org before deployment...`));
    
    // Convert ProjectConnectedApp to the format required by deleteConnectedApps
    const appsToDelete = toConnectedAppFormat(connectedApps);
    
    // Delete the apps without prompting
    await deleteConnectedApps(orgUsername, appsToDelete, this);
    uxLog(this, c.green('Connected Apps were successfully deleted from the org.'));
  }

  private async deployConnectedApps(
    orgUsername: string, 
    connectedApps: ProjectConnectedApp[]
  ): Promise<void> {
    if (connectedApps.length === 0) return;
    
    uxLog(this, c.cyan(`Deploying ${connectedApps.length} Connected App(s) to org...`));
    
    // Convert ProjectConnectedApp to the format needed by deployConnectedApps
    const connectedAppsList = toConnectedAppFormat(connectedApps);
    await deployConnectedApps(orgUsername, connectedAppsList, this);
    
    uxLog(this, c.green(`Deployment of ${connectedApps.length} Connected App(s) completed successfully`));
  }
}
