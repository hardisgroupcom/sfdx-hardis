import c from 'chalk';
import { Connection, SfError } from '@salesforce/core';
import { uxLog } from './index.js';
import { bulkQuery, soqlQuery } from './apiUtils.js';
import {
  ConnectedAppMigrationStatus,
  getConnectedAppMigrationStatus,
  listOrgOwnedConnectedAppNames,
  queryAllOAuthTokens,
  toConnectedAppApiName,
} from './oauthTokenUtils.js';
import sortArray from './sortArray.js';
import { t } from './i18n.js';

// One row of the Connected Apps usage report: every app that has OAuth tokens, secured or not
export interface ConnectedAppUsageRow {
  "Connected App": string;
  "App Type": string;
  "Last Used Date": string;
  "Move to External Client App": ConnectedAppMigrationStatus;
  "Usernames": string;
}

export interface CollectOAuthTokensOptions {
  // Apps whose tokens get the "⚪ Ignored" status
  ignoredAppNames?: string[];
  // Command used as uxLog context
  commandThis?: any;
  // true: log each step as an "action" line, like a command does. false: grey "log" lines only
  logActions?: boolean;
  // OAuth tokens already read with OAUTH_TOKEN_QUERY: they are not read again
  allOAuthTokens?: any[];
}

export interface OAuthTokensWithStatusResult {
  // Raw OAuthToken records, with the DeleteToken needed to revoke them
  allOAuthTokens: any[];
  // One report row per OAuth token, with its app, app type and security status
  allOAuthTokensWithStatus: any[];
  allConnectedApps: any[];
  allExternalClientApps: any[];
  // Apps whose status comes from the OAuth policy of an External Client App with the same name (sorted)
  convertedExtClientAppNames: string[];
  // Apps matching an External Client App by name, but without an OAuth policy record (sorted)
  convertedExtClientAppsWithoutPolicy: string[];
}

// Every field the OAuthToken readers need, so the tokens can be read once and shared (hardis:org:diagnose:what-will-break).
// AppMenuItem.NamespacePrefix tells a packaged Connected App (migrated by its vendor) from one the org owns.
export const OAUTH_TOKEN_QUERY = "SELECT AppName, AppMenuItem.IsUsingAdminAuthorization, AppMenuItem.NamespacePrefix, LastUsedDate, CreatedDate, UserId, User.Name, User.Username, User.IsActive, User.Profile.Name, UseCount, AppMenuItem.Id, AppMenuItem.Label, AppMenuItem.Name, AppMenuItem.ApplicationId, Id, DeleteToken FROM OAuthToken";

// Connected Apps usage of the org, without prompt, report file, table or notification, so it can run in CI
export async function getConnectedAppsUsage(conn: Connection, options: CollectOAuthTokensOptions = {}): Promise<ConnectedAppUsageRow[]> {
  const { allOAuthTokensWithStatus } = await collectOAuthTokensWithStatus(conn, options);
  return await buildConnectedAppsUsage(allOAuthTokensWithStatus, conn);
}

