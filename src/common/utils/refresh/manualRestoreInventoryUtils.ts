import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import { Connection } from '@salesforce/core';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { uxLog } from '../index.js';
import { soqlQuery, soqlQueryTooling } from '../apiUtils.js';
import { generateCsvFile } from '../filesUtils.js';
import { t } from '../i18n.js';

// Items that cannot be restored automatically after a sandbox refresh:
// external OAuth authentications, secrets of credentials & auth providers, scheduled jobs.
// They are inventoried before the refresh so admins get a manual actions checklist after it.

export const MANUAL_RESTORE_INVENTORY_FILE = 'manual-restore-inventory.json';
export const MANUAL_RESTORE_INVENTORY_CSV_FILE = 'manual-restore-inventory.csv';

export interface ExternalOauthApp {
  appName: string;
  tokenCount: number;
  users: string[];
  lastUsedDate: string | null;
  createdBy: string | null;
  detectedFrom: string[];
  isStandardApp: boolean;
}

// First-party Salesforce apps: their tokens are also revoked by a refresh,
// but users just log in again, there is nothing to reconfigure.
// Aligned with DiagnoseUnusedConnectedApps.allowedInactiveConnectedApps, plus apps seen only in OauthToken.
const STANDARD_SALESFORCE_OAUTH_APPS = [
  'AI Platform Auth',
  'Ant Migration Tool',
  'b2bma_canvas',
  'Chatbots',
  'Chatter Desktop',
  'Chatter Mobile for BlackBerry',
  'Code Builder',
  'Dataloader Bulk',
  'Dataloader Partner',
  'Force.com IDE',
  'OIQ_Integration',
  'Salesforce CLI',
  'Salesforce Chatter',
  'Salesforce Files',
  'Salesforce Mobile Dashboards',
  'Salesforce Touch',
  'Salesforce for Android',
  'Salesforce for iOS',
  'Salesforce for Outlook',
  'SalesforceA',
  'SalesforceA for Android',
  'SalesforceA for iOS',
  'SalesforceDX Namespace Registry',
  'SalesforceIQ',
  'Wave Web',
].map((name) => normalizeAppName(name));

export interface CredentialInfo {
  developerName: string;
  masterLabel: string;
  typeInfo: string;
}

export interface ScheduledJobInfo {
  name: string;
  jobType: string;
  cronExpression: string;
  state: string;
  nextFireTime: string | null;
}

export interface ManualRestoreInventory {
  collectedOn: string;
  instanceUrl: string;
  externalOauthApps: ExternalOauthApp[];
  authProviders: CredentialInfo[];
  externalCredentials: CredentialInfo[];
  namedCredentials: CredentialInfo[];
  scheduledJobs: ScheduledJobInfo[];
}

// CronJobDetail.JobType picklist values
const CRON_JOB_TYPE_LABELS: Record<string, string> = {
  '1': 'Data Export',
  '3': 'Dashboard Refresh',
  '4': 'Reporting Snapshot',
  '6': 'Scheduled Flow',
  '7': 'Scheduled Apex',
  '8': 'Report Run',
  '9': 'Batch Job',
  'A': 'Reporting Notification',
};

