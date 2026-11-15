import c from 'chalk';
import { Connection } from '@salesforce/core';
import { uxLog } from './index.js';
import { bulkQuery, soqlQuery } from './apiUtils.js';
import { t } from './i18n.js';

// Values of the "Move to External Client App" column of the Connected Apps usage report
export type ConnectedAppMigrationStatus = 'Required' | 'Vendor' | 'Not used' | 'Done (converted)' | 'Not needed';

// A Connected App still used in the last CONNECTED_APP_MIGRATION_RECENT_DAYS days must be moved to an External Client App
export const CONNECTED_APP_MIGRATION_RECENT_DAYS = 90;

// Connected Apps are no longer supported from Summer '27: tell which apps of the usage report must move to an External Client App.
// appType is the "App Type" column of the report, lastUsedDate an ISO date (YYYY-MM-DD) or an empty string.
// ownedByOrg is false for an app that is not a ConnectedApp metadata of the org (an app of Salesforce or of a vendor), null when unknown.
export function getConnectedAppMigrationStatus(
  appType: string,
  namespacePrefix: string,
  lastUsedDate: string,
  ownedByOrg: boolean | null,
  today: Date = new Date()
): ConnectedAppMigrationStatus {
  if (appType === 'Ext Client App (converted)') {
    return 'Done (converted)';
  }
  if (appType === 'Ext Client App') {
    return 'Not needed';
  }
  const ageInDays = lastUsedDate ? (today.getTime() - new Date(lastUsedDate).getTime()) / 86400000 : Infinity;
  if (ageInDays > CONNECTED_APP_MIGRATION_RECENT_DAYS) {
    return 'Not used';
  }
  if (namespacePrefix || ownedByOrg === false) {
    return 'Vendor';
  }
  return 'Required';
}

// API names of the Connected Apps the org owns (its ConnectedApp metadata), in the form of toConnectedAppApiName().
// The apps of Salesforce (Salesforce for Android, Insights...) are not part of it.
// Returns null when the metadata cannot be listed, so the caller does not guess.
// readMetadata would give the exact labels, but it fails with UNKNOWN_EXCEPTION on some orgs.
export async function listOrgOwnedConnectedAppNames(conn: Connection): Promise<Set<string> | null> {
  try {
    const fileProperties = await conn.metadata.list([{ type: 'ConnectedApp' }]);
    return new Set(
      (Array.isArray(fileProperties) ? fileProperties : [fileProperties])
        .filter((fileProperty) => fileProperty?.fullName)
        .map((fileProperty) => toConnectedAppApiName(fileProperty.fullName))
    );
  } catch {
    return null;
  }
}

// The API name Salesforce derives from a Connected App label, lowercased: "ClickDeploy.io" -> "clickdeploy_io"
export function toConnectedAppApiName(label: string): string {
  return (label || '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

// Query every OAuthToken record. A single Bulk query returns at most 2500 tokens (Salesforce hard limit),
// so the remaining ones are fetched page by page, using the CreatedDate of the latest token found.
// baseQuery must select CreatedDate and must not have WHERE / ORDER BY clauses.
export async function queryAllOAuthTokens(conn: Connection, baseQuery: string): Promise<any[]> {
  const tokensCountQueryRes = await soqlQuery(`SELECT count() FROM OauthToken`, conn);
  const totalTokens = tokensCountQueryRes.totalSize;
  uxLog("log", this, t('oauthTokensFound', { count: totalTokens }));

  const allOAuthTokenQueryRes = await bulkQuery(`${baseQuery} ORDER BY CreatedDate ASC`, conn);
  const allOAuthTokens = allOAuthTokenQueryRes.records;

  if (allOAuthTokens.length < totalTokens) {
    uxLog("warning", this, c.yellow(t('salesforceApiLimitOAuthTokensReached')));
    let lastCreatedDate = allOAuthTokens.length > 0 ? allOAuthTokens[allOAuthTokens.length - 1].CreatedDate : null;
    while (lastCreatedDate != null) {
      const remainingTokensQuery = `${baseQuery} WHERE CreatedDate > ${lastCreatedDate} ORDER BY CreatedDate ASC`;
      const remainingTokensQueryRes = await bulkQuery(remainingTokensQuery, conn);
      const remainingTokens = remainingTokensQueryRes.records;
      if (remainingTokens.length > 0) {
        allOAuthTokens.push(...remainingTokens);
        lastCreatedDate = remainingTokens[remainingTokens.length - 1].CreatedDate;
        uxLog("log", this, t('oauthTokensRetrievedProgress', { count: allOAuthTokens.length, total: totalTokens }));
        if (allOAuthTokens.length >= totalTokens) {
          lastCreatedDate = null;
        }
      } else {
        lastCreatedDate = null;
      }
    }
  }
  uxLog("log", this, t('oauthTokensRetrieved', { count: allOAuthTokens.length }));
  return allOAuthTokens;
}