// Query the Connected Apps, External Client Apps and OAuth tokens of the org, and give each token its app, app type and security status
export async function collectOAuthTokensWithStatus(conn: Connection, options: CollectOAuthTokensOptions = {}): Promise<OAuthTokensWithStatusResult> {
  const commandThis = options.commandThis;
  const logStep = (message: string) => {
    if (options.logActions) {
      uxLog("action", commandThis, c.cyan(message));
    } else {
      uxLog("log", commandThis, c.grey(message));
    }
  };
  const ignoredAppNamesSet = new Set((options.ignoredAppNames || []).map(normalizeAppName));

  // List available connected apps
  logStep(t('listingAllInstalledConnectedAppsFrom', { conn: conn.instanceUrl }));
  // OptionsAllowAdminApprovedUsersOnly is the "Admin approved users are pre-authorized" setting of the Connected App
  const connectedAppQuery = `SELECT Id, Name, OptionsAllowAdminApprovedUsersOnly FROM ConnectedApplication ORDER BY Name ASC`;
  const connectedAppQueryRes = await bulkQuery(connectedAppQuery, conn);
  const allConnectedApps: any[] = connectedAppQueryRes.records;
  uxLog("log", commandThis, t('connectedAppsFound', { count: allConnectedApps.length }));
  const allConnectedAppsById = new Map<string, any>(allConnectedApps.map(app => [app.Id, app]));
  // Also index by Name for AppName-based matching (tokens whose AppMenuItem link is gone)
  const allConnectedAppsByName = new Map<string, any>();
  for (const app of allConnectedApps) {
    if (app.Name) allConnectedAppsByName.set(normalizeAppName(app.Name), app);
  }

  // List available External Client Apps
  logStep(t('listingAllExternalClientAppsFrom', { conn: conn.instanceUrl }));
  const externalClientAppQuery = `SELECT Id, MasterLabel, DeveloperName FROM ExternalClientApplication ORDER BY MasterLabel ASC`;
  let allExternalClientApps: any[] = [];
  try {
    const externalClientAppQueryRes = await soqlQuery(externalClientAppQuery, conn);
    allExternalClientApps = externalClientAppQueryRes.records;
  } catch (_e) {
    // ExternalClientApplication may not be available in all orgs or API versions
  }
  uxLog("log", commandThis, t('externalClientAppsFound', { count: allExternalClientApps.length }));
  const allExternalClientAppsById = new Map<string, any>(allExternalClientApps.map(app => [app.Id, app]));
  // Also index by MasterLabel and DeveloperName for AppName-based matching (tokens without AppMenuItem link)
  const allExternalClientAppsByName = new Map<string, any>();
  for (const app of allExternalClientApps) {
    if (app.MasterLabel) allExternalClientAppsByName.set(app.MasterLabel.toLowerCase(), app);
    if (app.DeveloperName) allExternalClientAppsByName.set(app.DeveloperName.toLowerCase(), app);
  }

  // Query External Client App OAuth Policies to check admin pre-approval setting
  // PermittedUsersPolicyType === 'AdminApprovedPreAuthorized' means admin pre-approved
  const ecaOauthPoliciesQuery = `SELECT Id, ExternalClientApplicationId, PermittedUsersPolicyType FROM ExtlClntAppOauthPlcyCnfg`;
  let allEcaOauthPolicies: any[] = [];
  try {
    const ecaOauthPoliciesQueryRes = await soqlQuery(ecaOauthPoliciesQuery, conn);
    allEcaOauthPolicies = ecaOauthPoliciesQueryRes.records;
  } catch (_e) {
    // ExtlClntAppOauthConfigurablePolicies may not be available in all orgs or API versions
  }
  const ecaOauthPoliciesByAppId = new Map<string, any>(allEcaOauthPolicies.map(policy => [policy.ExternalClientApplicationId, policy]));

  // Collect all OAuth Tokens
  logStep(t('extractingAllOauthTokensFrom', { conn: conn.instanceUrl }));
  // A copy: the list is sorted below, and the caller may share it with other readers
  const allOAuthTokens = options.allOAuthTokens ? [...options.allOAuthTokens] : await queryAllOAuthTokens(conn, OAUTH_TOKEN_QUERY);
  sortArray(allOAuthTokens, { by: 'AppName' });

  // A Connected App migrated to an External Client App stays in the org as a read-only copy that is no longer
  // used for authentication, but its OAuth tokens still point to it. The migrated External Client App keeps
  // the Connected App name, so when one exists, its OAuth policy is the one that applies.
  // That detection is based on the name only: keep track of the apps whose status has been taken from an
  // External Client App policy, so an admin can check they are really converted Connected Apps.
  const convertedExtClientAppNames = new Set<string>();
  const convertedExtClientAppsWithoutPolicy = new Set<string>();

  const allOAuthTokensWithStatus = allOAuthTokens.map(oAuthToken => {
    let adminPreApproved = toBoolean(oAuthToken["AppMenuItem.IsUsingAdminAuthorization"]);
    let appName = oAuthToken.AppName ? oAuthToken.AppName : 'N/A';
    let appType = 'Connected App';
    const applicationId = oAuthToken["AppMenuItem.ApplicationId"];
    // null when the org does not expose ExtlClntAppOauthPlcyCnfg, or when the app has no policy record
    const getExtClientAppPreApproval = (extClientAppId: string): boolean | null => {
      const ecaPolicy = ecaOauthPoliciesByAppId.get(extClientAppId);
      return ecaPolicy ? ecaPolicy.PermittedUsersPolicyType === 'AdminApprovedPreAuthorized' : null;
    };
    const applyConnectedApp = (matchingConnectedApp: any) => {
      appName = matchingConnectedApp.Name;
      const connectedAppPreApproved = readBoolean(matchingConnectedApp.OptionsAllowAdminApprovedUsersOnly);
      if (connectedAppPreApproved !== null) {
        adminPreApproved = connectedAppPreApproved;
      }
    };
    // Without the External Client App policy, keep the Connected App type and setting: defaulting to
    // "not pre-approved" would report a secured Connected App as unsecured
    const applyConvertedExtClientApp = (convertedExtClientApp: any, connectedAppName: string) => {
      if (!convertedExtClientApp) {
        return;
      }
      const extClientAppPreApproved = getExtClientAppPreApproval(convertedExtClientApp.Id);
      if (extClientAppPreApproved === null) {
        convertedExtClientAppsWithoutPolicy.add(connectedAppName);
        return;
      }
      appType = 'Ext Client App (converted)';
      adminPreApproved = extClientAppPreApproved;
      convertedExtClientAppNames.add(connectedAppName);
    };
    if (applicationId) {
      if (applicationId.startsWith("0xI")) {
        // External Client App (matched via AppMenuItem.ApplicationId)
        appType = 'Ext Client App';
        const matchingExtClientApp = allExternalClientAppsById.get(applicationId);
        if (matchingExtClientApp) {
          appName = matchingExtClientApp.MasterLabel || matchingExtClientApp.DeveloperName;
        }
        // Use the actual ECA OAuth policy to determine admin pre-approval
        adminPreApproved = getExtClientAppPreApproval(applicationId) === true;
      } else {
        // Connected App
        const matchingConnectedApp = allConnectedAppsById.get(applicationId);
        if (!matchingConnectedApp) {
          throw new SfError(`Connected App with Id ${applicationId} not found among installed Connected Apps.`);
        }
        applyConnectedApp(matchingConnectedApp);
        applyConvertedExtClientApp(allExternalClientAppsByName.get(appName.toLowerCase()), appName);
      }
    } else if (appName !== 'N/A') {
      // No AppMenuItem link (External Client App token, or Connected App reinstalled since the token was issued):
      // match by AppName against External Client Apps first, then against Connected Apps
      const matchingExtClientApp = allExternalClientAppsByName.get(appName.toLowerCase());
      const matchingConnectedApp = allConnectedAppsByName.get(normalizeAppName(appName));
      if (matchingExtClientApp && matchingConnectedApp) {
        // Converted Connected App: report it like the tokens that still have their AppMenuItem link
        applyConnectedApp(matchingConnectedApp);
        applyConvertedExtClientApp(matchingExtClientApp, appName);
      } else if (matchingExtClientApp) {
        appType = 'Ext Client App';
        appName = matchingExtClientApp.MasterLabel || matchingExtClientApp.DeveloperName;
        adminPreApproved = getExtClientAppPreApproval(matchingExtClientApp.Id) === true;
      } else if (matchingConnectedApp) {
        applyConnectedApp(matchingConnectedApp);
      }
    }

    const isIgnored = ignoredAppNamesSet.has(normalizeAppName(appName));
    const appResult = {
      AppName: appName,
      "App Type": appType,
      "Status": isIgnored ? '⚪ Ignored' : (adminPreApproved ? '✅ Secured' : '❌ Unsecured'),
      "Admin Pre-Approved": adminPreApproved ? 'Yes' : 'No',
      "User": oAuthToken["User.Name"] ? oAuthToken["User.Name"] : 'N/A',
      "Username": oAuthToken["User.Username"] ? oAuthToken["User.Username"] : 'N/A',
      "User Profile": oAuthToken["User.Profile.Name"] ? oAuthToken["User.Profile.Name"] : 'N/A',
      "Last Used Date": oAuthToken.LastUsedDate ? new Date(oAuthToken.LastUsedDate).toISOString().split('T')[0] : 'N/A',
      "Created Date": oAuthToken.CreatedDate ? new Date(oAuthToken.CreatedDate).toISOString().split('T')[0] : 'N/A',
      "Use Count": oAuthToken.UseCount ? oAuthToken.UseCount : 0,
      "x-Token-Id": oAuthToken.Id ? oAuthToken.Id : 'N/A',
      "x-Token-AppName": oAuthToken.AppName ? oAuthToken.AppName : 'N/A',
      "x-Token-AppMenuItemLabel": oAuthToken["AppMenuItem.Label"] ? oAuthToken["AppMenuItem.Label"] : 'N/A',
      "x-Token-AppMenuItemId": oAuthToken["AppMenuItem.Id"] ? oAuthToken["AppMenuItem.Id"] : 'N/A',
      "x-Token-Namespace": oAuthToken["AppMenuItem.NamespacePrefix"] ? oAuthToken["AppMenuItem.NamespacePrefix"] : '',
      "x-AppName-Different-From-Label": (oAuthToken.AppName && oAuthToken["AppMenuItem.Label"] && oAuthToken.AppName !== oAuthToken["AppMenuItem.Label"]) ? 'Yes' : 'No',
    }
    return appResult;
  });

  return {
    allOAuthTokens,
    allOAuthTokensWithStatus,
    allConnectedApps,
    allExternalClientApps,
    convertedExtClientAppNames: Array.from(convertedExtClientAppNames).sort(),
    convertedExtClientAppsWithoutPolicy: Array.from(convertedExtClientAppsWithoutPolicy).sort(),
  };
}

