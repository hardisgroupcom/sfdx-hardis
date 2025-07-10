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

/**
 * Generate a package.xml object for Connected Apps
 * @param connectedApps - Array of ConnectedApp objects
 * @returns Object representing package.xml content
 */
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

/**
 * Generate an empty package.xml object (used for destructive changes)
 * @returns Object representing empty package.xml content
 */
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

/**
 * Create a temporary manifest file for Connected Apps
 * @param connectedApps - Array of ConnectedApp objects
 * @param command - Command context for logging
 * @returns Promise with path to the manifest file and temp directory
 */
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
  uxLog(command, c.cyan(`Package.xml manifest for ${connectedApps.length} Connected App(s):`));
  uxLog(command, c.yellow('----------------------------------------'));
  uxLog(command, manifestContent);
  uxLog(command, c.yellow('----------------------------------------'));
  
  return { manifestPath, tmpDir };
}

/**
 * Handle Connected App operations with proper .forceignore management
 * @param operationFn - Function to perform the operation
 * @param command - Command context for logging
 * @returns Promise with result of the operation
 */
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

/**
 * Delete Connected Apps from org using destructive changes
 * @param orgUsername - Username of the target org
 * @param connectedApps - Array of ConnectedApp objects to delete
 * @param command - Command context for logging
 * @returns Promise<void>
 */
export async function deleteConnectedApps(
  orgUsername: string | undefined, 
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<void> {
  try {
    validateConnectedAppParams(orgUsername, connectedApps);
  } catch (error: any) {
    uxLog(command, c.yellow(`Skipping delete operation: ${error.message}`));
    return;
  }
  
  // Use withConnectedAppIgnoreHandling to handle .forceignore modifications
  await withConnectedAppIgnoreHandling(async () => {
    // Create a destructive changes XML file
    const tmpDir = await createTempDir();
    const destructiveChangesXmlPath = path.join(tmpDir, 'destructiveChanges.xml');
    const packageXmlPath = path.join(tmpDir, 'package.xml');
    
    // Generate destructiveChanges.xml using the Connected App Package XML generator
    const destructiveChangesXml = generateConnectedAppPackageXml(connectedApps);
    
    // Generate empty package.xml required for deployment
    const packageXml = generateEmptyPackageXml();
    
    await writeXmlFile(destructiveChangesXmlPath, destructiveChangesXml);
    await writeXmlFile(packageXmlPath, packageXml);
    
    // Display the XML content for destructive changes
    const destructiveXmlContent = await fs.readFile(destructiveChangesXmlPath, 'utf8');
    uxLog(command, c.cyan(`Destructive Changes XML for deleting ${connectedApps.length} Connected App(s):`));
    uxLog(command, c.yellow('----------------------------------------'));
    uxLog(command, destructiveXmlContent);
    uxLog(command, c.yellow('----------------------------------------'));
    
    // Display the XML content for the empty package.xml
    const packageXmlContent = await fs.readFile(packageXmlPath, 'utf8');
    uxLog(command, c.cyan('Empty Package.xml for deployment:'));
    uxLog(command, c.yellow('----------------------------------------'));
    uxLog(command, packageXmlContent);
    uxLog(command, c.yellow('----------------------------------------'));
    
    // Deploy the destructive changes
    uxLog(command, c.cyan(`Deleting ${connectedApps.length} Connected App(s) from org...`));
    await execCommand(
      `sf project deploy start --manifest ${packageXmlPath} --post-destructive-changes ${destructiveChangesXmlPath} --target-org ${orgUsername} --ignore-warnings --ignore-conflicts --json`,
      command,
      { output: true, fail: true }
    );
    
    // Clean up
    await fs.remove(tmpDir);
    uxLog(command, c.grey('Removed temporary deployment files'));
  }, command);
}

/**
 * Temporarily modify .forceignore to allow retrieving Connected Apps
 * @param command - Command context for logging
 * @returns Object with original content and backup path, or null if no .forceignore exists
 */
export async function disableConnectedAppIgnore(command: SfCommand<any>): Promise<{ 
  forceignorePath: string; 
  originalContent: string; 
  tempBackupPath: string 
} | null> {
  const forceignorePath = path.join(process.cwd(), '.forceignore');
  
  // Check if .forceignore exists
  if (!await fs.pathExists(forceignorePath)) {
    uxLog(command, c.grey('No .forceignore file found, no modification needed'));
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
    uxLog(command, c.grey('No Connected App ignore patterns found in .forceignore'));
    return { forceignorePath, originalContent, tempBackupPath };
  }
  
  // Write modified .forceignore
  await fs.writeFile(forceignorePath, filteredLines.join('\n'));
  uxLog(command, c.cyan('Temporarily modified .forceignore to allow Connected App retrieval'));
  
  return { forceignorePath, originalContent, tempBackupPath };
}

/**
 * Restore original .forceignore content after retrieval
 * @param backupInfo - Object containing backup information, or null if no backup was made
 * @param command - Command context for logging
 */
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
      uxLog(command, c.grey('Restored original .forceignore file'));
    }
  } catch (error) {
    uxLog(command, c.yellow(`Error restoring .forceignore: ${error}`));
  }
}

