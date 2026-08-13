import { Connection } from '@salesforce/core';
import { soqlQuery } from './apiUtils.js';
import { t } from './i18n.js';

export type MfaCheckKey =
  | 'phishingResistantReadiness'
  | 'orgEnforcement'
  | 'mfaBypassUsers'
  | 'privilegedUsersAudit'
  | 'sso'
  | 'nonMfaLogins';

/* Salesforce VerificationHistory.VerificationMethod picklist values that count as phishing-resistant */
export const PHISHING_RESISTANT_METHODS = new Set<string>([
  'U2F',
  'BuiltInAuthenticator',
  'WebAuthnRoamingAuthenticator',
  'PwlessPasskey',
]);

/*
 * Every row in the report shares this shape so the CSV / XLSX has consistent
 * columns regardless of which check produced the row. `Severity` follows the
 * standard NotifSeverity vocabulary used everywhere else in sfdx-hardis
 * (log < success < info < warning < error < critical). `Recommendation`
 * tells the admin what to do next; empty means no action needed.
 */
export type MfaRowSeverity = 'success' | 'info' | 'warning' | 'error';

export interface MfaReportRow {
  Check: string;
  CheckKey: MfaCheckKey;
  Severity: MfaRowSeverity;
  Item: string;
  Details: string;
  Recommendation: string;
}

export interface MfaCheckResult {
  key: MfaCheckKey;
  status: MfaRowSeverity;
  title: string;
  detail: string;
  rows: MfaReportRow[];
  metric: number;
}

export interface MfaDiagnoseOptions {
  conn: Connection;
  lookbackDays: number;
  /* Window used to inspect VerificationHistory for phishing-resistant method registration / usage */
  phishingResistantLookbackDays: number;
  ignoreUsers: string[];
  privilegedPermFields: string[];
  debug?: boolean;
}

export interface MfaDiagnoseMetrics {
  OrgMfaOptedIn: 0 | 1;
  MfaBypassUsers: number;
  PrivilegedUsersWithBypass: number;
  PrivilegedUsersMissingApiMfa: number;
  PrivilegedUsersNotPhishingResistant: number;
  SsoEnabled: 0 | 1;
  NonMfaLogins: number;
  WeakIdentityFlags: number;
}

interface LatestVerification {
  method: string;
  time: string;
}

interface VerificationScan {
  latestByUserId: Record<string, LatestVerification>;
  failed: boolean;
}

interface PrivilegedUserEntry {
  Id: string;
  Username: string;
  Name: string;
  GrantedVia: Set<string>;
  ProfileId: string;
}

interface PrivilegedUserContext {
  userIndex: Record<string, PrivilegedUserEntry>;
  privilegedUsernames: string[];
  bypassUsernames: Set<string>;
  twoFactorApiUsernames: Set<string>;
}

/*
 * PermissionsBypassMFAForUiLogins is not provisioned in every org edition. Querying it
 * where it does not exist throws INVALID_FIELD, so its availability is checked with a
 * describe call before building any SOQL that references it.
 */
interface BypassFieldAvailability {
  permissionSet: boolean;
  profile: boolean;
}

export interface MfaDiagnoseResult {
  checks: MfaCheckResult[];
  metrics: MfaDiagnoseMetrics;
  severity: 'error' | 'warning' | 'log';
  reportRows: MfaReportRow[];
  /* Action items grouped by severity, ready for the end-of-command summary log */
  actionItems: { severity: 'error' | 'warning' | 'info'; recommendation: string; items: string[] }[];
}

const STRONG_AUTH_TOKENS = ['mfa', 'swk', 'fido', 'wia', 'hwk', 'face', 'fpt', 'otp'];

export const DEFAULT_PRIVILEGED_PERM_FIELDS = [
  'PermissionsModifyAllData',
  'PermissionsViewAllData',
  'PermissionsCustomizeApplication',
  'PermissionsAuthorApex',
];

/* Users per VerificationHistory query - keeps the IN () clause well below the SOQL length limit */
const VERIFICATION_HISTORY_CHUNK_SIZE = 200;

