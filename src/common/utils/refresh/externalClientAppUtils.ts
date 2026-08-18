import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import open from 'open';
import { Connection, SfError } from '@salesforce/core';
import { execCommand, execSfdxJson, isCI, createTempDir, uxLog } from '../index.js';
import { parseXmlFile, writePackageXmlFile, writeXmlFile } from '../xmlUtils.js';
import { getApiVersion } from '../../../config/index.js';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { prompts } from '../prompts.js';
import { t } from '../i18n.js';
import { ConnectedApp, deleteConnectedApps, retrieveConnectedApps } from './connectedAppUtils.js';
import { WebSocketClient } from '../../websocketClient.js';

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

/**
 * Resolve which app a satellite member belongs to: the longest app name it starts with.
 * Satellite member names do NOT follow a fixed `{appName}{suffix}` pattern; the only reliable
 * invariant is that they start with the parent ExternalClientApplication name
 * (e.g. app `sfdx_hardis_uat` -> ExtlClntAppGlobalOauthSettings `sfdx_hardis_uatGlblOAuth`).
 * App names may be prefixes of one another (e.g. `sfdx_hardis` and `sfdx_hardis_uat`), so the
 * longest matching name wins to avoid attributing a member to the wrong app.
 */
export function resolveEcaMemberOwner(member: string, allAppNames: string[]): string | null {
  let owner: string | null = null;
  for (const appName of allAppNames) {
    if (member.startsWith(appName) && (owner === null || appName.length > owner.length)) {
      owner = appName;
    }
  }
  return owner;
}

/**
 * List satellite member names of a given metadata type that belong to one of the selected apps.
 * Ownership is resolved against allAppNames (the full set of app names in the org) so that an
 * app whose name is a prefix of another app does not steal the other app's members.
 */
export async function listEcaSatelliteMembers(
  orgUsername: string,
  metadataType: string,
  allAppNames: string[],
  selectedNames: string[],
  command: SfCommand<any>
): Promise<string[]> {
  const result = await execSfdxJson(
    `sf org list metadata --metadata-type ${metadataType} --target-org ${orgUsername}`,
    command,
    { output: false }
  );
  const members = result?.result && Array.isArray(result.result) ? result.result : [];
  const selectedSet = new Set(selectedNames);
  return members
    .map((m: any) => m.fullName)
    .filter((fullName: string) => {
      const owner = resolveEcaMemberOwner(fullName, allAppNames);
      return owner !== null && selectedSet.has(owner);
    })
    .sort();
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
  uxLog("action", command, c.cyan(t('retrievingExternalClientAppsFromOrg')));
  // For selected apps, retrieve the parent by exact name and discover satellite member names
  // from the org (they are not a predictable `{appName}{suffix}`). Otherwise use wildcards.
  let packageContent: Record<string, string[]>;
  if (selectedNames && selectedNames.length > 0) {
    // Need every app name in the org (not just the selected ones) so longest-prefix ownership
    // can tell apart apps whose names are prefixes of one another.
    const allAppNames = await listExternalClientAppNames(orgUsername, command);
    packageContent = { ExternalClientApplication: selectedNames };
    for (const type of ECA_METADATA_TYPES) {
      if (type === 'ExternalClientApplication') continue;
      const members = await listEcaSatelliteMembers(orgUsername, type, allAppNames, selectedNames, command);
      if (members.length > 0) {
        packageContent[type] = members;
      }
    }
  } else {
    packageContent = Object.fromEntries(ECA_METADATA_TYPES.map(type => [type, ['*']]));
  }
  const ecaPackageXml = path.join(saveProjectPath, 'manifest', 'package-eca-to-save.xml');
  await writePackageXmlFile(ecaPackageXml, packageContent);

  // fail: true so a failed retrieve throws instead of silently counting stale files from a previous run
  await execCommand(
    `sf project retrieve start --manifest "${ecaPackageXml}" --target-org ${orgUsername} --ignore-conflicts --json`,
    command,
    { output: true, fail: true, cwd: saveProjectPath }
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
      // Let the user read which External Client App needs its credentials before the browser opens
      await new Promise((resolve) => setTimeout(resolve, 3000));
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
      } else if (/<consumerSecret\s*\/>/.test(xmlString)) {
        updatedXmlString = xmlString.replace(
          /<consumerSecret\s*\/>/,
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
      uxLog("action", command, c.cyan(t('ecaConsumerSecretAddedSuccessfully', { appName })));
    } else {
      uxLog("action", command, c.cyan(t('skippingEcaConsumerSecret', { appName })));
    }
  }
}