// Aggregate ALL apps that have OAuth tokens (secured, unsecured and ignored) to give a full usage inventory,
// with the most recent usage date, the list of usernames who hold a token for each app,
// and whether the app must be moved to an External Client App
export async function buildConnectedAppsUsage(allOAuthTokensWithStatus: any[], conn: Connection): Promise<ConnectedAppUsageRow[]> {
  const appsUsage: { [appName: string]: { appName: string; appType: string; namespacePrefix: string; lastUsedDate: string; usernames: Set<string>; } } = {};
  for (const token of allOAuthTokensWithStatus) {
    const appName = token.AppName && token.AppName !== 'N/A' ? token.AppName : 'N/A';
    if (!appsUsage[appName]) {
      appsUsage[appName] = {
        appName,
        appType: token["App Type"] || 'Connected App',
        namespacePrefix: token["x-Token-Namespace"] || '',
        lastUsedDate: '',
        usernames: new Set<string>(),
      };
    }
    const username = token["Username"] && token["Username"] !== 'N/A'
      ? token["Username"]
      : (token["User"] && token["User"] !== 'N/A' ? token["User"] : '');
    if (username) {
      appsUsage[appName].usernames.add(username);
    }
    // Dates are ISO YYYY-MM-DD strings, so a string comparison keeps the most recent one
    const lastUsedDate = token["Last Used Date"] && token["Last Used Date"] !== 'N/A' ? token["Last Used Date"] : '';
    if (lastUsedDate && lastUsedDate > appsUsage[appName].lastUsedDate) {
      appsUsage[appName].lastUsedDate = lastUsedDate;
    }
  }
  // Only the Connected Apps the org owns can be moved by the org: the others belong to Salesforce or to a vendor
  const orgOwnedConnectedAppNames = await listOrgOwnedConnectedAppNames(conn);
  const connectedAppsUsage: ConnectedAppUsageRow[] = Object.values(appsUsage).map(entry => ({
    "Connected App": entry.appName,
    "App Type": entry.appType,
    "Last Used Date": entry.lastUsedDate || 'N/A',
    "Move to External Client App": getConnectedAppMigrationStatus(
      entry.appType,
      entry.namespacePrefix,
      entry.lastUsedDate,
      orgOwnedConnectedAppNames ? orgOwnedConnectedAppNames.has(toConnectedAppApiName(entry.appName)) : null
    ),
    "Usernames": Array.from(entry.usernames).sort().join('\n'),
  }));
  sortArray(connectedAppsUsage, { by: 'Connected App' });
  return connectedAppsUsage;
}

function normalizeAppName(appName: string): string {
  return (appName || '').trim().toLowerCase();
}

function toBoolean(value: any): boolean {
  return readBoolean(value) === true;
}

// Bulk API v2 returns every field as a string, so a "false" boolean must not be read as truthy,
// and a field with no value comes back as an empty string, not as null
function readBoolean(value: any): boolean | null {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return null;
}