export async function diagnoseMfa(options: MfaDiagnoseOptions): Promise<MfaDiagnoseResult> {
  const ignoreSet = new Set(options.ignoreUsers.map((u) => u.toLowerCase()));

  const securityMetadata = await fetchSecurityMetadata(options.conn);

  const bypassField: BypassFieldAvailability = {
    permissionSet: await isFieldOnObject(options.conn, 'PermissionSet', 'PermissionsBypassMFAForUiLogins'),
    profile: await isFieldOnObject(options.conn, 'Profile', 'PermissionsBypassMFAForUiLogins'),
  };

  /*
   * Build the privileged-user context once so checkPhishingResistantReadiness (primary check) and
   * checkPrivilegedUsersAudit share the same source of truth and we save a round-trip to the org.
   */
  const privilegedContext = await buildPrivilegedUserContext(
    options.conn,
    options.privilegedPermFields,
    ignoreSet,
    bypassField
  );

  const privilegedIds = privilegedContext.privilegedUsernames
    .map((u) => privilegedContext.userIndex[u].Id)
    .filter((id) => !!id);
  const verificationScan = await fetchLatestVerificationByUser(
    options.conn,
    privilegedIds,
    options.phishingResistantLookbackDays
  );

  /*
   * Order matters: phishing-resistant readiness is the PRIMARY check for the Salesforce
   * enforcement rolling out July-September 2026 (Help article 005321563). It appears first
   * in the summary table, the per-check detail tables, and the "Actions to take" group
   * (which is already severity-sorted).
   */
  const phishingResistant = checkPhishingResistantReadiness(
    privilegedContext,
    verificationScan,
    options.phishingResistantLookbackDays,
    securityMetadata
  );
  const orgEnforcement = await checkOrgEnforcement(options.conn, securityMetadata, options.lookbackDays);
  const mfaBypassUsers = await checkMfaBypassUsers(options.conn, ignoreSet, bypassField);
  const privilegedUsersAudit = checkPrivilegedUsersAuditFromContext(privilegedContext);
  const sso = checkSso(securityMetadata);
  const nonMfaLogins = await checkNonMfaLogins(options.conn, options.lookbackDays, ignoreSet);

  const checks = [
    phishingResistant,
    orgEnforcement,
    mfaBypassUsers,
    privilegedUsersAudit,
    sso,
    nonMfaLogins,
  ];

  const metrics: MfaDiagnoseMetrics = {
    OrgMfaOptedIn: orgEnforcement.status === 'success' ? 1 : 0,
    MfaBypassUsers: mfaBypassUsers.metric,
    PrivilegedUsersWithBypass: privilegedUsersAudit.rows.filter((r) => r.Severity === 'error').length,
    PrivilegedUsersMissingApiMfa: privilegedUsersAudit.rows.filter(
      (r) => r.Severity === 'warning' && r.Recommendation.includes('TwoFactorApi')
    ).length,
    PrivilegedUsersNotPhishingResistant: phishingResistant.metric,
    SsoEnabled: sso.status === 'info' ? 1 : 0,
    NonMfaLogins: nonMfaLogins.metric,
    WeakIdentityFlags: orgEnforcement.rows.filter((r) => r.Severity === 'warning').length,
  };

  const severity = rollupSeverity(checks, metrics);

  const reportRows = checks.flatMap((c) => c.rows);

  const actionItems = buildActionItems(reportRows);

  return { checks, metrics, severity, reportRows, actionItems };
}

function rollupSeverity(checks: MfaCheckResult[], metrics: MfaDiagnoseMetrics): 'error' | 'warning' | 'log' {
  if (
    checks.find((c) => c.key === 'phishingResistantReadiness')?.status === 'error' ||
    checks.find((c) => c.key === 'orgEnforcement')?.status === 'error' ||
    metrics.PrivilegedUsersWithBypass > 0 ||
    metrics.PrivilegedUsersNotPhishingResistant > 0 ||
    metrics.NonMfaLogins > 0
  ) {
    return 'error';
  }
  if (checks.some((c) => c.status === 'warning' || c.status === 'info')) {
    return 'warning';
  }
  return 'log';
}

function buildActionItems(
  rows: MfaReportRow[]
): { severity: 'error' | 'warning' | 'info'; recommendation: string; items: string[] }[] {
  const groups: Record<string, { severity: 'error' | 'warning' | 'info'; recommendation: string; items: string[] }> =
    {};
  for (const row of rows) {
    if (row.Severity === 'success' || !row.Recommendation) continue;
    const key = `${row.Severity}::${row.Recommendation}`;
    if (!groups[key]) {
      groups[key] = {
        severity: row.Severity as 'error' | 'warning' | 'info',
        recommendation: row.Recommendation,
        items: [],
      };
    }
    const display = row.Details ? `${row.Item} - ${row.Details}` : row.Item;
    if (display) {
      groups[key].items.push(display);
    }
  }
  /* Order: error first, then warning, then info */
  const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
  return Object.values(groups).sort((a, b) => order[a.severity] - order[b.severity]);
}

/* Describe the sObject and confirm the field exists; on describe failure assume absent so no query crashes */
async function isFieldOnObject(conn: Connection, sobjectName: string, fieldName: string): Promise<boolean> {
  try {
    const describeResult = await conn.sobject(sobjectName).describe();
    return (describeResult.fields || []).some((f: any) => f.name === fieldName);
  } catch {
    return false;
  }
}

/*
 * Latest successful verification per user over the lookback window. Chunked because a single
 * IN () clause listing every user of a large org would blow past the SOQL statement length limit.
 * ORDER BY VerificationTime DESC + "first wins" in code = latest verification only.
 */
async function fetchLatestVerificationByUser(
  conn: Connection,
  userIds: string[],
  lookbackDays: number
): Promise<VerificationScan> {
  const latestByUserId: Record<string, LatestVerification> = {};
  for (let i = 0; i < userIds.length; i += VERIFICATION_HISTORY_CHUNK_SIZE) {
    const idList = userIds
      .slice(i, i + VERIFICATION_HISTORY_CHUNK_SIZE)
      .map((id) => `'${id}'`)
      .join(',');
    const query = `SELECT UserId, VerificationMethod, VerificationTime FROM VerificationHistory WHERE UserId IN (${idList}) AND Status IN ('Succeeded', 'AutomatedSuccess') AND VerificationTime = LAST_N_DAYS:${lookbackDays} ORDER BY VerificationTime DESC`;
    try {
      const res = await soqlQuery(query, conn);
      for (const r of (res.records || []) as any[]) {
        const uid = r.UserId as string;
        if (!uid || latestByUserId[uid]) continue;
        latestByUserId[uid] = { method: r.VerificationMethod || '', time: r.VerificationTime || '' };
      }
    } catch {
      /* A failure on any chunk makes the whole scan unreliable: partial data would report
         users as "no MFA" only because their chunk did not come back. */
      return { latestByUserId: {}, failed: true };
    }
  }
  return { latestByUserId, failed: false };
}

