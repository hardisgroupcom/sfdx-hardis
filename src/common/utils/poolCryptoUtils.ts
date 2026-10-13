import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { deflateRawSync, inflateRawSync } from 'zlib';
import { getEnvVar } from '../../config/index.js';

// Variable holding the key that encrypts the scratch org credentials stored in the git provider
export const POOL_ENCRYPTION_KEY_ENV_VAR = 'SFDX_HARDIS_POOL_ENCRYPTION_KEY';

// The salt is not a secret: it only makes the derived key specific to this usage
const KEY_DERIVATION_SALT = 'sfdx-hardis-scratch-org-pool';
const derivedKeys = new Map<string, Buffer>();

// Key of the pool, as the CI variable or the .env file gives it. Null when it is not set.
export function getPoolEncryptionKey(): string | null {
  const key = (getEnvVar(POOL_ENCRYPTION_KEY_ENV_VAR) || '').trim();
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

function deriveKey(key: string): Buffer {
  let derived = derivedKeys.get(key);
  if (!derived) {
    derived = scryptSync(key, KEY_DERIVATION_SALT, 32);
    derivedKeys.set(key, derived);
  }
  return derived;
}
