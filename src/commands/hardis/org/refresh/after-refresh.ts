import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as path from 'path';
import c from 'chalk';
import * as fs from 'fs';
import { glob } from 'glob';
import { uxLog } from '../../../../common/utils/index.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
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

**Restores all previously backed-up Connected Apps (including Consumer Secrets) to a Salesforce org after a sandbox refresh.**

This command is the second step in the sandbox refresh process. It scans the backup folder created before the refresh, allows selection of which Connected Apps to restore, and automates their deletion and redeployment to the refreshed org, ensuring all credentials and configuration are preserved.

Key functionalities:

- **Backup Folder Selection:** Prompts the user to select the correct backup folder for the sandbox instance.
- **Connected App Discovery:** Scans the backup for all Connected App metadata files.
- **User Selection:** Allows interactive or flag-based selection of which Connected Apps to restore.
- **Validation:** Ensures all selected apps exist in the backup and validates user input.
- **Org Cleanup:** Deletes existing Connected Apps from the refreshed org to allow clean redeployment.
- **Deployment:** Deploys the selected Connected Apps (with secrets) to the org.
- **Summary and Reporting:** Provides a summary of restored apps and their status.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is designed to be run after a sandbox refresh, using the backup created by the before-refresh command.

<details markdown="1">
<summary>Technical explanations</summary>

- **Backup Folder Handling:** Prompts for and validates the backup folder under \`scripts/sandbox-refresh/\`.
- **Metadata Scanning:** Uses glob patterns to find all \`*.connectedApp - meta.xml\` files in the backup.
- **Selection Logic:** Supports \`--all\`, \`--name\`, and interactive selection of apps to restore.
- **Validation:** Checks that all requested apps exist in the backup and provides clear errors if not.
- **Org Operations:** Deletes existing Connected Apps from the org before redeployment to avoid conflicts.
- **Deployment:** Uses utility functions to deploy Connected Apps and their secrets to the org.
- **Error Handling:** Handles and reports errors at each step, including parsing and deployment issues.

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
  protected refreshSandboxConfig: any = {};
  protected saveProjectPath: string;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgRefreshAfterRefresh);
    const orgUsername = flags["target-org"].getUsername() as string;
    const conn = flags["target-org"].getConnection();
    const instanceUrl = conn.instanceUrl;
    /* jscpd:ignore-start */
    const processAll = flags.all || false;
    const nameFilter = processAll ? undefined : flags.name; // If --all is set, ignore --name
    const config = await getConfig("user");
    this.refreshSandboxConfig = config?.refreshSandboxConfig || {};
    /* jscpd:ignore-end */
    uxLog("action", this, c.cyan(`This command with restore information after the refresh of org ${instanceUrl}`));

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

    try {
      // Step 1: Find Connected Apps in the project
      const connectedApps = await this.findConnectedAppsInProject(nameFilter, processAll);

      if (connectedApps.length === 0) {
        uxLog("warning", this, c.yellow('No Connected Apps found in the project'));
        return { success: false, message: 'No Connected Apps found in the project' };
      }

      /* jscpd:ignore-start */
      // Step 2: Select which Connected Apps to process
      const selectedApps = await this.selectConnectedApps(connectedApps, processAll, nameFilter);

      if (selectedApps.length === 0) {
        uxLog("warning", this, c.yellow('No Connected Apps selected'));
        return { success: false, message: 'No Connected Apps selected' };
      }
      /* jscpd:ignore-end */

      // Step 3: Delete existing Connected Apps from the org for clean deployment
      await this.deleteExistingConnectedApps(orgUsername, selectedApps);

      // Step 4: Deploy the Connected Apps to the org
      await this.deployConnectedApps(orgUsername, selectedApps);

      // Return the result
      uxLog("action", this, c.cyan(`Summary`));
      const appNames = selectedApps.map(app => `- ${app.fullName}`).join('\n');
      uxLog("success", this, c.green(`Successfully restored ${selectedApps.length} Connected App(s) to ${conn.instanceUrl}\n${appNames}`));
      return createConnectedAppSuccessResponse(
        `Successfully restored ${selectedApps.length} Connected App(s) to the org`,
        selectedApps.map(app => app.fullName)
      );
    } catch (error: any) {
      return handleConnectedAppError(error, this);
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
      throw new Error('Connected Apps deletion cancelled by user');
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
      throw new Error('Connected Apps deployment cancelled by user');
    }

    // Convert ProjectConnectedApp to the format needed by deployConnectedApps
    const connectedAppsList = toConnectedAppFormat(connectedApps);
    await deployConnectedApps(orgUsername, connectedAppsList, this, this.saveProjectPath);

    uxLog("success", this, c.green(`Deployment of ${connectedApps.length} Connected App(s) completed successfully`));
  }
}
