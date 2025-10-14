/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import c from 'chalk';
import { execCommand, uxLog } from '../../../../common/utils/index.js';
import { getConfig } from '../../../../config/index.js';
import fs from 'fs-extra';
import path from 'path';
import { prompts } from '../../../../common/utils/prompts.js';
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

See [Salesforce documentation on decomposed metadata](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_decomposed_md_types.htm)

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

  protected configInfo: any;
  private sourceBehaviorOptionsCache?: string[] | null;

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
          return {
            success: true,
            message: 'All metadata types already decomposed',
            alreadyDecomposed: true,
            alreadyDecomposedTypes: results.alreadyDecomposedTypes
          };
        } else {
          uxLog("warning", this, c.yellow(`No supported metadata types found in this project`));
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
        uxLog("warning", this, c.yellow('Operation cancelled by user.'));
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
        uxLog("action", this, c.green(`Successfully decomposed: ${results.decomposedTypes.join(', ')}`));
      } else {
        uxLog("action", this, c.yellow(`No metadata types were decomposed`));
      }

      // Log errors if any
      if (results.errors.length > 0) {
        uxLog("action", this, c.red(`Errors summary:`));
        results.errors.forEach((error, index) => {
          uxLog("error", this, c.red(`\nError ${index + 1}:\n${error}`));
        });
      }
    } catch (error: any) {
      results.success = false;

      // Build comprehensive error information
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack || '';
      const errorStdout = error?.stdout || '';
      const errorStderr = error?.stderr || '';

      // Build detailed error report
      const errorDetails: string[] = [];
      errorDetails.push(`Error Type: Unexpected error during metadata decomposition`);

      if (errorMessage && errorMessage !== 'Unknown error') {
        errorDetails.push(`Error Message: ${errorMessage}`);
      }

      if (errorStdout && errorStdout.trim()) {
        errorDetails.push(`Standard Output:\n${errorStdout.trim()}`);
      }

      if (errorStderr && errorStderr.trim()) {
        errorDetails.push(`Standard Error:\n${errorStderr.trim()}`);
      }

      if (errorStack) {
        errorDetails.push(`Stack Trace:\n${errorStack}`);
      }

      const detailedErrorReport = errorDetails.join('\n');
      results.errors.push(detailedErrorReport);

      // Send error status to UI with detailed message
      let uiErrorMessage = 'Error during metadata decomposition';
      if (errorStderr && errorStderr.trim()) {
        const firstErrorLine = errorStderr.trim().split('\n')[0];
        uiErrorMessage += `: ${firstErrorLine}`;
      } else if (errorMessage && errorMessage !== 'Unknown error') {
        uiErrorMessage += `: ${errorMessage}`;
      }

      // Log detailed error report
      uxLog("error", this, c.red(uiErrorMessage));
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
    } catch (error: any) {
      // If there's an error reading the file, assume no options exist
      this.sourceBehaviorOptionsCache = null;
      uxLog("warning", this, c.yellow(`Warning: Unable to read sfdx-project.json for sourceBehaviorOptions (error: ${error instanceof Error ? error.message : 'unknown error'})`));
      return [];
    }
  }

  /**
   * Get package directories from project
   * Supports custom package directory structures (Optimization #3)
   * Returns base package paths (e.g., 'force-app'), not including 'main/default'
   */
  private getPackageDirectories(): string[] {
    try {
      // Use the project's getPackageDirectories method if available
      const packageDirs = this.project?.getPackageDirectories();

      if (packageDirs && packageDirs.length > 0) {
        // Map to get just the path property from each package directory object
        return packageDirs.map((pd: any) => pd.path);
      }

      // Fallback to default if no project or no package directories
      return ['force-app'];
    } catch (error) {
      uxLog("warning", this, c.yellow(`Warning: Unable to read package directories from sfdx-project.json (error: ${error instanceof Error ? error.message : 'unknown error'})`));
      // Fallback to default on error
      return ['force-app'];
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

    try {
      // Use the framework's execCommand utility which handles cross-platform execution
      const result = await execCommand(commandWithAutoConfirm, this, {
        fail: true,
        output: flags.output || flags.debug,
        debug: flags.debug
      });

      return result;
    } catch (error: any) {
      // Enhance error with more context
      const enhancedError = new Error(error.message || 'Unknown error');
      (enhancedError as any).stdout = error.stdout || '';
      (enhancedError as any).stderr = error.stderr || '';
      (enhancedError as any).exitCode = error.exitCode || error.code || 1;
      (enhancedError as any).command = command;
      throw enhancedError;
    }
  }

  /**
   * Decompose a specific metadata type
   */
  private async decomposeMetadataType(
    metadataType: MetadataTypeConfig,
    flags: any
  ): Promise<{ success: boolean; error?: string }> {
    uxLog("action", this, c.cyan(`Attempting to decompose metadata ${metadataType.name}...`));

    // Run sf project convert source-behavior command
    const command = `sf project convert source-behavior --behavior ${metadataType.behavior}`;

    try {
      // Use cross-platform method to handle confirmation
      await this.execSfCommandWithConfirmation(command, flags);
      uxLog("success", this, c.green(`Successfully decomposed ${metadataType.name}`));
      return { success: true };
    } catch (error: any) {
      // Extract all error information
      const errorMessage = error?.message || 'Unknown error';
      const errorStdout = error?.stdout || '';
      const errorStderr = error?.stderr || '';
      const exitCode = error?.exitCode || '';
      const commandExecuted = error?.command || command;

      // Check if error is due to behavior already existing
      if (errorMessage.includes('sourceBehaviorOptionAlreadyExists') ||
        errorStdout.includes('sourceBehaviorOptionAlreadyExists') ||
        errorStderr.includes('sourceBehaviorOptionAlreadyExists')) {
        uxLog("log", this, c.grey(`${metadataType.name} is already decomposed (${metadataType.behavior} found in sfdx-project.json)`));
        return { success: true, error: 'Already decomposed' };
      }

      if (errorMessage.includes('TrackingNotSupportedError')) {
        const retryRes = await prompts({
          type: 'confirm',
          name: 'retry',
          message: c.yellow(`You can not decompose metadata when default org has source tracking enabled. Do you want to unselect the default org and retry?`),
          description: 'This will unset the default org for this project and try the command again',
          initial: true
        });
        if (retryRes.retry) {
          // Unset default org
          await execCommand('sf config unset target-org', this, { fail: true, debug: flags.debug });
          uxLog("log", this, c.green(`Default org unset successfully. Retrying decomposition of ${metadataType.name}...`));
          // Retry decomposition
          return await this.decomposeMetadataType(metadataType, flags);
        }
      }

      // Build comprehensive error report
      const errorDetails: string[] = [];
      errorDetails.push(`Metadata Type: ${metadataType.name}`);
      errorDetails.push(`Behavior: ${metadataType.behavior}`);
      errorDetails.push(`Command: ${commandExecuted}`);

      if (exitCode) {
        errorDetails.push(`Exit Code: ${exitCode}`);
      }

      if (errorMessage && errorMessage !== 'Unknown error') {
        errorDetails.push(`Error Message: ${errorMessage}`);
      }

      if (errorStdout && errorStdout.trim()) {
        errorDetails.push(`Standard Output:\n${errorStdout.trim()}`);
      }

      if (errorStderr && errorStderr.trim()) {
        errorDetails.push(`Standard Error:\n${errorStderr.trim()}`);
      }

      const detailedErrorReport = errorDetails.join('\n');

      // Create user-friendly error message for UI
      let uiErrorMessage = `Error decomposing ${metadataType.name}`;
      if (exitCode) {
        uiErrorMessage += ` (exit code ${exitCode})`;
      }
      if (errorStderr && errorStderr.trim()) {
        // Include first line of stderr in UI message
        const firstErrorLine = errorStderr.trim().split('\n')[0];
        uiErrorMessage += `: ${firstErrorLine}`;
      } else if (errorMessage && errorMessage !== 'Unknown error') {
        uiErrorMessage += `: ${errorMessage}`;
      }

      // Log detailed error report
      uxLog("error", this, c.red(uiErrorMessage));

      // Also log to help with debugging
      if (flags.debug) {
        uxLog("error", this, c.grey(`Full error object: ${JSON.stringify(error, null, 2)}`));
      }

      return { success: false, error: detailedErrorReport };
    }
  }

}
/* jscpd:ignore-end */