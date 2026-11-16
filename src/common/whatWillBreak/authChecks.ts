import { Connection, SfError } from '@salesforce/core';
import { WebSocketClient } from '../websocketClient.js';
import { isFieldOnObject, isUnsupportedSObjectError, soqlQuery } from '../utils/apiUtils.js';
import { markRowSensitiveValues } from '../utils/anonymizeUtils.js';
import { isIpInRange, isRangeWiderThan } from '../utils/ipRangeUtils.js';
import { t } from '../utils/i18n.js';
import { getDateLabel, getDeadlineLabel, getDeadlineSeverity, getDeadlineWhen, getFixDocUrl } from './whatWillBreakDeadlines.js';
import { buildRow, DAY_MS, finalizeCheck, formatDate, getOrgOAuthTokens, notAvailableResult, successRow } from './checkResults.js';
import {
  CheckContext,
  LoginContext,
  WhatWillBreakCheckKey,
  WhatWillBreakCheckResult,
  WhatWillBreakDetailRow,
  WhatWillBreakSeverity,
} from './whatWillBreakTypes.js';


// Trusted IP ranges wider than these prefixes no longer spare SOAP login() callers the security token
export const SOAP_LOGIN_WIDE_RANGE_IPV4_PREFIX = 8;
export const SOAP_LOGIN_WIDE_RANGE_IPV6_PREFIX = 29;
// Salesforce turns SOAP login() off when nobody called it during this period
export const SOAP_LOGIN_INACTIVITY_DAYS = 180;
// The last SOAP login() call of the org is old enough for a rare job to lose login()
export const SOAP_LOGIN_INACTIVITY_WARNING_DAYS = 120;
// A SOAP login() caller is a rare job when its last call is older than this
export const SOAP_LOGIN_RARE_CALLER_DAYS = 90;
// Refresh tokens unused for this number of days expire
export const REFRESH_TOKEN_IDLE_TTL_DAYS = 30;

export const SOAP_LOGIN_SUBTYPES = [
  'SOAP API',
  'SOAP API (Self-Service)',
  'SOAP API (Networks Portal)',
  'SOAP API (Portal)',
  'SOAP API (Mobile)',
];
export const DEVICE_FLOW_SUBTYPES = ['OAuth Device'];
export const USERNAME_PASSWORD_FLOW_SUBTYPES = ['OAuth Username-Password'];
// Salesforce's own mobile apps log in with the user-agent flow for hybrid apps, so these logins are reported per app, as information
export const USER_AGENT_FLOW_SUBTYPES = [
  'OAuth User-Agent',
  'OAuth User-Agent for Hybrid Apps',
  'OAuth User-Agent with ID Token',
];
// An aggregate query returns at most 2000 groups: past that, the raw logins are read instead
const LOGIN_AGGREGATE_MAX_GROUPS = 2000;

const USER_QUERY_CHUNK_SIZE = 200;

interface LoginGroup {
  userId: string;
  username: string;
  application: string;
  loginSubType: string;
  apiVersion: string;
  sourceIp: string;
  successCount: number;
  failedCount: number;
  lastSuccess: string;
}

// Every use of a refresh token to get a new access token
export const REFRESH_TOKEN_SUBTYPES = ['OAuth Refresh Token', 'OAuth Refresh Token for Hybrid Apps'];
// Salesforce apps people use on their phone or in their mailbox: a holiday longer than 30 days is not a broken integration
const SALESFORCE_END_USER_APP_PREFIXES = [
  'salesforce for ios',
  'salesforce for android',
  'salesforce mobile',
  'salesforce authenticator',
  'salesforce for outlook',
  'salesforce inbox',
  'salesforcea',
  'salesforce insights',
  'field service',
  'chatter',
  'pardot sso',
  'tbid.',
];
// Users per day-grouped refresh token query: halved again when a query reaches the 2000 groups limit
const REFRESH_DAYS_USER_CHUNK_SIZE = 20;

// The checks that read LoginHistory share a single query
const LOGIN_BASED_CHECKS: WhatWillBreakCheckKey[] = [
  'deviceFlow',
  'soapLoginPermission',
  'soapLoginIpRange',
  'soapLoginInactivity',
  'usernamePasswordFlow',
  'soapLoginRetirement',
];

// True when one of the given checks reads the shared LoginHistory query
export function needsLoginHistory(keys: WhatWillBreakCheckKey[]): boolean {
  return keys.some((key) => LOGIN_BASED_CHECKS.includes(key));
}

// Read the LoginHistory rows the login based checks share, once, before they run
export async function loadLoginHistory(context: CheckContext): Promise<void> {
  context.logins = await fetchLogins(context.conn, context.lookbackDays);
}

