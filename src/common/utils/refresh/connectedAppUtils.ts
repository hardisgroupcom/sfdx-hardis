import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import { glob } from 'glob';
import { execCommand, createTempDir, uxLog } from '../index.js';
import { writeXmlFile } from '../xmlUtils.js';
import { getApiVersion } from '../../../config/index.js';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { prompts } from '../prompts.js';
import { GLOB_IGNORE_PATTERNS } from '../projectUtils.js';

// Define interface for Connected App metadata
export interface ConnectedApp {
  fullName: string;
  fileName: string;
  type: string;
  consumerKey?: string;
  consumerSecret?: string;
}

export function generateConnectedAppPackageXml(connectedApps: ConnectedApp[]): any {
  return {
    Package: {
      $: {
        xmlns: 'http://soap.sforce.com/2006/04/metadata'
      },
      types: [
        {
          members: connectedApps.map(app => app.fullName),
          name: ['ConnectedApp']
        }
      ],
      version: [getApiVersion()]
    }
  };
}

export function generateEmptyPackageXml(): any {
  return {
    Package: {
      $: {
        xmlns: 'http://soap.sforce.com/2006/04/metadata'
      },
      version: [getApiVersion()]
    }
  };
}

export async function createConnectedAppManifest(
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<{ manifestPath: string; tmpDir: string }> {
  // Create a temporary directory for the manifest
  const tmpDir = await createTempDir();
  const manifestPath = path.join(tmpDir, 'connected-apps-manifest.xml');

  // Generate and write the package.xml content
  const packageXml = generateConnectedAppPackageXml(connectedApps);
  await writeXmlFile(manifestPath, packageXml);

  // Display the XML content for the manifest
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  uxLog("action", command, c.cyan(`Package.xml manifest for ${connectedApps.length} Connected App(s):`));
  uxLog("warning", command, c.yellow('----------------------------------------'));
  uxLog("other", command, manifestContent);
  uxLog("warning", command, c.yellow('----------------------------------------'));

  return { manifestPath, tmpDir };
}

export async function withConnectedAppIgnoreHandling<T>(
  operationFn: (backupInfo: {
    forceignorePath: string;
    originalContent: string;
    tempBackupPath: string
  } | null) => Promise<T>,
  command: SfCommand<any>
): Promise<T> {
  // Temporarily modify .forceignore to allow Connected App operations
  const backupInfo = await disableConnectedAppIgnore(command);

  try {
    // Perform the operation
    return await operationFn(backupInfo);
  } finally {
    // Always restore .forceignore
    await restoreConnectedAppIgnore(backupInfo, command);
  }
}

export async function createDestructiveChangesManifest(
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<{ destructiveChangesPath: string; packageXmlPath: string; tmpDir: string }> {
  // Create a temporary directory for the manifest
  const tmpDir = await createTempDir();
  const destructiveChangesPath = path.join(tmpDir, 'destructiveChanges.xml');
  const packageXmlPath = path.join(tmpDir, 'package.xml');

  // Generate destructiveChanges.xml using the Connected App Package XML generator
  const destructiveChangesXml = generateConnectedAppPackageXml(connectedApps);

  // Generate empty package.xml required for deployment
  const packageXml = generateEmptyPackageXml();

  await writeXmlFile(destructiveChangesPath, destructiveChangesXml);
  await writeXmlFile(packageXmlPath, packageXml);

  // Display the XML content for destructive changes
  const destructiveXmlContent = await fs.readFile(destructiveChangesPath, 'utf8');
  uxLog("action", command, c.cyan(`Destructive Changes XML for deleting ${connectedApps.length} Connected App(s):`));
  uxLog("warning", command, c.yellow('----------------------------------------'));
  uxLog("other", command, destructiveXmlContent);
  uxLog("warning", command, c.yellow('----------------------------------------'));

  // Display the XML content for the empty package.xml
  const packageXmlContent = await fs.readFile(packageXmlPath, 'utf8');
  uxLog("action", command, c.cyan('Empty Package.xml for deployment:'));
  uxLog("warning", command, c.yellow('----------------------------------------'));
  uxLog("other", command, packageXmlContent);
  uxLog("warning", command, c.yellow('----------------------------------------'));

  return { destructiveChangesPath, packageXmlPath, tmpDir };
}

export async function deleteConnectedApps(
  orgUsername: string | undefined,
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<void> {
  await withConnectedAppValidation(orgUsername, connectedApps, command, 'delete', async () => {
    if (!orgUsername) return; // This should never happen due to validation, but TypeScript needs it

    // Use withConnectedAppIgnoreHandling to handle .forceignore modifications
    await withConnectedAppIgnoreHandling(async () => {
      // Create destructive changes manifests
      const { destructiveChangesPath, packageXmlPath, tmpDir } =
        await createDestructiveChangesManifest(connectedApps, command);

      // Deploy the destructive changes
      uxLog("action", command, c.cyan(`Deleting ${connectedApps.length} Connected App(s) from org...`));
      try {
        await execCommand(
          `sf project deploy start --manifest ${packageXmlPath} --post-destructive-changes ${destructiveChangesPath} --target-org ${orgUsername} --ignore-warnings --ignore-conflicts --json`,
          command,
          { output: true, fail: true }
        );
      } catch (deleteError: any) {
        throw new Error(`Failed to delete Connected Apps: ${deleteError.message || String(deleteError)}`);
      }

      // Clean up
      await fs.remove(tmpDir);
      uxLog("log", command, c.grey('Removed temporary deployment files'));
    }, command);
  });
}

export async function disableConnectedAppIgnore(command: SfCommand<any>): Promise<{
  forceignorePath: string;
  originalContent: string;
  tempBackupPath: string
} | null> {
  const forceignorePath = path.join(process.cwd(), '.forceignore');

  // Check if .forceignore exists
  if (!await fs.pathExists(forceignorePath)) {
    uxLog("log", command, c.grey('No .forceignore file found, no modification needed'));
    return null;
  }

  // Create backup
  const tempBackupPath = path.join(process.cwd(), '.forceignore.backup');
  const originalContent = await fs.readFile(forceignorePath, 'utf8');
  await fs.writeFile(tempBackupPath, originalContent);

  // Read content and remove lines that would ignore Connected Apps
  const lines = originalContent.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim();
    return !(
      trimmedLine.includes('connectedApp') ||
      trimmedLine.includes('ConnectedApp') ||
      trimmedLine.includes('connectedApps')
    );
  });

  // Check if any lines were filtered out
  if (lines.length === filteredLines.length) {
    uxLog("log", command, c.grey('No Connected App ignore patterns found in .forceignore'));
    return { forceignorePath, originalContent, tempBackupPath };
  }

  // Write modified .forceignore
  await fs.writeFile(forceignorePath, filteredLines.join('\n'));
  uxLog("action", command, c.cyan('Temporarily modified .forceignore to allow Connected App retrieval'));

  return { forceignorePath, originalContent, tempBackupPath };
}

export async function restoreConnectedAppIgnore(
  backupInfo: {
    forceignorePath: string;
    originalContent: string;
    tempBackupPath: string
  } | null,
  command: SfCommand<any>
): Promise<void> {
  if (!backupInfo) return;

  try {
    // Restore original .forceignore if backup exists
    if (await fs.pathExists(backupInfo.tempBackupPath)) {
      await fs.writeFile(backupInfo.forceignorePath, backupInfo.originalContent);
      await fs.remove(backupInfo.tempBackupPath);
      uxLog("log", command, c.grey('Restored original .forceignore file'));
    }
  } catch (error) {
    uxLog("warning", command, c.yellow(`Error restoring .forceignore: ${error}`));
  }
}

export async function retrieveConnectedApps(
  orgUsername: string | undefined,
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<void> {
  await withConnectedAppValidation(orgUsername, connectedApps, command, 'retrieve', async () => {
    if (!orgUsername) return; // This should never happen due to validation, but TypeScript needs it

    await performConnectedAppOperationWithManifest(
      orgUsername,
      connectedApps,
      command,
      'retrieve',
      async (manifestPath, orgUsername, command) => {
        await execCommand(
          `sf project retrieve start --manifest ${manifestPath} --target-org ${orgUsername} --ignore-conflicts --json`,
          command,
          { output: true, fail: true }
        );
      }
    );
  });
}

export async function deployConnectedApps(
  orgUsername: string | undefined,
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<void> {
  await withConnectedAppValidation(orgUsername, connectedApps, command, 'deploy', async () => {
    if (!orgUsername) return; // This should never happen due to validation, but TypeScript needs it

    await performConnectedAppOperationWithManifest(
      orgUsername,
      connectedApps,
      command,
      'deploy',
      async (manifestPath, orgUsername, command) => {
        await execCommand(
          `sf project deploy start --manifest ${manifestPath} --target-org ${orgUsername} --ignore-warnings --json`,
          command,
          { output: true, fail: true }
        );
      }
    );
  });
}

export function toConnectedAppFormat(apps: Array<{ fullName: string; fileName?: string; filePath?: string; }>): ConnectedApp[] {
  return apps.map(app => {
    return {
      fullName: app.fullName,
      fileName: app.fileName || app.fullName || (app.filePath ? path.basename(app.filePath, '.connectedApp-meta.xml') : app.fullName),
      type: 'ConnectedApp'
    };
  });
}

export function validateConnectedApps(
  requestedApps: string[],
  availableApps: string[],
  command: SfCommand<any>,
  context: 'org' | 'project'
): { missingApps: string[], validApps: string[] } {
  // Case-insensitive matching for app names
  const missingApps = requestedApps.filter(name =>
    !availableApps.some(availableName =>
      availableName.toLowerCase() === name.toLowerCase()
    )
  );

  if (missingApps.length > 0) {
    const errorMsg = `The following Connected App(s) could not be found in the ${context}: ${missingApps.join(', ')}`;
    uxLog("error", command, c.red(errorMsg));

    if (availableApps.length > 0) {
      uxLog("warning", command, c.yellow(`Available Connected Apps in the ${context}:`));
      availableApps.forEach(name => {
        uxLog("log", command, c.grey(`  - ${name}`));
      });

      // Suggest similar names to help the user
      missingApps.forEach(missingApp => {
        const similarNames = availableApps
          .filter(name =>
            name.toLowerCase().includes(missingApp.toLowerCase()) ||
            missingApp.toLowerCase().includes(name.toLowerCase())
          )
          .slice(0, 3);

        if (similarNames.length > 0) {
          uxLog("warning", command, c.yellow(`Did you mean one of these instead of "${missingApp}"?`));
          similarNames.forEach(name => {
            uxLog("log", command, c.grey(`  - ${name}`));
          });
        }
      });
    } else {
      uxLog("warning", command, c.yellow(`No Connected Apps were found in the ${context}.`));
    }

    uxLog("warning", command, c.yellow('Please check the app name(s) and try again.'));
    throw new Error(errorMsg);
  }

  // Return the list of valid apps
  const validApps = requestedApps.filter(name =>
    availableApps.some(availableName =>
      availableName.toLowerCase() === name.toLowerCase()
    )
  );

  return { missingApps, validApps };
}

export function validateConnectedAppParams(
  orgUsername: string | undefined,
  connectedApps: Array<any>
): void {
  if (!orgUsername) {
    throw new Error('Organization username is required');
  }
  if (!connectedApps || connectedApps.length === 0) {
    throw new Error('No Connected Apps specified');
  }
}

export async function promptForConnectedAppSelection<T extends { fullName: string }>(
  connectedApps: T[],
  promptMessage: string,
  command: SfCommand<any>
): Promise<T[]> {
  // Create choices for the prompt
  const choices = connectedApps.map(app => {
    return { title: app.fullName, value: app.fullName };
  });

  // Prompt user for selection
  const promptResponse = await prompts({
    type: 'multiselect',
    name: 'selectedApps',
    message: promptMessage,
    description: 'Select Connected Apps to process',
    choices: choices
  });

  if (!promptResponse.selectedApps || promptResponse.selectedApps.length === 0) {
    return [];
  }

  // Filter apps based on selection
  const selectedApps = connectedApps.filter(app =>
    promptResponse.selectedApps.includes(app.fullName)
  );

  uxLog("action", command, c.cyan(`Processing ${selectedApps.length} Connected App(s)`));
  return selectedApps;
}

export async function findConnectedAppFile(
  appName: string,
  command: SfCommand<any>
): Promise<string | null> {
  uxLog("action", command, c.cyan(`Searching for Connected App: ${appName}`));

  try {
    // First, try an exact case-sensitive match
    const exactPattern = `**/${appName}.connectedApp-meta.xml`;
    const exactMatches = await glob(exactPattern, { ignore: GLOB_IGNORE_PATTERNS });

    if (exactMatches.length > 0) {
      uxLog("success", command, c.green(`✓ Found Connected App: ${exactMatches[0]}`));
      return exactMatches[0];
    }

    // Try standard locations with possible name variations
    const possiblePaths = [
      `force-app/main/default/connectedApps/${appName}.connectedApp-meta.xml`,
      `force-app/main/default/connectedApps/${appName.replace(/\s/g, '_')}.connectedApp-meta.xml`,
      `force-app/main/default/connectedApps/${appName.replace(/\s/g, '')}.connectedApp-meta.xml`
    ];

    for (const potentialPath of possiblePaths) {
      if (fs.existsSync(potentialPath)) {
        uxLog("success", command, c.green(`✓ Found Connected App at standard path: ${potentialPath}`));
        return potentialPath;
      }
    }

    // If no exact match, try case-insensitive search by getting all ConnectedApp files
    uxLog("warning", command, c.yellow(`No exact match found, trying case-insensitive search...`));
    const allConnectedAppFiles = await glob('**/*.connectedApp-meta.xml', { ignore: GLOB_IGNORE_PATTERNS });

    if (allConnectedAppFiles.length === 0) {
      uxLog("error", command, c.red(`No Connected App files found in the project.`));
      return null;
    }

    // Find a case-insensitive match
    const caseInsensitiveMatch = allConnectedAppFiles.find(file => {
      const baseName = path.basename(file, '.connectedApp-meta.xml');
      return baseName.toLowerCase() === appName.toLowerCase() ||
        baseName.toLowerCase() === appName.toLowerCase().replace(/\s/g, '_') ||
        baseName.toLowerCase() === appName.toLowerCase().replace(/\s/g, '');
    });

    if (caseInsensitiveMatch) {
      uxLog("success", command, c.green(`✓ Found case-insensitive match: ${caseInsensitiveMatch}`));
      return caseInsensitiveMatch;
    }

    // If still not found, list available Connected Apps
    uxLog("error", command, c.red(`✗ Could not find Connected App "${appName}"`));
    uxLog("warning", command, c.yellow('Available Connected Apps:'));
    allConnectedAppFiles.forEach(file => {
      const baseName = path.basename(file, '.connectedApp-meta.xml');
      uxLog("log", command, c.grey(`  - ${baseName}`));
    });

    return null;
  } catch (error) {
    uxLog("error", command, c.red(`Error searching for Connected App: ${error}`));
    return null;
  }
}

export async function selectConnectedAppsForProcessing<T extends { fullName: string }>(
  connectedApps: T[],
  processAll: boolean,
  nameFilter: string | undefined,
  promptMessage: string,
  command: SfCommand<any>
): Promise<T[]> {
  // Display found Connected Apps
  uxLog("log", command, c.cyan(`Found ${connectedApps.length} Connected App(s)`));
  connectedApps.forEach(app => {
    uxLog("log", command, `${c.green(app.fullName)} (${(app as any).fileName || (app as any).filePath || ''})`);
  });

  // If all flag or name is provided, use all connected apps from the list without prompting
  if (processAll || nameFilter) {
    const selectionReason = processAll ? 'all flag' : 'name filter';
    uxLog("action", command, c.cyan(`Processing ${connectedApps.length} Connected App(s) based on ${selectionReason}`));
    return connectedApps;
  }

  // Otherwise, prompt for selection
  return await promptForConnectedAppSelection(
    connectedApps,
    promptMessage,
    command
  );
}

export async function withConnectedAppValidation(
  orgUsername: string | undefined,
  connectedApps: ConnectedApp[],
  command: SfCommand<any>,
  operationName: string,
  operationFn: () => Promise<void>
): Promise<void> {
  try {
    validateConnectedAppParams(orgUsername, connectedApps);
  } catch (error: any) {
    uxLog("log", command, c.yellow(`Skipping ${operationName} operation: ${error.message}`));
    return;
  }

  await operationFn();
}

export async function performConnectedAppOperationWithManifest(
  orgUsername: string,
  connectedApps: ConnectedApp[],
  command: SfCommand<any>,
  operationName: 'retrieve' | 'deploy',
  commandFn: (manifestPath: string, orgUsername: string, command: SfCommand<any>) => Promise<void>
): Promise<void> {
  // Use withConnectedAppIgnoreHandling to handle .forceignore modifications
  await withConnectedAppIgnoreHandling(async () => {
    // Create a manifest for the Connected Apps
    const { manifestPath, tmpDir } = await createConnectedAppManifest(connectedApps, command);

    // Execute the operation using the manifest
    uxLog("action", command, c.cyan(`${operationName === 'retrieve' ? 'Retrieving' : 'Deploying'} ${connectedApps.length} Connected App(s) ${operationName === 'retrieve' ? 'from' : 'to'} org...`));

    try {
      await commandFn(manifestPath, orgUsername, command);

      // Wait a moment to ensure files are written to disk (especially for retrieve operations)
      if (operationName === 'retrieve') {
        uxLog("log", command, c.grey('Waiting for files to be written to disk...'));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      throw new Error(`Failed to ${operationName} Connected Apps: ${error.message || String(error)}`);
    }

    // Clean up
    await fs.remove(tmpDir);
    uxLog("log", command, c.grey('Removed temporary manifest file'));
  }, command);
}

export function createConnectedAppSuccessResponse(
  message: string,
  processedApps: string[],
  additionalData: Record<string, any> = {}
): { success: true; message: string; connectedAppsProcessed: string[] } & Record<string, any> {
  return {
    success: true,
    message,
    connectedAppsProcessed: processedApps,
    ...additionalData
  };
}

export function handleConnectedAppError(
  error: any,
  command: SfCommand<any>
): { success: false; error: string } {
  const errorMessage = error.message || JSON.stringify(error);
  uxLog("error", command, c.red(`Error: ${errorMessage}`));
  return { success: false, error: errorMessage };
}
