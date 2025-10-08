/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import c from 'chalk';
import { execCommand, uxLog } from '../../../../common/utils/index.js';
import { getConfig } from '../../../../config/index.js';
import fs from 'fs-extra';
import path from 'path';
import { prompts } from '../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { isSfdxProject } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Define metadata types and their corresponding behaviors
interface MetadataTypeConfig {
  name: string;
  behavior: string;
  directory: string;
  filePattern?: string;
}

const METADATA_TYPES: MetadataTypeConfig[] = [
  {
    name: 'CustomLabels',
    behavior: 'decomposeCustomLabelsBeta2',
    directory: 'labels',
    filePattern: 'CustomLabels.labels-meta.xml'
  },
  {
    name: 'PermissionSet',
    behavior: 'decomposePermissionSetBeta2',
    directory: 'permissionsets'
  },
  {
    name: 'ExternalServiceRegistration',
    behavior: 'decomposeExternalServiceRegistrationBeta',
    directory: 'externalServiceRegistrations'
  },
  {
    name: 'SharingRules',
    behavior: 'decomposeSharingRulesBeta',
    directory: 'sharingRules'
  },
  {
    name: 'Workflow',
    behavior: 'decomposeWorkflowBeta',
    directory: 'workflows'
  }
];

export default class ActivateDecomposedMetadata extends SfCommand<any> {
  public static title = 'Activate Decomposed Metadata (Beta)';
  public static description = `
## Command Behavior

**Activate decomposed metadata types in Salesforce DX projects.**

This command helps manage decomposed metadata types that can be split into multiple files in source format. It automatically decomposes all supported metadata types that exist in your project.

Supported metadata types (Beta):
- CustomLabels
- PermissionSet
- ExternalServiceRegistration
- SharingRules
- Workflow

Key features:
- Automatically detects and decomposes all applicable metadata types
- Decomposes only metadata types that exist in your project
- Interactive confirmation for decomposition operations
- Handles all confirmation prompts automatically

<details markdown="1">
<summary>Technical explanations</summary>

This command utilizes Salesforce CLI's decomposed metadata feature to split complex metadata types into smaller, more manageable components:

- **CustomLabels**: Each custom label becomes a separate file, making it easier to track changes and manage translations.
- **PermissionSets**: Permission sets are decomposed into multiple files based on the permissions they contain (field permissions, object permissions, etc.).
- **ExternalServiceRegistration**: Decomposes external service registrations.
- **SharingRules**: Decomposes sharing rules into individual components.
- **Workflow**: Decomposes workflow rules into individual components.

The command wraps the underlying Salesforce CLI functionality and provides a more user-friendly interface with additional validation and error handling.

Note: All decomposed metadata features are currently in Beta in Salesforce CLI.
</details>
`;

  public static examples = [
    '$ sf hardis:project:metadata:activate-decomposed',
    '$ sf hardis:project:metadata:activate-decomposed --debug'
  ];

