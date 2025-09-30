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

export default class DecomposedMetadata extends SfCommand<any> {
  public static title = 'Decomposed Metadata (Beta)';
  public static description = `
## Command Behavior

**Manage decomposed metadata types in Salesforce DX projects.**

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
    '$ sf hardis:project:metadata:decomposed',
    '$ sf hardis:project:metadata:decomposed --debug'
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
  protected webSocketClient: any;

  public async run(): Promise<any> {
    const { flags } = await this.parse(DecomposedMetadata);

    // Initialize configuration
    this.configInfo = await getConfig('user');

    // Initialize WebSocket client for UI integration
    if (flags.websocket && typeof flags.websocket === 'string') {
      this.webSocketClient = new WebSocketClient({
        websocketHostPort: flags.websocket,
        command: 'hardis:project:metadata:decomposed',
        id: Date.now().toString()
      });
    }

    uxLog("action", this, c.cyan(`Checking for metadata types eligible for decomposition (Beta feature)`));

    const results: {
      success: boolean;
      cancelled: boolean;
      decomposedTypes: string[];
      errors: string[];
    } = {
      success: true,
      cancelled: false,
      decomposedTypes: [],
      errors: []
    };

    try {
      // Send initial status to UI
      this.sendWebSocketStatus({
        status: 'running',
        message: `Preparing to decompose metadata`,
        icon: 'sync'
      });

      // Detect which metadata types exist in the project and need decomposition
      const applicableTypes = await this.detectApplicableMetadataTypes();

      if (applicableTypes.length === 0) {
        const existingOptions = this.getExistingSourceBehaviorOptions();
        if (existingOptions.length > 0) {
          uxLog("warning", this, c.yellow(`All supported metadata types are already decomposed in this project`));
          this.sendWebSocketStatus({
            status: 'warning',
            message: `All supported metadata types are already decomposed in this project`,
            icon: 'warning'
          });
          return { success: true, message: 'All metadata types already decomposed', alreadyDecomposed: true };
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

      // Build confirmation message with comma-separated list of metadata types
      const metadataTypesList = applicableTypes.map(type => type.name).join(', ');
      const confirmMessage = `Are you sure you want to decompose these metadata types: ${metadataTypesList}?`;

      // Ask for confirmation
      const confirmed = await this.promptConfirmation({
        title: 'Confirm Metadata Decomposition',
        message: confirmMessage,
        confirmLabel: 'Yes, decompose',
        cancelLabel: 'Cancel',
        icon: 'help-circle'
      });

      if (!confirmed) {
        uxLog("warning", this, c.yellow('Operation cancelled by user'));
        this.sendWebSocketStatus({
          status: 'warning',
          message: 'Metadata decomposition cancelled by user',
          icon: 'x-circle'
        });
        results.cancelled = true;
        return results;
      }

      // Process each applicable metadata type
      for (const metadataType of applicableTypes) {
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
      if (Array.isArray(results.errors)) {
        results.errors.push(error.message || 'Unknown error');
      }

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
      if (this.webSocketClient) {
        WebSocketClient.closeClient('completed');
      }
    }

    return results;
  }

  /**
   * Read the sfdx-project.json file and get existing sourceBehaviorOptions
   */
  private getExistingSourceBehaviorOptions(): string[] {
    if (!isSfdxProject()) {
      return [];
    }

    try {
      const projectJsonPath = path.join(process.cwd(), 'sfdx-project.json');
      if (!fs.existsSync(projectJsonPath)) {
        return [];
      }

      const projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
      return Array.isArray(projectConfig.sourceBehaviorOptions) ?
        projectConfig.sourceBehaviorOptions : [];
    } catch (error) {
      // If there's an error reading the file, assume no options exist
      return [];
    }
  }

  /**
   * Detect which metadata types exist in the project
   */
  private async detectApplicableMetadataTypes(): Promise<MetadataTypeConfig[]> {
    const applicableTypes: MetadataTypeConfig[] = [];
    const existingOptions = this.getExistingSourceBehaviorOptions();

    for (const metadataType of METADATA_TYPES) {
      // Skip if this behavior is already in sfdx-project.json
      if (existingOptions.includes(metadataType.behavior)) {
        uxLog("log", this, c.grey(`Skipping ${metadataType.name}: already decomposed (${metadataType.behavior} found in sfdx-project.json)`));
        continue;
      }

      const directory = path.join('force-app', 'main', 'default', metadataType.directory);

      if (fs.existsSync(directory)) {
        // If a specific file pattern is defined, check if it exists
        if (metadataType.filePattern) {
          const filePath = path.join(directory, metadataType.filePattern);
          if (fs.existsSync(filePath)) {
            applicableTypes.push(metadataType);
          }
        } else {
          // Otherwise, check if directory has any files
          const files = fs.readdirSync(directory);
          if (files.length > 0) {
            applicableTypes.push(metadataType);
          }
        }
      }
    }

    return applicableTypes;
  }

  /**
   * Decompose a specific metadata type
   */
  private async decomposeMetadataType(
    metadataType: MetadataTypeConfig,
    flags: any
  ): Promise<{ success: boolean; error?: string }> {
    uxLog("action", this, c.cyan(`Preparing to decompose ${metadataType.name}...`));

    // Double-check if behavior is already in sfdx-project.json
    const existingOptions = this.getExistingSourceBehaviorOptions();
    if (existingOptions.includes(metadataType.behavior)) {
      uxLog("log", this, c.grey(`Skipping ${metadataType.name}: already decomposed (${metadataType.behavior} found in sfdx-project.json)`));
      return { success: true, error: 'Already decomposed' };
    }

    // Update UI status
    this.sendWebSocketStatus({
      status: 'running',
      message: `Decomposing ${metadataType.name}...`,
      icon: 'refresh'
    });

    // Run sf project convert source-behavior command
    const command = `sf project convert source-behavior --behavior ${metadataType.behavior}`;

    try {
      // Use echo y to automatically answer "y" to the confirmation prompt
      const commandWithAutoConfirm = `echo y | ${command}`;
      uxLog("action", this, c.cyan(`Executing: ${command} (with auto-confirmation)`));
      await execCommand(commandWithAutoConfirm, this, {
        fail: true,
        output: true,
        debug: flags.debug
      });

      this.sendWebSocketStatus({
        status: 'success',
        message: `Successfully decomposed ${metadataType.name}`,
        icon: 'check-circle'
      });

      uxLog("success", this, c.green(`Successfully decomposed ${metadataType.name}`));
      return { success: true };
    } catch (error: any) {
      // Check if error is due to behavior already existing
      if (error?.message && error.message.includes('sourceBehaviorOptionAlreadyExists')) {
        uxLog("log", this, c.grey(`${metadataType.name} is already decomposed (${metadataType.behavior} found in sfdx-project.json)`));
        return { success: true, error: 'Already decomposed' };
      }

      this.sendWebSocketStatus({
        status: 'error',
        message: `Error decomposing ${metadataType.name}: ${error?.message || 'Unknown error'}`,
        icon: 'error'
      });

      uxLog("error", this, c.red(`Error decomposing ${metadataType.name}: ${error?.message || 'Unknown error'}`));
      return { success: false, error: error?.message || 'Unknown error' };
    }
  }

  // Helper method to send status updates to the WebSocket UI
  private sendWebSocketStatus(status: any): void {
    if (this.webSocketClient) {
      WebSocketClient.sendMessage({
        event: 'status',
        data: status
      });
    }
  }

  // Helper method to prompt for confirmation via UI or terminal
  private async promptConfirmation(options: any): Promise<boolean> {
    if (this.webSocketClient && WebSocketClient.isAlive()) {
      try {
        // Send confirmation request via WebSocket
        const response = await WebSocketClient.sendPrompts({
          type: 'confirm',
          name: 'confirmed',
          message: options.message,
          description: options.title || 'Confirm operation',
          initial: false
        });

        return response?.confirmed === true;
      } catch (e) {
        // Fall back to terminal prompt if WebSocket prompts fail
        uxLog("warning", this, c.yellow('WebSocket prompt failed, falling back to terminal prompt'));
        return this.terminalPrompt(options);
      }
    } else {
      // Fall back to terminal prompt
      return this.terminalPrompt(options);
    }
  }

  // Terminal prompt fallback
  private async terminalPrompt(options: any): Promise<boolean> {
    const confirmResult = await prompts({
      type: 'confirm',
      name: 'value',
      message: c.cyan(options.message),
      description: options.title || 'Confirm operation',
      initial: false
    });

    return confirmResult.value === true;
  }
}
/* jscpd:ignore-end */