// Run one authentication check. The login based ones need loadLoginHistory first.
export async function runAuthCheck(context: CheckContext, key: WhatWillBreakCheckKey): Promise<WhatWillBreakCheckResult> {
  const runners: Partial<Record<WhatWillBreakCheckKey, () => Promise<WhatWillBreakCheckResult> | WhatWillBreakCheckResult>> = {
    idleRefreshTokens: () => checkIdleRefreshTokens(context),
    refreshTokenCadence: () => checkRefreshTokenCadence(context),
    deviceFlow: () => checkDeviceFlow(context),
    soapLoginPermission: () => checkSoapLoginPermission(context),
    soapLoginIpRange: () => checkSoapLoginIpRange(context),
    soapLoginInactivity: () => checkSoapLoginInactivity(context),
    usernamePasswordFlow: () => checkUsernamePasswordFlow(context),
    sfConnectLegacyAuth: () => checkSfConnectLegacyAuth(context),
    soapLoginRetirement: () => checkSoapLoginRetirement(context),
  };
  const runner = runners[key];
  if (!runner) {
    throw new SfError(`${key} is not an authentication check`);
  }
  return runner();
}

// Longest number of days between two consecutive days of use (YYYY-MM-DD strings, sorted)
export function getLongestGapDays(sortedDays: string[]): number {
  let longest = 0;
  for (let i = 1; i < sortedDays.length; i++) {
    const gap = Math.round((new Date(sortedDays[i]).getTime() - new Date(sortedDays[i - 1]).getTime()) / DAY_MS);
    longest = Math.max(longest, gap);
  }
  return longest;
}

