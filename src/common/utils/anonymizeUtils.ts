import { createHash } from 'crypto';
import * as os from 'os';
import { getConfig, getEnvVar } from '../../config/index.js';
import { isCI } from './envUtils.js';
import type { NotifMessage } from '../notifProvider/types.js';

// Central anonymization engine for personal data leaving the machine: generated report files
// (CSV / XLSX, which become CI artifacts and email attachments), notification channels
// (API / Loki, email, Slack / Teams / Google Chat), monitoring notification files (which feed
// the AI summary and the PPTX report) and console tables.
//
// Two levels:
// - "standard" (sensitive except technical): end-user identity. Usernames, emails, first / last /
//   display names, Salesforce user Ids (id_<hash>), client IPs and hostnames (ip_<hash>).
//   Technical actor fields (audit trail CreatedBy / LastModifiedBy / DelegateUser, DeployedBy,
//   TriggeredBy) stay readable: they identify administrators performing setup actions.
// - "strict" (sensitive including technical): standard plus the actor fields.
//
// Default behavior: "standard" when running in CI (scheduled monitoring jobs push to shared
// observability backends and CI artifacts are retained), "off" in local runs (locally generated
// report files must stay analyzable). Overridable with SFDX_HARDIS_ANONYMIZE env var or the
// `anonymization` config property. NOTIF_API_ANONYMIZE is kept as a deprecated alias.
//
// Pseudonyms are stable and org-salted: the same value in the same org always maps to the same
// hash across every surface (Grafana, CSV, XLSX, emails), so distinct counts and per-user
// drill-downs keep working, while values are not linkable across orgs.

export type AnonymizationLevel = 'off' | 'standard' | 'strict';
export type AnonymizationChannel = 'files' | 'api' | 'email' | 'messaging';
export type SensitiveKind = 'user' | 'id' | 'ip';
export type SensitiveValueMarker = string | { value: string; kind: SensitiveKind };

// Row-level marker: producers whose sensitive values live in ambiguous columns (e.g. MFA_CONFIG
// rows where `Item` holds a settings key on some rows and a username on others) declare them
// with markRowSensitiveValues(). The engine replaces the values everywhere in the row, registers
// them for free-text scrubbing, then strips the marker before any output.
export const SENSITIVE_VALUES_KEY = '_sensitiveValues';

const LEVEL_ORDER: Record<AnonymizationLevel, number> = { off: 0, standard: 1, strict: 2 };