async function fetchSecurityMetadata(conn: Connection): Promise<any> {
  try {
    const res: any = await conn.tooling.query('SELECT Id, Metadata FROM SecuritySettings LIMIT 1');
    return res?.records?.[0]?.Metadata || {};
  } catch {
    return {};
  }
}

async function checkOrgEnforcement(
  conn: Connection,
  securityMetadata: any,
  lookbackDays: number
): Promise<MfaCheckResult> {
  const sessionSettings = securityMetadata?.sessionSettings || {};
  const enableMFADirectUILoginOptIn = sessionSettings.enableMFADirectUILoginOptIn === true;
  const skipSFAWhenMFADirectUILogin = sessionSettings.skipSFAWhenMFADirectUILogin === true;
  const enableSMSIdentity = sessionSettings.enableSMSIdentity === true;
  const canConfirmIdentityBySmsOnly = sessionSettings.canConfirmIdentityBySmsOnly === true;
  const identityConfirmationOnTwoFactorRegistrationEnabled =
    sessionSettings.identityConfirmationOnTwoFactorRegistrationEnabled === true;

  let platformEnforcementDetected = false;
  try {
    /* Status cannot be filtered server-side, so pull a window and inspect client-side */
    const q = `SELECT Status FROM LoginHistory WHERE LoginTime = LAST_N_DAYS:${lookbackDays} LIMIT 1000`;
    const res = await soqlQuery(q, conn);
    platformEnforcementDetected = (res.records || []).some((r: any) => r.Status === 'Multi-factor required');
  } catch {
    /* keep platformEnforcementDetected false */
  }

  const checkTitle = t('mfaCheckOrgEnforcementTitle');
  const checkKey: MfaCheckKey = 'orgEnforcement';
  const rows: MfaReportRow[] = [];

  /* Org opt-in flag */
  if (!enableMFADirectUILoginOptIn && !platformEnforcementDetected) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'error',
      Item: 'enableMFADirectUILoginOptIn',
      Details: t('mfaDetailOrgMfaOff'),
      Recommendation: t('mfaRecommendationEnforceMfaOrgWide'),
    });
  } else {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'success',
      Item: 'enableMFADirectUILoginOptIn',
      Details: enableMFADirectUILoginOptIn
        ? t('mfaDetailOrgMfaOptInOn')
        : t('mfaDetailOrgMfaPlatformEnforced'),
      Recommendation: '',
    });
  }

  /* SMS identity weak methods */
  if (enableSMSIdentity) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'warning',
      Item: 'enableSMSIdentity',
      Details: t('mfaDetailSmsIdentityEnabled'),
      Recommendation: t('mfaRecommendationDisableSmsIdentity'),
    });
  }
  if (canConfirmIdentityBySmsOnly) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'warning',
      Item: 'canConfirmIdentityBySmsOnly',
      Details: t('mfaDetailSmsOnlyEnabled'),
      Recommendation: t('mfaRecommendationDisableSmsOnly'),
    });
  }

  /*
   * Informational rows with real explanations of what each flag does.
   *
   * skipSFAWhenMFADirectUILogin is NOT about single-factor authentication despite how it reads:
   * per the Metadata API reference it decides which screen users see first when prompted to register
   * a verification method. True = the full list of supported methods. False = the built-in
   * authenticator (passkey) registration screen first. That is the Setup > Identity Verification
   * option "Show all verification method registration options instead of starting with built-in
   * authenticators", and it is the usual reason ordinary users report being "forced" to create a
   * passkey when they only need any MFA method.
   */
  rows.push({
    Check: checkTitle,
    CheckKey: checkKey,
    Severity: skipSFAWhenMFADirectUILogin ? 'success' : 'info',
    Item: 'skipSFAWhenMFADirectUILogin',
    Details: skipSFAWhenMFADirectUILogin
      ? t('mfaDetailRegistrationShowsAllMethods')
      : t('mfaDetailRegistrationStartsWithPasskey'),
    Recommendation: skipSFAWhenMFADirectUILogin ? '' : t('mfaRecommendationShowAllRegistrationOptions'),
  });
  rows.push({
    Check: checkTitle,
    CheckKey: checkKey,
    Severity: identityConfirmationOnTwoFactorRegistrationEnabled ? 'success' : 'warning',
    Item: 'identityConfirmationOnTwoFactorRegistrationEnabled',
    Details: identityConfirmationOnTwoFactorRegistrationEnabled
      ? t('mfaDetailIdentityConfirmationOn')
      : t('mfaDetailIdentityConfirmationOff'),
    Recommendation: identityConfirmationOnTwoFactorRegistrationEnabled
      ? ''
      : t('mfaRecommendationEnableIdentityConfirmation'),
  });

  let status: MfaCheckResult['status'] = 'success';
  let detail = t('mfaCheckOrgEnforcementPass');
  if (!enableMFADirectUILoginOptIn && !platformEnforcementDetected) {
    status = 'error';
    detail = t('mfaCheckOrgEnforcementFail');
  } else if (enableSMSIdentity || canConfirmIdentityBySmsOnly || !identityConfirmationOnTwoFactorRegistrationEnabled) {
    status = 'warning';
    detail = t('mfaCheckOrgEnforcementWeakSms', {
      flag: enableSMSIdentity ? 'enableSMSIdentity' : 'canConfirmIdentityBySmsOnly',
    });
  }

  return {
    key: 'orgEnforcement',
    status,
    title: checkTitle,
    detail,
    rows,
    metric: rows.filter((r) => r.Severity === 'warning' || r.Severity === 'error').length,
  };
}

