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

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DecomposedMetadata extends SfCommand<any> {
  public static title = 'Decomposed Metadata (Beta)';
  public static description = `
## Command Behavior

**Manage decomposed metadata types in Salesforce DX projects.**

This command helps manage decomposed metadata types such as CustomLabels and PermissionSet that can be split into multiple files in source format.

Key features:
- Decompose CustomLabels into individual files using decomposeCustomLabelsBeta2 behavior
- Decompose PermissionSets using the decomposePermissionSetBeta2 behavior
- Interactive confirmation for decomposition operations

<details markdown="1">
<summary>Technical explanations</summary>

This command utilizes Salesforce CLI's decomposed metadata feature to split complex metadata types into smaller, more manageable components:

- **CustomLabels**: Each custom label becomes a separate file, making it easier to track changes and manage translations.
- **PermissionSets**: Permission sets are decomposed into multiple files based on the permissions they contain (field permissions, object permissions, etc.).

The command wraps the underlying Salesforce CLI functionality and provides a more user-friendly interface with additional validation and error handling.
</details>
`;

  public static examples = [
    '$ sf hardis:project:metadata:decomposed --behavior decomposePermissionSetBeta2',
    '$ sf hardis:project:metadata:decomposed --behavior decomposeCustomLabelsBeta2'
  ];

  public static flags: any = {
    behavior: Flags.string({
      char: 'b',
      description: 'Decomposition behavior to use',
      options: ['decomposePermissionSetBeta2', 'decomposeCustomLabelsBeta2'],
      required: true
    }),
    'auto-confirm': Flags.boolean({
      char: 'y',
      description: 'Automatically confirm decomposition without prompting',
      default: false
    }),
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

    uxLog("action", this, c.cyan(`Starting metadata decomposition with behavior: ${c.green(flags.behavior)}`));

    const results: {
      success: boolean;
      behavior: string;
      errors: string[];
    } = {
      success: true,
      behavior: flags.behavior,
      errors: []
    };

    try {
      // Send initial status to UI
      this.sendWebSocketStatus({
        status: 'running',
        message: `Preparing to decompose metadata using ${flags.behavior}`,
        icon: 'sync'
      });

      // Determine which decomposition function to call based on behavior flag
      if (flags.behavior === 'decomposeCustomLabelsBeta2') {
        await this.decomposeCustomLabels(flags);
      } else if (flags.behavior === 'decomposePermissionSetBeta2') {
        await this.decomposePermissionSets(flags);
      }

      // Send success status to UI
      this.sendWebSocketStatus({
        status: 'success',
        message: `Successfully decomposed metadata using ${flags.behavior}`,
        icon: 'check-circle'
      });

      uxLog("success", this, c.green(`Successfully decomposed metadata using ${flags.behavior}`));
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

  private async decomposeCustomLabels(flags: any): Promise<void> {
    uxLog("action", this, c.cyan('Preparing to decompose Custom Labels...'));

    // Update UI status
    this.sendWebSocketStatus({
      status: 'running',
      message: 'Checking for Custom Labels files...',
      icon: 'search'
    });

    // Check if CustomLabels.labels-meta.xml exists
    const customLabelsPath = path.join('force-app', 'main', 'default', 'labels', 'CustomLabels.labels-meta.xml');
    if (!fs.existsSync(customLabelsPath)) {
      this.sendWebSocketStatus({
        status: 'warning',
        message: `Custom Labels file not found at ${customLabelsPath}`,
        icon: 'warning'
      });
      uxLog("warning", this, c.yellow(`Custom Labels file not found at ${customLabelsPath}`));
      return;
    }

    // Confirm with user unless auto-confirm is set
    if (!flags['auto-confirm']) {
      // Send confirmation request to UI
      const confirmOptions = {
        title: 'Confirm Custom Labels Decomposition',
        message: `Are you sure you want to decompose Custom Labels?`,
        confirmLabel: 'Yes, decompose',
        cancelLabel: 'Cancel',
        icon: 'help-circle'
      };

      const confirmed = await this.promptConfirmation(confirmOptions);

      if (!confirmed) {
        this.sendWebSocketStatus({
          status: 'warning',
          message: 'Custom Labels decomposition cancelled by user',
          icon: 'x-circle'
        });
        uxLog("warning", this, c.yellow('Operation cancelled by user'));
        return;
      }
    }

    // Update UI status
    this.sendWebSocketStatus({
      status: 'running',
      message: 'Decomposing Custom Labels...',
      icon: 'refresh'
    });

    // Run sf project convert source-behavior command
    const command = `sf project convert source-behavior` +
      ` --behavior ${flags.behavior}` +
      (flags['auto-confirm'] ? ' --no-prompt' : '');

    try {
      uxLog("action", this, c.cyan(`Executing: ${command}`));
      await execCommand(command, this, {
        fail: true,
        output: true,
        debug: flags.debug
      });

      this.sendWebSocketStatus({
        status: 'success',
        message: `Successfully decomposed Custom Labels`,
        icon: 'check-circle'
      });

      uxLog("success", this, c.green(`Successfully decomposed Custom Labels`));
    } catch (error: any) {
      this.sendWebSocketStatus({
        status: 'error',
        message: `Error decomposing Custom Labels: ${error?.message || 'Unknown error'}`,
        icon: 'error'
      });

      uxLog("error", this, c.red(`Error decomposing Custom Labels: ${error?.message || 'Unknown error'}`));
      throw error;
    }
  }

  private async decomposePermissionSets(flags: any): Promise<void> {
    uxLog("action", this, c.cyan('Preparing to decompose Permission Sets...'));

    // Update UI status
    this.sendWebSocketStatus({
      status: 'running',
      message: 'Checking for Permission Sets files...',
      icon: 'search'
    });

    // Check if permissionsets directory exists
    const permissionSetsDir = path.join('force-app', 'main', 'default', 'permissionsets');
    if (!fs.existsSync(permissionSetsDir)) {
      this.sendWebSocketStatus({
        status: 'warning',
        message: `Permission Sets directory not found at ${permissionSetsDir}`,
        icon: 'warning'
      });

      uxLog("warning", this, c.yellow(`Permission Sets directory not found at ${permissionSetsDir}`));
      return;
    }

    // Confirm with user unless auto-confirm is set
    if (!flags['auto-confirm']) {
      // Send confirmation request to UI
      const confirmOptions = {
        title: 'Confirm Permission Sets Decomposition',
        message: `Are you sure you want to decompose Permission Sets?`,
        confirmLabel: 'Yes, decompose',
        cancelLabel: 'Cancel',
        icon: 'help-circle'
      };

      const confirmed = await this.promptConfirmation(confirmOptions);

      if (!confirmed) {
        this.sendWebSocketStatus({
          status: 'warning',
          message: 'Permission Sets decomposition cancelled by user',
          icon: 'x-circle'
        });

        uxLog("warning", this, c.yellow('Operation cancelled by user'));
        return;
      }
    }

    // Update UI status
    this.sendWebSocketStatus({
      status: 'running',
      message: 'Decomposing Permission Sets...',
      icon: 'refresh'
    });

    // Run sf project convert source-behavior command
    const command = `sf project convert source-behavior` +
      ` --behavior ${flags.behavior}` +
      (flags['auto-confirm'] ? ' --no-prompt' : '');

    try {
      uxLog("action", this, c.cyan(`Executing: ${command}`));
      await execCommand(command, this, {
        fail: true,
        output: true,
        debug: flags.debug
      });

      this.sendWebSocketStatus({
        status: 'success',
        message: `Successfully decomposed Permission Sets`,
        icon: 'check-circle'
      });

      uxLog("success", this, c.green(`Successfully decomposed Permission Sets`));
    } catch (error: any) {
      this.sendWebSocketStatus({
        status: 'error',
        message: `Error decomposing Permission Sets: ${error?.message || 'Unknown error'}`,
        icon: 'error'
      });

      uxLog("error", this, c.red(`Error decomposing Permission Sets: ${error?.message || 'Unknown error'}`));
      throw error;
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