/**
 * Retrieve Connected Apps from org using a package.xml manifest
 * @param orgUsername - Username of the target org
 * @param connectedApps - Array of ConnectedApp objects to retrieve
 * @param command - Command context for logging
 * @returns Promise<void>
 */
export async function retrieveConnectedApps(
  orgUsername: string | undefined,
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<void> {
  try {
    validateConnectedAppParams(orgUsername, connectedApps);
  } catch (error: any) {
    uxLog(command, c.yellow(`Skipping retrieve operation: ${error.message}`));
    return;
  }

  // Use withConnectedAppIgnoreHandling to handle .forceignore modifications
  await withConnectedAppIgnoreHandling(async () => {
    // Create a manifest for the Connected Apps
    const { manifestPath, tmpDir } = await createConnectedAppManifest(connectedApps, command);
    
    // Retrieve the Connected Apps using the manifest
    uxLog(command, c.cyan(`Retrieving ${connectedApps.length} Connected App(s) from org...`));
    await execCommand(
      `sf project retrieve start --manifest ${manifestPath} --target-org ${orgUsername} --ignore-conflicts --json`,
      command,
      { output: true, fail: true }
    );
    
    // Wait a moment to ensure files are written to disk
    uxLog(command, c.grey('Waiting for files to be written to disk...'));
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Clean up
    await fs.remove(tmpDir);
    uxLog(command, c.grey('Removed temporary manifest file'));
  }, command);
}

/**
 * Deploy Connected Apps to the org using a package.xml manifest
 * @param orgUsername - Username of the target org
 * @param connectedApps - Array of ConnectedApp objects to deploy
 * @param command - Command context for logging
 * @returns Promise<void>
 */
export async function deployConnectedApps(
  orgUsername: string | undefined,
  connectedApps: ConnectedApp[],
  command: SfCommand<any>
): Promise<void> {
  try {
    validateConnectedAppParams(orgUsername, connectedApps);
  } catch (error: any) {
    uxLog(command, c.yellow(`Skipping deploy operation: ${error.message}`));
    return;
  }

  // Use withConnectedAppIgnoreHandling to handle .forceignore modifications
  await withConnectedAppIgnoreHandling(async () => {
    // Create a manifest for the Connected Apps
    const { manifestPath, tmpDir } = await createConnectedAppManifest(connectedApps, command);
    
    // Deploy the Connected Apps using the manifest
    uxLog(command, c.cyan(`Deploying ${connectedApps.length} Connected App(s) to org...`));
    try {
      await execCommand(
        `sf project deploy start --manifest ${manifestPath} --target-org ${orgUsername} --ignore-warnings --json`,
        command,
        { output: true, fail: true }
      );
    } catch (deployError: any) {
      throw new Error(`Failed to deploy Connected Apps: ${deployError.message || String(deployError)}`);
    }
    
    // Clean up
    await fs.remove(tmpDir);
    uxLog(command, c.grey('Removed temporary manifest file'));
  }, command);
}

/**
 * Convert any connected app format to the standard ConnectedApp interface
 * This utility makes it easier to convert between different formats of connected app objects
 * @param apps - Array of objects with at least a fullName property
 * @returns Array of ConnectedApp objects
 */
export function toConnectedAppFormat(apps: Array<{ fullName: string; fileName?: string; filePath?: string; }>): ConnectedApp[] {
  return apps.map(app => {
    return {
      fullName: app.fullName,
      fileName: app.fileName || app.fullName || (app.filePath ? path.basename(app.filePath, '.connectedApp-meta.xml') : app.fullName),
      type: 'ConnectedApp'
    };
  });
}

/**
 * Shared utility functions for Connected App operations
 */

/**
 * Common validation function to check if Connected Apps exist and provide helpful error messages
 * @param requestedApps - Array of requested app names
 * @param availableApps - Array of available app names
 * @param command - Command context for logging
 * @param context - Context string to indicate whether checking in "org" or "project"
 * @returns { missingApps, validApps } - Arrays of missing and valid app names
 * @throws Error if any apps are missing
 */
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
    uxLog(command, c.red(errorMsg));
    
    if (availableApps.length > 0) {
      uxLog(command, c.yellow(`Available Connected Apps in the ${context}:`));
      availableApps.forEach(name => {
        uxLog(command, c.grey(`  - ${name}`));
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
          uxLog(command, c.yellow(`Did you mean one of these instead of "${missingApp}"?`));
          similarNames.forEach(name => {
            uxLog(command, c.grey(`  - ${name}`));
          });
        }
      });
    } else {
      uxLog(command, c.yellow(`No Connected Apps were found in the ${context}.`));
    }
    
    uxLog(command, c.yellow('Please check the app name(s) and try again.'));
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