/* Query active Standard users assigned to any of the given profiles */
async function queryActiveStandardUsersByProfiles(conn: Connection, profiles: any[]): Promise<any[]> {
  const profileIds = profiles.map((p) => `'${p.Id}'`).join(',');
  const userQuery = `SELECT Id, Username, Name, IsActive, UserType, ProfileId FROM User WHERE ProfileId IN (${profileIds}) AND IsActive = true`;
  const userRes = await soqlQuery(userQuery, conn);
  return ((userRes.records || []) as any[]).filter((u) => u.UserType === 'Standard');
}

async function checkMfaBypassUsers(
  conn: Connection,
  ignoreSet: Set<string>,
  bypassField: BypassFieldAvailability
): Promise<MfaCheckResult> {
  const checkTitle = t('mfaCheckBypassUsersTitle');
  const checkKey: MfaCheckKey = 'mfaBypassUsers';

  /* Field absent on both objects: the bypass permission cannot be granted in this org at all */
  if (!bypassField.permissionSet && !bypassField.profile) {
    const detail = t('mfaCheckBypassFieldNotAvailable');
    return {
      key: 'mfaBypassUsers',
      status: 'success',
      title: checkTitle,
      detail,
      rows: [
        {
          Check: checkTitle,
          CheckKey: checkKey,
          Severity: 'success',
          Item: 'PermissionsBypassMFAForUiLogins',
          Details: detail,
          Recommendation: '',
        },
      ],
      metric: 0,
    };
  }

  let bypassProfiles: any[] = [];
  if (bypassField.profile) {
    const profileQuery = `SELECT Id, Name FROM Profile WHERE PermissionsBypassMFAForUiLogins = true`;
    const profileRes = await soqlQuery(profileQuery, conn);
    bypassProfiles = (profileRes.records || []) as any[];
  }

  const rows: MfaReportRow[] = [];

  /*
   * Same assignment-first sweep as buildPrivilegedUserContext, for the same reason: permission set
   * groups only ever produce an assignment to their aggregate permission set, so filtering the
   * member permission sets first would miss group-granted bypasses. Profile-owned permission sets
   * are skipped here because the Profile branch below reports them with a dedicated message.
   */
  if (bypassField.permissionSet) {
    const psaQuery = `SELECT AssigneeId, PermissionSetId, Assignee.Username, Assignee.Name, Assignee.UserType, PermissionSet.Label, PermissionSet.Type FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND PermissionSet.PermissionsBypassMFAForUiLogins = true`;
    const psaRes = await soqlQuery(psaQuery, conn);
    for (const a of (psaRes.records || []) as any[]) {
      const username = a.Assignee?.Username || '';
      if (a.Assignee?.UserType !== 'Standard') continue;
      if (!username || ignoreSet.has(username.toLowerCase())) continue;
      if (a.PermissionSet?.Type === 'Profile') continue;
      const isGroup = a.PermissionSet?.Type === 'Group';
      rows.push({
        Check: checkTitle,
        CheckKey: checkKey,
        Severity: 'warning',
        Item: username,
        Details: t(isGroup ? 'mfaDetailBypassViaPermSetGroup' : 'mfaDetailBypassViaPermSet', {
          name: a.Assignee?.Name || '',
          source: a.PermissionSet?.Label || a.PermissionSetId,
        }),
        Recommendation: t('mfaRecommendationRemoveBypassPermSet'),
      });
    }
  }

  if (bypassProfiles.length > 0) {
    const users = await queryActiveStandardUsersByProfiles(conn, bypassProfiles);
    for (const u of users) {
      if (ignoreSet.has((u.Username || '').toLowerCase())) continue;
      const profile = bypassProfiles.find((p) => p.Id === u.ProfileId);
      rows.push({
        Check: checkTitle,
        CheckKey: checkKey,
        Severity: 'warning',
        Item: u.Username,
        Details: t('mfaDetailBypassViaProfile', {
          name: u.Name || '',
          source: profile?.Name || u.ProfileId,
        }),
        Recommendation: t('mfaRecommendationRemoveBypassProfile'),
      });
    }
  }

  const status: MfaCheckResult['status'] = rows.length > 0 ? 'warning' : 'success';
  const detail =
    rows.length > 0
      ? t('mfaCheckBypassUsersFound', { count: rows.length })
      : t('mfaCheckBypassUsersNone');

  /* Add a pass row when no findings so the report shows the check ran */
  if (rows.length === 0) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'success',
      Item: '-',
      Details: detail,
      Recommendation: '',
    });
  }

  return {
    key: 'mfaBypassUsers',
    status,
    title: checkTitle,
    detail,
    rows,
    metric: rows.filter((r) => r.Severity === 'warning' || r.Severity === 'error').length,
  };
}

