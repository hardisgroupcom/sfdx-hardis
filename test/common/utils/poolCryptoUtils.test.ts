import { expect } from 'chai';
import {
  decryptPoolPayload,
  encryptPoolPayload,
  generatePoolEncryptionKey,
  getPoolEncryptionKey,
  getPoolKeyId,
  POOL_ENCRYPTION_KEY_ENV_VAR,
} from '../../../src/common/utils/poolCryptoUtils.js';

describe('poolCryptoUtils', () => {
  const scratchOrg = {
    scratchOrgAlias: 'PO-test',
    scratchOrgSfdxAuthUrl: 'force://PlatformCLI::secret-token@example.my.salesforce.com',
    authFileJson: { result: { expirationDate: '2026-12-01', instanceUrl: 'https://example.my.salesforce.com' } },
  };

  it('decrypts what it encrypted', () => {
    const key = generatePoolEncryptionKey();
    const payload = encryptPoolPayload(scratchOrg, key);
    expect(decryptPoolPayload(payload, key)).to.deep.equal(scratchOrg);
  });

  it('does not leave the credentials readable in the payload', () => {
    const payload = encryptPoolPayload(scratchOrg, generatePoolEncryptionKey());
    expect(payload).to.not.include('secret-token');
    expect(Buffer.from(payload.split('.')[2], 'base64url').toString('utf8')).to.not.include('secret-token');
  });

  it('encrypts the same value differently each time', () => {
    const key = generatePoolEncryptionKey();
    expect(encryptPoolPayload(scratchOrg, key)).to.not.equal(encryptPoolPayload(scratchOrg, key));
  });

  it('refuses another key', () => {
    const payload = encryptPoolPayload(scratchOrg, generatePoolEncryptionKey());
    expect(() => decryptPoolPayload(payload, generatePoolEncryptionKey())).to.throw();
  });

  it('refuses an altered payload', () => {
    const key = generatePoolEncryptionKey();
    const [iv, tag, ciphertext] = encryptPoolPayload(scratchOrg, key).split('.');
    const altered = Buffer.from(ciphertext, 'base64url');
    altered[0] = altered[0] ^ 1;
    expect(() => decryptPoolPayload([iv, tag, altered.toString('base64url')].join('.'), key)).to.throw();
    expect(() => decryptPoolPayload('not-a-payload', key)).to.throw();
  });

  it('gives the same id to the same key, and another one to another key', () => {
    const key = generatePoolEncryptionKey();
    expect(getPoolKeyId(key)).to.equal(getPoolKeyId(key));
    expect(getPoolKeyId(key)).to.match(/^[0-9a-f]{8}$/);
    expect(getPoolKeyId(key)).to.not.equal(getPoolKeyId(generatePoolEncryptionKey()));
  });

  it('reads the key from the environment, and ignores an unresolved Azure variable', () => {
    const previous = process.env[POOL_ENCRYPTION_KEY_ENV_VAR];
    try {
      process.env[POOL_ENCRYPTION_KEY_ENV_VAR] = '  my-key  ';
      expect(getPoolEncryptionKey()).to.equal('my-key');
      process.env[POOL_ENCRYPTION_KEY_ENV_VAR] = '$(SFDX_HARDIS_POOL_ENCRYPTION_KEY)';
      expect(getPoolEncryptionKey()).to.equal(null);
      delete process.env[POOL_ENCRYPTION_KEY_ENV_VAR];
      expect(getPoolEncryptionKey()).to.equal(null);
    } finally {
      if (previous === undefined) {
        delete process.env[POOL_ENCRYPTION_KEY_ENV_VAR];
      } else {
        process.env[POOL_ENCRYPTION_KEY_ENV_VAR] = previous;
      }
    }
  });
});
