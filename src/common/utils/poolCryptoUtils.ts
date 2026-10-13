import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { deflateRawSync, inflateRawSync } from 'zlib';
import { getEnvVar } from '../../config/index.js';

// Variable holding the key that encrypts the scratch org credentials stored in the git provider
export const POOL_ENCRYPTION_KEY_ENV_VAR = 'SFDX_HARDIS_POOL_ENCRYPTION_KEY';

// Variable holding the key the pool had before a rotation: with it, the refresh can tell the
// entries of the previous key from forged ones, and delete their scratch orgs
export const POOL_PREVIOUS_ENCRYPTION_KEY_ENV_VAR = 'SFDX_HARDIS_POOL_PREVIOUS_ENCRYPTION_KEY';

// The salt is not a secret: it only makes the derived key specific to this usage
const KEY_DERIVATION_SALT = 'sfdx-hardis-scratch-org-pool';
const derivedKeys = new Map<string, Buffer>();

// Key of the pool, as the CI variable or the .env file gives it. Null when it is not set.
export function getPoolEncryptionKey(): string | null {
  const key = (getEnvVar(POOL_ENCRYPTION_KEY_ENV_VAR) || '').trim();
  return key === '' ? null : key;
}

export function getPreviousPoolEncryptionKey(): string | null {
  const key = (getEnvVar(POOL_PREVIOUS_ENCRYPTION_KEY_ENV_VAR) || '').trim();
  return key === '' ? null : key;
}

// A new random key, to store in the CI variable
export function generatePoolEncryptionKey(): string {
  return randomBytes(32).toString('base64url');
}

// Short public fingerprint of a key: two entries with the same one were encrypted with the same
// key, so a key rotation is detected without trying to decrypt anything
export function getPoolKeyId(key: string): string {
  return createHash('sha256').update(deriveKey(key)).digest('hex').slice(0, 8);
}

// AES-256-GCM of the deflated JSON, as "iv.tag.ciphertext" in base64url
export function encryptPoolPayload(value: any, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

// Throws when the key is not the one the payload was encrypted with, or when the payload was altered
export function decryptPoolPayload(payload: string, key: string): any {
  const [iv, tag, ciphertext] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext) {
    throw new Error('Malformed scratch org pool payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(key), iv);
  decipher.setAuthTag(tag);
  const deflated = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(inflateRawSync(deflated).toString('utf8'));
}

// Signature of the data of a pool comment. Anyone who can comment on the dashboard can write a
// comment that looks like one of the pool: only the holders of the key can sign it.
export function signPoolData(data: Record<string, any>, key: string): string {
  const unsigned = { ...data };
  delete unsigned.mac;
  return createHmac('sha256', deriveKey(key)).update(stableStringify(unsigned)).digest('hex');
}

export function isPoolDataSignedBy(data: Record<string, any>, key: string): boolean {
  if (typeof data?.mac !== 'string') {
    return false;
  }
  const expected = Buffer.from(signPoolData(data, key), 'hex');
  const actual = Buffer.from(data.mac, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// JSON with sorted keys, so the same data always gives the same signature
function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((name) => value[name] !== undefined).map((name) => `${JSON.stringify(name)}:${stableStringify(value[name])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deriveKey(key: string): Buffer {
  let derived = derivedKeys.get(key);
  if (!derived) {
    derived = scryptSync(key, KEY_DERIVATION_SALT, 32);
    derivedKeys.set(key, derived);
  }
  return derived;
}