async function buildPrivilegedUserContext(
  conn: Connection,
  privilegedPermFields: string[],
  ignoreSet: Set<string>,
  bypassField: BypassFieldAvailability
): Promise<PrivilegedUserContext> {
  const orClause = privilegedPermFields.map((f) => `${f} = true`).join(' OR ');

  const userIndex: Record<string, PrivilegedUserEntry> = {};

  /*
   * Sweep PermissionSetAssignment with the permission filters applied through the PermissionSet
   * relationship - this is the shape Salesforce itself publishes to identify privileged users, and
   * it is the only one that covers all three grant paths in a single pass:
   *  - Profile: every user has an assignment to the permission set owned by their profile
   *    (Type = 'Profile'), so profile-granted permissions show up here too.
   *  - Permission Set: the plain case.
   *  - Permission Set Group: users are assigned the group's aggregate permission set
   *    (Type = 'Group'), never its member permission sets. Filtering on the member permission sets
   *    and then joining on PermissionSetId missed every user whose admin rights come from a group,
   *    which is why they were prompted for a passkey without ever appearing in this report.
   */
  const psaPrivWhere = `Assignee.IsActive = true AND (${privilegedPermFields
    .map((f) => `PermissionSet.${f} = true`)
    .join(' OR ')})`;
  const psaPrivFields =
    'AssigneeId, PermissionSetId, Assignee.Username, Assignee.Name, Assignee.UserType, Assignee.ProfileId, PermissionSet.Label, PermissionSet.Type';
  let psaPrivRes: any;
  try {
    psaPrivRes = await soqlQuery(
      `SELECT ${psaPrivFields}, PermissionSet.Profile.Name FROM PermissionSetAssignment WHERE ${psaPrivWhere}`,
      conn
    );
  } catch {
    /* Fall back without the Profile traversal rather than failing the whole monitoring run: the
       permission set Label of a profile-owned permission set already carries the profile name. */
    psaPrivRes = await soqlQuery(`SELECT ${psaPrivFields} FROM PermissionSetAssignment WHERE ${psaPrivWhere}`, conn);
  }
  for (const a of (psaPrivRes.records || []) as any[]) {
    if (a.Assignee?.UserType !== 'Standard') continue;
    const username = a.Assignee?.Username || '';
    if (!username || ignoreSet.has(username.toLowerCase())) continue;
    const tag = grantedViaTag(a.PermissionSet, a.PermissionSetId);
    if (!userIndex[username]) {
      userIndex[username] = {
        Id: a.AssigneeId,
        Username: username,
        Name: a.Assignee?.Name || '',
        GrantedVia: new Set<string>([tag]),
        ProfileId: a.Assignee?.ProfileId || '',
      };
    } else {
      userIndex[username].GrantedVia.add(tag);
    }
  }

  /*
   * Belt and braces: the Profile object is queried directly as well. The assignment sweep above
   * already covers profiles through their owned permission sets, but this keeps the check working
   * if an org does not expose those assignment records, and it costs one query.
   */
  const profileQuery = `SELECT Id, Name, ${privilegedPermFields.join(', ')} FROM Profile WHERE ${orClause}`;
  const profileRes = await soqlQuery(profileQuery, conn);
  const privProfiles = (profileRes.records || []) as any[];

  if (privProfiles.length > 0) {
    const users = await queryActiveStandardUsersByProfiles(conn, privProfiles);
    for (const u of users) {
      const username = u.Username || '';
      if (!username || ignoreSet.has(username.toLowerCase())) continue;
      const profile = privProfiles.find((p) => p.Id === u.ProfileId);
      const tag = `Profile:${profile?.Name || u.ProfileId}`;
      if (!userIndex[username]) {
        userIndex[username] = {
          Id: u.Id,
          Username: username,
          Name: u.Name || '',
          GrantedVia: new Set<string>([tag]),
          ProfileId: u.ProfileId || '',
        };
      } else {
        userIndex[username].GrantedVia.add(tag);
      }
    }
  }

  const privilegedUsernames = Object.keys(userIndex);

  const bypassUsernames = new Set<string>();
  const twoFactorApiUsernames = new Set<string>();

  if (privilegedUsernames.length > 0) {
    const usernameList = privilegedUsernames.map((u) => `'${u.replace(/'/g, "\\'")}'`).join(',');

    const psaFlagFields = bypassField.permissionSet
      ? 'PermissionSet.PermissionsBypassMFAForUiLogins, PermissionSet.PermissionsTwoFactorApi'
      : 'PermissionSet.PermissionsTwoFactorApi';
    const psaFlagsQuery = `SELECT Assignee.Username, ${psaFlagFields} FROM PermissionSetAssignment WHERE Assignee.Username IN (${usernameList})`;
    const psaFlagsRes = await soqlQuery(psaFlagsQuery, conn);
    for (const a of (psaFlagsRes.records || []) as any[]) {
      const username = a.Assignee?.Username;
      if (!username) continue;
      if (a.PermissionSet?.PermissionsBypassMFAForUiLogins === true) bypassUsernames.add(username);
      if (a.PermissionSet?.PermissionsTwoFactorApi === true) twoFactorApiUsernames.add(username);
    }

    const profileFlagFields = bypassField.profile
      ? 'PermissionsBypassMFAForUiLogins, PermissionsTwoFactorApi'
      : 'PermissionsTwoFactorApi';
    const profileFlagsQuery = `SELECT Id, ${profileFlagFields} FROM Profile WHERE Id IN (SELECT ProfileId FROM User WHERE Username IN (${usernameList}))`;
    const profileFlagsRes = await soqlQuery(profileFlagsQuery, conn);
    const flaggedProfileIds = new Map<string, { bypass: boolean; api: boolean }>();
    for (const p of (profileFlagsRes.records || []) as any[]) {
      flaggedProfileIds.set(p.Id, {
        bypass: p.PermissionsBypassMFAForUiLogins === true,
        api: p.PermissionsTwoFactorApi === true,
      });
    }
    for (const username of privilegedUsernames) {
      const profileId = userIndex[username].ProfileId;
      const flags = flaggedProfileIds.get(profileId);
      if (flags?.bypass) bypassUsernames.add(username);
      if (flags?.api) twoFactorApiUsernames.add(username);
    }
  }

  return { userIndex, privilegedUsernames, bypassUsernames, twoFactorApiUsernames };
}