// An External Client App as returned by the OAuth Usage REST API.
export interface EcaOAuthApp {
  developerName: string;
  identifier: string;
  label?: string;
}

// A consumer (OAuth credential) of an External Client App.
export interface EcaConsumer {
  id: string;
  key: string;
  name: string;
}

// A staged credential currently attached to a consumer.
export interface EcaStagedCredential {
  id: string;
  state: string;
}

// A freshly staged credential, including its new key and secret.
export interface EcaNewCredential {
  key: string;
  secret: string;
  id: string;
  state: string;
}

/**
 * List External Client Apps exposed through the OAuth Usage REST API.
 * Requires "Allow access to External Client App consumer secrets via REST API" enabled in Setup.
 */
export async function listEcaOAuthApps(conn: Connection, command: SfCommand<any>): Promise<EcaOAuthApp[]> {
  const apiVersion = `v${conn.version}`;
  const usageUrl = `/services/data/${apiVersion}/apps/oauth/usage`;
  uxLog("log", command, c.grey(`GET ${usageUrl}`));
  const usageResponse = await conn.request<{ apps: EcaOAuthApp[] }>({ method: 'GET', url: usageUrl });
  return usageResponse?.apps || [];
}

/**
 * List the consumers (OAuth credentials) of an External Client App.
 */
export async function getEcaConsumers(conn: Connection, appId: string, command: SfCommand<any>): Promise<EcaConsumer[]> {
  const apiVersion = `v${conn.version}`;
  const credentialsUrl = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}`;
  uxLog("log", command, c.grey(`GET ${credentialsUrl}`));
  const credentialsResponse = await conn.request<{ consumers: EcaConsumer[] }>({ method: 'GET', url: credentialsUrl });
  return credentialsResponse?.consumers || [];
}

/**
 * Read the current (main) key and secret of a consumer via the OAuth Credentials REST API.
 * After a rotate, this returns the freshly promoted credentials.
 */
export async function getEcaConsumerKeyAndSecret(
  conn: Connection,
  appId: string,
  consumerId: string,
  command: SfCommand<any>
): Promise<{ key: string; secret: string }> {
  const apiVersion = `v${conn.version}`;
  const url = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}/${consumerId}?part=keyandsecret`;
  uxLog("log", command, c.grey(`GET ${url}`));
  const response = await conn.request<{ key: string; secret: string }>({ method: 'GET', url });
  return { key: response?.key, secret: response?.secret };
}

/**
 * True when an OAuth Credentials REST API error means the org/user has not enabled
 * "Allow access to External Client App consumer secrets via REST API".
 */
export function isEcaRestApiNotEnabledError(e: any): boolean {
  const msg = (e?.message || String(e) || '').toLowerCase();
  return msg.includes('not currently enabled') || msg.includes('feature is not enabled') || msg.includes('not enabled for this user');
}

/**
 * Build the Setup URL of the External Client App Settings page for an org.
 */
export function getEcaSettingsSetupUrl(conn: Connection): string {
  const base = (conn.instanceUrl || '').replace('.my.salesforce.com', '.my.salesforce-setup.com');
  return `${base}/lightning/setup/ExternalClientApplicationSettings/home`;
}

/**
 * Throw a clear, actionable error telling the user to enable the prerequisite and retry.
 * Logs the External Client App Settings URL and shows a button in the VS Code UI (does not open it automatically).
 */
