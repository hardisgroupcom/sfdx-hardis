import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import open from 'open';
import { Connection } from '@salesforce/core';
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

// Folder and file extension for each satellite metadata type.
export const ECA_SATELLITE_META: Record<string, { dir: string; fileSuffix: string }> = {
  'ExtlClntAppOauthSettings': { dir: 'extlClntAppOauthSettings', fileSuffix: 'ecaOauth-meta.xml' },
  'ExtlClntAppGlobalOauthSettings': { dir: 'extlClntAppGlobalOauthSets', fileSuffix: 'ecaGlblOauth-meta.xml' },
  'ExtlClntAppOauthConfigurablePolicies': { dir: 'extlClntAppOauthPolicies', fileSuffix: 'ecaOauthPlcy-meta.xml' },
  'ExtlClntAppConfigurablePolicies': { dir: 'extlClntAppPolicies', fileSuffix: 'ecaPlcy-meta.xml' },
};

// Suffix appended to the app name to form the member name for each satellite type.
// ExternalClientApplication uses no suffix (member == appName).
export const ECA_SATELLITE_SUFFIXES: Record<string, string> = {
  'ExternalClientApplication': '',
  'ExtlClntAppOauthSettings': '_defOauthSet',
  'ExtlClntAppGlobalOauthSettings': '_defGlblOauthSet',
  'ExtlClntAppOauthConfigurablePolicies': '_defOauthPlcy',
  'ExtlClntAppConfigurablePolicies': '_defPlcy',
};

/**
 * Build the package content for the 5 ECA metadata types.
 * When appNames is provided, member names are constructed as `{appName}{suffix}`
 * using ECA_SATELLITE_SUFFIXES. Otherwise wildcards are used.
 */