// Leaf field names (lowercase) carrying end-user identity
const USER_LEAF_KEYS = ['username', 'email', 'useremail', 'firstname', 'lastname', 'user'];
// Leaf field names (lowercase) carrying a user record Id
const ID_LEAF_KEYS = ['userid', 'user_id', 'assigneeid'];
// Leaf field names (lowercase) carrying a client IP or its reverse-DNS hostname
// (a raw hostname would defeat the IP hashing, so both get the ip_ prefix)
const IP_LEAF_KEYS = ['client_ip', 'clientip', 'sourceip', 'ipaddress', 'client_hostname', 'hostname'];
// Path fragments (lowercase) marking technical actor context: anonymized only at "strict" level
const ACTOR_PATH_FRAGMENTS = ['createdby', 'lastmodifiedby', 'delegateuser', 'deployedby', 'triggeredby'];
// Salesforce User record Ids always start with the 005 keyprefix (15 or 18 chars)
const USER_SF_ID_REGEX = /^005[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;

const PSEUDONYM_HASH_LENGTH = 10;
// Idempotency guard: a value that is already a pseudonym is never re-hashed, so rows passing
// through several chokepoints (console table, CSV file, notification) stay stable.
const PSEUDONYM_REGEX = /^(user|id|ip)_[0-9a-f]{10}$/;

// ---------------------------------------------------------------------------
// Level resolution
// ---------------------------------------------------------------------------

interface AnonymizationConfig {
  level?: AnonymizationLevel;
  channels?: Partial<Record<AnonymizationChannel, AnonymizationLevel>>;
  // The config file only applies to CI runs by default (local logs and reports must keep full
  // information). Set to true to enforce the configured anonymization in local runs too.
  enforceLocally?: boolean;
}

let configCache: AnonymizationConfig | null = null;
let legacyEnvVarUsed = false;
let noticeEmitted = false;

function parseLevelToken(raw: string | null | undefined): AnonymizationLevel | null {
  const token = (raw || '').trim().toLowerCase();
  if (['off', 'false', '0', 'no'].includes(token)) {
    return 'off';
  }
  if (['standard', 'true', '1', 'yes'].includes(token)) {
    return 'standard';
  }
  if (token === 'strict') {
    return 'strict';
  }
  return null;
}

function maxLevel(a: AnonymizationLevel, b: AnonymizationLevel): AnonymizationLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

function getEnvLevel(): AnonymizationLevel | null {
  const envLevel = parseLevelToken(getEnvVar('SFDX_HARDIS_ANONYMIZE'));
  if (envLevel !== null) {
    return envLevel;
  }
  // Deprecated alias, kept so existing installations keep working: true -> standard, false -> off
  const legacyLevel = parseLevelToken(getEnvVar('NOTIF_API_ANONYMIZE'));
  if (legacyLevel !== null) {
    legacyEnvVarUsed = true;
    return legacyLevel;
  }
  return null;
}

async function primeConfigCache(): Promise<AnonymizationConfig> {
  if (configCache !== null) {
    return configCache;
  }
  let parsed: AnonymizationConfig = {};
  try {
    const config = await getConfig('user');
    const rawAnonymization = config?.anonymization;
    if (rawAnonymization && typeof rawAnonymization === 'object') {
      const level = parseLevelToken(rawAnonymization.level);
      const channels: AnonymizationConfig['channels'] = {};
      for (const channel of ['files', 'api', 'email', 'messaging'] as AnonymizationChannel[]) {
        const channelLevel = parseLevelToken(rawAnonymization.channels?.[channel]);
        if (channelLevel !== null) {
          channels[channel] = channelLevel;
        }
      }
      parsed = {
        ...(level !== null ? { level } : {}),
        channels,
        enforceLocally: rawAnonymization.enforceLocally === true,
      };
    }
  } catch {
    parsed = {};
  }
  configCache = parsed;
  return configCache;
}

// Shared resolution: env var is absolute (explicitly setting it locally works, "off" disables
// everything including channel raises). Without env var, the config file and the "standard"
// default only apply to CI runs, unless the config sets enforceLocally: local logs and reports
// must keep full information by default.
function computeLevel(
  config: AnonymizationConfig,
  isCiRun: boolean,
  channel: AnonymizationChannel | null
): AnonymizationLevel {
  const envLevel = getEnvLevel();
  if (envLevel === 'off') {
    return 'off';
  }
  const applies = isCiRun || config.enforceLocally === true || envLevel !== null;
  if (!applies) {
    return 'off';
  }
  const base = envLevel ?? config.level ?? 'standard';
  if (channel !== null) {
    return maxLevel(base, config.channels?.[channel] || 'off');
  }
  return base;
}

// Effective global anonymization level: env var (absolute) > config file (CI runs only,
// unless enforceLocally) > default (standard in CI, off locally).
// isCiRun is overridable for tests only.
export async function getAnonymizationLevel(isCiRun: boolean = isCI): Promise<AnonymizationLevel> {
  const config = await primeConfigCache();
  return computeLevel(config, isCiRun, null);
}

// Per-channel effective level: a channel can only raise the level above the global one,
// never lower it (the data source is anonymized once, so a channel cannot get rawer data).
export async function getChannelAnonymizationLevel(
  channel: AnonymizationChannel,
  isCiRun: boolean = isCI
): Promise<AnonymizationLevel> {
  const config = await primeConfigCache();
  return computeLevel(config, isCiRun, channel);
}

// Sync best-effort variant for synchronous call sites (console tables): uses the env vars,
// the already-primed config cache when available, and the CI default. Chokepoints that can
// await (file generation, notifications) use the exact async resolution above.
export function getChannelAnonymizationLevelSync(
  channel: AnonymizationChannel,
  isCiRun: boolean = isCI
): AnonymizationLevel {
  return computeLevel(configCache || {}, isCiRun, channel);
}

// One-shot notice so chokepoints can inform the user that anonymization is active
// (and that the deprecated env var is used) exactly once per process.
export function consumeAnonymizationNotice(effectiveLevel: AnonymizationLevel): { legacyEnvVarUsed: boolean } | null {
  if (effectiveLevel === 'off' || noticeEmitted) {
    return null;
  }
  noticeEmitted = true;
  return { legacyEnvVarUsed };
}

// Test helper: reset module state between test cases. An optional config can be injected
// to test the config-file resolution without writing a .sfdx-hardis.yml file.
export function resetAnonymizationCache(testConfig: AnonymizationConfig | null = null): void {
  configCache = testConfig;
  legacyEnvVarUsed = false;
  noticeEmitted = false;
  registeredSalt = null;
}

// ---------------------------------------------------------------------------
// Salt
// ---------------------------------------------------------------------------

let registeredSalt: string | null = null;

// Same normalization as the API provider org identifier, so pseudonyms in report files match
// the ones already stored in observability backends for the same org.
export function buildOrgIdentifier(instanceUrl: string): string {
  return instanceUrl.replace('https://', '').replace('.my.salesforce.com', '').replace(/\./gm, '__');
}

// Called from the shared query utilities: the salt must be known before report generation,
// which happens before setConnectionVariables in most commands.
export function registerAnonymizationSalt(instanceUrl: string | null | undefined): void {
  // Also warm the config cache in the background, so the sync resolution used by console
  // tables sees the .sfdx-hardis.yml anonymization config and not only env vars / CI default
  void primeConfigCache();
  if (registeredSalt === null && instanceUrl) {
    registeredSalt = buildOrgIdentifier(instanceUrl);
  }
}

export function getAnonymizationSalt(): string {
  const monitoringKey = getEnvVar('SFDX_HARDIS_MONITORING_KEY') || getEnvVar('MONITORING_KEY');
  if (monitoringKey) {
    return monitoringKey;
  }
  if (registeredSalt === null) {
    const conn = (globalThis as any).jsForceConn;
    if (conn?.instanceUrl) {
      registerAnonymizationSalt(conn.instanceUrl);
    }
  }
  // Last resort when no org context exists yet: a machine-and-project-stable salt, so
  // pseudonyms are never plain unsalted hashes (which would be identical across all
  // installations and dictionary-attackable)
  return registeredSalt || `${os.hostname()}|${process.cwd()}`;
}

// ---------------------------------------------------------------------------
// Pseudonyms
// ---------------------------------------------------------------------------

// Stable, org-salted pseudonym: same value in the same org always maps to the same hash,
// so distinct counts and per-user drill-downs keep working on anonymized data,
// while values are not linkable across orgs.
export function buildPseudonym(value: string, kind: SensitiveKind = 'user', salt?: string): string {
  if (PSEUDONYM_REGEX.test(value)) {
    return value;
  }
  const effectiveSalt = salt ?? getAnonymizationSalt();
  const hash = createHash('sha256').update(`${effectiveSalt}|${value}`).digest('hex');
  return `${kind}_` + hash.slice(0, PSEUDONYM_HASH_LENGTH);
}

// ---------------------------------------------------------------------------
// Field classification
// ---------------------------------------------------------------------------

function isActorPath(fullPathLower: string): boolean {
  return ACTOR_PATH_FRAGMENTS.some((fragment) => fullPathLower.includes(fragment));
}

function classifyField(
  fullPath: string,
  value: any,
  row: Record<string, any>,
  level: AnonymizationLevel
): SensitiveKind | null {
  const fullPathLower = fullPath.toLowerCase();
  const isActor = isActorPath(fullPathLower);
  if (isActor && level !== 'strict') {
    return null;
  }
  const leaf = fullPathLower.split('.').pop() || '';
  if (USER_LEAF_KEYS.includes(leaf)) {
    return 'user';
  }
  if (ID_LEAF_KEYS.includes(leaf)) {
    return 'id';
  }
  if (IP_LEAF_KEYS.includes(leaf)) {
    return 'ip';
  }
  // At strict level, actor leaf fields carrying a name or username directly
  // (DeployedBy, TriggeredBy, _triggeredBy, DelegateUser)
  if (level === 'strict' && ACTOR_PATH_FRAGMENTS.some((fragment) => leaf.includes(fragment))) {
    return 'user';
  }
  // Salesforce User record Id by value, whatever the field name (USER_ID, Id, AssigneeId...)
  if (typeof value === 'string' && USER_SF_ID_REGEX.test(value)) {
    return 'id';
  }
  if (leaf === 'name') {
    // At strict level, actor display names (CreatedBy.Name, LastModifiedBy.Name...)
    if (isActor && level === 'strict') {
      return 'user';
    }
    // A bare top-level "Name" field is sensitive only on rows that look like user rows
    // (so Flow names, Profile.Name or license names are never touched)
    if (fullPathLower === 'name') {
      const hasUsernameSibling = Object.keys(row).some((key) => {
        const keyLower = key.toLowerCase();
        const otherLeaf = keyLower.split('.').pop() || '';
        return otherLeaf === 'username' && (level === 'strict' || !isActorPath(keyLower));
      });
      return hasUsernameSibling ? 'user' : null;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row markers
// ---------------------------------------------------------------------------

// Declare which values of a row are personal when the engine field rules cannot know it
// (ambiguous columns, values interpolated inside free-text fields). Strings default to
// kind "user"; pass { value, kind } for user Ids or IPs.
export function markRowSensitiveValues<T extends Record<string, any>>(row: T, markers: (SensitiveValueMarker | null | undefined)[]): T {
  const normalized = markers
    .map((marker) => (typeof marker === 'string' ? { value: marker, kind: 'user' as SensitiveKind } : marker))
    .filter((marker): marker is { value: string; kind: SensitiveKind } => !!marker && typeof marker.value === 'string' && marker.value.length > 0);
  if (normalized.length > 0) {
    (row as Record<string, any>)[SENSITIVE_VALUES_KEY] = normalized;
  }
  return row;
}

function readRowMarkers(row: Record<string, any>): { value: string; kind: SensitiveKind }[] {
  const raw = row[SENSITIVE_VALUES_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((marker: SensitiveValueMarker) => (typeof marker === 'string' ? { value: marker, kind: 'user' as SensitiveKind } : marker))
    .filter((marker) => !!marker && typeof marker.value === 'string' && marker.value.length > 0);
}

function rowsHaveMarkers(rows: any[]): boolean {
  return rows.some((row) => row != null && typeof row === 'object' && SENSITIVE_VALUES_KEY in row);
}

// Remove the marker key without anonymizing (used at level "off" and for command --json outputs).
// Returns new row objects when a marker is present, the original objects otherwise.
export function stripSensitiveValues(rows: any[]): any[] {
  if (!Array.isArray(rows) || !rowsHaveMarkers(rows)) {
    return rows;
  }
  return rows.map((row) => {
    if (row == null || typeof row !== 'object' || !(SENSITIVE_VALUES_KEY in row)) {
      return row;
    }
    const copy = { ...row };
    delete copy[SENSITIVE_VALUES_KEY];
    return copy;
  });
}

// ---------------------------------------------------------------------------
// Core anonymization
// ---------------------------------------------------------------------------

function registerReplacement(replacementMap: Map<string, string>, original: string, pseudonym: string): void {
  if (original.length >= 3) {
    replacementMap.set(original, pseudonym);
  }
}

// Walk a row / data node (flat dot-path keys like "CreatedBy.Username" and nested objects
// are both used across commands) and replace sensitive values with pseudonyms.
// Collected replacements (original -> pseudonym) are appended to replacementMap so the same
// values can be scrubbed from free-text fields afterwards.
function anonymizeNode(
  node: any,
  level: AnonymizationLevel,
  replacementMap: Map<string, string>,
  salt: string,
  pathPrefix = ''
): any {
  if (node == null || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => anonymizeNode(item, level, replacementMap, salt, pathPrefix));
  }
  const result: Record<string, any> = {};
  const rowFirstNames: string[] = [];
  const rowLastNames: string[] = [];
  const markers = readRowMarkers(node);
  for (const key of Object.keys(node)) {
    if (key === SENSITIVE_VALUES_KEY) {
      continue;
    }
    const value = node[key];
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (value != null && typeof value === 'object') {
      result[key] = anonymizeNode(value, level, replacementMap, salt, fullPath);
      continue;
    }
    if (typeof value === 'string' && value.length > 0) {
      const kind = classifyField(fullPath, value, node, level);
      if (kind !== null) {
        const pseudonym = buildPseudonym(value, kind, salt);
        result[key] = pseudonym;
        registerReplacement(replacementMap, value, pseudonym);
        const leaf = fullPath.toLowerCase().split('.').pop() || '';
        if (leaf === 'firstname') {
          rowFirstNames.push(value);
        } else if (leaf === 'lastname') {
          rowLastNames.push(value);
        }
        continue;
      }
    }
    result[key] = value;
  }
  // Marker pass: replace declared sensitive values everywhere in the row, both as whole
  // field values and inside free-text fields (e.g. a display name inside a Details column)
  if (markers.length > 0) {
    const markerMap = new Map<string, string>();
    for (const marker of markers) {
      if (PSEUDONYM_REGEX.test(marker.value)) {
        continue;
      }
      const pseudonym = buildPseudonym(marker.value, marker.kind, salt);
      markerMap.set(marker.value, pseudonym);
      registerReplacement(replacementMap, marker.value, pseudonym);
    }
    if (markerMap.size > 0) {
      for (const key of Object.keys(result)) {
        const value = result[key];
        if (typeof value !== 'string' || value.length === 0) {
          continue;
        }
        if (markerMap.has(value)) {
          result[key] = markerMap.get(value);
        } else {
          result[key] = scrubText(value, markerMap);
        }
      }
    }
  }
  // "First Last" / "Last First" combinations often appear in message bodies:
  // register them too so text scrubbing catches full display names
  for (const firstName of rowFirstNames) {
    for (const lastName of rowLastNames) {
      const combined = `${firstName} ${lastName}`;
      const combinedReverse = `${lastName} ${firstName}`;
      const pseudonym = buildPseudonym(combined, 'user', salt);
      replacementMap.set(combined, pseudonym);
      replacementMap.set(combinedReverse, pseudonym);
    }
  }
  return result;
}

// Anonymize an array of report / log element rows. Returns NEW row objects (caller arrays are
// never mutated, so command return values and later chokepoints keep working on originals).
// Always strips the row markers, even at level "off".
export function anonymizeRows(
  rows: any[],
  level: AnonymizationLevel,
  replacementMap: Map<string, string> = new Map(),
  salt?: string
): any[] {
  if (!Array.isArray(rows)) {
    return rows;
  }
  if (level === 'off') {
    return stripSensitiveValues(rows);
  }
  const effectiveSalt = salt ?? getAnonymizationSalt();
  return rows.map((row) => anonymizeNode(row, level, replacementMap, effectiveSalt));
}

// Anonymize an arbitrary data object (notification `data` payloads: nested arrays like
// legacyApiSummary, flat keys like _triggeredBy...)
export function anonymizeData(
  data: any,
  level: AnonymizationLevel,
  replacementMap: Map<string, string> = new Map(),
  salt?: string
): any {
  if (level === 'off' || data == null || typeof data !== 'object') {
    return data;
  }
  const effectiveSalt = salt ?? getAnonymizationSalt();
  return anonymizeNode(data, level, replacementMap, effectiveSalt);
}

export function scrubText(text: string, replacementMap: Map<string, string>): string {
  let result = text;
  // Longest originals first so "Jane Doe" is replaced before "Jane" or "Doe"
  const originals = [...replacementMap.keys()].sort((a, b) => b.length - a.length);
  for (const original of originals) {
    if (result.includes(original)) {
      // Word-boundary match so a user named "Support" does not mangle "Support_Flow"
      // or unrelated sentences containing the same word. "." is intentionally NOT part of
      // the boundary classes: a value at the end of a sentence must still be scrubbed.
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`(?<![\\w@])${escaped}(?![\\w@])`, 'g'), replacementMap.get(original) || original);
    }
  }
  return result;
}

// Anonymize a whole notification message for a given level: logElements rows, data payload,
// then free-text fields (text, attachments[].text) scrubbed with the collected values.
// Returns a copy; the input message is never mutated.
export function anonymizeNotifMessage(notifMessage: NotifMessage, level: AnonymizationLevel): NotifMessage {
  if (level === 'off') {
    if (Array.isArray(notifMessage.logElements) && rowsHaveMarkers(notifMessage.logElements)) {
      return { ...notifMessage, logElements: stripSensitiveValues(notifMessage.logElements) };
    }
    return notifMessage;
  }
  const salt = getAnonymizationSalt();
  const replacementMap = new Map<string, string>();
  const result: NotifMessage = { ...notifMessage };
  if (Array.isArray(result.logElements)) {
    result.logElements = anonymizeRows(result.logElements, level, replacementMap, salt);
  }
  if (result.data != null && typeof result.data === 'object') {
    result.data = anonymizeData(result.data, level, replacementMap, salt);
  }
  if (replacementMap.size > 0) {
    if (typeof result.text === 'string') {
      result.text = scrubText(result.text, replacementMap);
    }
    if (Array.isArray(result.attachments)) {
      result.attachments = result.attachments.map((attachment) =>
        attachment && typeof attachment.text === 'string'
          ? { ...attachment, text: scrubText(attachment.text, replacementMap) }
          : attachment
      );
    }
  }
  return result;
}
