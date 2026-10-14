import { expect } from 'chai';
import { encrypt, decrypt } from '../../../src/common/cryptoUtils.js';

describe('cryptoUtils - encrypt/decrypt round-trip', () => {
  it('decrypts content that was encrypted with the returned key', () => {
    const originalText = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const { text: encryptedText, encryptionKey } = encrypt(originalText);
    const decryptedText = decrypt(encryptedText, encryptionKey);
    expect(decryptedText).to.equal(originalText);
  });

  it('supports storing encrypted cert content in env variable (SFDX_CLIENT_CERT pattern)', () => {
    // Simulate what getCertificateKeyFile does when SFDX_CLIENT_CERT_<ORGALIAS> env var is set:
    // the cert content is stored as encrypted text, decrypted at runtime using SFDX_CLIENT_KEY_<ORGALIAS>
    const certContent = '-----BEGIN RSA PRIVATE KEY-----\nFAKEKEYCONTENT\n-----END RSA PRIVATE KEY-----';
    const { text: encryptedCert, encryptionKey } = encrypt(certContent);

    // Simulate CI env vars
    process.env['SFDX_CLIENT_CERT_TESTBRANCH'] = encryptedCert;
    process.env['SFDX_CLIENT_KEY_TESTBRANCH'] = encryptionKey;

    // Verify decryption produces the original cert
    const storedEncryptedContent = process.env['SFDX_CLIENT_CERT_TESTBRANCH'];
    const storedKey = process.env['SFDX_CLIENT_KEY_TESTBRANCH'];
    expect(decrypt(storedEncryptedContent!, storedKey!)).to.equal(certContent);

    // Cleanup
    delete process.env['SFDX_CLIENT_CERT_TESTBRANCH'];
    delete process.env['SFDX_CLIENT_KEY_TESTBRANCH'];
  });
});