  public static flags: any = {
    debug: Flags.boolean({
      char: 'd',
      description: 'Run command in debug mode',
      default: false
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  };

  public static requiresProject = true;

  protected configInfo: any;
  private sourceBehaviorOptionsCache?: string[] | null;
  private packageDirectoriesCache?: string[];

  public async run(): Promise<any> {
    const { flags } = await this.parse(ActivateDecomposedMetadata);

    // Initialize configuration
    this.configInfo = await getConfig('user');

    const results: {
      success: boolean;
      cancelled: boolean;
      decomposedTypes: string[];
      alreadyDecomposedTypes: string[];
      errors: string[];
    } = {
      success: true,
      cancelled: false,
      decomposedTypes: [],
      alreadyDecomposedTypes: [],
      errors: []
    };

    try {
      // Send initial status to UI
      this.sendWebSocketStatus({
        status: 'running',
        message: `Preparing to decompose metadata`,
        icon: 'sync'
      });

      // Start main action section
      uxLog("action", this, c.cyan(`Checking for metadata types eligible for decomposition (Beta feature)`));

      // Preliminary check: identify already decomposed and remaining metadata types
      const decompositionStatus = this.checkDecompositionStatus();

      // Build names once to avoid duplicate mapping (Optimization #1)
      const alreadyDecomposedNames = decompositionStatus.alreadyDecomposed.length > 0
        ? decompositionStatus.alreadyDecomposed.map(t => t.name).join(', ')
        : '';

      // Detect which metadata types exist in the project and need decomposition
      const applicableTypes = await this.detectApplicableMetadataTypes();

      // Display already decomposed types as a separate section (always visible)
      if (alreadyDecomposedNames) {
        uxLog("action", this, c.grey(`Already decomposed: ${alreadyDecomposedNames}`));
        results.alreadyDecomposedTypes = decompositionStatus.alreadyDecomposed.map(t => t.name);
      }

      // Display eligible types as a log entry under the last action
      if (applicableTypes.length > 0) {
        const remainingNames = applicableTypes.map(t => t.name).join(', ');
        uxLog("log", this, c.cyan(`Eligible for decomposition: ${remainingNames}`));
      }

      if (applicableTypes.length === 0) {
        if (alreadyDecomposedNames) {
          uxLog("warning", this, c.yellow(`All supported metadata types are already decomposed in this project`));
          uxLog("log", this, c.grey(`Already decomposed: ${alreadyDecomposedNames}`));
          this.sendWebSocketStatus({
            status: 'warning',
            message: `All supported metadata types are already decomposed: ${alreadyDecomposedNames}`,
            icon: 'warning'
          });
          return {
            success: true,
            message: 'All metadata types already decomposed',
            alreadyDecomposed: true,
            alreadyDecomposedTypes: results.alreadyDecomposedTypes
          };
        } else {
          uxLog("warning", this, c.yellow(`No supported metadata types found in this project`));
          this.sendWebSocketStatus({
            status: 'warning',
            message: `No supported metadata types found in this project`,
            icon: 'warning'
          });
          return { success: false, message: 'No supported metadata types found' };
        }
      }

      // Let user select which metadata types to decompose
      const selectionResult = await prompts({
        type: 'multiselect',
        name: 'selectedTypes',
        message: c.cyan('Select metadata types to decompose:'),
        description: 'Use space to select/deselect, Enter to confirm',
        choices: applicableTypes.map(type => ({
          title: type.name,
          value: type.name,
          selected: true // All selected by default
        }))
      });

      // Check if user cancelled the selection
      if (!selectionResult.selectedTypes || selectionResult.selectedTypes.length === 0) {
        uxLog("warning", this, c.yellow('Operation cancelled by user'));
        this.sendWebSocketStatus({
          status: 'warning',
          message: 'Metadata decomposition cancelled by user',
          icon: 'x-circle'
        });
        results.cancelled = true;
        return results;
      }

      // Filter to only selected types
      const selectedMetadataTypes = applicableTypes.filter(type =>
        selectionResult.selectedTypes.includes(type.name)
      );

      uxLog("log", this, c.cyan(`Selected for decomposition: ${selectedMetadataTypes.map(t => t.name).join(', ')}`));

      // Process each selected metadata type
      for (const metadataType of selectedMetadataTypes) {
        const operationResult = await this.decomposeMetadataType(metadataType, flags);

        if (operationResult.success) {
          results.decomposedTypes.push(metadataType.name);
        } else if (operationResult.error) {
          results.errors.push(`${metadataType.name}: ${operationResult.error}`);
        }
      }

      // Send success status to UI if any types were decomposed
      if (results.decomposedTypes.length > 0) {
        this.sendWebSocketStatus({
          status: 'success',
          message: `Successfully decomposed: ${results.decomposedTypes.join(', ')}`,
          icon: 'check-circle'
        });

        uxLog("success", this, c.green(`Successfully decomposed: ${results.decomposedTypes.join(', ')}`));
      } else {
        this.sendWebSocketStatus({
          status: 'warning',
          message: `No metadata types were decomposed`,
          icon: 'warning'
        });

        uxLog("warning", this, c.yellow(`No metadata types were decomposed`));
      }

      // Log errors if any
      if (results.errors.length > 0) {
        uxLog("error", this, c.red(`Errors occurred during decomposition:\n${results.errors.join('\n')}`));
      }
    } catch (error: any) {
      results.success = false;
      results.errors.push(error.message || 'Unknown error');

      // Send error status to UI
      this.sendWebSocketStatus({
        status: 'error',
        message: `Error during metadata decomposition: ${error.message || 'Unknown error'}`,
        icon: 'error'
      });

      uxLog("error", this, c.red(`Error during metadata decomposition: ${error.message || 'Unknown error'}`));
      if (flags.debug && error.stack) {
        uxLog("error", this, c.red(error.stack));
      }
    } finally {
      // Close WebSocket connection if it was opened
      WebSocketClient.closeClient('completed');
    }

    return results;
  }

  /**
   * Read the sfdx-project.json file and get existing sourceBehaviorOptions (with caching)
   */
  private getExistingSourceBehaviorOptions(): string[] {
    // Return cached value if available
    if (this.sourceBehaviorOptionsCache !== undefined) {
      return this.sourceBehaviorOptionsCache ?? [];
    }

    if (!isSfdxProject()) {
      this.sourceBehaviorOptionsCache = null;
      return [];
    }

    try {
      const projectJsonPath = path.join(process.cwd(), 'sfdx-project.json');
      if (!fs.existsSync(projectJsonPath)) {
        this.sourceBehaviorOptionsCache = null;
        return [];
      }

      const projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
      const options = Array.isArray(projectConfig.sourceBehaviorOptions) ?
        projectConfig.sourceBehaviorOptions : [];

      this.sourceBehaviorOptionsCache = options;
      return options;
    } catch (error) {
      // If there's an error reading the file, assume no options exist
      this.sourceBehaviorOptionsCache = null;
      return [];
    }
  }

  /**
   * Get package directories from sfdx-project.json (with caching)
   * Supports custom package directory structures (Optimization #3)
   * Returns base package paths (e.g., 'force-app'), not including 'main/default'
   */
  private getPackageDirectories(): string[] {
    // Return cached value if available
    if (this.packageDirectoriesCache) {
      return this.packageDirectoriesCache;
    }

    try {
      const projectJsonPath = path.join(process.cwd(), 'sfdx-project.json');
      if (!fs.existsSync(projectJsonPath)) {
        this.packageDirectoriesCache = ['force-app'];
        return this.packageDirectoriesCache;
      }

      const projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
      const packageDirs: string[] = projectConfig.packageDirectories?.map((pd: any) => pd.path) || [];

      // If no package directories, default to force-app
      this.packageDirectoriesCache = packageDirs.length > 0 ? packageDirs : ['force-app'];
      return this.packageDirectoriesCache;
    } catch (error) {
      this.packageDirectoriesCache = ['force-app'];
      return this.packageDirectoriesCache;
    }
  }

  /**
   * Check decomposition status: identify which metadata types are already decomposed and which remain
   */
  private checkDecompositionStatus(): {
    alreadyDecomposed: MetadataTypeConfig[];
    remaining: MetadataTypeConfig[];
  } {
    const existingOptions = this.getExistingSourceBehaviorOptions();
    const alreadyDecomposed: MetadataTypeConfig[] = [];
    const remaining: MetadataTypeConfig[] = [];

    for (const metadataType of METADATA_TYPES) {
      if (existingOptions.includes(metadataType.behavior)) {
        alreadyDecomposed.push(metadataType);
      } else {
        remaining.push(metadataType);
      }
    }

    return { alreadyDecomposed, remaining };
  }

  /**
   * Detect which metadata types exist in the project
   * Uses parallel file checks for better performance (Optimization #2)
   */
  private async detectApplicableMetadataTypes(): Promise<MetadataTypeConfig[]> {
    const existingOptions = this.getExistingSourceBehaviorOptions();
    const packageDirs = this.getPackageDirectories();

    // Filter out already decomposed types first
    const typesToCheck = METADATA_TYPES.filter(
      metadataType => !existingOptions.includes(metadataType.behavior)
    );

    // Check all metadata types in all package directories in parallel
    const checkPromises = typesToCheck.map(async (metadataType) => {
      // Check all package directories for this metadata type
      for (const pkgDir of packageDirs) {
        // Construct full path: packageDir/main/default/metadataDirectory
        const directory = path.join(pkgDir, 'main', 'default', metadataType.directory);

        const dirExists = await fs.pathExists(directory);
        if (!dirExists) {
          continue;
        }

        if (metadataType.filePattern) {
          const filePath = path.join(directory, metadataType.filePattern);
          const fileExists = await fs.pathExists(filePath);
          if (fileExists) {
            return metadataType;
          }
        } else {
          const files = await fs.readdir(directory);
          if (files.length > 0) {
            return metadataType;
          }
        }
      }
      return null;
    });

    const results = await Promise.all(checkPromises);

    // Filter out nulls and return applicable types
    const applicableTypes = results.filter((type): type is MetadataTypeConfig => type !== null);

    return applicableTypes;
  }

  /**
   * Execute a Salesforce CLI command with automatic confirmation (cross-platform)
   * Uses the framework's execCommand utility with auto-confirmation via echo
   */
  private async execSfCommandWithConfirmation(
    command: string,
    flags: any
  ): Promise<any> {
    // Use echo y | command for cross-platform auto-confirmation
    const commandWithAutoConfirm = `echo y | ${command}`;

    uxLog("action", this, c.cyan(`Executing: ${command} (with auto-confirmation)`));

    // Use the framework's execCommand utility which handles cross-platform execution
    const result = await execCommand(commandWithAutoConfirm, this, {
      fail: true,
      output: flags.output || flags.debug,
      debug: flags.debug
    });

    return result;
  }

  /**
   * Decompose a specific metadata type
   */
  private async decomposeMetadataType(
    metadataType: MetadataTypeConfig,
    flags: any
  ): Promise<{ success: boolean; error?: string }> {
    uxLog("action", this, c.cyan(`Preparing to decompose ${metadataType.name}...`));

    // Update UI status
    this.sendWebSocketStatus({
      status: 'running',
      message: `Decomposing ${metadataType.name}...`,
      icon: 'refresh'
    });

    // Run sf project convert source-behavior command
    const command = `sf project convert source-behavior --behavior ${metadataType.behavior}`;

    try {
      // Use cross-platform method to handle confirmation
      await this.execSfCommandWithConfirmation(command, flags);

      this.sendWebSocketStatus({
        status: 'success',
        message: `Successfully decomposed ${metadataType.name}`,
        icon: 'check-circle'
      });

      uxLog("success", this, c.green(`Successfully decomposed ${metadataType.name}`));
      return { success: true };
    } catch (error: any) {
      // Check if error is due to behavior already existing
      const errorMessage = error?.message || '';
      const errorStdout = error?.stdout || '';
      const errorStderr = error?.stderr || '';

      if (errorMessage.includes('sourceBehaviorOptionAlreadyExists') ||
        errorStdout.includes('sourceBehaviorOptionAlreadyExists') ||
        errorStderr.includes('sourceBehaviorOptionAlreadyExists')) {
        uxLog("log", this, c.grey(`${metadataType.name} is already decomposed (${metadataType.behavior} found in sfdx-project.json)`));
        return { success: true, error: 'Already decomposed' };
      }

      // Build detailed error message
      let detailedError = errorMessage;
      if (errorStdout) {
        detailedError += `\nOutput: ${errorStdout}`;
      }
      if (errorStderr) {
        detailedError += `\nError: ${errorStderr}`;
      }

      this.sendWebSocketStatus({
        status: 'error',
        message: `Error decomposing ${metadataType.name}: ${errorMessage || 'Unknown error'}`,
        icon: 'error'
      });

      uxLog("error", this, c.red(`Error decomposing ${metadataType.name}: ${detailedError || 'Unknown error'}`));
      return { success: false, error: detailedError || 'Unknown error' };
    }
  }

  // Helper method to send status updates to the WebSocket UI
  private sendWebSocketStatus(status: any): void {
    WebSocketClient.sendMessage({
      event: 'status',
      data: status
    });
  }
}
/* jscpd:ignore-end */