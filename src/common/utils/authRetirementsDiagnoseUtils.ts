import { Connection } from '@salesforce/core';
import { isFieldOnObject, isUnsupportedSObjectError, soqlQuery } from './apiUtils.js';
import { markRowSensitiveValues } from './anonymizeUtils.js';
import { queryAllOAuthTokens } from './oauthTokenUtils.js';
import { isIpInRange, isRangeWiderThan } from './ipRangeUtils.js';
import { t } from './i18n.js';
import { CONSTANTS } from '../../config/index.js';

export type AuthRetirementCheckKey =
  | 'idleRefreshTokens'
  | 'deviceFlow'
  | 'soapLoginPermission'
  | 'soapLoginIpRange'
  | 'soapLoginInactivity'
  | 'usernamePasswordFlow'
  | 'sfConnectLegacyAuth'
  | 'soapLoginRetirement';

export type AuthRetirementSeverity = 'success' | 'info' | 'warning' | 'error';

export interface AuthRetirementDeadline {
  productionDate: string;
  sandboxDate?: string;
  // Salesforce gives a release, not a day: the date is only used to compute the severity
  releaseLabel?: string;
  // The change is already enforced and keeps acting every day (findings are warnings, not errors)
  rolling?: boolean;
  articleUrl: string;
  // Anchor of the "How to fix" section of this check on the doc page
  fixAnchor: string;
}

export interface AuthRetirementReportRow {
  Check: string;
  CheckKey: AuthRetirementCheckKey;
  Severity: AuthRetirementSeverity;
  Deadline: string;
  Item: string;
  Details: string;
  LastSeen: string;
  Count: number | string;
  Recommendation: string;
  HowToFix: string;
  Article: string;
}

export interface AuthRetirementCheckResult {
  key: AuthRetirementCheckKey;
  status: AuthRetirementSeverity;
  title: string;
  detail: string;
  deadline: string;
  howToFixUrl: string;
  rows: AuthRetirementReportRow[];
  // true when the check could not run on this org (missing object or permission)
  notChecked?: boolean;
  // undefined when the check could not run on this org: no metric is sent then
  metric?: number;
}

export interface AuthRetirementsOptions {
  conn: Connection;
  lookbackDays: number;
  idleWarningDays: number;
  ignoreUsers: string[];
  today?: Date;
}

export interface AuthRetirementsResult {
  checks: AuthRetirementCheckResult[];
  metrics: Record<string, number>;
  severity: 'error' | 'warning' | 'log';
  reportRows: AuthRetirementReportRow[];
}

// Salesforce dates of every change. When Salesforce moves a date, update it here only.
export const AUTH_RETIREMENT_DEADLINES: Record<AuthRetirementCheckKey, AuthRetirementDeadline> = {
  idleRefreshTokens: {
    productionDate: '2026-11-04',
    sandboxDate: '2026-10-21',
    rolling: true,
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005461275&type=1',
    fixAnchor: 'fix-idle-refresh-tokens',
  },
  deviceFlow: {
    productionDate: '2026-11-30',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005461280&type=1',
    fixAnchor: 'fix-device-flow',
  },
  soapLoginPermission: {
    productionDate: '2026-12-01',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-permission',
  },
  soapLoginIpRange: {
    productionDate: '2027-01-31',
    sandboxDate: '2026-12-15',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-ip-range',
  },
  soapLoginInactivity: {
    productionDate: '2027-01-31',
    sandboxDate: '2026-12-15',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-inactivity',
  },
  usernamePasswordFlow: {
    productionDate: '2027-02-20',
    articleUrl:
      'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5',
    fixAnchor: 'fix-username-password-flow',
  },
  sfConnectLegacyAuth: {
    productionDate: '2027-02-13',
    releaseLabel: "Spring '27",
    articleUrl:
      'https://help.salesforce.com/s/articleView?id=release-notes.rn_sf_connect_xorg_legacy_auth_retiring_ru.htm&release=264&type=5',
    fixAnchor: 'fix-salesforce-connect',
  },
  soapLoginRetirement: {
    productionDate: '2027-06-01',
    releaseLabel: "Summer '27",
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-retirement',
  },
};

export const AUTH_RETIREMENTS_DOC_URL = `${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-auth-retirements/`;

// A finding becomes an error when its deadline is closer than this
export const AUTH_RETIREMENT_ERROR_DAYS = 60;
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

const DAY_MS = 86400000;
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

interface LoginContext {
  failed: boolean;
  records: any[];
  usernameById: Map<string, string>;
  activeUserIds: Set<string>;
}