/*
 * Human-readable origin of a privileged permission. PermissionSet.Type tells the three grant paths
 * apart: 'Profile' for the permission set owned by a profile, 'Group' for a permission set group's
 * aggregate permission set, anything else for a plain permission set.
 */
function grantedViaTag(permissionSet: any, permissionSetId: string): string {
  if (permissionSet?.Type === 'Profile') {
    return `Profile:${permissionSet?.Profile?.Name || permissionSet?.Label || permissionSetId}`;
  }
  if (permissionSet?.Type === 'Group') {
    return `PermissionSetGroup:${permissionSet?.Label || permissionSetId}`;
  }
  return `PermissionSet:${permissionSet?.Label || permissionSetId}`;
}

function formatGrantedVia(grantedVia: Set<string>): string {
  /* Profiles first, then PermissionSets, alphabetical within each group */
  return Array.from(grantedVia)
    .sort((a, b) => {
      const aProfile = a.startsWith('Profile:');
      const bProfile = b.startsWith('Profile:');
      if (aProfile !== bProfile) return aProfile ? -1 : 1;
      return a.localeCompare(b);
    })
    .join(' | ');
}

function checkPhishingResistantReadiness(
  ctx: PrivilegedUserContext,
  scan: VerificationScan,
  lookbackDays: number,
  securityMetadata: any
): MfaCheckResult {
  const checkTitle = t('mfaCheckPhishingResistantTitle');
  const checkKey: MfaCheckKey = 'phishingResistantReadiness';
  const rows: MfaReportRow[] = [];

  /*
   * General enforcement row: Salesforce does NOT expose a direct "require phishing-resistant
   * MFA for privileged users" toggle today. The platform-side enforcement rolls out per
   * release group (sandboxes since July 10 2026, production starting July 20 2026 -
   * see Salesforce Help article 005321563).
   * As a proxy, we flag the org if SMS-based identity verification is still permitted - because
   * if SMS is on, a privileged user could fall back to a non-phishing-resistant flow. The
   * recommendation always points to the Identity Verification Methods Setup page.
   */
  const sessionSettings = securityMetadata?.sessionSettings || {};
  const smsEnabled = sessionSettings.enableSMSIdentity === true;
  const smsOnlyEnabled = sessionSettings.canConfirmIdentityBySmsOnly === true;
  const orgRowIsWarning = smsEnabled || smsOnlyEnabled;
  rows.push({
    Check: checkTitle,
    CheckKey: checkKey,
    Severity: orgRowIsWarning ? 'warning' : 'info',
    Item: 'orgPhishingResistantEnforcement',
    Details: orgRowIsWarning
      ? t('mfaDetailPhishingResistantOrgNotEnforced')
      : t('mfaDetailPhishingResistantOrgPartiallyHardened'),
    Recommendation: t('mfaRecommendationEnforcePhishingResistantOrgWide'),
  });

  /*
   * Availability row: a user cannot register a passkey or a security key when neither method is
   * enabled in Setup > Identity Verification. Without one of these two flags, no amount of user
   * training makes the org compliant, so this is an error regardless of the per-user results.
   */
  const builtInAuthenticatorEnabled = sessionSettings.enableBuiltInAuthenticator === true;
  const securityKeyEnabled = sessionSettings.enableU2F === true;
  const noPhishingResistantMethod = !builtInAuthenticatorEnabled && !securityKeyEnabled;
  rows.push({
    Check: checkTitle,
    CheckKey: checkKey,
    Severity: noPhishingResistantMethod ? 'error' : 'success',
    Item: 'enableBuiltInAuthenticator / enableU2F',
    Details: noPhishingResistantMethod
      ? t('mfaDetailPhishingResistantMethodsUnavailable')
      : t('mfaDetailPhishingResistantMethodsAvailable', {
          builtIn: builtInAuthenticatorEnabled,
          securityKey: securityKeyEnabled,
        }),
    Recommendation: noPhishingResistantMethod ? t('mfaRecommendationEnablePhishingResistantMethods') : '',
  });

  if (ctx.privilegedUsernames.length === 0) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'success',
      Item: '-',
      Details: t('mfaCheckPhishingResistantNoPrivileged'),
      Recommendation: '',
    });
    return {
      key: checkKey,
      status: noPhishingResistantMethod ? 'error' : 'success',
      title: checkTitle,
      detail: noPhishingResistantMethod
        ? t('mfaDetailPhishingResistantMethodsUnavailable')
        : t('mfaCheckPhishingResistantNoPrivileged'),
      rows,
      metric: 0,
    };
  }

  if (scan.failed) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'warning',
      Item: '-',
      Details: t('mfaCheckPhishingResistantQueryFailed'),
      Recommendation: t('mfaRecommendationGrantVerificationHistoryAccess'),
    });
    return {
      key: checkKey,
      status: 'warning',
      title: checkTitle,
      detail: t('mfaCheckPhishingResistantQueryFailed'),
      rows,
      metric: 0,
    };
  }

  /*
   * Per-user check: take ONLY the LATEST successful verification per user.
   * If the latest verification used a phishing-resistant method, the user is ready,
   * regardless of older non-resistant verifications (they have evidently migrated).
   * If the latest was a non-resistant method (or there is no verification at all
   * in the window), flag them - the live Salesforce enforcement blocks them as its
   * rollout wave reaches the org.
   */
  let notReadyCount = 0;
  for (const username of ctx.privilegedUsernames) {
    const entry = ctx.userIndex[username];
    const grantedVia = formatGrantedVia(entry.GrantedVia);
    const latestMethod = scan.latestByUserId[entry.Id]?.method || '';

    if (latestMethod && PHISHING_RESISTANT_METHODS.has(latestMethod)) {
      rows.push({
        Check: checkTitle,
        CheckKey: checkKey,
        Severity: 'success',
        Item: username,
        Details: t('mfaDetailPhishingResistantReady', {
          name: entry.Name,
          methods: latestMethod,
          grantedVia,
        }),
        Recommendation: '',
      });
    } else {
      notReadyCount++;
      const observed = latestMethod || t('mfaDetailPhishingResistantNone');
      rows.push({
        Check: checkTitle,
        CheckKey: checkKey,
        Severity: 'error',
        Item: username,
        Details: t('mfaDetailPhishingResistantNotReady', {
          name: entry.Name,
          observed,
          days: lookbackDays,
          grantedVia,
        }),
        Recommendation: t('mfaRecommendationRegisterPhishingResistant'),
      });
    }
  }

  let status: MfaCheckResult['status'] = 'success';
  let detail = t('mfaCheckPhishingResistantPass', { count: ctx.privilegedUsernames.length });
  if (notReadyCount > 0) {
    status = 'error';
    detail = t('mfaCheckPhishingResistantFail', {
      count: notReadyCount,
      total: ctx.privilegedUsernames.length,
    });
  } else if (noPhishingResistantMethod) {
    status = 'error';
    detail = t('mfaDetailPhishingResistantMethodsUnavailable');
  } else if (orgRowIsWarning) {
    status = 'warning';
    detail = t('mfaCheckPhishingResistantOrgNotEnforcedSummary');
  }

  return {
    key: checkKey,
    status,
    title: checkTitle,
    detail,
    rows,
    metric: notReadyCount,
  };
}