// Names can differ between metadata fullName (My_App_EMEA) and
// ConnectedApplication.Name / OauthToken.AppName (My App (EMEA))
export function normalizeAppName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function collectExternalOauthApps(
  conn: Connection,
  savedWithCredentials: string[],
  unretrievableApps: string[],
  command: SfCommand<any>
): Promise<ExternalOauthApp[]> {
  const savedSet = new Set(savedWithCredentials.map(normalizeAppName));
  const unretrievableSet = new Set(unretrievableApps.map(normalizeAppName));

  // ConnectedApplication lists every app registration, including apps owned by external orgs
  const connectedApplicationsByName = new Map<string, any>();
  try {
    const appsRes = await soqlQuery('SELECT Name, CreatedBy.Name FROM ConnectedApplication ORDER BY Name', conn);
    for (const record of appsRes?.records || []) {
      connectedApplicationsByName.set(normalizeAppName(record.Name), record);
    }
  } catch (e: any) {
    uxLog("warning", command, c.yellow(t('unableToQueryConnectedApplications', { error: e.message || e })));
  }

  // OauthToken does not support GROUP BY on Id: aggregate client-side
  const tokenGroups = new Map<string, { appName: string; tokenCount: number; users: Set<string>; lastUsedDate: string | null }>();
  try {
    const tokensRes = await soqlQuery('SELECT AppName, User.Username, LastUsedDate FROM OauthToken', conn);
    for (const token of tokensRes?.records || []) {
      const key = normalizeAppName(token.AppName);
      const group = tokenGroups.get(key) || { appName: token.AppName, tokenCount: 0, users: new Set<string>(), lastUsedDate: null };
      group.tokenCount++;
      if (token.User?.Username) {
        group.users.add(token.User.Username);
      }
      if (token.LastUsedDate && (!group.lastUsedDate || token.LastUsedDate > group.lastUsedDate)) {
        group.lastUsedDate = token.LastUsedDate;
      }
      tokenGroups.set(key, group);
    }
  } catch (e: any) {
    uxLog("warning", command, c.yellow(t('unableToQueryOauthTokens', { error: e.message || e })));
  }

  const externalApps: ExternalOauthApp[] = [];
  for (const [key, group] of tokenGroups) {
    if (savedSet.has(key)) {
      continue; // App saved with its credentials: restorable, not a manual action
    }
    const detectedFrom = ['oauth-tokens'];
    if (unretrievableSet.has(key)) {
      detectedFrom.push('unretrievable-metadata');
    }
    externalApps.push({
      appName: group.appName,
      tokenCount: group.tokenCount,
      users: Array.from(group.users).sort(),
      lastUsedDate: group.lastUsedDate,
      createdBy: connectedApplicationsByName.get(key)?.CreatedBy?.Name || null,
      detectedFrom,
      isStandardApp: STANDARD_SALESFORCE_OAUTH_APPS.includes(key),
    });
  }
  // Unretrievable apps without any active token still need to be reported
  for (const appName of unretrievableApps) {
    const key = normalizeAppName(appName);
    if (savedSet.has(key) || externalApps.some((app) => normalizeAppName(app.appName) === key)) {
      continue;
    }
    externalApps.push({
      appName: appName,
      tokenCount: 0,
      users: [],
      lastUsedDate: null,
      createdBy: connectedApplicationsByName.get(key)?.CreatedBy?.Name || null,
      detectedFrom: ['unretrievable-metadata'],
      isStandardApp: STANDARD_SALESFORCE_OAUTH_APPS.includes(key),
    });
  }
  externalApps.sort((a, b) => b.tokenCount - a.tokenCount || a.appName.localeCompare(b.appName));
  return externalApps;
}

export async function collectAuthProviders(conn: Connection, command: SfCommand<any>): Promise<CredentialInfo[]> {
  try {
    const res = await soqlQuery('SELECT DeveloperName, FriendlyName, ProviderType FROM AuthProvider ORDER BY DeveloperName', conn);
    return (res?.records || []).map((record: any) => ({
      developerName: record.DeveloperName,
      masterLabel: record.FriendlyName || record.DeveloperName,
      typeInfo: record.ProviderType || '',
    }));
  } catch (e: any) {
    uxLog("warning", command, c.yellow(t('unableToQueryAuthProviders', { error: e.message || e })));
    return [];
  }
}

export async function collectExternalCredentials(conn: Connection, command: SfCommand<any>): Promise<CredentialInfo[]> {
  try {
    const res = await soqlQueryTooling('SELECT DeveloperName, MasterLabel, AuthenticationProtocol FROM ExternalCredential ORDER BY DeveloperName', conn);
    return (res?.records || []).map((record: any) => ({
      developerName: record.DeveloperName,
      masterLabel: record.MasterLabel || record.DeveloperName,
      typeInfo: record.AuthenticationProtocol || '',
    }));
  } catch (e: any) {
    uxLog("warning", command, c.yellow(t('unableToQueryExternalCredentials', { error: e.message || e })));
    return [];
  }
}

export async function collectNamedCredentials(conn: Connection, command: SfCommand<any>): Promise<CredentialInfo[]> {
  try {
    const res = await soqlQueryTooling('SELECT DeveloperName, MasterLabel, PrincipalType FROM NamedCredential ORDER BY DeveloperName', conn);
    return (res?.records || []).map((record: any) => ({
      developerName: record.DeveloperName,
      masterLabel: record.MasterLabel || record.DeveloperName,
      typeInfo: record.PrincipalType || '',
    }));
  } catch (e: any) {
    uxLog("warning", command, c.yellow(t('unableToQueryNamedCredentials', { error: e.message || e })));
    return [];
  }
}

