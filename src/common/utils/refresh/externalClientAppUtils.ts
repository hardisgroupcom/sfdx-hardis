import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import open from 'open';
import { Browser, Page } from 'puppeteer-core';
import { execCommand, execSfdxJson, isCI, createTempDir, uxLog } from '../index.js';
import { parseXmlFile, writePackageXmlFile, writeXmlFile } from '../xmlUtils.js';
import { getApiVersion } from '../../../config/index.js';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { prompts } from '../prompts.js';
import { t } from '../i18n.js';
import { ConnectedApp, deleteConnectedApps } from './connectedAppUtils.js';

// The 5 metadata types that make up an External Client App
export const ECA_METADATA_TYPES = [
  'ExternalClientApplication',
  'ExtlClntAppOauthSettings',
  'ExtlClntAppGlobalOauthSettings',
  'ExtlClntAppOauthConfigurablePolicies',
  'ExtlClntAppConfigurablePolicies',
];

export function getEcaPackageContent(): Record<string, string[]> {
  return Object.fromEntries(ECA_METADATA_TYPES.map(t => [t, ['*']]));
}

/**
 * Returns the list of ECA names from .eca-meta.xml files in the save project.
 */
export function getEcaNames(saveProjectPath: string): string[] {
  const ecaFolder = path.join(saveProjectPath, 'force-app', 'main', 'default', 'externalClientApps');
  if (!fs.existsSync(ecaFolder)) {
    return [];
  }
  return fs.readdirSync(ecaFolder)
    .filter(f => f.endsWith('.eca-meta.xml'))
    .map(f => f.replace('.eca-meta.xml', ''));
}

/**
 * Retrieve External Client App metadata from org into the save project.
 */
export async function retrieveExternalClientApps(
  orgUsername: string,
  saveProjectPath: string,
  command: SfCommand<any>
): Promise<number> {
  const ecaPackageXml = path.join(saveProjectPath, 'manifest', 'package-eca-to-save.xml');
  await writePackageXmlFile(ecaPackageXml, getEcaPackageContent());

  uxLog("action", command, c.cyan(t('retrievingExternalClientAppsFromOrg')));
  await execCommand(
    `sf project retrieve start --manifest ${ecaPackageXml} --target-org ${orgUsername} --ignore-conflicts --json`,
    command,
    { output: true, fail: false, cwd: saveProjectPath }
  );

  const ecaNames = getEcaNames(saveProjectPath);
  return ecaNames.length;
}

/**
 * Verify credentials in ECA Global OAuth settings files.
 * If consumerSecret is missing, attempts browser extraction or manual entry.
 */
