import { createHash } from 'crypto';
import { getEnvVar } from '../../config/index.js';
import { isCI } from '../utils/index.js';

// Anonymization of user-identifying fields before sending notifications to the API channel
// (Grafana Loki or any other logs endpoint).
//
// Default behavior: anonymize when running in CI (scheduled monitoring jobs push to shared
// observability backends), keep raw values in local runs (locally generated report files must
// stay analyzable). Env var NOTIF_API_ANONYMIZE=true|false overrides the default in both
// directions.
//
// Actor fields (CreatedBy.*, LastModifiedBy.*, DelegateUser) are kept raw on purpose: they
// identify administrators performing setup actions (audit trail context), not end users.

// Leaf field names (lowercase) that carry end-user identity
const SENSITIVE_LEAF_KEYS = ['username', 'email', 'useremail', 'firstname', 'lastname'];

// Path fragments (lowercase) marking actor context that must stay readable
const ACTOR_PATH_FRAGMENTS = ['createdby', 'lastmodifiedby', 'delegateuser'];

const PSEUDONYM_PREFIX = 'user_';
const PSEUDONYM_HASH_LENGTH = 10;

export function shouldAnonymizeApiData(): boolean {
  const override = getEnvVar('NOTIF_API_ANONYMIZE');
  if (override === 'true') {
    return true;
  }
  if (override === 'false') {
    return false;
  }
  return isCI;
}

// Stable, org-salted pseudonym: same value in the same org always maps to the same hash,
// so distinct counts and per-user drill-downs keep working on anonymized data,
// while values are not linkable across orgs.
export function buildPseudonym(value: string, orgIdentifier: string): string {
  const hash = createHash('sha256').update(`${orgIdentifier}|${value}`).digest('hex');
  return PSEUDONYM_PREFIX + hash.slice(0, PSEUDONYM_HASH_LENGTH);
}

function isActorPath(fullPathLower: string): boolean {
  return ACTOR_PATH_FRAGMENTS.some((fragment) => fullPathLower.includes(fragment));
}

function isSensitiveKey(fullPath: string, row: Record<string, any>): boolean {
  const fullPathLower = fullPath.toLowerCase();
  if (isActorPath(fullPathLower)) {
    return false;
  }
  const leaf = fullPathLower.split('.').pop() || '';
  if (SENSITIVE_LEAF_KEYS.includes(leaf)) {
    return true;
  }
  // A bare "Name" field is sensitive only on rows that look like user rows
  // (so Flow names, Profile.Name or license names are never touched)
  if (fullPathLower === 'name') {
    return Object.keys(row).some((key) => {
      const otherLeaf = key.toLowerCase().split('.').pop() || '';
      return otherLeaf === 'username' && !isActorPath(key.toLowerCase());
    });
  }
  return false;
}

// Walk a log element row (flat dot-path keys like "CreatedBy.Username" and nested objects
// are both used across commands) and replace sensitive values with pseudonyms.
// Collected replacements (original -> pseudonym) are appended to replacementMap so the same
// values can be scrubbed from free-text fields afterwards.
function anonymizeRow(
  row: any,
  orgIdentifier: string,
  replacementMap: Map<string, string>,
  pathPrefix = ''
): any {
  if (row == null || typeof row !== 'object') {
    return row;
  }
  if (Array.isArray(row)) {
    return row.map((item) => anonymizeRow(item, orgIdentifier, replacementMap, pathPrefix));
  }
  const result: Record<string, any> = {};
  const rowFirstNames: string[] = [];
  const rowLastNames: string[] = [];
  for (const key of Object.keys(row)) {
    const value = row[key];
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (value != null && typeof value === 'object') {
      result[key] = anonymizeRow(value, orgIdentifier, replacementMap, fullPath);
      continue;
    }
    if (typeof value === 'string' && value.length > 0 && isSensitiveKey(fullPath, row)) {
      const pseudonym = buildPseudonym(value, orgIdentifier);
      result[key] = pseudonym;
      if (value.length >= 3) {
        replacementMap.set(value, pseudonym);
      }
      const leaf = fullPath.toLowerCase().split('.').pop() || '';
      if (leaf === 'firstname') {
        rowFirstNames.push(value);
      } else if (leaf === 'lastname') {
        rowLastNames.push(value);
      }
    } else {
      result[key] = value;
    }
  }
  // "First Last" / "Last First" combinations often appear in message bodies:
  // register them too so text scrubbing catches full display names
  for (const firstName of rowFirstNames) {
    for (const lastName of rowLastNames) {
      const combined = `${firstName} ${lastName}`;
      const combinedReverse = `${lastName} ${firstName}`;
      const pseudonym = buildPseudonym(combined, orgIdentifier);
      replacementMap.set(combined, pseudonym);
      replacementMap.set(combinedReverse, pseudonym);
    }
  }
  return result;
}

function scrubText(text: string, replacementMap: Map<string, string>): string {
  let result = text;
  // Longest originals first so "Jane Doe" is replaced before "Jane" or "Doe"
  const originals = [...replacementMap.keys()].sort((a, b) => b.length - a.length);
  for (const original of originals) {
    if (result.includes(original)) {
      result = result.split(original).join(replacementMap.get(original) || original);
    }
  }
  return result;
}

// Anonymize an API payload data object (the `data` property built by ApiProvider.buildPayload):
// - `_logElements` rows: sensitive fields replaced by org-salted pseudonyms
// - `_title` and `_logBodyText`: occurrences of the collected sensitive values scrubbed
export function anonymizeApiPayloadData(data: any, orgIdentifier: string): any {
  if (data == null || typeof data !== 'object') {
    return data;
  }
  const replacementMap = new Map<string, string>();
  const result = Object.assign({}, data);
  if (Array.isArray(result._logElements)) {
    result._logElements = anonymizeRow(result._logElements, orgIdentifier, replacementMap);
  }
  if (replacementMap.size > 0) {
    if (typeof result._title === 'string') {
      result._title = scrubText(result._title, replacementMap);
    }
    if (typeof result._logBodyText === 'string') {
      result._logBodyText = scrubText(result._logBodyText, replacementMap);
    }
  }
  return result;
}
