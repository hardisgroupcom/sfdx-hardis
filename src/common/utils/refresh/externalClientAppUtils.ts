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

// Define interface for External Client App metadata
export interface ExternalClientApp {
  fullName: string;
  fileName: string;
  type: string;
  clientId?: string;
  clientSecret?: string;
}

// External Client App metadata types
export const ECA_METADATA_TYPES = [
  'ExternalClientApplication',
  'ExtlClntAppOauthSettings',
  'ExtlClntAppGlobalOauthSettings'
];

export function generateExternalClientAppPackageXml(externalClientApps: ExternalClientApp[]): any {
  return {
    Package: {
      $: {
        xmlns: 'http://soap.sforce.com/2006/04/metadata'
      },
      types: [
        {
          members: externalClientApps.map(app => app.fullName),
          name: ['ExternalClientApplication']
        },
        {
          members: externalClientApps.map(app => `${app.fullName}OAuthSettings`),
          name: ['ExtlClntAppOauthSettings']
        },
        {
          members: externalClientApps.map(app => `${app.fullName}GlblOAuth`),
          name: ['ExtlClntAppGlobalOauthSettings']
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

export async function createExternalClientAppManifest(
  externalClientApps: ExternalClientApp[],
  command: SfCommand<any>
): Promise<{ manifestPath: string; tmpDir: string }> {
  // Create a temporary directory for the manifest
  const tmpDir = await createTempDir();
  const manifestPath = path.join(tmpDir, 'external-client-apps-manifest.xml');

  // Generate and write the package.xml content
  const packageXml = generateExternalClientAppPackageXml(externalClientApps);
  await writeXmlFile(manifestPath, packageXml);

  // Display the XML content for the manifest
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  uxLog("log", command, c.cyan(`package.xml manifest for ${externalClientApps.length} External Client App(s):\n${manifestContent}`));

  return { manifestPath, tmpDir };
}

export async function withExternalClientAppIgnoreHandling<T>(
  operationFn: (backupInfo: {
    forceignorePath: string;
    originalContent: string;
    tempBackupPath: string
  } | null) => Promise<T>,
  command: SfCommand<any>
): Promise<T> {
  // Temporarily modify .forceignore to allow External Client App operations
  const backupInfo = await disableExternalClientAppIgnore(command);

  try {
    // Perform the operation
    return await operationFn(backupInfo);
  } finally {
    // Always restore .forceignore
    await restoreExternalClientAppIgnore(backupInfo, command);
  }
}

export async function createDestructiveChangesManifest(
  externalClientApps: ExternalClientApp[],
  command: SfCommand<any>
): Promise<{ destructiveChangesPath: string; packageXmlPath: string; tmpDir: string }> {
  // Create a temporary directory for the manifest
  const tmpDir = await createTempDir();
  const destructiveChangesPath = path.join(tmpDir, 'destructiveChanges.xml');
  const packageXmlPath = path.join(tmpDir, 'package.xml');

  // Generate destructiveChanges.xml using the External Client App Package XML generator
  const destructiveChangesXml = generateExternalClientAppPackageXml(externalClientApps);

  // Generate empty package.xml required for deployment
  const packageXml = generateEmptyPackageXml();

  await writeXmlFile(destructiveChangesPath, destructiveChangesXml);
  await writeXmlFile(packageXmlPath, packageXml);

  // Display the XML content for destructive changes
  const destructiveXmlContent = await fs.readFile(destructiveChangesPath, 'utf8');
  uxLog("log", command, c.cyan(`Destructive changes XML for deleting ${externalClientApps.length} External Client App(s):\n${destructiveXmlContent}`));

  return { destructiveChangesPath, packageXmlPath, tmpDir };
}

export async function deleteExternalClientApps(
  orgUsername: string | undefined,
  externalClientApps: ExternalClientApp[],
  command: SfCommand<any>,
  saveProjectPath: string
): Promise<void> {
  await withExternalClientAppValidation(orgUsername, externalClientApps, command, 'delete', async () => {
    if (!orgUsername) return; // This should never happen due to validation, but TypeScript needs it

    // Use withExternalClientAppIgnoreHandling to handle .forceignore modifications
    await withExternalClientAppIgnoreHandling(async () => {
      // Create destructive changes manifests
      const { destructiveChangesPath, packageXmlPath, tmpDir } =
        await createDestructiveChangesManifest(externalClientApps, command);

      // Deploy the destructive changes
      uxLog("log", command, c.grey(`Deploying destructive changes to delete ${externalClientApps.length} External Client App(s) from org...`));
      try {
        await execCommand(
          `sf project deploy start --manifest ${packageXmlPath} --post-destructive-changes ${destructiveChangesPath} --target-org ${orgUsername} --ignore-warnings --ignore-conflicts --json`,
          command,
          { output: true, fail: true, cwd: saveProjectPath }
        );
      } catch (deleteError: any) {
        throw new Error(`Failed to delete External Client Apps: ${deleteError.message || String(deleteError)}`);
      }

      // Clean up
      await fs.remove(tmpDir);
      uxLog("log", command, c.grey('Removed temporary deployment files.'));
    }, command);
  });
}

export async function disableExternalClientAppIgnore(command: SfCommand<any>): Promise<{
  forceignorePath: string;
  originalContent: string;
  tempBackupPath: string
} | null> {
  const forceignorePath = path.join(process.cwd(), '.forceignore');

  // Check if .forceignore exists
  if (!await fs.pathExists(forceignorePath)) {
    uxLog("log", command, c.grey('No .forceignore file found; no modification needed.'));
    return null;
  }

  // Create backup
  const tempBackupPath = path.join(process.cwd(), '.forceignore.backup.eca');
  const originalContent = await fs.readFile(forceignorePath, 'utf8');
  await fs.writeFile(tempBackupPath, originalContent);

  // Read content and remove lines that would ignore External Client Apps
  const lines = originalContent.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim().toLowerCase();
    return !(
      trimmedLine.includes('externalclientapp') ||
      trimmedLine.includes('extlclntapp') ||
      trimmedLine.includes('externalclientapplication') ||
      trimmedLine.includes('ecaoauth') ||
      trimmedLine.includes('ecaglbloauth')
    );
  });

  // Check if any lines were filtered out
  if (lines.length === filteredLines.length) {
    uxLog("log", command, c.grey('No External Client App ignore patterns found in .forceignore.'));
    return { forceignorePath, originalContent, tempBackupPath };
  }

  // Write modified .forceignore
  await fs.writeFile(forceignorePath, filteredLines.join('\n'));
  uxLog("warning", command, c.cyan('Temporarily modified .forceignore to allow External Client App metadata operations.'));

  return { forceignorePath, originalContent, tempBackupPath };
}

export async function restoreExternalClientAppIgnore(
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
      uxLog("log", command, c.grey('Restored original .forceignore file.'));
    }
  } catch (error) {
    uxLog("warning", command, c.yellow(`Error restoring .forceignore: ${error}`));
  }
}

export async function retrieveExternalClientApps(
  orgUsername: string | undefined,
  externalClientApps: ExternalClientApp[],
  command: SfCommand<any>,
  saveProjectPath: string
): Promise<void> {
  await withExternalClientAppValidation(orgUsername, externalClientApps, command, 'retrieve', async () => {
    if (!orgUsername) return; // This should never happen due to validation, but TypeScript needs it

    await performExternalClientAppOperationWithManifest(
      orgUsername,
      externalClientApps,
      command,
      'retrieve',
      async (manifestPath, orgUsername, command) => {
        await execCommand(
          `sf project retrieve start --manifest ${manifestPath} --target-org ${orgUsername} --ignore-conflicts --json`,
          command,
          { output: true, fail: true, cwd: saveProjectPath }
        );
      }
    );
  });
}

export async function deployExternalClientApps(
  orgUsername: string | undefined,
  externalClientApps: ExternalClientApp[],
  command: SfCommand<any>,
  saveProjectPath: string
): Promise<void> {
  await withExternalClientAppValidation(orgUsername, externalClientApps, command, 'deploy', async () => {
    if (!orgUsername) return; // This should never happen due to validation, but TypeScript needs it

    await performExternalClientAppOperationWithManifest(
      orgUsername,
      externalClientApps,
      command,
      'deploy',
      async (manifestPath, orgUsername, command) => {
        await execCommand(
          `sf project deploy start --manifest ${manifestPath} --target-org ${orgUsername} --ignore-warnings --json`,
          command,
          { output: true, fail: true, cwd: saveProjectPath }
        );
      }
    );
  });
}

export function toExternalClientAppFormat(apps: Array<{ fullName: string; fileName?: string; filePath?: string; }>): ExternalClientApp[] {
  return apps.map(app => {
    return {
      fullName: app.fullName,
      fileName: app.fileName || app.fullName || (app.filePath ? path.basename(app.filePath, '.eca-meta.xml') : app.fullName),
      type: 'ExternalClientApplication'
    };
  });
}

export function validateExternalClientApps(
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
    const errorMsg = `The following External Client App(s) could not be found in the ${context}: ${missingApps.join(', ')}`;
    uxLog("error", command, c.red(errorMsg));

    if (availableApps.length > 0) {
      uxLog("warning", command, c.yellow(`Available External Client Apps in the ${context}:`));
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
      uxLog("warning", command, c.yellow(`No External Client Apps were found in the ${context}.`));
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

export function validateExternalClientAppParams(
  orgUsername: string | undefined,
  externalClientApps: Array<any>
): void {
  if (!orgUsername) {
    throw new Error('Organization username is required');
  }
  if (!externalClientApps || externalClientApps.length === 0) {
    throw new Error('No External Client Apps specified');
  }
}

export async function promptForExternalClientAppSelection<T extends { fullName: string }>(
  externalClientApps: T[],
  initialSelection: string[] = [],
  promptMessage: string
): Promise<T[]> {
  // Create choices for the prompt
  const choices = externalClientApps.map(app => {
    return { title: app.fullName, value: app.fullName };
  });

  // Prompt user for selection
  const promptResponse = await prompts({
    type: 'multiselect',
    name: 'selectedApps',
    message: promptMessage,
    description: 'Select External Client Apps to process.',
    choices: choices,
    initial: initialSelection,
  });

  if (!promptResponse.selectedApps || promptResponse.selectedApps.length === 0) {
    return [];
  }

  // Filter apps based on selection
  const selectedApps = externalClientApps.filter(app =>
    promptResponse.selectedApps.includes(app.fullName)
  );

  return selectedApps;
}

export async function findExternalClientAppFile(
  appName: string,
  command: SfCommand<any>,
  saveProjectPath: string
): Promise<string | null> {
  uxLog("other", command, c.cyan(`Searching for External Client App: ${appName}.`));
  try {
    // First, try an exact case-sensitive match
    const exactPattern = `**/${appName}.eca-meta.xml`;
    const exactMatches = await glob(exactPattern, { ignore: GLOB_IGNORE_PATTERNS, cwd: saveProjectPath });

    if (exactMatches.length > 0) {
      uxLog("success", command, c.green(`✓ Found External Client App: ${exactMatches[0]}`));
      return path.join(saveProjectPath, exactMatches[0]);
    }

    // Try standard locations with possible name variations
    const possiblePaths = [
      path.join(saveProjectPath, `force-app/main/default/externalClientApps/${appName}.eca-meta.xml`),
      path.join(saveProjectPath, `force-app/main/default/externalClientApps/${appName.replace(/\s/g, '_')}.eca-meta.xml`),
      path.join(saveProjectPath, `force-app/main/default/externalClientApps/${appName.replace(/\s/g, '')}.eca-meta.xml`)
    ];

    for (const potentialPath of possiblePaths) {
      if (fs.existsSync(potentialPath)) {
        uxLog("success", command, c.green(`✓ Found External Client App at standard path: ${potentialPath}`));
        return potentialPath;
      }
    }

    // If no exact match, try case-insensitive search by getting all ECA files
    uxLog("warning", command, c.yellow(`No exact match found; trying case-insensitive search...`));
    const allEcaFiles = await glob('**/*.eca-meta.xml', { ignore: GLOB_IGNORE_PATTERNS, cwd: saveProjectPath });

    if (allEcaFiles.length === 0) {
      uxLog("error", command, c.red(`No External Client App files found in the project.`));
      return null;
    }

    // Find a case-insensitive match
    const caseInsensitiveMatch = allEcaFiles.find(file => {
      const baseName = path.basename(file, '.eca-meta.xml');
      return baseName.toLowerCase() === appName.toLowerCase() ||
        baseName.toLowerCase() === appName.toLowerCase().replace(/\s/g, '_') ||
        baseName.toLowerCase() === appName.toLowerCase().replace(/\s/g, '');
    });

    if (caseInsensitiveMatch) {
      uxLog("success", command, c.green(`✓ Found case-insensitive match: ${caseInsensitiveMatch}`));
      return path.join(saveProjectPath, caseInsensitiveMatch);
    }

    // If still not found, list available External Client Apps
    uxLog("error", command, c.red(`✗ Could not find External Client App "${appName}".`));
    const allEcaNames = allEcaFiles.map(file => "- " + path.basename(file, '.eca-meta.xml')).join('\n');
    uxLog("warning", command, c.yellow(`Available External Client Apps:\n${allEcaNames}`));

    return null;
  } catch (error) {
    uxLog("error", command, c.red(`Error searching for External Client App: ${error}.`));
    return null;
  }
}

export async function selectExternalClientAppsForProcessing<T extends { fullName: string }>(
  externalClientApps: T[],
  initialSelection: string[] = [],
  processAll: boolean,
  nameFilter: string | undefined,
  promptMessage: string,
  command: SfCommand<any>
): Promise<T[]> {

  // If all flag or name is provided, use all External Client Apps from the list without prompting
  if (processAll || nameFilter) {
    const selectionReason = processAll ? 'all flag' : 'name filter';
    uxLog("action", command, c.cyan(`Processing ${externalClientApps.length} External Client App(s) based on ${selectionReason}.`));
    return externalClientApps;
  }

  // Otherwise, prompt for selection
  return await promptForExternalClientAppSelection(
    externalClientApps,
    initialSelection,
    promptMessage
  );
}

export async function withExternalClientAppValidation(
  orgUsername: string | undefined,
  externalClientApps: ExternalClientApp[],
  command: SfCommand<any>,
  operationName: string,
  operationFn: () => Promise<void>
): Promise<void> {
  try {
    validateExternalClientAppParams(orgUsername, externalClientApps);
  } catch (error: any) {
    uxLog("log", command, c.yellow(`Skipping ${operationName} operation: ${error.message}`));
    return;
  }

  await operationFn();
}

export async function performExternalClientAppOperationWithManifest(
  orgUsername: string,
  externalClientApps: ExternalClientApp[],
  command: SfCommand<any>,
  operationName: 'retrieve' | 'deploy',
  commandFn: (manifestPath: string, orgUsername: string, command: SfCommand<any>) => Promise<void>
): Promise<void> {
  // Use withExternalClientAppIgnoreHandling to handle .forceignore modifications
  await withExternalClientAppIgnoreHandling(async () => {
    // Create a manifest for the External Client Apps
    const { manifestPath, tmpDir } = await createExternalClientAppManifest(externalClientApps, command);

    // Execute the operation using the manifest
    uxLog("log", command, c.cyan(`${operationName === 'retrieve' ? 'Retrieving' : 'Deploying'} ${externalClientApps.length} External Client App(s) ${operationName === 'retrieve' ? 'from' : 'to'} org...`));

    try {
      await commandFn(manifestPath, orgUsername, command);

      // Wait a moment to ensure files are written to disk (especially for retrieve operations)
      if (operationName === 'retrieve') {
        uxLog("log", command, c.grey('Waiting for files to be written to disk...'));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      throw new Error(`Failed to ${operationName} External Client Apps: ${error.message || String(error)}`);
    }

    // Clean up
    await fs.remove(tmpDir);
    uxLog("log", command, c.grey('Removed temporary manifest file.'));
  }, command);
}

export function createExternalClientAppSuccessResponse(
  message: string,
  processedApps: string[],
  additionalData: Record<string, any> = {}
): { success: true; message: string; externalClientAppsProcessed: string[] } & Record<string, any> {
  return {
    success: true,
    message,
    externalClientAppsProcessed: processedApps,
    ...additionalData
  };
}

export function handleExternalClientAppError(
  error: any,
  command: SfCommand<any>
): { success: false; error: string } {
  const errorMessage = error.message || JSON.stringify(error);
  uxLog("error", command, c.red(`Error: ${errorMessage}`));
  return { success: false, error: errorMessage };
}