export function getEcaPackageContent(appNames?: string[]): Record<string, string[]> {
  if (appNames && appNames.length > 0) {
    return Object.fromEntries(
      ECA_METADATA_TYPES.map(type => [
        type,
        appNames.map(name => name + (ECA_SATELLITE_SUFFIXES[type] ?? '')),
      ])
    );
  }
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
 * List External Client App names available in the org.
 */
export async function listExternalClientAppNames(
  orgUsername: string,
  command: SfCommand<any>
): Promise<string[]> {
  const result = await execSfdxJson(
    `sf org list metadata --metadata-type ExternalClientApplication --target-org ${orgUsername}`,
    command,
    { output: false }
  );
  const apps = result?.result && Array.isArray(result.result) ? result.result : [];
  return apps.map((a: any) => a.fullName).sort();
}

/**
 * Retrieve External Client App metadata from org into the save project.
 * If selectedNames is provided, only those apps are retrieved; otherwise all apps are retrieved.
 */
export async function retrieveExternalClientApps(
  orgUsername: string,
  saveProjectPath: string,
  command: SfCommand<any>,
  selectedNames?: string[]
): Promise<number> {
  const packageContent = getEcaPackageContent(selectedNames && selectedNames.length > 0 ? selectedNames : undefined);
  const ecaPackageXml = path.join(saveProjectPath, 'manifest', 'package-eca-to-save.xml');
  await writePackageXmlFile(ecaPackageXml, packageContent);

  uxLog("action", command, c.cyan(t('retrievingExternalClientAppsFromOrg')));
  await execCommand(
    `sf project retrieve start --manifest "${ecaPackageXml}" --target-org ${orgUsername} --ignore-conflicts --json`,
    command,
    { output: true, fail: false, cwd: saveProjectPath }
  );

  const ecaNames = getEcaNames(saveProjectPath);
  return ecaNames.length;
}

/**
 * Verify credentials in ECA Global OAuth settings files.
 * If consumerSecret is missing, attempts Connect REST API extraction or manual entry.
 */
export async function verifyEcaCredentials(
  saveProjectPath: string,
  instanceUrl: string,
  conn: Connection | null,
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

    // Try Connect REST API first
    if (conn) {
      uxLog("log", command, c.cyan(t('ecaFetchingCredentialsViaApi', { appName })));
      try {
        extractedSecret = await fetchEcaCredentialsViaApi(conn, appName, consumerKey, command);
      } catch (e: any) {
        uxLog("warning", command, c.yellow(t('ecaCredentialsApiError', { appName, message: e.message || String(e) })));
      }
    }

    // If API extraction failed, prompt for manual entry
    if (!extractedSecret) {
      uxLog("action", command, c.cyan(t('ecaSetupUrlForConsumerSecret', { appName })));
      await open(`${instanceUrl}/lightning/setup/ManageExternalClientApplication/home`);

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
 * Fetch External Client App consumer secret via the OAuth Credentials REST API.
 *
 * The flow requires three calls:
 * 1. GET /apps/oauth/usage → find the app identifier by developerName
 * 2. GET /apps/oauth/credentials/{appId} → list consumers
 * 3. GET /apps/oauth/credentials/{appId}/{consumerId}?part=keyandsecret → get the secret
 *
 * Requires "Allow access to External Client App consumer secrets via REST API" enabled in Setup.
 */
export async function fetchEcaCredentialsViaApi(
  conn: Connection,
  appName: string,
  consumerKey: string,
  command: SfCommand<any>
): Promise<string | null> {
  const apiVersion = `v${conn.version}`;

  // Step 1: List all OAuth apps to find the app identifier
  const usageUrl = `/services/data/${apiVersion}/apps/oauth/usage`;
  uxLog("log", command, c.grey(`GET ${usageUrl}`));
  const usageResponse = await conn.request<{ apps: Array<{ developerName: string; identifier: string }> }>({
    method: 'GET',
    url: usageUrl,
  });

  const app = usageResponse?.apps?.find(a => a.developerName === appName);
  if (!app) {
    uxLog("warning", command, c.yellow(t('ecaAppNotFoundInUsageApi', { appName })));
    return null;
  }

  const appId = app.identifier;

  // Step 2: Get consumers for this app
  const credentialsUrl = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}`;
  uxLog("log", command, c.grey(`GET ${credentialsUrl}`));
  const credentialsResponse = await conn.request<{ consumers: Array<{ id: string; key: string; name: string }> }>({
    method: 'GET',
    url: credentialsUrl,
  });

  const consumers = credentialsResponse?.consumers || [];
  if (consumers.length === 0) {
    uxLog("warning", command, c.yellow(t('ecaNoConsumersFound', { appName })));
    return null;
  }

  // Match consumer by known consumerKey, or fall back to the first one
  const consumer = consumerKey
    ? consumers.find(co => co.key === consumerKey) || consumers[0]
    : consumers[0];

  // Step 3: Get key and secret for this consumer
  const secretUrl = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}/${consumer.id}?part=keyandsecret`;
  uxLog("log", command, c.grey(`GET ${secretUrl}`));
  const secretResponse = await conn.request<{ key: string; secret: string }>({
    method: 'GET',
    url: secretUrl,
  });

  if (secretResponse?.secret) {
    uxLog("success", command, c.green(t('ecaCredentialsRetrievedViaApi', { appName })));
    return secretResponse.secret;
  }

  return null;
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
): Promise<string[]> {
  if (ecaNames.length === 0) {
    return [];
  }

  // Only check for global OAuth files - those are the ones with credentials
  const globalOauthFolder = path.join(saveProjectPath, 'force-app', 'main', 'default', 'extlClntAppGlobalOauthSets');
  if (!fs.existsSync(globalOauthFolder) || fs.readdirSync(globalOauthFolder).filter(f => f.endsWith('.ecaGlblOauth-meta.xml')).length === 0) {
    // No global OAuth settings means no credentials to protect - skip deletion
    return [];
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
      return [];
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
      `sf project deploy start --manifest "${packageXmlPath}" --post-destructive-changes "${destructiveChangesPath}" --target-org ${orgUsername} --ignore-warnings --ignore-conflicts --json`,
      command,
      { output: true, fail: true, cwd: saveProjectPath }
    );
    uxLog("success", command, c.green(t('externalClientAppsDeletedSuccessfully')));
    // Clean up
    await fs.remove(tmpDir);
    return ecaNames;
  } catch (deleteError: any) {
    uxLog("error", command, c.red(t('errorProcessing', { app: 'External Client Apps', error: deleteError.message || String(deleteError) })));
  }

  // Clean up
  await fs.remove(tmpDir);
  return [];
}

/**
 * Deploy External Client Apps metadata to an org.
 * Returns a map of metadataType -> deployed member names.
 */
export async function deployExternalClientApps(
  orgUsername: string,
  instanceUrl: string,
  saveProjectPath: string,
  command: SfCommand<any>,
  selectedNames?: string[]
): Promise<Record<string, string[]>> {
  const ecaNames = selectedNames && selectedNames.length > 0 ? selectedNames : getEcaNames(saveProjectPath);
  const ecaContent = getEcaPackageContent(ecaNames.length > 0 ? ecaNames : undefined);

  // Phase 1: Deploy ExternalClientApplication parent type only.
  // Satellite types (OAuth settings, policies) require the parent to exist first.
  // Before Phase 1: strip <orgScopedExternalApp> from ExternalClientApplication files.
  // This tag is org-specific and breaks deployment on fresh/refreshed orgs.
  const ecaFolder = path.join(saveProjectPath, 'force-app', 'main', 'default', 'externalClientApps');
  if (fs.existsSync(ecaFolder)) {
    const ecaFiles = fs.readdirSync(ecaFolder).filter(f => f.endsWith('.externalClientApp-meta.xml'));
    for (const ecaFile of ecaFiles) {
      const filePath = path.join(ecaFolder, ecaFile);
      const xmlContent = await fs.readFile(filePath, 'utf8');
      if (xmlContent.includes('<orgScopedExternalApp>')) {
        const updated = xmlContent.replace(/<orgScopedExternalApp>.*?<\/orgScopedExternalApp>\s*/gs, '');
        await fs.writeFile(filePath, updated);
        uxLog("log", command, c.grey(t('removingOrgScopedExternalAppFromEca', { file: ecaFile })));
      }
    }
  }

  const ecaPackageXmlPhase1 = path.join(saveProjectPath, 'manifest', 'package-eca-to-restore-phase1.xml');
  await writePackageXmlFile(ecaPackageXmlPhase1, { ExternalClientApplication: ecaContent['ExternalClientApplication'] });
  uxLog("action", command, c.cyan(t('restoringExternalClientAppsStep1')));
  await execCommand(
    `sf project deploy start --manifest "${ecaPackageXmlPhase1}" --target-org ${orgUsername} --ignore-conflicts --json`,
    command,
    { output: true, fail: true, cwd: saveProjectPath }
  );

  // Between phases: strip <oauthLink> from ExtlClntAppOauthSettings files.
  // The oauthLink is an org-specific reference that breaks deployment on fresh orgs.
  const ecaOauthSettingsFolder = path.join(saveProjectPath, 'force-app', 'main', 'default', 'extlClntAppOauthSettings');
  if (fs.existsSync(ecaOauthSettingsFolder)) {
    const oauthSettingsFiles = fs.readdirSync(ecaOauthSettingsFolder).filter(f => f.endsWith('.ecaOauth-meta.xml'));
    for (const oauthFile of oauthSettingsFiles) {
      const filePath = path.join(ecaOauthSettingsFolder, oauthFile);
      const xmlContent = await fs.readFile(filePath, 'utf8');
      if (xmlContent.includes('<oauthLink>')) {
        const updated = xmlContent.replace(/<oauthLink>.*?<\/oauthLink>\s*/gs, '');
        await fs.writeFile(filePath, updated);
        uxLog("log", command, c.grey(t('removingOauthLinkFromEcaOauthSettings', { file: oauthFile })));
      }
    }
  }

  // Phase 2: Deploy all satellite types now that the parent ECAs exist in the org.
  // Only include members for which a metadata file actually exists in the backup.
  const forceAppDefault = path.join(saveProjectPath, 'force-app', 'main', 'default');
  const satelliteContent: Record<string, string[]> = {};
  for (const [type, members] of Object.entries(ecaContent)) {
    if (type === 'ExternalClientApplication') continue;
    const meta = ECA_SATELLITE_META[type];
    if (!meta) continue;
    const presentMembers = members.filter(member => {
      const filePath = path.join(forceAppDefault, meta.dir, `${member}.${meta.fileSuffix}`);
      return fs.existsSync(filePath);
    });
    if (presentMembers.length > 0) {
      satelliteContent[type] = presentMembers;
      uxLog("log", command, c.grey(t('ecaSatelliteTypeFilesFound', { type, count: presentMembers.length })));
    } else {
      uxLog("log", command, c.grey(t('ecaSatelliteTypeNoFilesFound', { type })));
    }
  }
  const ecaPackageXmlPhase2 = path.join(saveProjectPath, 'manifest', 'package-eca-to-restore-phase2.xml');
  await writePackageXmlFile(ecaPackageXmlPhase2, satelliteContent);
  uxLog("action", command, c.cyan(t('restoringExternalClientAppsStep2')));
  await execCommand(
    `sf project deploy start --manifest "${ecaPackageXmlPhase2}" --target-org ${orgUsername} --ignore-conflicts --json`,
    command,
    { output: true, fail: true, cwd: saveProjectPath }
  );

  uxLog("success", command, c.green(t('externalClientAppsRestoredSuccessfully', { instanceUrl })));

  return {
    ExternalClientApplication: ecaContent['ExternalClientApplication'] ?? [],
    ...satelliteContent,
  };
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
): Promise<string[]> {
  if (ecaNames.length === 0) {
    return [];
  }
  uxLog("action", command, c.cyan(t('checkingForConflictingConnectedAppsAndExtClientAppToDelete')));
  // Query for Connected Apps with the same names as External Client Apps
  const listCommand = `sf org list metadata --metadata-type ConnectedApp --target-org ${orgUsername}`;
  const result = await execSfdxJson(listCommand, command, { output: false });
  const allConnectedApps: ConnectedApp[] = result?.result && Array.isArray(result.result) ? result.result : [];

  // Find Connected Apps with the same name as External Client Apps (case-insensitive)
  const conflicting = allConnectedApps.filter(ca =>
    ecaNames.some(ecaName => ecaName.toLowerCase() === ca.fullName.toLowerCase())
  );

  if (conflicting.length === 0) {
    return [];
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
      return [];
    }
  }

  uxLog("action", command, c.cyan(t('deletingConflictingConnectedApps')));
  await deleteConnectedApps(orgUsername, conflicting, command, saveProjectPath);
  uxLog("success", command, c.green(t('conflictingConnectedAppsDeleted')));
  return conflicting.map(ca => ca.fullName);
}
