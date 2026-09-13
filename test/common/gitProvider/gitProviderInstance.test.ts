/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { GitlabProvider } from '../../../src/common/gitProvider/gitlab.js';

const ENV_KEYS = [
  'GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_API_URL',
  'CI_JOB_TOKEN', 'CI_SFDX_HARDIS_GITLAB_TOKEN', 'CI_SERVER_URL', 'CI_PROJECT_ID', 'CI_PROJECT_PATH', 'GITLAB_CI',
  'SYSTEM_ACCESSTOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'SYSTEM_COLLECTIONURI',
  'BITBUCKET_WORKSPACE', 'BITBUCKET_REPO_SLUG', 'CI_SFDX_HARDIS_BITBUCKET_TOKEN',
];

describe('GitProvider.getInstance', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    GitProvider.resetInstance();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    GitProvider.resetInstance();
  });

  it('builds the provider once per process for the same environment', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'acme/widgets';
    const first = await GitProvider.getInstance();
    const second = await GitProvider.getInstance();
    expect(first).to.be.instanceOf(GithubProvider);
    expect(second).to.equal(first);
  });

  it('builds another provider when the environment changes, and after a reset', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'acme/widgets';
    const github = await GitProvider.getInstance();
    delete process.env.GITHUB_TOKEN;
    process.env.CI_SFDX_HARDIS_GITLAB_TOKEN = 'glpat';
    process.env.CI_SERVER_URL = 'https://gitlab.example.com';
    process.env.CI_PROJECT_ID = '42';
    process.env.GITLAB_CI = 'true';
    const gitlab = await GitProvider.getInstance();
    expect(github).to.be.instanceOf(GithubProvider);
    expect(gitlab).to.be.instanceOf(GitlabProvider);
    const again = await GitProvider.getInstance();
    expect(again).to.equal(gitlab);
    GitProvider.resetInstance();
    const rebuilt = await GitProvider.getInstance();
    expect(rebuilt).to.be.instanceOf(GitlabProvider);
    expect(rebuilt).to.not.equal(gitlab);
  });

  it('remembers that no provider is configured', async () => {
    expect(await GitProvider.getInstance()).to.be.null;
    expect(await GitProvider.getInstance()).to.be.null;
  });
});