export async function verifyEcaCredentials(
  saveProjectPath: string,
  instanceUrl: string,
  browserContext: { browser: Browser; instanceUrl: string; accessToken: string } | null,
  command: SfCommand<any>
): Promise<void> {
  uxLog("action", command, c.cyan(t('checkingEcaCredentials')));

  const globalOauthFolder = path.join(saveProjectPath, 'force-app', 'main', 'default', 'extlClntAppGlobalOauthSets');
  if (!fs.existsSync(globalOauthFolder)) {
    uxLog("log", command, c.grey(t('ecaNoGlobalOauthFilesFound')));
    return;
  }

  const globalOauthFiles = fs.readdirSync(globalOauthFolder).filter(f => f.endsWith('.ecaGlblOauth-meta.xml'));
  if (globalOauthFiles.length === 0) {
    uxLog("log", command, c.grey(t('ecaNoGlobalOauthFilesFound')));
    return;
  }

  for (const oauthFile of globalOauthFiles) {
    const filePath = path.join(globalOauthFolder, oauthFile);
    const xmlData = await parseXmlFile(filePath);

    if (!xmlData?.ExtlClntAppGlobalOauthSettings) {
      continue;
    }

    const settings = xmlData.ExtlClntAppGlobalOauthSettings;
    const appName = settings.externalClientApplication?.[0] || oauthFile.replace('.ecaGlblOauth-meta.xml', '');
    const consumerKey = settings.consumerKey?.[0] || '';
    const consumerSecret = settings.consumerSecret?.[0] || '';

    if (consumerKey) {
      uxLog("log", command, c.grey(t('ecaConsumerKeyFound', { appName, consumerKey })));
    }

    // Check if consumer secret is present and non-empty
    if (consumerSecret && consumerSecret.trim() !== '') {
      uxLog("success", command, c.green(t('ecaConsumerSecretFound', { appName })));
      continue;
    }

    // Consumer secret is missing - try to extract it
    uxLog("warning", command, c.yellow(t('ecaConsumerSecretMissing', { appName })));

    let extractedSecret: string | null = null;

    // Try browser automation first
    if (browserContext?.browser) {
      uxLog("log", command, c.cyan(t('attemptingToExtractEcaConsumerSecret', { appName })));
      try {
        extractedSecret = await extractEcaConsumerSecret(browserContext.browser, instanceUrl, appName, command);
      } catch (e: any) {
        uxLog("warning", command, c.yellow(t('errorExtractingEcaConsumerSecret', { appName })));
      }
    }

    // If browser automation failed, prompt for manual entry
    if (!extractedSecret) {
      uxLog("action", command, c.cyan(t('ecaSetupUrlForConsumerSecret', { appName })));
      await open(`${instanceUrl}/lightning/setup/ExternalClientAppList/home`);

      const secretPromptResponse = await prompts({
        type: 'text',
        name: 'consumerSecret',
        message: t('enterConsumerSecretForEca', { appName }),
        description: t('ecaSetupUrlForConsumerSecret', { appName }),
      });

      if (secretPromptResponse.consumerSecret && secretPromptResponse.consumerSecret.trim() !== '') {
        extractedSecret = secretPromptResponse.consumerSecret.trim();
      }
    }

    // Write the consumer secret back into the XML file
    if (extractedSecret) {
      const xmlString = await fs.readFile(filePath, 'utf8');
      let updatedXmlString: string;
      if (xmlString.includes('<consumerSecret>')) {
        updatedXmlString = xmlString.replace(
          /<consumerSecret>.*?<\/consumerSecret>/,
          `<consumerSecret>${extractedSecret}</consumerSecret>`
        );
      } else if (xmlString.includes('<consumerKey>')) {
        updatedXmlString = xmlString.replace(
          /<consumerKey>.*?<\/consumerKey>/,
          `$&\n        <consumerSecret>${extractedSecret}</consumerSecret>`
        );
      } else {
        // Add consumerSecret before closing tag
        updatedXmlString = xmlString.replace(
          /<\/ExtlClntAppGlobalOauthSettings>/,
          `    <consumerSecret>${extractedSecret}</consumerSecret>\n</ExtlClntAppGlobalOauthSettings>`
        );
      }
      await fs.writeFile(filePath, updatedXmlString);
      uxLog("success", command, c.green(t('ecaConsumerSecretAddedSuccessfully', { appName })));
    } else {
      uxLog("warning", command, c.yellow(t('skippingEcaConsumerSecret', { appName })));
    }
  }
}

/**
 * Attempt to extract the External Client App consumer secret using Puppeteer.
 */
export async function extractEcaConsumerSecret(
  browser: Browser,
  instanceUrl: string,
  appName: string,
  command: SfCommand<any>
): Promise<string | null> {
  let page: Page | undefined;
  try {
    page = await browser.newPage();
    // Navigate to External Client App list page
    const ecaListUrl = `${instanceUrl}/lightning/setup/ExternalClientAppList/home`;
    await page.goto(ecaListUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });

    // Wait for the page to load and try to find the app link
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Look for the app link and click it
    const appLink = await page.$(`a[title="${appName}"]`);
    if (appLink) {
      await appLink.click();
      await page.waitForNavigation({ waitUntil: 'networkidle0' });
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to find and extract the consumer secret from the detail page
      const consumerSecretEl = await page.$('span[data-consumer-secret]');
      if (consumerSecretEl) {
        const secret = await page.evaluate(el => el.getAttribute('data-consumer-secret'), consumerSecretEl);
        if (secret) {
          uxLog("success", command, c.green(t('ecaConsumerSecretFound', { appName })));
          return secret;
        }
      }
    }

    return null;
  } catch (error) {
    return null;
  } finally {
    if (page) await page.close();
  }
}

/**
 * Delete External Client Apps from org using destructive changes.
 */