function checkPrivilegedUsersAuditFromContext(ctx: PrivilegedUserContext): MfaCheckResult {
  const checkTitle = t('mfaCheckPrivilegedTitle');
  const checkKey: MfaCheckKey = 'privilegedUsersAudit';

  const rows: MfaReportRow[] = ctx.privilegedUsernames.map((username) => {
    const entry = ctx.userIndex[username];
    const hasBypass = ctx.bypassUsernames.has(username);
    const hasApiMfa = ctx.twoFactorApiUsernames.has(username);
    const grantedVia = formatGrantedVia(entry.GrantedVia);

    let severity: MfaReportRow['Severity'] = 'success';
    let recommendation = '';
    let details = '';

    if (hasBypass) {
      severity = 'error';
      details = t('mfaDetailPrivilegedUserHasBypass', { name: entry.Name, grantedVia });
      recommendation = t('mfaRecommendationReviewPrivilegedBypass');
    } else if (!hasApiMfa) {
      severity = 'warning';
      details = t('mfaDetailPrivilegedUserMissingApiMfa', { name: entry.Name, grantedVia });
      recommendation = t('mfaRecommendationGrantTwoFactorApi');
    } else {
      details = t('mfaDetailPrivilegedUserOk', { name: entry.Name, grantedVia });
    }

    return {
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: severity,
      Item: username,
      Details: details,
      Recommendation: recommendation,
    };
  });

  const bypassCount = rows.filter((r) => r.Severity === 'error').length;
  const missingApiCount = rows.filter((r) => r.Severity === 'warning').length;

  let status: MfaCheckResult['status'] = 'success';
  let detail = t('mfaCheckPrivilegedNone');
  if (bypassCount > 0) {
    status = 'error';
    detail = t('mfaCheckPrivilegedBypassError', { count: bypassCount });
  } else if (missingApiCount > 0) {
    status = 'warning';
    detail = t('mfaCheckPrivilegedMissingApiMfa', { count: missingApiCount });
  }

  if (rows.length === 0) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'success',
      Item: '-',
      Details: detail,
      Recommendation: '',
    });
  }

  return {
    key: 'privilegedUsersAudit',
    status,
    title: checkTitle,
    detail,
    rows,
    metric: rows.filter((r) => r.Severity === 'error' || r.Severity === 'warning').length,
  };
}

