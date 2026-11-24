/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { GitProviderConnectionCheck } from '../../../src/common/gitProvider/gitProviderRoot.js';
import { cliTokenFound, getProviderCliFailure, getProviderTokenInfo, resetProviderCliAuthState } from '../../../src/common/utils/providerCliAuthUtils.js';
import { clearRegisteredSecrets, redactSecrets } from '../../../src/common/utils/secretMaskingUtils.js';

const ENV_KEYS = [
  'CI', 'SFDX_HARDIS_PROVIDER_CLI_AUTH', 'SFDX_HARDIS_PROVIDER_TOKEN_CHECK',
  'GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN', 'PAT', 'GITHUB_REPOSITORY', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY_OWNER',
  'CI_JOB_TOKEN', 'CI_SFDX_HARDIS_GITLAB_TOKEN', 'SYSTEM_ACCESSTOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'AZURE_DEVOPS_EXT_PAT',
  'BITBUCKET_WORKSPACE', 'CI_SFDX_HARDIS_BITBUCKET_TOKEN',
];
const REMOTE = 'https://github.com/acme/widgets.git';
const CLI_TOKEN = 'gho_fake_cli_token_0000000000000000';

describe('GitProvider CLI token fallback', () => {
  let savedEnv: Record<string, string | undefined>;
  const original = {
    readCliToken: GithubProvider.readCliToken,
    checkConnection: GithubProvider.prototype.checkConnection,
    getOriginRemoteUrl: (GitProvider as any).getOriginRemoteUrl,
  };
  let cliCalls: number;
  let checkedTokens: string[];
  let answers: Record<string, GitProviderConnectionCheck>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.SFDX_HARDIS_PROVIDER_CLI_AUTH = 'true';
    cliCalls = 0;
    checkedTokens = [];
    answers = {};
    (GitProvider as any).getOriginRemoteUrl = async () => REMOTE;
    GithubProvider.readCliToken = async () => {
      cliCalls++;
      return cliTokenFound(CLI_TOKEN, GithubProvider.getCliTokenSource(), 'github.com');
    };
    GithubProvider.prototype.checkConnection = async function (this: any) {
      const token = this.api['headers'].Authorization.replace('token ', '');
      checkedTokens.push(token);
      return answers[token] || { connected: true };
    };
    GitProvider.resetInstance();
    resetProviderCliAuthState();
    clearRegisteredSecrets();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    GithubProvider.readCliToken = original.readCliToken;
    GithubProvider.prototype.checkConnection = original.checkConnection;
    (GitProvider as any).getOriginRemoteUrl = original.getOriginRemoteUrl;
    GitProvider.resetInstance();
    resetProviderCliAuthState();
    clearRegisteredSecrets();
  });

  it('keeps a token of the environment that the provider accepts, without asking the CLI', async () => {
    process.env.GITHUB_TOKEN = 'ghp_env_token';
    await GitProvider.applyCliTokenFallback();
    expect(cliCalls).to.equal(0);
    expect(checkedTokens).to.deep.equal(['ghp_env_token']);
    expect(process.env.CI_SFDX_HARDIS_GITHUB_TOKEN).to.be.undefined;
    expect(getProviderTokenInfo('github')).to.deep.equal({ source: 'env', variable: 'GITHUB_TOKEN' });
  });

  it('replaces a refused token of the environment with the token of the CLI', async () => {
    process.env.GITHUB_TOKEN = 'ghp_REFUSED';
    answers.ghp_REFUSED = { connected: false, reason: 'refused', httpStatus: 401 };
    await GitProvider.applyCliTokenFallback();
    expect(cliCalls).to.equal(1);
    expect(checkedTokens).to.deep.equal(['ghp_REFUSED', CLI_TOKEN]);
    expect(process.env.CI_SFDX_HARDIS_GITHUB_TOKEN).to.equal(CLI_TOKEN);
    expect(getProviderTokenInfo('github')).to.deep.equal({ source: 'gh', variable: 'CI_SFDX_HARDIS_GITHUB_TOKEN' });
  });

  it('keeps the token of the environment when the provider cannot be reached', async () => {
    process.env.GITHUB_TOKEN = 'ghp_env_token';
    answers.ghp_env_token = { connected: false, reason: 'unreachable', message: 'ECONNRESET' };
    await GitProvider.applyCliTokenFallback();
    expect(cliCalls).to.equal(0);
    expect(process.env.CI_SFDX_HARDIS_GITHUB_TOKEN).to.be.undefined;
  });

  it('uses the token of the CLI when no variable is set', async () => {
    await GitProvider.applyCliTokenFallback();
    expect(cliCalls).to.equal(1);
    expect(process.env.CI_SFDX_HARDIS_GITHUB_TOKEN).to.equal(CLI_TOKEN);
  });

  it('uses the token of the environment without checking it when the check is off', async () => {
    process.env.SFDX_HARDIS_PROVIDER_TOKEN_CHECK = 'false';
    process.env.GITHUB_TOKEN = 'ghp_env_token';
    await GitProvider.applyCliTokenFallback();
    expect(checkedTokens).to.deep.equal([]);
    expect(cliCalls).to.equal(0);
  });

  it('keeps the refused token when the token of the CLI is refused too, and says why', async () => {
    process.env.GITHUB_TOKEN = 'ghp_REFUSED';
    answers.ghp_REFUSED = { connected: false, reason: 'refused', httpStatus: 401 };
    answers[CLI_TOKEN] = { connected: false, reason: 'refused', httpStatus: 403 };
    await GitProvider.applyCliTokenFallback();
    expect(process.env.CI_SFDX_HARDIS_GITHUB_TOKEN).to.be.undefined;
    expect(getProviderCliFailure('github')).to.contain('403');
  });

  it('does nothing when the fallback is not enabled', async () => {
    process.env.SFDX_HARDIS_PROVIDER_CLI_AUTH = 'false';
    await GitProvider.applyCliTokenFallback();
    expect(cliCalls).to.equal(0);
    expect(checkedTokens).to.deep.equal([]);
  });

  it('never lets a token reach the outputs', async () => {
    process.env.GITHUB_TOKEN = 'ghp_REFUSED';
    answers.ghp_REFUSED = { connected: false, reason: 'refused', httpStatus: 401 };
    await GitProvider.applyCliTokenFallback();
    const text = redactSecrets(`env ghp_REFUSED cli ${CLI_TOKEN}`);
    expect(text).to.not.contain('ghp_REFUSED');
    expect(text).to.not.contain(CLI_TOKEN);
  });

  it('reports a connected provider and where its token comes from', async () => {
    process.env.GITHUB_REPOSITORY = 'acme/widgets';
    const status = await GitProvider.checkConnection();
    expect(status).to.include({ type: 'git', provider: 'github', label: 'GitHub', connected: true, tokenSource: 'gh', detail: null });
  });

  it('says what to do when there is no token at all', async () => {
    GithubProvider.readCliToken = async () => ({ token: null, source: GithubProvider.getCliTokenSource(), host: 'github.com', reason: 'notLoggedIn' });
    const status = await GitProvider.checkConnection();
    expect(status.connected).to.be.false;
    expect(status.detail).to.contain('CI_SFDX_HARDIS_GITHUB_TOKEN');
    expect(status.detail).to.contain('gh auth login --hostname github.com');
  });
});