export function throwEcaRestApiNotEnabled(conn: Connection, command: SfCommand<any>): never {
  const setupUrl = getEcaSettingsSetupUrl(conn);
  uxLog("error", command, c.red(t('ecaRestApiNotEnabled')));
  uxLog("error", command, c.cyan(`${t('openExternalClientAppSettings')}: ${setupUrl}`));
  WebSocketClient.sendReportFileMessage(setupUrl, t('openExternalClientAppSettings'), "actionUrl");
  throw new SfError(`${t('ecaRestApiNotEnabled')}\n${setupUrl}`);
}

/**
 * Extract the staged credential id from a stagedCredentialsURL (the id is the last path segment).
 */
function extractStagedIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const parts = url.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  // Ignore the "staged" segment itself when no resource id is appended
  return last && last !== 'staged' ? last : undefined;
}

/**
 * Normalize the various shapes the OAuth Credentials API may use for a staged credential into { id, state }.
 */
function extractStagedCredential(response: any): EcaStagedCredential | null {
  if (!response) return null;
  // The payload may be the credential itself, an array, or wrapped under stagedCredentials
  let staged: any = response;
  if (Array.isArray(response)) {
    staged = response[0];
  } else if (response.stagedCredentials) {
    staged = Array.isArray(response.stagedCredentials) ? response.stagedCredentials[0] : response.stagedCredentials;
  }
  const id =
    staged?.id ??
    staged?.stagedCredentialId ??
    extractStagedIdFromUrl(staged?.stagedCredentialsURL ?? staged?.stagedCredentialsUrl ?? staged?.url);
  if (!id) return null;
  return { id, state: staged?.state };
}

/**
 * Return the current staged credential of a consumer, or null when none exists.
 * Throws an actionable error when the REST API prerequisite is not enabled.
 */