export async function collectScheduledJobs(conn: Connection, command: SfCommand<any>): Promise<ScheduledJobInfo[]> {
  try {
    const res = await soqlQuery(
      "SELECT CronJobDetail.Name, CronJobDetail.JobType, CronExpression, State, NextFireTime FROM CronTrigger WHERE State != 'DELETED' ORDER BY CronJobDetail.Name",
      conn
    );
    return (res?.records || []).map((record: any) => ({
      name: record.CronJobDetail?.Name || record.Id,
      jobType: CRON_JOB_TYPE_LABELS[record.CronJobDetail?.JobType] || record.CronJobDetail?.JobType || '',
      cronExpression: record.CronExpression || '',
      state: record.State || '',
      nextFireTime: record.NextFireTime || null,
    }));
  } catch (e: any) {
    uxLog("warning", command, c.yellow(t('unableToQueryScheduledJobs', { error: e.message || e })));
    return [];
  }
}

export async function collectManualRestoreInventory(
  conn: Connection,
  savedWithCredentials: string[],
  unretrievableApps: string[],
  command: SfCommand<any>
): Promise<ManualRestoreInventory> {
  return {
    collectedOn: new Date().toISOString(),
    instanceUrl: conn.instanceUrl,
    externalOauthApps: await collectExternalOauthApps(conn, savedWithCredentials, unretrievableApps, command),
    authProviders: await collectAuthProviders(conn, command),
    externalCredentials: await collectExternalCredentials(conn, command),
    namedCredentials: await collectNamedCredentials(conn, command),
    scheduledJobs: await collectScheduledJobs(conn, command),
  };
}

// Flat rows for the human-readable CSV/XLSX version of the inventory
export function manualRestoreInventoryToRows(inventory: ManualRestoreInventory): any[] {
  const rows: any[] = [];
  for (const app of inventory.externalOauthApps) {
    rows.push({
      Category: 'External OAuth authentication',
      Name: app.appName,
      Detail: app.isStandardApp ? 'Standard Salesforce app' : (app.createdBy ? `Created by ${app.createdBy}` : ''),
      Users: app.users.join(', '),
      'Last Used': app.lastUsedDate || '',
      'Next Fire Time': '',
      'Manual Action': app.isStandardApp
        ? 'Users just log in again from the app'
        : 'Re-authorize from the external tool with "Log in with Salesforce"',
    });
  }
  for (const item of inventory.authProviders) {
    rows.push({
      Category: 'Auth Provider',
      Name: item.developerName,
      Detail: item.typeInfo,
      Users: '',
      'Last Used': '',
      'Next Fire Time': '',
      'Manual Action': 'Re-enter Consumer Secret manually after restore',
    });
  }
  for (const item of inventory.externalCredentials) {
    rows.push({
      Category: 'External Credential',
      Name: item.developerName,
      Detail: item.typeInfo,
      Users: '',
      'Last Used': '',
      'Next Fire Time': '',
      'Manual Action': 'Re-authenticate principals or re-enter secrets after restore',
    });
  }
  for (const item of inventory.namedCredentials) {
    rows.push({
      Category: 'Named Credential',
      Name: item.developerName,
      Detail: item.typeInfo,
      Users: '',
      'Last Used': '',
      'Next Fire Time': '',
      'Manual Action': 'Check endpoint and re-enter secrets after restore',
    });
  }
  for (const job of inventory.scheduledJobs) {
    rows.push({
      Category: 'Scheduled job',
      Name: job.name,
      Detail: `${job.jobType}${job.cronExpression ? ` (${job.cronExpression})` : ''}`,
      Users: '',
      'Last Used': '',
      'Next Fire Time': job.nextFireTime || '',
      'Manual Action': 'Re-schedule after refresh if missing',
    });
  }
  return rows;
}

export async function saveManualRestoreInventory(saveProjectPath: string, inventory: ManualRestoreInventory): Promise<string> {
  const inventoryFile = path.join(saveProjectPath, MANUAL_RESTORE_INVENTORY_FILE);
  await fs.writeJson(inventoryFile, inventory, { spaces: 2 });
  // Also generate CSV + XLSX so the inventory can be read and shared by humans
  const rows = manualRestoreInventoryToRows(inventory);
  if (rows.length > 0) {
    const csvFile = path.join(saveProjectPath, MANUAL_RESTORE_INVENTORY_CSV_FILE);
    await generateCsvFile(rows, csvFile, { fileTitle: t('manualActionsInventoryTitle') });
  }
  return inventoryFile;
}

export async function loadManualRestoreInventory(saveProjectPath: string): Promise<ManualRestoreInventory | null> {
  const inventoryFile = path.join(saveProjectPath, MANUAL_RESTORE_INVENTORY_FILE);
  if (!fs.existsSync(inventoryFile)) {
    return null;
  }
  try {
    return await fs.readJson(inventoryFile);
  } catch {
    return null;
  }
}