/**
 * Common function to validate Connected App operation parameters
 * @param orgUsername - Username of the target org
 * @param connectedApps - Array of ConnectedApp objects
 * @returns void
 * @throws Error if parameters are invalid
 */
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

/**
 * Common function to handle user prompt for Connected App selection
 * @param connectedApps - Array of available ConnectedApp objects
 * @param promptMessage - Message to display in the prompt
 * @param command - Command context for logging
 * @returns Promise<Array<T>> - Array of selected apps
 */
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
    choices: choices
  });
  
  if (!promptResponse.selectedApps || promptResponse.selectedApps.length === 0) {
    return [];
  }
  
  // Filter apps based on selection
  const selectedApps = connectedApps.filter(app => 
    promptResponse.selectedApps.includes(app.fullName)
  );
  
  uxLog(command, c.cyan(`Processing ${selectedApps.length} Connected App(s)`));
  return selectedApps;
}

/**
 * Find Connected App file in the project by app name
 * @param appName - Name of the Connected App to find
 * @param command - Command context for logging
 * @returns Promise<string | null> - Path to the Connected App file or null if not found
 */
export async function findConnectedAppFile(
  appName: string, 
  command: SfCommand<any>
): Promise<string | null> {
  uxLog(command, c.cyan(`Searching for Connected App: ${appName}`));
  
  try {
    // First, try an exact case-sensitive match
    const exactPattern = `**/${appName}.connectedApp-meta.xml`;
    const exactMatches = await glob(exactPattern, { ignore: GLOB_IGNORE_PATTERNS });
    
    if (exactMatches.length > 0) {
      uxLog(command, c.green(`✓ Found Connected App: ${exactMatches[0]}`));
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
        uxLog(command, c.green(`✓ Found Connected App at standard path: ${potentialPath}`));
        return potentialPath;
      }
    }
    
    // If no exact match, try case-insensitive search by getting all ConnectedApp files
    uxLog(command, c.yellow(`No exact match found, trying case-insensitive search...`));
    const allConnectedAppFiles = await glob('**/*.connectedApp-meta.xml', { ignore: GLOB_IGNORE_PATTERNS });
    
    if (allConnectedAppFiles.length === 0) {
      uxLog(command, c.red(`No Connected App files found in the project.`));
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
      uxLog(command, c.green(`✓ Found case-insensitive match: ${caseInsensitiveMatch}`));
      return caseInsensitiveMatch;
    }
    
    // If still not found, list available Connected Apps
    uxLog(command, c.red(`✗ Could not find Connected App "${appName}"`));
    uxLog(command, c.yellow('Available Connected Apps:'));
    allConnectedAppFiles.forEach(file => {
      const baseName = path.basename(file, '.connectedApp-meta.xml');
      uxLog(command, c.grey(`  - ${baseName}`));
    });
    
    return null;
  } catch (error) {
    uxLog(command, c.red(`Error searching for Connected App: ${error}`));
    return null;
  }
}