export async function getStagedEcaCredential(
  conn: Connection,
  appId: string,
  consumerId: string,
  command: SfCommand<any>
): Promise<EcaStagedCredential | null> {
  const apiVersion = `v${conn.version}`;
  const stagedUrl = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}/${consumerId}/staged`;
  uxLog("log", command, c.grey(`GET ${stagedUrl}`));
  try {
    const response = await conn.request<any>({ method: 'GET', url: stagedUrl });
    return extractStagedCredential(response);
  } catch (e: any) {
    // The prerequisite toggle is off: surface a clear message instead of silently continuing
    if (isEcaRestApiNotEnabledError(e)) {
      throwEcaRestApiNotEnabled(conn, command);
    }
    // No staged credential yet: the endpoint may answer with a 404 when nothing is staged
    uxLog("log", command, c.grey(`No staged credential found (${e.message || String(e)})`));
  }
  return null;
}

/**
 * Stage new credentials for a consumer. Returns the brand new key and secret.
 */
export async function stageEcaCredential(
  conn: Connection,
  appId: string,
  consumerId: string,
  command: SfCommand<any>
): Promise<EcaNewCredential> {
  const apiVersion = `v${conn.version}`;
  const stagedUrl = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}/${consumerId}/staged`;
  uxLog("log", command, c.grey(`POST ${stagedUrl}`));
  let response: any;
  try {
    response = await conn.request<any>({
      method: 'POST',
      url: stagedUrl,
      // Send an empty JSON body so a Content-Length is set; without a body Salesforce hangs and the socket resets (ECONNRESET)
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    if (isEcaRestApiNotEnabledError(e)) {
      throwEcaRestApiNotEnabled(conn, command);
    }
    throw e;
  }
  // Log field names only (never values) to diagnose unexpected response shapes without leaking the secret
  uxLog("log", command, c.grey(`Staged credential response fields: ${Object.keys(response || {}).join(', ') || '(none)'}`));
  const key = response?.key ?? response?.consumerKey;
  const secret = response?.secret ?? response?.consumerSecret;
  const state = response?.state;
  // The POST response does not always expose the staged credential id directly: resolve it from the staged endpoint
  let id =
    response?.id ??
    response?.stagedCredentialId ??
    extractStagedIdFromUrl(response?.stagedCredentialsURL ?? response?.stagedCredentialsUrl ?? response?.url);
  if (!id) {
    const staged = await getStagedEcaCredential(conn, appId, consumerId, command);
    id = staged?.id;
  }
  return { key, secret, id, state };
}

/* jscpd:ignore-start */
/**
 * Promote a staged credential to the main set (rotate command).
 */
export async function rotateStagedEcaCredential(
  conn: Connection,
  appId: string,
  consumerId: string,
  stagedId: string,
  command: SfCommand<any>
): Promise<void> {
  const apiVersion = `v${conn.version}`;
  const url = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}/${consumerId}/staged/${stagedId}`;
  uxLog("log", command, c.grey(`PATCH ${url}`));
  await conn.request<any>({
    method: 'PATCH',
    url,
    body: JSON.stringify({ command: 'rotate' }),
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Delete a staged credential of a consumer.
 */
export async function deleteStagedEcaCredential(
  conn: Connection,
  appId: string,
  consumerId: string,
  stagedId: string,
  command: SfCommand<any>
): Promise<void> {
  const apiVersion = `v${conn.version}`;
  const url = `/services/data/${apiVersion}/apps/oauth/credentials/${appId}/${consumerId}/staged/${stagedId}`;
  uxLog("log", command, c.grey(`DELETE ${url}`));
  await conn.request<any>({ method: 'DELETE', url });
}
/* jscpd:ignore-end */

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
  const apps = await listEcaOAuthApps(conn, command);
  const app = apps.find(a => a.developerName === appName);
  if (!app) {
    uxLog("warning", command, c.yellow(t('ecaAppNotFoundInUsageApi', { appName })));
    return null;
  }

  const appId = app.identifier;

  // Step 2: Get consumers for this app
  const consumers = await getEcaConsumers(conn, appId, command);
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
 * Returns the names of ECAs whose backup contains a non-empty consumerSecret in
 * their Global OAuth settings file. Only those can be safely deleted before a refresh:
 * an ECA deleted without its saved secret can never be recreated with the same credentials.
 */
export async function getEcaNamesWithSavedSecret(saveProjectPath: string): Promise<string[]> {
  const globalOauthFolder = path.join(saveProjectPath, 'force-app', 'main', 'default', 'extlClntAppGlobalOauthSets');
  if (!fs.existsSync(globalOauthFolder)) {
    return [];
  }
  const namesWithSecret: string[] = [];
  const globalOauthFiles = fs.readdirSync(globalOauthFolder).filter(f => f.endsWith('.ecaGlblOauth-meta.xml'));
  for (const oauthFile of globalOauthFiles) {
    const xmlData = await parseXmlFile(path.join(globalOauthFolder, oauthFile));
    const settings = xmlData?.ExtlClntAppGlobalOauthSettings;
    if (!settings) {
      continue;
    }
    const consumerSecret = settings.consumerSecret?.[0] || '';
    if (consumerSecret && String(consumerSecret).trim() !== '') {
      const appName = settings.externalClientApplication?.[0] || oauthFile.replace('.ecaGlblOauth-meta.xml', '');
      namesWithSecret.push(appName);
    }
  }
  return namesWithSecret;
}

/**
 * Delete External Client Apps from org using destructive changes.
 * Apps whose Consumer Secret is not present in the backup are never deleted.
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

  // Never delete an ECA whose secret is not in the backup: it could not be recreated identically
  const namesWithSecret = await getEcaNamesWithSavedSecret(saveProjectPath);
  const namesWithSecretLower = namesWithSecret.map(name => name.toLowerCase());
  const missingSecretNames = ecaNames.filter(name => !namesWithSecretLower.includes(name.toLowerCase()));
  if (missingSecretNames.length > 0) {
    uxLog("warning", command, c.yellow(t('ecaSkippedDeletionMissingSecret', { ecaNames: missingSecretNames.join(', ') })));
    ecaNames = ecaNames.filter(name => !missingSecretNames.includes(name));
    if (ecaNames.length === 0) {
      return [];
    }
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
  const allEcaNames = getEcaNames(saveProjectPath);
  const ecaNames = selectedNames && selectedNames.length > 0 ? selectedNames : allEcaNames;
  const selectedSet = new Set(ecaNames);
  const parentMembers = ecaNames.length > 0 ? ecaNames : ['*'];

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
  await writePackageXmlFile(ecaPackageXmlPhase1, { ExternalClientApplication: parentMembers });
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
  for (const type of ECA_METADATA_TYPES) {
    if (type === 'ExternalClientApplication') continue;
    const meta = ECA_SATELLITE_META[type];
    if (!meta) continue;
    const folder = path.join(forceAppDefault, meta.dir);
    if (!fs.existsSync(folder)) {
      uxLog("log", command, c.grey(t('ecaSatelliteTypeNoFilesFound', { type })));
      continue;
    }
    // Member names are not predictable; only the prefix (app name) is reliable. Attribute each
    // backup file to its owning app via longest-prefix match (against the full backup set, so
    // prefix-named apps don't collide) and keep it only when that app was selected.
    const suffix = `.${meta.fileSuffix}`;
    const presentMembers = fs.readdirSync(folder)
      .filter(f => f.endsWith(suffix))
      .map(f => f.slice(0, -suffix.length))
      .filter(member => {
        if (ecaNames.length === 0) return true;
        const owner = resolveEcaMemberOwner(member, allEcaNames);
        return owner !== null && selectedSet.has(owner);
      })
      .sort();
    if (presentMembers.length > 0) {
      satelliteContent[type] = presentMembers;
      uxLog("log", command, c.grey(t('ecaSatelliteTypeFilesFound', { type, count: presentMembers.length })));
    } else {
      uxLog("log", command, c.grey(t('ecaSatelliteTypeNoFilesFound', { type })));
    }
  }
  // Skip phase 2 when there is no satellite metadata: deploying an empty manifest would fail
  // and wrongly mark the parent apps (already deployed in phase 1) as errors
  if (Object.keys(satelliteContent).length > 0) {
    const ecaPackageXmlPhase2 = path.join(saveProjectPath, 'manifest', 'package-eca-to-restore-phase2.xml');
    await writePackageXmlFile(ecaPackageXmlPhase2, satelliteContent);
    uxLog("action", command, c.cyan(t('restoringExternalClientAppsStep2')));
    await execCommand(
      `sf project deploy start --manifest "${ecaPackageXmlPhase2}" --target-org ${orgUsername} --ignore-conflicts --json`,
      command,
      { output: true, fail: true, cwd: saveProjectPath }
    );
  }

  uxLog("success", command, c.green(t('externalClientAppsRestoredSuccessfully', { instanceUrl })));

  return {
    ExternalClientApplication: parentMembers,
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

  // Best-effort backup of the conflicting Connected Apps metadata before deleting them,
  // so at least their policies and consumer key are kept in the save project
  try {
    uxLog("action", command, c.cyan(t('conflictingConnectedAppsBackupAttempt')));
    await retrieveConnectedApps(orgUsername, conflicting, command, saveProjectPath);
  } catch (e: any) {
    uxLog("warning", command, c.yellow(t('errorProcessing', { app: 'Conflicting Connected Apps backup', error: e.message || String(e) })));
  }

  uxLog("action", command, c.cyan(t('deletingConflictingConnectedApps')));
  await deleteConnectedApps(orgUsername, conflicting, command, saveProjectPath);
  uxLog("success", command, c.green(t('conflictingConnectedAppsDeleted')));
  return conflicting.map(ca => ca.fullName);
}