export async function deleteExternalClientApps(
  orgUsername: string,
  ecaNames: string[],
  saveProjectPath: string,
  command: SfCommand<any>,
  skipPrompt = false
): Promise<void> {
  if (ecaNames.length === 0) {
    return;
  }

  // Only check for global OAuth files - those are the ones with credentials
  const globalOauthFolder = path.join(saveProjectPath, 'force-app', 'main', 'default', 'extlClntAppGlobalOauthSets');
  if (!fs.existsSync(globalOauthFolder) || fs.readdirSync(globalOauthFolder).filter(f => f.endsWith('.ecaGlblOauth-meta.xml')).length === 0) {
    // No global OAuth settings means no credentials to protect - skip deletion
    return;
  }

  if (!skipPrompt && !isCI) {
    const ecaNamesStr = ecaNames.join(', ');
    const deletePrompt = await prompts({
      type: 'confirm',
      name: 'delete',
      message: t('doYouWantToDeleteExternalClientApps', { ecaNames: ecaNamesStr }),
      description: t('ifNotDeletedEcasWillRemainInOrg'),
      initial: false
    });
    if (!deletePrompt.delete) {
      return;
    }
  }

  uxLog("action", command, c.cyan(t('deletingExternalClientAppsFromOrg')));

  // Create destructive changes for ECA deletion
  const tmpDir = await createTempDir();
  const destructiveChangesPath = path.join(tmpDir, 'destructiveChanges.xml');
  const packageXmlPath = path.join(tmpDir, 'package.xml');

  // Build destructive changes XML
  const destructiveChangesXml = {
    Package: {
      $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' },
      types: [
        { members: ecaNames, name: ['ExternalClientApplication'] },
      ],
      version: [getApiVersion()]
    }
  };

  // Build empty package.xml
  const emptyPackageXml = {
    Package: {
      $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' },
      version: [getApiVersion()]
    }
  };

  await writeXmlFile(destructiveChangesPath, destructiveChangesXml);
  await writeXmlFile(packageXmlPath, emptyPackageXml);

  try {
    await execCommand(
      `sf project deploy start --manifest ${packageXmlPath} --post-destructive-changes ${destructiveChangesPath} --target-org ${orgUsername} --ignore-warnings --ignore-conflicts --json`,
      command,
      { output: true, fail: true, cwd: saveProjectPath }
    );
    uxLog("success", command, c.green(t('externalClientAppsDeletedSuccessfully')));
  } catch (deleteError: any) {
    uxLog("error", command, c.red(t('errorProcessing', { app: 'External Client Apps', error: deleteError.message || String(deleteError) })));
  }

  // Clean up
  await fs.remove(tmpDir);
}

/**
 * Deploy External Client Apps metadata to an org.
 */
export async function deployExternalClientApps(
  orgUsername: string,
  instanceUrl: string,
  saveProjectPath: string,
  command: SfCommand<any>
): Promise<void> {
  const ecaPackageXml = path.join(saveProjectPath, 'manifest', 'package-eca-to-restore.xml');
  await writePackageXmlFile(ecaPackageXml, getEcaPackageContent());

  uxLog("action", command, c.cyan(t('restoringExternalClientAppsToOrg', { instanceUrl })));
  await execCommand(
    `sf project deploy start --manifest ${ecaPackageXml} --target-org ${orgUsername} --json`,
    command,
    { output: true, fail: true, cwd: saveProjectPath }
  );
  uxLog("success", command, c.green(t('externalClientAppsRestoredSuccessfully', { instanceUrl })));
}

/**
 * Delete Connected Apps from the org that have the same name as External Client Apps
 * so they don't conflict during ECA restoration.
 */
export async function deleteConflictingConnectedApps(
  orgUsername: string,
  ecaNames: string[],
  saveProjectPath: string,
  command: SfCommand<any>
): Promise<void> {
  if (ecaNames.length === 0) {
    return;
  }

  // Query for Connected Apps with the same names as External Client Apps
  const listCommand = `sf org list metadata --metadata-type ConnectedApp --target-org ${orgUsername}`;
  const result = await execSfdxJson(listCommand, command, { output: false });
  const allConnectedApps: ConnectedApp[] = result?.result && Array.isArray(result.result) ? result.result : [];

  // Find Connected Apps with the same name as External Client Apps (case-insensitive)
  const conflicting = allConnectedApps.filter(ca =>
    ecaNames.some(ecaName => ecaName.toLowerCase() === ca.fullName.toLowerCase())
  );

  if (conflicting.length === 0) {
    return;
  }

  const names = conflicting.map(ca => ca.fullName).join(', ');
  uxLog("warning", command, c.yellow(t('conflictingConnectedAppsFound', { count: conflicting.length, names })));

  if (!isCI) {
    const deletePrompt = await prompts({
      type: 'confirm',
      name: 'delete',
      message: t('doYouWantToDeleteConflictingConnectedApps', { names }),
      description: t('ifNotDeletedConflictingConnectedAppsWillBlock'),
      initial: true
    });
    if (!deletePrompt.delete) {
      return;
    }
  }

  uxLog("action", command, c.cyan(t('deletingConflictingConnectedApps')));
  await deleteConnectedApps(orgUsername, conflicting, command, saveProjectPath);
  uxLog("success", command, c.green(t('conflictingConnectedAppsDeleted')));
}