interface CheckContext {
  conn: Connection;
  today: Date;
  isSandbox: boolean;
  lookbackDays: number;
  idleWarningDays: number;
  ignoreSet: Set<string>;
  logins: LoginContext;
}

export async function diagnoseAuthRetirements(options: AuthRetirementsOptions): Promise<AuthRetirementsResult> {
  const today = options.today || new Date();
  const context: CheckContext = {
    conn: options.conn,
    today,
    isSandbox: await fetchIsSandbox(options.conn),
    lookbackDays: options.lookbackDays,
    idleWarningDays: options.idleWarningDays,
    ignoreSet: new Set(options.ignoreUsers.map((u) => u.toLowerCase())),
    logins: await fetchLogins(options.conn, options.lookbackDays),
  };

  // Checks are sorted by deadline, the closest first
  const checks: AuthRetirementCheckResult[] = [
    await checkIdleRefreshTokens(context),
    checkDeviceFlow(context),
    await checkSoapLoginPermission(context),
    await checkSoapLoginIpRange(context),
    checkSoapLoginInactivity(context),
    await checkUsernamePasswordFlow(context),
    await checkSfConnectLegacyAuth(context),
    checkSoapLoginRetirement(context),
  ];

  const metrics = buildMetrics(checks);
  const severity = rollupSeverity(checks);
  const reportRows = checks.flatMap((ck) => ck.rows);
  return { checks, metrics, severity, reportRows };
}

// Severity of a finding of a check, from the time left before its deadline
export function getDeadlineSeverity(key: AuthRetirementCheckKey, isSandbox: boolean, today: Date): 'error' | 'warning' {
  const deadline = AUTH_RETIREMENT_DEADLINES[key];
  if (deadline.rolling) {
    return 'warning';
  }
  const daysLeft = getDaysLeft(key, isSandbox, today);
  return daysLeft <= AUTH_RETIREMENT_ERROR_DAYS ? 'error' : 'warning';
}

// Human readable deadline of a check: "Enforced since 2026-11-04", "2026-12-01 (16 days left)", "Summer '27"
export function getDeadlineLabel(key: AuthRetirementCheckKey, isSandbox: boolean, today: Date): string {
  const deadline = AUTH_RETIREMENT_DEADLINES[key];
  const date = getDeadlineDate(key, isSandbox);
  const daysLeft = getDaysLeft(key, isSandbox, today);
  if (daysLeft <= 0) {
    return t('authRetirementsDeadlinePassed', { date });
  }
  if (deadline.releaseLabel) {
    return deadline.releaseLabel;
  }
  return t('authRetirementsDeadlineIn', { date, days: daysLeft });
}

export function getDeadlineDate(key: AuthRetirementCheckKey, isSandbox: boolean): string {
  const deadline = AUTH_RETIREMENT_DEADLINES[key];
  return isSandbox && deadline.sandboxDate ? deadline.sandboxDate : deadline.productionDate;
}