function checkSso(securityMetadata: any): MfaCheckResult {
  const checkTitle = t('mfaCheckSsoTitle');
  const checkKey: MfaCheckKey = 'sso';

  const singleSignOnSettings = securityMetadata?.singleSignOnSettings || {};
  const enableSamlLogin = singleSignOnSettings.enableSamlLogin === true;
  const enableMultipleSamlConfigs = singleSignOnSettings.enableMultipleSamlConfigs === true;
  const enableSamlJitProvisioning = singleSignOnSettings.enableSamlJitProvisioning === true;

  const ssoOn = enableSamlLogin || enableMultipleSamlConfigs;

  const rows: MfaReportRow[] = ssoOn
    ? [
        {
          Check: checkTitle,
          CheckKey: checkKey,
          Severity: 'info',
          Item: 'enableSamlLogin',
          Details: t('mfaDetailSamlEnabled', {
            multi: enableMultipleSamlConfigs,
            jit: enableSamlJitProvisioning,
          }),
          Recommendation: t('mfaRecommendationVerifyIdpMfa'),
        },
      ]
    : [
        {
          Check: checkTitle,
          CheckKey: checkKey,
          Severity: 'success',
          Item: '-',
          Details: t('mfaCheckSsoInactive'),
          Recommendation: '',
        },
      ];

  return {
    key: 'sso',
    status: ssoOn ? 'info' : 'success',
    title: checkTitle,
    detail: ssoOn ? t('mfaCheckSsoActive') : t('mfaCheckSsoInactive'),
    rows,
    metric: ssoOn ? 1 : 0,
  };
}

async function checkNonMfaLogins(
  conn: Connection,
  lookbackDays: number,
  ignoreSet: Set<string>
): Promise<MfaCheckResult> {
  const checkTitle = t('mfaCheckNonMfaLoginsTitle', { days: lookbackDays });
  const checkKey: MfaCheckKey = 'nonMfaLogins';

  const query = `SELECT UserId, LoginTime, LoginType, LoginSubType, Status, AuthMethodReference, ApiType, Application, SourceIp FROM LoginHistory WHERE LoginTime = LAST_N_DAYS:${lookbackDays} LIMIT 5000`;
  let records: any[] = [];
  try {
    const res = await soqlQuery(query, conn);
    records = (res.records || []) as any[];
  } catch {
    return {
      key: 'nonMfaLogins',
      status: 'warning',
      title: checkTitle,
      detail: t('mfaCheckNonMfaLoginsQueryFailed'),
      rows: [
        {
          Check: checkTitle,
          CheckKey: checkKey,
          Severity: 'warning',
          Item: '-',
          Details: t('mfaCheckNonMfaLoginsQueryFailed'),
          Recommendation: t('mfaRecommendationGrantLoginHistoryAccess'),
        },
      ],
      metric: 0,
    };
  }

  const flagged: any[] = [];
  for (const r of records) {
    if (r.Status !== 'Success') continue;
    if (r.LoginType !== 'Application') continue;
    const auth = (r.AuthMethodReference || '').toString().toLowerCase();
    if (!auth) continue;
    if (STRONG_AUTH_TOKENS.some((tok) => auth.includes(tok))) continue;
    flagged.push(r);
  }

  if (flagged.length > 0) {
    const userIds = Array.from(new Set(flagged.map((r) => r.UserId).filter((id) => !!id)));
    if (userIds.length > 0) {
      const idList = userIds.map((id) => `'${id}'`).join(',');
      const userRes = await soqlQuery(`SELECT Id, Username FROM User WHERE Id IN (${idList})`, conn);
      const usernameById = new Map<string, string>();
      for (const u of (userRes.records || []) as any[]) {
        usernameById.set(u.Id, u.Username);
      }
      for (const r of flagged) {
        r.Username = usernameById.get(r.UserId) || r.UserId;
      }
    }
  }

  const filtered = flagged.filter((r) => !ignoreSet.has((r.Username || '').toLowerCase()));

  const rows: MfaReportRow[] = filtered.map((r) => ({
    Check: checkTitle,
    CheckKey: checkKey,
    Severity: 'error',
    Item: r.Username || r.UserId,
    Details: t('mfaDetailNonMfaLogin', {
      loginTime: r.LoginTime,
      sourceIp: r.SourceIp || '-',
      auth: r.AuthMethodReference || '-',
    }),
    Recommendation: t('mfaRecommendationInvestigateNonMfaLogin'),
  }));

  const status: MfaCheckResult['status'] = rows.length > 0 ? 'error' : 'success';
  const detail =
    rows.length > 0
      ? t('mfaCheckNonMfaLoginsFound', { count: rows.length, days: lookbackDays })
      : t('mfaCheckNonMfaLoginsNone', { days: lookbackDays });

  if (rows.length === 0) {
    rows.push({
      Check: checkTitle,
      CheckKey: checkKey,
      Severity: 'success',
      Item: '-',
      Details: detail,
      Recommendation: '',
    });
  }

  return {
    key: 'nonMfaLogins',
    status,
    title: checkTitle,
    detail,
    rows,
    metric: rows.filter((r) => r.Severity === 'error').length,
  };
}
