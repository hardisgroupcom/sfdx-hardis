/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { parseSfCommand, tokenizeCommand } from '../../../src/common/utils/sfCoreCommands.js';
import { applySfPerformanceEnv } from '../../../src/common/utils/index.js';

describe('sfCoreCommands', () => {
  describe('tokenizeCommand', () => {
    it('splits on spaces and honors quotes', () => {
      expect(tokenizeCommand(`sf config set target-org="my alias" --json`)).to.deep.equal([
        'sf',
        'config',
        'set',
        'target-org=my alias',
        '--json',
      ]);
    });
  });

  describe('parseSfCommand', () => {
    it('recognizes org display with and without target org', () => {
      expect(parseSfCommand('sf org display --json')).to.deep.equal({ kind: 'org-display', targetOrg: null });
      expect(parseSfCommand('sf org display --target-org myOrg --json')).to.deep.equal({ kind: 'org-display', targetOrg: 'myOrg' });
      expect(parseSfCommand('sf org display -o myOrg')).to.deep.equal({ kind: 'org-display', targetOrg: 'myOrg' });
      expect(parseSfCommand('sf org display --target-org=myOrg')).to.deep.equal({ kind: 'org-display', targetOrg: 'myOrg' });
    });

    it('refuses org display with unsupported flags', () => {
      expect(parseSfCommand('sf org display --target-org myOrg --verbose --json')).to.be.null;
      expect(parseSfCommand('sf org display --api-version 60.0')).to.be.null;
    });

    it('recognizes config get', () => {
      expect(parseSfCommand('sf config get target-org --json')).to.deep.equal({ kind: 'config-get', keys: ['target-org'] });
      expect(parseSfCommand('sf config get target-org target-dev-hub')).to.deep.equal({
        kind: 'config-get',
        keys: ['target-org', 'target-dev-hub'],
      });
      expect(parseSfCommand('sf config get --json')).to.be.null;
    });

    it('recognizes config set', () => {
      expect(parseSfCommand('sf config set target-org=user@example.com --json')).to.deep.equal({
        kind: 'config-set',
        entries: [{ name: 'target-org', value: 'user@example.com' }],
        global: false,
      });
      expect(parseSfCommand('sf config set target-dev-hub=hub --global')).to.deep.equal({
        kind: 'config-set',
        entries: [{ name: 'target-dev-hub', value: 'hub' }],
        global: true,
      });
      expect(parseSfCommand('sf config set target-org --json')).to.be.null;
    });

    it('ignores commands that are not handled in-process', () => {
      expect(parseSfCommand('sf org list --json')).to.be.null;
      expect(parseSfCommand('sf org list metadata --metadata-type ConnectedApp --json')).to.be.null;
      expect(parseSfCommand('sf project deploy start --json')).to.be.null;
      expect(parseSfCommand('git status')).to.be.null;
    });
  });

  describe('applySfPerformanceEnv', () => {
    const previous = process.env.SFDX_HARDIS_ENHANCE_PERFORMANCE;
    afterEach(() => {
      if (previous === undefined) {
        delete process.env.SFDX_HARDIS_ENHANCE_PERFORMANCE;
      } else {
        process.env.SFDX_HARDIS_ENHANCE_PERFORMANCE = previous;
      }
    });

    it('sets sf performance variables without overriding user values', () => {
      delete process.env.SFDX_HARDIS_ENHANCE_PERFORMANCE;
      const env: Record<string, any> = { SF_DISABLE_TELEMETRY: 'false' };
      applySfPerformanceEnv('sf org list --json', env);
      expect(env.SF_DISABLE_TELEMETRY).to.equal('false');
      expect(env.SF_DISABLE_LOG_FILE).to.equal('true');
      expect(env.SF_SKIP_NEW_VERSION_CHECK).to.equal('true');
      expect(env.SF_DISABLE_AUTOUPDATE).to.equal('true');
    });

    it('does nothing for non sf commands', () => {
      delete process.env.SFDX_HARDIS_ENHANCE_PERFORMANCE;
      const env: Record<string, any> = {};
      applySfPerformanceEnv('git status', env);
      expect(env).to.deep.equal({});
    });

    it('does nothing when SFDX_HARDIS_ENHANCE_PERFORMANCE=false', () => {
      process.env.SFDX_HARDIS_ENHANCE_PERFORMANCE = 'false';
      const env: Record<string, any> = {};
      applySfPerformanceEnv('sf org list --json', env);
      expect(env).to.deep.equal({});
    });
  });
});
