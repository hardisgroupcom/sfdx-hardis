/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Loaded first, as the application does: a provider class imported alone meets the import cycle
// between the utils and the git provider index
import '../../../src/common/gitProvider/index.js';
import {
  cliHostFromServerUrl,
  describeCliTokenFailure,
  isProviderCliAuthEnabled,
  isProviderTokenCheckEnabled,
} from '../../../src/common/utils/providerCliAuthUtils.js';
import { runSilentCommand } from '../../../src/common/utils/silentCommandUtils.js';
import { GitlabProvider } from '../../../src/common/gitProvider/gitlab.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';
import { maskSecretEnvVars } from '../../../src/hooks/init/log.js';

const ENV_KEYS = ['CI', 'SFDX_HARDIS_PROVIDER_CLI_AUTH', 'SFDX_HARDIS_PROVIDER_TOKEN_CHECK'];

describe('providerCliAuthUtils', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('isProviderCliAuthEnabled', () => {
    it('is never enabled in CI, even when the variable asks for it', () => {
      process.env.CI = 'true';
      process.env.SFDX_HARDIS_PROVIDER_CLI_AUTH = 'true';
      expect(isProviderCliAuthEnabled()).to.be.false;
    });

    it('follows SFDX_HARDIS_PROVIDER_CLI_AUTH outside CI', () => {
      process.env.SFDX_HARDIS_PROVIDER_CLI_AUTH = 'true';
      expect(isProviderCliAuthEnabled()).to.be.true;
      process.env.SFDX_HARDIS_PROVIDER_CLI_AUTH = 'false';
      expect(isProviderCliAuthEnabled()).to.be.false;
    });

    it('is off without --agent when the variable is not set', () => {
      // mocha is not started with --agent
      expect(isProviderCliAuthEnabled()).to.be.false;
    });
  });

  it('checks the token unless SFDX_HARDIS_PROVIDER_TOKEN_CHECK=false', () => {
    expect(isProviderTokenCheckEnabled()).to.be.true;
    process.env.SFDX_HARDIS_PROVIDER_TOKEN_CHECK = 'false';
    expect(isProviderTokenCheckEnabled()).to.be.false;
  });

  describe('cliHostFromServerUrl', () => {
    it('keeps the port of an https remote and drops the SSH port', () => {
      expect(cliHostFromServerUrl('https://git.acme.com:8443', 'https://git.acme.com:8443/a/b.git')).to.equal('git.acme.com:8443');
      expect(cliHostFromServerUrl('https://git.acme.com:2222', 'ssh://git@git.acme.com:2222/a/b.git')).to.equal('git.acme.com');
      expect(cliHostFromServerUrl('https://github.com', 'git@github.com:a/b.git')).to.equal('github.com');
    });

    it('refuses what cannot be passed to a CLI', () => {
      expect(cliHostFromServerUrl(null, 'x')).to.equal('');
      expect(cliHostFromServerUrl('not a url', 'x')).to.equal('');
    });
  });

  describe('describeCliTokenFailure', () => {
    it('tells how to install or log in, and says nothing when there is no CLI', () => {
      const source = GithubProvider.getCliTokenSource();
      expect(describeCliTokenFailure({ token: null, source, host: 'github.com', reason: 'notInstalled' })).to.contain('https://cli.github.com/');
      expect(describeCliTokenFailure({ token: null, source, host: 'github.com', reason: 'notLoggedIn' })).to.contain('gh auth login --hostname github.com');
      expect(describeCliTokenFailure({ token: null, source: null, host: '' })).to.be.null;
    });
  });

  describe('GitlabProvider.parseGlabStatusToken', () => {
    it('reads the token of the "Token found" line only', () => {
      const output = [
        'gitlab.acme.com',
        '  ✓ Logged in to gitlab.acme.com as helios-bot (C:\\Users\\x\\config.yml)',
        '  ✓ API calls for gitlab.acme.com are made over https protocol.',
        '  ✓ Token found: glpat-FAKEFAKEFAKEFAKE1234',
      ].join('\n');
      expect(GitlabProvider.parseGlabStatusToken(output)).to.equal('glpat-FAKEFAKEFAKEFAKE1234');
    });

    it('returns null for a masked token or no token', () => {
      expect(GitlabProvider.parseGlabStatusToken('  ✓ Token found: **************************')).to.be.null;
      expect(GitlabProvider.parseGlabStatusToken('  ! No token found (checked config file, keyring, and environment variables).')).to.be.null;
      expect(GitlabProvider.parseGlabStatusToken('')).to.be.null;
    });
  });

  describe('AzureDevopsProvider.getAuthorizationHeaderForToken', () => {
    it('sends a Personal Access Token as Basic and any other token as Bearer', () => {
      expect(AzureDevopsProvider.getAuthorizationHeaderForToken('a'.repeat(52))).to.match(/^Basic /);
      expect(AzureDevopsProvider.getAuthorizationHeaderForToken('a'.repeat(84))).to.match(/^Basic /);
      expect(AzureDevopsProvider.getAuthorizationHeaderForToken('eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl')).to.equal('Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl');
    });
  });

  it('masks the values of the secret variables of the debug environment dump', () => {
    const masked = maskSecretEnvVars({ GITHUB_TOKEN: 'abc', PAT: 'def', SFDX_AUTH_URL: 'force://x', JIRA_API_KEY: 'k', PATH: '/usr/bin', EMPTY_TOKEN: '' });
    expect(masked).to.deep.equal({ GITHUB_TOKEN: '***', PAT: '***', SFDX_AUTH_URL: '***', JIRA_API_KEY: '***', PATH: '/usr/bin', EMPTY_TOKEN: '' });
  });

  describe('runSilentCommand', () => {
    it('returns the output and the exit code without displaying anything', async () => {
      const result = await runSilentCommand(process.execPath, ['-e', 'process.stdout.write("out");process.stderr.write("err");process.exit(3)']);
      expect(result).to.deep.equal({ status: 3, stdout: 'out', stderr: 'err' });
    });

    it('stops a command that does not end in time', async () => {
      const result = await runSilentCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { timeoutMs: 200 });
      expect(result.status).to.equal(1);
    });

    it('answers 1 for a command that does not exist', async () => {
      const result = await runSilentCommand('sfdx-hardis-command-that-does-not-exist', []);
      expect(result.status).to.equal(1);
    });

    if (process.platform === 'win32') {
      it('refuses an argument cmd.exe could read as a command', async () => {
        const result = await runSilentCommand('C:\\tools\\az.cmd', ['account', 'x & calc']);
        expect(result.status).to.equal(1);
      });
    }
  });
});