// Link to the "How to fix" section of a check on the doc page
export function getFixDocUrl(key: AuthRetirementCheckKey): string {
  return `${AUTH_RETIREMENTS_DOC_URL}#${AUTH_RETIREMENT_DEADLINES[key].fixAnchor}`;
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

// Every API user can read Organization: an error here means the org cannot be reached (expired login, invalid session...).
// It is not caught, so the command fails instead of reporting every check as not run, which would read as "nothing to fix".
async function fetchIsSandbox(conn: Connection): Promise<boolean> {
  const res = await soqlQuery('SELECT IsSandbox FROM Organization LIMIT 1', conn);
  return res.records?.[0]?.IsSandbox === true;
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

async function checkIdleRefreshTokens(context: CheckContext): Promise<AuthRetirementCheckResult> {
  const key: AuthRetirementCheckKey = 'idleRefreshTokens';
  const title = t('authRetirementsCheckIdleTokens');
  let tokens: any[];
  try {
    tokens = await queryAllOAuthTokens(
      context.conn,
      'SELECT Id, AppName, LastUsedDate, CreatedDate, UseCount, UserId, User.Username, User.IsActive FROM OAuthToken'
    );
  } catch (e) {
    return notAvailableResult(context, key, title, (e as Error).message);
  }
  const apiOnlyUserIds = await queryApiOnlyUserIds(context.conn);
  const severity = getDeadlineSeverity(key, context.isSandbox, context.today);
  const rows: AuthRetirementReportRow[] = [];
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
    rows.push(
      markRowSensitiveValues<AuthRetirementReportRow>(
        buildRow(context, key, title, expired ? 'info' : severity, {
          Item: `${appUser.appName} - ${appUser.username}`,
          Details: expired
            ? t('authRetirementsDetailTokenExpired', { days: idleDays })
            : t('authRetirementsDetailTokenExpiring', { days: idleDays, left: REFRESH_TOKEN_IDLE_TTL_DAYS - idleDays }),
          LastSeen: formatDate(appUser.lastUse),
          Count: appUser.useCount,
          Recommendation: t(expired ? 'authRetirementsRecoTokenExpired' : 'authRetirementsRecoTokenExpiring'),
        }),
        [appUser.username]
      )
    );
  }
  for (const [appName, count] of Array.from(otherUsersExpiringByApp.entries()).sort()) {
    rows.push(
      buildRow(context, key, title, 'info', {
        Item: appName,
        Details: t('authRetirementsDetailTokensOtherUsers', { count, days: REFRESH_TOKEN_IDLE_TTL_DAYS }),
        LastSeen: '',
        Count: count,
        Recommendation: t('authRetirementsRecoTokensOtherUsers'),
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

function checkDeviceFlow(context: CheckContext): AuthRetirementCheckResult {
  const key: AuthRetirementCheckKey = 'deviceFlow';
  const title = t('authRetirementsCheckDeviceFlow');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  const groups = filterLoginGroups(
    context,
    groupLogins(context.logins.records, context.logins.usernameById, DEVICE_FLOW_SUBTYPES, ['userId', 'application'])
  );
  return loginGroupsResult(context, key, title, groups, 'authRetirementsDetailDeviceFlow', 'authRetirementsRecoDeviceFlow');
}

async function checkSoapLoginPermission(context: CheckContext): Promise<AuthRetirementCheckResult> {
  const key: AuthRetirementCheckKey = 'soapLoginPermission';
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
  return loginGroupsResult(context, key, title, missing, 'authRetirementsDetailSoapPermission', 'authRetirementsRecoSoapPermission', true);
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

async function checkSoapLoginIpRange(context: CheckContext): Promise<AuthRetirementCheckResult> {
  const key: AuthRetirementCheckKey = 'soapLoginIpRange';
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
    'authRetirementsRecoSoapIpRange'
  );
  // The wide ranges themselves are worth a look even when no SOAP caller uses them
  const wideRangeRows = wideRanges.map((range) =>
    buildRow(context, key, title, 'info', {
      Item: `${range.start} - ${range.end}`,
      Details: t('authRetirementsDetailWideRange', { description: range.description || '-' }),
      LastSeen: '',
      Count: '',
      Recommendation: t('authRetirementsRecoWideRange'),
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

function checkSoapLoginInactivity(context: CheckContext): AuthRetirementCheckResult {
  const key: AuthRetirementCheckKey = 'soapLoginInactivity';
  const title = t('authRetirementsCheckSoapInactivity');
  if (context.logins.failed) {
    return loginHistoryUnavailableResult(context, key, title);
  }
  const groups = filterLoginGroups(
    context,
    groupLogins(context.logins.records, context.logins.usernameById, SOAP_LOGIN_SUBTYPES, ['userId'])
  ).filter((group) => group.successCount > 0);
  const lastOrgCall = groups.reduce((latest, group) => (group.lastSuccess > latest ? group.lastSuccess : latest), '');
  if (!lastOrgCall) {
    const row = buildRow(context, key, title, 'info', {
      Item: '-',
      Details: t('authRetirementsDetailNoSoapLogin', { days: context.lookbackDays }),
      LastSeen: '',
      Count: 0,
      Recommendation: t('authRetirementsRecoNoSoapLogin'),
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
  const rows: AuthRetirementReportRow[] = [];
  const orgIdle = daysSince(lastOrgCall);
  if (orgIdle > SOAP_LOGIN_INACTIVITY_WARNING_DAYS) {
    rows.push(
      buildRow(context, key, title, 'warning', {
        Item: '-',
        Details: t('authRetirementsDetailOrgSoapIdle', { days: orgIdle, limit: SOAP_LOGIN_INACTIVITY_DAYS }),
        LastSeen: formatDate(lastOrgCall),
        Count: '',
        Recommendation: t('authRetirementsRecoOrgSoapIdle'),
      })
    );
  }
  for (const group of groups.filter((g) => daysSince(g.lastSuccess) > SOAP_LOGIN_RARE_CALLER_DAYS)) {
    rows.push(
      markRowSensitiveValues<AuthRetirementReportRow>(
        buildRow(context, key, title, 'info', {
          Item: group.username,
          Details: t('authRetirementsDetailRareSoapCaller', { days: daysSince(group.lastSuccess) }),
          LastSeen: formatDate(group.lastSuccess),
          Count: group.successCount,
          Recommendation: t('authRetirementsRecoRareSoapCaller'),
        }),
        [group.username]
      )
    );
  }
  const status: AuthRetirementSeverity = rows.some((r) => r.Severity === 'warning') ? 'warning' : rows.length > 0 ? 'info' : 'success';
  const detail =
    status === 'success'
      ? t('authRetirementsSoapLoginActive', { date: formatDate(lastOrgCall) })
      : t('authRetirementsFoundRareSoapCallers', { count: rows.length, date: formatDate(lastOrgCall) });
  if (rows.length === 0) {
    rows.push(successRow(context, key, title, detail));
  }
  return { key, status, title, detail, deadline: getDeadlineLabel(key, context.isSandbox, context.today), howToFixUrl: getFixDocUrl(key), rows };
}

async function checkUsernamePasswordFlow(context: CheckContext): Promise<AuthRetirementCheckResult> {
  const key: AuthRetirementCheckKey = 'usernamePasswordFlow';
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
    'authRetirementsRecoUsernamePassword'
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
        LastSeen: formatDate(app.lastSuccess),
        Count: app.successCount,
        Recommendation: t('authRetirementsRecoUserAgent'),
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

async function fetchOauthOidcSettings(conn: Connection): Promise<any> {
  try {
    const res: any = await conn.tooling.query('SELECT Id, Metadata FROM OauthOidcSettings LIMIT 1');
    return res?.records?.[0]?.Metadata || null;
  } catch {
    return null;
  }
}

async function checkSfConnectLegacyAuth(context: CheckContext): Promise<AuthRetirementCheckResult> {
  const key: AuthRetirementCheckKey = 'sfConnectLegacyAuth';
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
      LastSeen: '',
      Count: '',
      Recommendation: t('authRetirementsRecoSfConnect'),
    })
  );
  return finalizeCheck(context, key, title, rows, rows.length, t('authRetirementsFoundSfConnect', { count: rows.length }));
}

function checkSoapLoginRetirement(context: CheckContext): AuthRetirementCheckResult {
  const key: AuthRetirementCheckKey = 'soapLoginRetirement';
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
  return loginGroupsResult(context, key, title, groups, 'authRetirementsDetailSoapRetirement', 'authRetirementsRecoSoapRetirement');
}

// Skip the groups of ignored users
function filterLoginGroups(context: CheckContext, groups: LoginGroup[]): LoginGroup[] {
  return groups.filter((group) => !context.ignoreSet.has(group.username.toLowerCase()));
}

// Result of a check whose findings are login groups: one row per group, the metric is the number of distinct users.
// Only active users count, and only their successful logins unless includeFailedOnly is set.
function loginGroupsResult(
  context: CheckContext,
  key: AuthRetirementCheckKey,
  title: string,
  groups: LoginGroup[],
  detailKey: string,
  recommendationKey: string,
  includeFailedOnly = false
): AuthRetirementCheckResult {
  const severity = getDeadlineSeverity(key, context.isSandbox, context.today);
  const findings = groups.filter(
    (group) =>
      context.logins.activeUserIds.has(group.userId) && (group.successCount > 0 || (includeFailedOnly && group.failedCount > 0))
  );
  const rows = findings.map((group) =>
    markRowSensitiveValues<AuthRetirementReportRow>(
      buildRow(context, key, title, severity, {
        Item: group.username,
        Details: t(detailKey, {
          application: group.application,
          apiVersion: group.apiVersion,
          loginSubType: group.loginSubType,
          sourceIp: group.sourceIp || '-',
          failed: group.failedCount,
        }),
        LastSeen: formatDate(group.lastSuccess),
        Count: group.successCount,
        Recommendation: t(recommendationKey),
      }),
      [
        { value: group.username, kind: 'user' },
        group.sourceIp ? { value: group.sourceIp, kind: 'ip' } : null,
      ]
    )
  );
  const users = new Set(findings.map((group) => group.userId)).size;
  return finalizeCheck(context, key, title, rows, users, t('authRetirementsFoundUsers', { count: users, days: context.lookbackDays }));
}

function finalizeCheck(
  context: CheckContext,
  key: AuthRetirementCheckKey,
  title: string,
  rows: AuthRetirementReportRow[],
  metric: number,
  foundDetail: string
): AuthRetirementCheckResult {
  const deadline = getDeadlineLabel(key, context.isSandbox, context.today);
  const order: Record<AuthRetirementSeverity, number> = { success: 0, info: 1, warning: 2, error: 3 };
  const status = rows.reduce<AuthRetirementSeverity>(
    (worst, row) => (order[row.Severity] > order[worst] ? row.Severity : worst),
    'success'
  );
  if (rows.length === 0) {
    const detail = t('authRetirementsNothingFound');
    return {
      key,
      status: 'success',
      title,
      detail,
      deadline,
      howToFixUrl: getFixDocUrl(key),
      rows: [successRow(context, key, title, detail)],
      metric,
    };
  }
  // Only information rows: nothing to act on
  const detail = status === 'info' ? t('authRetirementsInfoOnly', { count: rows.length }) : foundDetail;
  return { key, status, title, detail, deadline, howToFixUrl: getFixDocUrl(key), rows, metric };
}

function loginHistoryUnavailableResult(
  context: CheckContext,
  key: AuthRetirementCheckKey,
  title: string
): AuthRetirementCheckResult {
  return notAvailableResult(context, key, title, t('authRetirementsLoginHistoryUnavailable'));
}

function notAvailableResult(
  context: CheckContext,
  key: AuthRetirementCheckKey,
  title: string,
  reason: string
): AuthRetirementCheckResult {
  const detail = t('authRetirementsCheckNotAvailable', { reason });
  const row = buildRow(context, key, title, 'info', {
    Item: '-',
    Details: detail,
    LastSeen: '',
    Count: '',
    Recommendation: '',
  });
  return {
    key,
    status: 'info',
    title,
    detail,
    deadline: row.Deadline,
    howToFixUrl: row.HowToFix,
    rows: [row],
    notChecked: true,
  };
}

function successRow(context: CheckContext, key: AuthRetirementCheckKey, title: string, detail: string): AuthRetirementReportRow {
  return buildRow(context, key, title, 'success', {
    Item: '-',
    Details: detail,
    LastSeen: '',
    Count: 0,
    Recommendation: '',
  });
}

function buildRow(
  context: CheckContext,
  key: AuthRetirementCheckKey,
  title: string,
  severity: AuthRetirementSeverity,
  values: Pick<AuthRetirementReportRow, 'Item' | 'Details' | 'LastSeen' | 'Count' | 'Recommendation'>
): AuthRetirementReportRow {
  return {
    Check: title,
    CheckKey: key,
    Severity: severity,
    Deadline: getDeadlineLabel(key, context.isSandbox, context.today),
    ...values,
    HowToFix: getFixDocUrl(key),
    Article: AUTH_RETIREMENT_DEADLINES[key].articleUrl,
  };
}

function buildMetrics(checks: AuthRetirementCheckResult[]): Record<string, number> {
  const metricNames: Partial<Record<AuthRetirementCheckKey, string>> = {
    idleRefreshTokens: 'IdleRefreshTokensExpiringSoon',
    deviceFlow: 'DeviceFlowUsers',
    soapLoginPermission: 'SoapLoginUsersMissingPermission',
    soapLoginIpRange: 'SoapLoginUsersNeedingToken',
    usernamePasswordFlow: 'UsernamePasswordFlowUsers',
    sfConnectLegacyAuth: 'SfConnectLegacyDataSources',
    soapLoginRetirement: 'SoapLoginUsers',
  };
  const metrics: Record<string, number> = {};
  for (const check of checks) {
    const metricName = metricNames[check.key];
    // A check that could not run on this org sends no metric: an absent metric is "not measured", a 0 is "none found"
    if (metricName && check.metric !== undefined) {
      metrics[metricName] = check.metric;
    }
  }
  return metrics;
}

function rollupSeverity(checks: AuthRetirementCheckResult[]): 'error' | 'warning' | 'log' {
  if (checks.some((ck) => ck.status === 'error')) {
    return 'error';
  }
  if (checks.some((ck) => ck.status === 'warning')) {
    return 'warning';
  }
  return 'log';
}

function getDaysLeft(key: AuthRetirementCheckKey, isSandbox: boolean, today: Date): number {
  const date = new Date(`${getDeadlineDate(key, isSandbox)}T00:00:00Z`);
  return Math.ceil((date.getTime() - today.getTime()) / DAY_MS);
}

function formatDate(value: string): string {
  return value ? new Date(value).toISOString().split('T')[0] : '';
}
