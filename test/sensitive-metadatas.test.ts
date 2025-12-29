import { strict as assert } from 'assert';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import CleanSensitiveMetadatas from '../src/commands/hardis/project/clean/sensitive-metadatas.js';

describe('hardis:project:clean:sensitive-metadatas', () => {
  it('hides certificates and sensitive metadata fields', async () => {
    const originalCwd = process.cwd();
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-'));
    const forceApp = path.join(projectDir, 'force-app');
    await fs.writeJson(path.join(projectDir, 'sfdx-project.json'), {
      packageDirectories: [{ path: 'force-app', default: true }],
      namespace: '',
      sfdcLoginUrl: 'https://login.salesforce.com',
      sourceApiVersion: '60.0',
    });

    const certPath = path.join(forceApp, 'main', 'default', 'certs', 'MyCert.crt');
    await fs.ensureDir(path.dirname(certPath));
    await fs.writeFile(certPath, '-----BEGIN CERTIFICATE-----\nSECRET\n-----END CERTIFICATE-----');

    const authProviderPath = path.join(
      forceApp,
      'main',
      'default',
      'authproviders',
      'MyAuthProvider.authprovider-meta.xml'
    );
    await fs.ensureDir(path.dirname(authProviderPath));
    await fs.writeFile(
      authProviderPath,
      '<AuthProvider xmlns="http://soap.sforce.com/2006/04/metadata"><consumerSecret>should-hide</consumerSecret></AuthProvider>'
    );

    const connectedAppPath = path.join(
      forceApp,
      'main',
      'default',
      'connectedApps',
      'MyConnectedApp.connectedApp-meta.xml'
    );
    await fs.ensureDir(path.dirname(connectedAppPath));
    await fs.writeFile(
      connectedAppPath,
      '<ConnectedApp xmlns="http://soap.sforce.com/2006/04/metadata"><consumerSecret>should-hide</consumerSecret></ConnectedApp>'
    );

    const namedCredentialPath = path.join(
      forceApp,
      'main',
      'default',
      'namedCredentials',
      'MyCredential.namedCredential-meta.xml'
    );
    await fs.ensureDir(path.dirname(namedCredentialPath));
    await fs.writeFile(
      namedCredentialPath,
      `<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
  <username>my-user</username>
  <password>super-secret</password>
  <clientSecret>client-secret</clientSecret>
  <privateKey>private-key</privateKey>
</NamedCredential>`
    );

    try {
      process.chdir(projectDir);
      await CleanSensitiveMetadatas.run(['--folder', forceApp]);

      const certContent = await fs.readFile(certPath, 'utf8');
      assert.ok(certContent.startsWith('CERTIFICATE HIDDEN BY SFDX-HARDIS'), 'certificate content should be hidden');

      const authContent = await fs.readFile(authProviderPath, 'utf8');
      assert.ok(
        authContent.includes('<consumerSecret>HIDDEN_BY_SFDX_HARDIS</consumerSecret>'),
        'auth provider secret should be hidden'
      );

      const connectedContent = await fs.readFile(connectedAppPath, 'utf8');
      assert.ok(
        connectedContent.includes('<consumerSecret>HIDDEN_BY_SFDX_HARDIS</consumerSecret>'),
        'connected app secret should be hidden'
      );

      const namedContent = await fs.readFile(namedCredentialPath, 'utf8');
      assert.ok(namedContent.includes('<username>HIDDEN_BY_SFDX_HARDIS</username>'), 'username should be hidden');
      assert.ok(namedContent.includes('<password>HIDDEN_BY_SFDX_HARDIS</password>'), 'password should be hidden');
      assert.ok(
        namedContent.includes('<clientSecret>HIDDEN_BY_SFDX_HARDIS</clientSecret>'),
        'client secret should be hidden'
      );
      assert.ok(namedContent.includes('<privateKey>HIDDEN_BY_SFDX_HARDIS</privateKey>'), 'private key should be hidden');
    } finally {
      process.chdir(originalCwd);
      await fs.remove(projectDir);
    }
  });
});