export function isSalesforceEndUserApp(application: string): boolean {
  const name = (application || '').toLowerCase();
  return SALESFORCE_END_USER_APP_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// Group LoginHistory rows by the given key, keeping counts and the last successful login.
// A row is either a raw LoginHistory record, or an aggregate row with its count (cnt) and its last LoginTime (lastLogin).
export function groupLogins(
  records: any[],
  usernameById: Map<string, string>,
  subTypes: string[],
  keyFields: (keyof LoginGroup)[]
): LoginGroup[] {
  const groups = new Map<string, LoginGroup>();
  for (const record of records) {
    if (!subTypes.includes(record.LoginSubType)) {
      continue;
    }
    const entry: LoginGroup = {
      userId: record.UserId || '',
      username: usernameById.get(record.UserId) || record.UserId || '',
      application: record.Application || 'N/A',
      loginSubType: record.LoginSubType || '',
      apiVersion: record.ApiVersion || 'N/A',
      sourceIp: record.SourceIp || '',
      successCount: 0,
      failedCount: 0,
      lastSuccess: '',
    };
    const key = keyFields.map((field) => entry[field]).join('|');
    const group = groups.get(key) || entry;
    const count = Number(record.cnt ?? 1);
    const loginTime = record.lastLogin || record.LoginTime || '';
    if (record.Status === 'Success') {
      group.successCount += count;
      // LoginTime values are ISO strings: a string comparison keeps the most recent one
      if (loginTime > group.lastSuccess) {
        group.lastSuccess = loginTime;
      }
    } else {
      group.failedCount += count;
    }
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => a.username.localeCompare(b.username));
}

// One LoginHistory query for every login type the checks look at, then the usernames of the users found.
// LoginHistory does not support the Bulk API: an aggregate query keeps the volume low, the raw logins are the fallback.
async function fetchLogins(conn: Connection, lookbackDays: number): Promise<LoginContext> {
  const subTypes = [...SOAP_LOGIN_SUBTYPES, ...DEVICE_FLOW_SUBTYPES, ...USERNAME_PASSWORD_FLOW_SUBTYPES, ...USER_AGENT_FLOW_SUBTYPES]
    .map((subType) => `'${subType}'`)
    .join(',');
  const where = `WHERE LoginTime = LAST_N_DAYS:${lookbackDays} AND LoginSubType IN (${subTypes})`;
  const groupFields = 'UserId, LoginSubType, Application, ApiVersion, SourceIp, Status';
  let records: any[] | null = null;
  try {
    const aggregate = await soqlQuery(
      `SELECT ${groupFields}, COUNT(Id) cnt, MAX(LoginTime) lastLogin FROM LoginHistory ${where} GROUP BY ${groupFields}`,
      conn
    );
    if ((aggregate.records || []).length < LOGIN_AGGREGATE_MAX_GROUPS) {
      records = aggregate.records || [];
    }
  } catch {
    // Read the raw logins below
  }
  if (records === null) {
    try {
      records = (await soqlQuery(`SELECT ${groupFields}, LoginTime FROM LoginHistory ${where}`, conn)).records || [];
    } catch {
      return { failed: true, records: [], usernameById: new Map(), activeUserIds: new Set() };
    }
  }
  const loginRecords: any[] = records || [];
  const userIds = Array.from(new Set(loginRecords.map((r) => r.UserId).filter((id) => !!id)));
  const users = await queryUsersByIds(conn, userIds);
  const usernameById = new Map<string, string>(users.map((u) => [u.Id, u.Username]));
  const activeUserIds = new Set<string>(users.filter((u) => u.IsActive === true || u.IsActive === 'true').map((u) => u.Id));
  return { failed: false, records: loginRecords, usernameById, activeUserIds };
}

async function queryUsersByIds(conn: Connection, userIds: string[]): Promise<any[]> {
  const users: any[] = [];
  for (let i = 0; i < userIds.length; i += USER_QUERY_CHUNK_SIZE) {
    const idList = userIds
      .slice(i, i + USER_QUERY_CHUNK_SIZE)
      .map((id) => `'${id}'`)
      .join(',');
    const res = await soqlQuery(`SELECT Id, Username, IsActive FROM User WHERE Id IN (${idList})`, conn);
    users.push(...(res.records || []));
  }
  return users;
}

async function checkIdleRefreshTokens(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'idleRefreshTokens';
  const title = t('authRetirementsCheckIdleTokens');
  let tokens: any[];
  try {
    tokens = await getOrgOAuthTokens(context);
  } catch (e) {
    return notAvailableResult(context, key, title, (e as Error).message);
  }
  const apiOnlyUserIds = await queryApiOnlyUserIds(context.conn);
  const severity = getDeadlineSeverity(key, context.isSandbox, context.today);
  const rows: WhatWillBreakDetailRow[] = [];
  // Tokens of the other users are counted per app: listing every mobile user token would drown the report
  const otherUsersExpiringByApp = new Map<string, number>();
  for (const appUser of groupTokensByAppAndUser(tokens, context.ignoreSet)) {
    const idleDays = Math.floor((context.today.getTime() - new Date(appUser.lastUse).getTime()) / DAY_MS);
    if (idleDays < context.idleWarningDays) {
      continue;
    }
    if (!apiOnlyUserIds.has(appUser.userId)) {
      if (idleDays < REFRESH_TOKEN_IDLE_TTL_DAYS) {
        otherUsersExpiringByApp.set(appUser.appName, (otherUsersExpiringByApp.get(appUser.appName) || 0) + 1);
      }
      continue;
    }
    const expired = idleDays >= REFRESH_TOKEN_IDLE_TTL_DAYS;
    const expiryDate = formatDate(new Date(new Date(appUser.lastUse).getTime() + REFRESH_TOKEN_IDLE_TTL_DAYS * DAY_MS).toISOString());
    const params = { app: appUser.appName, user: appUser.username, date: expiryDate, days: idleDays };
    const row = buildRow(context, key, title, expired ? 'info' : severity, {
      Item: `${appUser.appName} - ${appUser.username}`,
      Details: expired
        ? t('authRetirementsDetailTokenExpired', { days: idleDays })
        : t('authRetirementsDetailTokenExpiring', { days: idleDays, left: REFRESH_TOKEN_IDLE_TTL_DAYS - idleDays }),
      WhatWillBreak: t(expired ? 'whatWillBreakExpiredTokenImpact' : 'whatWillBreakIdleTokenImpact', params),
      LastSeen: formatDate(appUser.lastUse),
      Count: appUser.useCount,
      Recommendation: t(expired ? 'whatWillBreakExpiredTokenTodo' : 'whatWillBreakIdleTokenTodo', params),
    });
    // Each token has its own expiry date
    if (!expired) {
      row.Deadline = getDateLabel(expiryDate, context.today);
    }
    rows.push(markRowSensitiveValues<WhatWillBreakDetailRow>(row, [appUser.username]));
  }
  for (const [appName, count] of Array.from(otherUsersExpiringByApp.entries()).sort()) {
    rows.push(
      buildRow(context, key, title, 'info', {
        Item: appName,
        Details: t('authRetirementsDetailTokensOtherUsers', { count, days: REFRESH_TOKEN_IDLE_TTL_DAYS }),
        WhatWillBreak: t('whatWillBreakOtherUsersTokensImpact', { count, app: appName }),
        LastSeen: '',
        Count: count,
        Recommendation: t('whatWillBreakOtherUsersTokensTodo', { app: appName }),
      })
    );
  }
  const expiringCount = rows.filter((r) => r.Severity === severity).length;
  return finalizeCheck(context, key, title, rows, expiringCount, t('authRetirementsFoundIdleTokens', { count: expiringCount }));
}

// The tokens of active users, one entry per app and user: an integration is at risk only when its most recent token is idle
function groupTokensByAppAndUser(
  tokens: any[],
  ignoreSet: Set<string>
): { appName: string; userId: string; username: string; lastUse: string; useCount: number }[] {
  const byAppAndUser = new Map<string, { appName: string; userId: string; username: string; lastUse: string; useCount: number }>();
  for (const token of tokens) {
    const isActive = token['User.IsActive'] === true || token['User.IsActive'] === 'true';
    const username = token['User.Username'] || token.UserId || '';
    const lastUse = token.LastUsedDate || token.CreatedDate || '';
    if (!isActive || !lastUse || ignoreSet.has(username.toLowerCase())) {
      continue;
    }
    const appName = token.AppName || 'N/A';
    const mapKey = `${appName}|${token.UserId}`;
    const entry = byAppAndUser.get(mapKey) || { appName, userId: token.UserId, username, lastUse: '', useCount: 0 };
    entry.useCount += Number(token.UseCount || 0);
    // Dates are ISO strings: a string comparison keeps the most recent one
    if (lastUse > entry.lastUse) {
      entry.lastUse = lastUse;
    }
    byAppAndUser.set(mapKey, entry);
  }
  return Array.from(byAppAndUser.values()).sort((a, b) => `${a.appName}|${a.username}`.localeCompare(`${b.appName}|${b.username}`));
}

async function queryApiOnlyUserIds(conn: Connection): Promise<Set<string>> {
  try {
    const res = await soqlQuery(
      'SELECT AssigneeId FROM PermissionSetAssignment WHERE PermissionSet.PermissionsApiUserOnly = true AND Assignee.IsActive = true',
      conn
    );
    return new Set((res.records || []).map((r: any) => r.AssigneeId));
  } catch {
    return new Set();
  }
}

// Integrations that use their refresh token less often than every 30 days: monthly or quarterly syncs break between two runs,
// even when their token was used yesterday. Salesforce's own end-user apps are left out.
async function checkRefreshTokenCadence(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'refreshTokenCadence';
  const title = t('whatWillBreakCheckRefreshTokenCadence');
  const subTypes = REFRESH_TOKEN_SUBTYPES.map((subType) => `'${subType}'`).join(',');
  const where = `WHERE LoginTime = LAST_N_DAYS:${context.lookbackDays} AND LoginSubType IN (${subTypes})`;
  let candidateUserIds: string[];
  try {
    candidateUserIds = await queryRefreshTokenUserIds(context.conn, where);
  } catch {
    return notAvailableResult(context, key, title, t('authRetirementsLoginHistoryUnavailable'));
  }
  const users = await queryUsersByIds(context.conn, candidateUserIds);
  const activeUsers = users.filter(
    (user) => (user.IsActive === true || user.IsActive === 'true') && !context.ignoreSet.has((user.Username || '').toLowerCase())
  );
  const usernameById = new Map<string, string>(activeUsers.map((user) => [user.Id, user.Username]));
  // Days of successful use of each app by each user. Status cannot be filtered in SOQL, only grouped.
  const daysByPair = new Map<string, { userId: string; application: string; days: Set<string> }>();
  for (const record of await queryRefreshTokenDays(context.conn, where, Array.from(usernameById.keys()))) {
    if (record.Status !== 'Success' || isSalesforceEndUserApp(record.Application) || !usernameById.has(record.UserId)) {
      continue;
    }
    const pairKey = `${record.UserId}|${record.Application}`;
    const pair = daysByPair.get(pairKey) || { userId: record.UserId, application: record.Application || 'N/A', days: new Set<string>() };
    pair.days.add(String(record.d).substring(0, 10));
    daysByPair.set(pairKey, pair);
  }
  const severity = getDeadlineSeverity(key, context.isSandbox, context.today);
  const rows: WhatWillBreakDetailRow[] = [];
  for (const pair of daysByPair.values()) {
    const days = Array.from(pair.days).sort();
    const username = usernameById.get(pair.userId) || pair.userId;
    // One day of use gives no gap to measure: a semi-annual sync looks like that
    if (days.length === 1) {
      rows.push(singleUseRow(context, key, title, severity, { app: pair.application, user: username, day: days[0] }));
      continue;
    }
    const longestGap = getLongestGapDays(days);
    if (longestGap < REFRESH_TOKEN_IDLE_TTL_DAYS) {
      continue;
    }
    const params = { app: pair.application, user: username, days: longestGap };
    rows.push(
      markRowSensitiveValues<WhatWillBreakDetailRow>(
        buildRow(context, key, title, severity, {
          Item: `${pair.application} - ${username}`,
          Details: t('whatWillBreakDetailRefreshCadence', { days: longestGap, uses: days.length }),
          WhatWillBreak: t('whatWillBreakRefreshCadenceImpact', params),
          LastSeen: days[days.length - 1],
          Count: days.length,
          Recommendation: t('whatWillBreakRefreshCadenceTodo', params),
        }),
        [{ value: username, kind: 'user' }]
      )
    );
  }
  rows.sort((a, b) => a.Item.localeCompare(b.Item));
  // A recent single use is information: it does not count as an integration that refreshes too rarely
  const found = rows.filter((row) => row.Severity !== 'info').length;
  return finalizeCheck(context, key, title, rows, found, t('whatWillBreakFoundRefreshCadence', { count: found }));
}

// Users who refreshed a token, without the Salesforce end-user apps. Past 2000 user and app pairs (the aggregate limit),
// users are grouped alone, and past 2000 users every active user is read: the day queries keep only the users who refreshed.
async function queryRefreshTokenUserIds(conn: Connection, where: string): Promise<string[]> {
  const unique = (ids: string[]) => Array.from(new Set(ids.filter((id) => !!id)));
  const pairs = (await soqlQuery(`SELECT UserId, Application, COUNT(Id) cnt FROM LoginHistory ${where} GROUP BY UserId, Application`, conn)).records || [];
  if (pairs.length < LOGIN_AGGREGATE_MAX_GROUPS) {
    return unique(pairs.filter((pair) => !isSalesforceEndUserApp(pair.Application)).map((pair) => pair.UserId));
  }
  const users = (await soqlQuery(`SELECT UserId, COUNT(Id) cnt FROM LoginHistory ${where} GROUP BY UserId`, conn)).records || [];
  if (users.length < LOGIN_AGGREGATE_MAX_GROUPS) {
    return unique(users.map((user) => user.UserId));
  }
  const activeUsers = (await soqlQuery('SELECT Id FROM User WHERE IsActive = true', conn)).records || [];
  return unique(activeUsers.map((user) => user.Id));
}

// An app and user that refreshed its token on one day only: its token has expired when that day is 30 days or more ago
function singleUseRow(
  context: CheckContext,
  key: WhatWillBreakCheckKey,
  title: string,
  severity: WhatWillBreakSeverity,
  use: { app: string; user: string; day: string }
): WhatWillBreakDetailRow {
  const daysSinceUse = Math.floor((context.today.getTime() - new Date(use.day).getTime()) / DAY_MS);
  const expired = daysSinceUse >= REFRESH_TOKEN_IDLE_TTL_DAYS;
  const params = { ...use, days: daysSinceUse, lookback: context.lookbackDays };
  return markRowSensitiveValues<WhatWillBreakDetailRow>(
    buildRow(context, key, title, expired ? severity : 'info', {
      Item: `${use.app} - ${use.user}`,
      Details: t('whatWillBreakDetailRefreshSingleUse', params),
      WhatWillBreak: t(expired ? 'whatWillBreakRefreshSingleUseExpiredImpact' : 'whatWillBreakRefreshSingleUseImpact', params),
      LastSeen: use.day,
      Count: 1,
      Recommendation: t('whatWillBreakRefreshCadenceTodo', params),
    }),
    [{ value: use.user, kind: 'user' }]
  );
}

// Days of refresh token use per user, app and status. A grouped query returns at most 2000 groups:
// a chunk of users that reaches it is split in two and read again.
async function queryRefreshTokenDays(conn: Connection, where: string, userIds: string[]): Promise<any[]> {
  const records: any[] = [];
  const chunkCount = Math.ceil(userIds.length / REFRESH_DAYS_USER_CHUNK_SIZE);
  for (let i = 0; i < userIds.length; i += REFRESH_DAYS_USER_CHUNK_SIZE) {
    records.push(...(await queryRefreshTokenDaysChunk(conn, where, userIds.slice(i, i + REFRESH_DAYS_USER_CHUNK_SIZE))));
    // Steps of the progress block the check runs in
    WebSocketClient.sendProgressStepMessage(i / REFRESH_DAYS_USER_CHUNK_SIZE + 1, chunkCount);
  }
  return records;
}

async function queryRefreshTokenDaysChunk(conn: Connection, where: string, userIds: string[]): Promise<any[]> {
  const idList = userIds.map((id) => `'${id}'`).join(',');
  const res = await soqlQuery(
    `SELECT UserId, Application, Status, DAY_ONLY(LoginTime) d, COUNT(Id) cnt FROM LoginHistory ${where} AND UserId IN (${idList}) ` +
      'GROUP BY UserId, Application, Status, DAY_ONLY(LoginTime)',
    conn
  );
  const records = res.records || [];
  if (records.length < LOGIN_AGGREGATE_MAX_GROUPS || userIds.length === 1) {
    return records;
  }
  const half = Math.ceil(userIds.length / 2);
  return [
    ...(await queryRefreshTokenDaysChunk(conn, where, userIds.slice(0, half))),
    ...(await queryRefreshTokenDaysChunk(conn, where, userIds.slice(half))),
  ];
}

function checkDeviceFlow(context: CheckContext): WhatWillBreakCheckResult {
  const key: WhatWillBreakCheckKey = 'deviceFlow';
  const title = t('authRetirementsCheckDeviceFlow');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  const groups = filterLoginGroups(
    context,
    groupLogins(context.logins.records, context.logins.usernameById, DEVICE_FLOW_SUBTYPES, ['userId', 'application'])
  );
  return loginGroupsResult(context, key, title, groups, 'authRetirementsDetailDeviceFlow', 'whatWillBreakDeviceFlow');
}

async function checkSoapLoginPermission(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'soapLoginPermission';
  const title = t('authRetirementsCheckSoapPermission');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  if (!(await isFieldOnObject(context.conn, 'PermissionSet', 'PermissionsUseAnyApiAuth'))) {
    return notAvailableResult(context, key, title, t('authRetirementsUseAnyApiAuthMissing'));
  }
  const groups = filterLoginGroups(
    context,
    groupLogins(context.logins.records, context.logins.usernameById, SOAP_LOGIN_SUBTYPES, ['userId'])
  ).filter((group) => context.logins.activeUserIds.has(group.userId));
  const usersWithPermission = await queryUsersWithPermission(
    context.conn,
    groups.map((group) => group.userId),
    'PermissionsUseAnyApiAuth'
  );
  const missing = groups.filter((group) => !usersWithPermission.has(group.userId));
  // Failed logins are kept: after enforcement, a caller without the permission only fails (INSUFFICIENT_ACCESS)
  return loginGroupsResult(context, key, title, missing, 'authRetirementsDetailSoapPermission', 'whatWillBreakSoapPermission', true);
}

async function queryUsersWithPermission(conn: Connection, userIds: string[], permissionField: string): Promise<Set<string>> {
  const result = new Set<string>();
  for (let i = 0; i < userIds.length; i += USER_QUERY_CHUNK_SIZE) {
    const idList = userIds
      .slice(i, i + USER_QUERY_CHUNK_SIZE)
      .map((id) => `'${id}'`)
      .join(',');
    const res = await soqlQuery(
      `SELECT AssigneeId FROM PermissionSetAssignment WHERE PermissionSet.${permissionField} = true AND AssigneeId IN (${idList})`,
      conn
    );
    for (const record of res.records || []) {
      result.add(record.AssigneeId);
    }
  }
  return result;
}

async function checkSoapLoginIpRange(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'soapLoginIpRange';
  const title = t('authRetirementsCheckSoapIpRange');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  const ipRanges = await fetchTrustedIpRanges(context.conn);
  if (ipRanges === null) {
    return notAvailableResult(context, key, title, t('authRetirementsNetworkAccessUnavailable'));
  }
  const isWide = (range: any) =>
    isRangeWiderThan(range.start, range.end, SOAP_LOGIN_WIDE_RANGE_IPV4_PREFIX, SOAP_LOGIN_WIDE_RANGE_IPV6_PREFIX);
  const wideRanges = ipRanges.filter(isWide);
  const narrowRanges = ipRanges.filter((range) => !isWide(range));
  const groups = filterLoginGroups(
    context,
    groupLogins(context.logins.records, context.logins.usernameById, SOAP_LOGIN_SUBTYPES, ['userId', 'sourceIp'])
  );
  // A caller only covered by a wide trusted range logs in without security token today, and will need one
  const needingToken = groups.filter(
    (group) =>
      group.successCount > 0 &&
      wideRanges.some((range) => isIpInRange(group.sourceIp, range.start, range.end)) &&
      !narrowRanges.some((range) => isIpInRange(group.sourceIp, range.start, range.end))
  );
  const result = loginGroupsResult(
    context,
    key,
    title,
    needingToken,
    'authRetirementsDetailSoapIpRange',
    'whatWillBreakSoapIpRange'
  );
  // The wide ranges themselves are worth a look even when no SOAP caller uses them
  const wideRangeRows = wideRanges.map((range) =>
    buildRow(context, key, title, 'info', {
      Item: `${range.start} - ${range.end}`,
      Details: t('authRetirementsDetailWideRange', { description: range.description || '-' }),
      WhatWillBreak: t('whatWillBreakWideRangeImpact', {
        range: `${range.start} - ${range.end}`,
        when: getDeadlineWhen(key, context.isSandbox, context.today),
      }),
      LastSeen: '',
      Count: '',
      Recommendation: t('whatWillBreakWideRangeTodo', { range: `${range.start} - ${range.end}` }),
    })
  );
  if (wideRangeRows.length > 0) {
    result.rows = [...result.rows.filter((row) => row.Severity !== 'success'), ...wideRangeRows];
    if (result.status === 'success') {
      result.status = 'info';
      result.detail = t('authRetirementsFoundWideRanges', { count: wideRangeRows.length });
    }
  }
  return result;
}

async function fetchTrustedIpRanges(conn: Connection): Promise<any[] | null> {
  try {
    const res: any = await conn.tooling.query('SELECT Id, Metadata FROM SecuritySettings LIMIT 1');
    const ipRanges = res?.records?.[0]?.Metadata?.networkAccess?.ipRanges || [];
    return Array.isArray(ipRanges) ? ipRanges : [ipRanges];
  } catch {
    return null;
  }
}

function checkSoapLoginInactivity(context: CheckContext): WhatWillBreakCheckResult {
  const key: WhatWillBreakCheckKey = 'soapLoginInactivity';
  const title = t('authRetirementsCheckSoapInactivity');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  // Every caller keeps login() on in the org, ignored users included: they only leave the list of rare callers
  const allCallers = groupLogins(context.logins.records, context.logins.usernameById, SOAP_LOGIN_SUBTYPES, ['userId']).filter(
    (group) => group.successCount > 0
  );
  const groups = filterLoginGroups(context, allCallers);
  const lastOrgCall = allCallers.reduce((latest, group) => (group.lastSuccess > latest ? group.lastSuccess : latest), '');
  if (!lastOrgCall) {
    const row = buildRow(context, key, title, 'info', {
      Item: '-',
      Details: t('authRetirementsDetailNoSoapLogin', { days: context.lookbackDays }),
      WhatWillBreak: t('authRetirementsDetailNoSoapLogin', { days: context.lookbackDays }),
      LastSeen: '',
      Count: 0,
      Recommendation: t('whatWillBreakNothingToDo'),
    });
    return {
      key,
      status: 'info',
      title,
      detail: row.Details,
      deadline: row.Deadline,
      howToFixUrl: row.HowToFix,
      rows: [row],
    };
  }
  const daysSince = (date: string) => Math.floor((context.today.getTime() - new Date(date).getTime()) / DAY_MS);
  const rows: WhatWillBreakDetailRow[] = [];
  const orgIdle = daysSince(lastOrgCall);
  if (orgIdle > SOAP_LOGIN_INACTIVITY_WARNING_DAYS) {
    rows.push(
      buildRow(context, key, title, 'warning', {
        Item: '-',
        Details: t('authRetirementsDetailOrgSoapIdle', { days: orgIdle, limit: SOAP_LOGIN_INACTIVITY_DAYS }),
        WhatWillBreak: t('whatWillBreakOrgSoapIdleImpact', { days: orgIdle, limit: SOAP_LOGIN_INACTIVITY_DAYS }),
        LastSeen: formatDate(lastOrgCall),
        Count: '',
        Recommendation: t('whatWillBreakOrgSoapIdleTodo'),
      })
    );
  }
  for (const group of groups.filter((g) => daysSince(g.lastSuccess) > SOAP_LOGIN_RARE_CALLER_DAYS)) {
    rows.push(
      markRowSensitiveValues<WhatWillBreakDetailRow>(
        buildRow(context, key, title, 'info', {
          Item: group.username,
          Details: t('authRetirementsDetailRareSoapCaller', { days: daysSince(group.lastSuccess) }),
          WhatWillBreak: t('whatWillBreakRareSoapCallerImpact', { user: group.username, days: daysSince(group.lastSuccess) }),
          LastSeen: formatDate(group.lastSuccess),
          Count: group.successCount,
          Recommendation: t('whatWillBreakRareSoapCallerTodo', { user: group.username }),
        }),
        [group.username]
      )
    );
  }
  const status: WhatWillBreakSeverity = rows.some((r) => r.Severity === 'warning') ? 'warning' : rows.length > 0 ? 'info' : 'success';
  const detail =
    status === 'success'
      ? t('authRetirementsSoapLoginActive', { date: formatDate(lastOrgCall) })
      : t('authRetirementsFoundRareSoapCallers', { count: rows.length, date: formatDate(lastOrgCall) });
  if (rows.length === 0) {
    rows.push(successRow(context, key, title, detail));
  }
  return { key, status, title, detail, deadline: getDeadlineLabel(key, context.isSandbox, context.today), howToFixUrl: getFixDocUrl(key), rows };
}

async function checkUsernamePasswordFlow(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'usernamePasswordFlow';
  const title = t('authRetirementsCheckUsernamePassword');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  const groups = filterLoginGroups(
    context,
    groupLogins(context.logins.records, context.logins.usernameById, USERNAME_PASSWORD_FLOW_SUBTYPES, [
      'userId',
      'application',
      'loginSubType',
    ])
  );
  const result = loginGroupsResult(
    context,
    key,
    title,
    groups,
    'authRetirementsDetailUsernamePassword',
    'whatWillBreakUsernamePassword'
  );
  if (groups.length === 0) {
    const oauthSettings = await fetchOauthOidcSettings(context.conn);
    if (oauthSettings?.blockOAuthUnPwFlow === true) {
      result.detail = t('authRetirementsFlowsAlreadyBlocked');
      result.rows = [successRow(context, key, title, result.detail)];
    }
  }
  // User-agent flow logins: one information row per app, with its number of users
  const userAgentApps = groupLogins(context.logins.records, context.logins.usernameById, USER_AGENT_FLOW_SUBTYPES, [
    'application',
    'loginSubType',
  ]).filter((group) => group.successCount > 0);
  if (userAgentApps.length > 0) {
    const userAgentUsers = groupLogins(context.logins.records, context.logins.usernameById, USER_AGENT_FLOW_SUBTYPES, [
      'application',
      'loginSubType',
      'userId',
    ]).filter((group) => group.successCount > 0);
    const userAgentRows = userAgentApps.map((app) =>
      buildRow(context, key, title, 'info', {
        Item: app.application,
        Details: t('authRetirementsDetailUserAgent', {
          loginSubType: app.loginSubType,
          users: userAgentUsers.filter((u) => u.application === app.application && u.loginSubType === app.loginSubType).length,
        }),
        WhatWillBreak: t('whatWillBreakUserAgentImpact', {
          app: app.application,
          loginSubType: app.loginSubType,
          users: userAgentUsers.filter((u) => u.application === app.application && u.loginSubType === app.loginSubType).length,
        }),
        LastSeen: formatDate(app.lastSuccess),
        Count: app.successCount,
        // Salesforce moves its own apps (mobile apps, browser): only the other apps need something from the org
        Recommendation: t(isSalesforceUserAgentApp(app.application) ? 'whatWillBreakUserAgentTodoSalesforce' : 'whatWillBreakUserAgentTodo', {
          app: app.application,
        }),
      })
    );
    result.rows = [...result.rows.filter((row) => row.Severity !== 'success'), ...userAgentRows];
    if (result.status === 'success') {
      result.status = 'info';
      result.detail = t('authRetirementsFoundUserAgentApps', { count: userAgentApps.length });
    }
  }
  return result;
}

function isSalesforceUserAgentApp(application: string): boolean {
  return isSalesforceEndUserApp(application) || /^(salesforce|browser)/i.test(application || '');
}

async function fetchOauthOidcSettings(conn: Connection): Promise<any> {
  try {
    const res: any = await conn.tooling.query('SELECT Id, Metadata FROM OauthOidcSettings LIMIT 1');
    return res?.records?.[0]?.Metadata || null;
  } catch {
    return null;
  }
}

async function checkSfConnectLegacyAuth(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'sfConnectLegacyAuth';
  const title = t('authRetirementsCheckSfConnect');
  let dataSources: any[];
  try {
    const res = await soqlQuery(
      "SELECT Id, DeveloperName, MasterLabel, Protocol, PrincipalType, NamedCredentialId FROM ExternalDataSource WHERE Type = 'SfdcOrg'",
      context.conn
    );
    dataSources = res.records || [];
  } catch (e) {
    if (isUnsupportedSObjectError(e, 'ExternalDataSource')) {
      return notAvailableResult(context, key, title, t('authRetirementsObjectNotAvailable', { object: 'ExternalDataSource' }));
    }
    return notAvailableResult(context, key, title, (e as Error).message);
  }
  const severity = getDeadlineSeverity(key, context.isSandbox, context.today);
  const legacy = dataSources.filter(
    (ds) => !ds.NamedCredentialId && ds.Protocol && ds.Protocol !== 'NoAuthentication'
  );
  const rows = legacy.map((ds) =>
    buildRow(context, key, title, severity, {
      Item: `${ds.MasterLabel} (${ds.DeveloperName})`,
      Details: t('authRetirementsDetailSfConnect', { protocol: ds.Protocol, principalType: ds.PrincipalType || '-' }),
      WhatWillBreak: t('whatWillBreakSfConnectImpact', {
        name: ds.MasterLabel,
        protocol: ds.Protocol,
        when: getDeadlineWhen(key, context.isSandbox, context.today),
      }),
      LastSeen: '',
      Count: '',
      Recommendation: t('whatWillBreakSfConnectTodo', { name: ds.MasterLabel }),
    })
  );
  return finalizeCheck(context, key, title, rows, rows.length, t('authRetirementsFoundSfConnect', { count: rows.length }));
}

function checkSoapLoginRetirement(context: CheckContext): WhatWillBreakCheckResult {
  const key: WhatWillBreakCheckKey = 'soapLoginRetirement';
  const title = t('authRetirementsCheckSoapRetirement');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  const groups = filterLoginGroups(
    context,
    groupLogins(context.logins.records, context.logins.usernameById, SOAP_LOGIN_SUBTYPES, [
      'userId',
      'application',
      'apiVersion',
    ])
  );
  return loginGroupsResult(context, key, title, groups, 'authRetirementsDetailSoapRetirement', 'whatWillBreakSoapRetirement');
}

// Skip the groups of ignored users
function filterLoginGroups(context: CheckContext, groups: LoginGroup[]): LoginGroup[] {
  return groups.filter((group) => !context.ignoreSet.has(group.username.toLowerCase()));
}

// Result of a check whose findings are login groups: one row per group, the metric is the number of distinct users.
// Only active users count, and only their successful logins unless includeFailedOnly is set.
// findingKeyPrefix names the two texts of a finding: <prefix>Impact (what will break) and <prefix>Todo (what to do).
function loginGroupsResult(
  context: CheckContext,
  key: WhatWillBreakCheckKey,
  title: string,
  groups: LoginGroup[],
  detailKey: string,
  findingKeyPrefix: string,
  includeFailedOnly = false
): WhatWillBreakCheckResult {
  const when = getDeadlineWhen(key, context.isSandbox, context.today);
  const severity = getDeadlineSeverity(key, context.isSandbox, context.today);
  const findings = groups.filter(
    (group) =>
      context.logins.activeUserIds.has(group.userId) && (group.successCount > 0 || (includeFailedOnly && group.failedCount > 0))
  );
  const rows = findings.map((group) => {
    const params = {
      application: group.application,
      apiVersion: group.apiVersion,
      loginSubType: group.loginSubType,
      sourceIp: group.sourceIp || '-',
      failed: group.failedCount,
      user: group.username,
      when,
    };
    return markRowSensitiveValues<WhatWillBreakDetailRow>(
      buildRow(context, key, title, severity, {
        Item: group.username,
        Details: t(detailKey, params),
        WhatWillBreak: t(`${findingKeyPrefix}Impact`, params),
        LastSeen: formatDate(group.lastSuccess),
        Count: group.successCount,
        Recommendation: t(`${findingKeyPrefix}Todo`, params),
      }),
      [
        { value: group.username, kind: 'user' },
        group.sourceIp ? { value: group.sourceIp, kind: 'ip' } : null,
      ]
    );
  });
  const users = new Set(findings.map((group) => group.userId)).size;
  return finalizeCheck(context, key, title, rows, users, t('authRetirementsFoundUsers', { count: users, days: context.lookbackDays }));
}


function loginHistoryUnavailableResult(
  context: CheckContext,
  key: WhatWillBreakCheckKey,
  title: string
): WhatWillBreakCheckResult {
  return notAvailableResult(context, key, title, t('authRetirementsLoginHistoryUnavailable'));
}
