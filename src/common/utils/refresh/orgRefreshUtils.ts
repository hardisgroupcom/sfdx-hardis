import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import { execCommand, createTempDir, uxLog } from '../index.js';
import { writeXmlFile } from '../xmlUtils.js';
import { CONSTANTS } from '../../../config/index.js';
import { SfCommand } from '@salesforce/sf-plugins-core';

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
      version: [CONSTANTS.API_VERSION]
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
      version: [CONSTANTS.API_VERSION]
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
 * Delete Connected Apps from the org using destructive changes deployment
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
  if (!orgUsername) {
    throw new Error('Organization username is required');
  }
  if (connectedApps.length === 0) return;
  
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
  if (!orgUsername) {
    throw new Error('Organization username is required');
  }
  if (connectedApps.length === 0) return;

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
  if (!orgUsername) {
    throw new Error('Organization username is required');
  }
  if (connectedApps.length === 0) return;

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
