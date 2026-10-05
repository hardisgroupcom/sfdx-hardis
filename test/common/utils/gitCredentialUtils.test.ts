/* eslint-disable @typescript-eslint/no-unused-expressions */
// Git credentials kept by git's credential helper. The store tests run the real git, in a scratch
// repository whose global and system configurations are replaced, and with a helper writing in a
// temporary file: nothing of the machine's own git configuration or credential store is touched.
import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildGitCredentialInput,
  forgetGitCredentials,
  GitCredentialHelperProbes,
  listCandidateGitCredentialHelpers,
  listGitCredentialHelpers,
  parseGitCredentialOutput,
  readStoredGitCredentials,
  storeGitCredentials,
} from '../../../src/common/utils/gitCredentialUtils.js';

const probes = (overrides: Partial<GitCredentialHelperProbes>): GitCredentialHelperProbes => ({
  platform: 'linux',
  hasManager: () => false,
  hasBundledHelper: () => false,
  ...overrides,
});

describe('git credential input and output', () => {
  it('builds what git credential reads, ended by an empty line', () => {
    expect(buildGitCredentialInput({ url: 'https://gitlab.com/acme/crm.git', username: 'jane', password: 'glpat-1' })).to.equal(
      'url=https://gitlab.com/acme/crm.git\nusername=jane\npassword=glpat-1\n\n'
    );
    expect(buildGitCredentialInput({ url: 'https://gitlab.com/acme/crm.git' })).to.equal('url=https://gitlab.com/acme/crm.git\n\n');
  });

  it('reads what git credential fill prints, a password holding an = included', () => {
    expect(parseGitCredentialOutput('protocol=https\r\nhost=gitlab.com\nusername=jane\npassword=a=b=c\n')).to.deep.equal({
      protocol: 'https',
      host: 'gitlab.com',
      username: 'jane',
      password: 'a=b=c',
    });
  });
});

describe('listCandidateGitCredentialHelpers()', () => {
  it('prefers the protected store of the platform, and always ends with the file of git', () => {
    expect(listCandidateGitCredentialHelpers(probes({ platform: 'win32', hasManager: () => true }))).to.deep.equal(['manager', 'store']);
    expect(
      listCandidateGitCredentialHelpers(probes({ platform: 'darwin', hasBundledHelper: (name) => name === 'osxkeychain' }))
    ).to.deep.equal(['osxkeychain', 'store']);
    expect(
      listCandidateGitCredentialHelpers(
        probes({ platform: 'linux', hasManager: () => true, hasBundledHelper: (name) => name === 'libsecret' })
      )
    ).to.deep.equal(['libsecret', 'manager', 'store']);
    expect(listCandidateGitCredentialHelpers(probes({ platform: 'linux' }))).to.deep.equal(['store']);
  });

  it('does not offer the helper of another platform', () => {
    expect(listCandidateGitCredentialHelpers(probes({ platform: 'linux', hasBundledHelper: () => true }))).to.deep.equal([
      'libsecret',
      'store',
    ]);
  });

  it('takes the helper the user forces, and nothing else', () => {
    expect(listCandidateGitCredentialHelpers(probes({ forcedHelper: 'cache --timeout=3600', hasManager: () => true }))).to.deep.equal([
      'cache --timeout=3600',
    ]);
  });
});

describe('git credentials in the credential helper (real git)', function () {
  this.timeout(60000);
  const url = 'https://git.example.invalid/acme/crm.git';
  const credentials = { url, username: 'jane', password: 'glpat-s3cret/with@odd:chars' };
  const envBefore = { ...process.env };
  let workDir: string;
  let repo: string;
  let storeFile: string;
  let helper: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-git-cred-'));
    repo = path.join(workDir, 'repo');
    fs.mkdirSync(repo);
    storeFile = path.join(workDir, 'credentials').replace(/\\/g, '/');
    helper = `store --file "${storeFile}"`;
    // The machine's own git configuration is out of the picture
    process.env.GIT_CONFIG_GLOBAL = path.join(workDir, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
    git('init', '-q');
  });

  afterEach(() => {
    for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) {
      if (envBefore[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBefore[key];
      }
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('keeps credentials in the configured helper, and reads them back', () => {
    git('config', '--local', 'credential.helper', helper);
    const result = storeGitCredentials(credentials, repo, probes({}));
    expect(result).to.deep.equal({ stored: true, helper, configuredScope: null });
    expect(readStoredGitCredentials(url, repo)).to.deep.equal({ username: 'jane', password: credentials.password });
    // The remote URL is never where they go
    expect(fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8')).to.not.include('glpat');
  });

  it('configures a helper for the user when none is, so the credentials are asked once', () => {
    expect(listGitCredentialHelpers(repo)).to.deep.equal([]);
    const result = storeGitCredentials(credentials, repo, probes({ forcedHelper: helper }));
    expect(result).to.deep.equal({ stored: true, helper, configuredScope: 'global' });
    expect(git('config', '--global', '--get', 'credential.helper')).to.equal(helper);
    // Another repository of the machine finds them too
    const other = path.join(workDir, 'other');
    fs.mkdirSync(other);
    execFileSync('git', ['init', '-q'], { cwd: other });
    expect(readStoredGitCredentials(url, other)?.password).to.equal(credentials.password);
  });

  it('goes on to the next helper when one keeps nothing', () => {
    // A helper that accepts everything and stores nothing, then the file of git
    const result = storeGitCredentials(credentials, repo, {
      ...probes({}),
      forcedHelper: undefined,
      hasManager: () => false,
      hasBundledHelper: () => false,
    });
    expect(result.stored).to.be.true;
    expect(result.helper).to.equal('store');
    expect(result.configuredScope).to.equal('global');
  });

  it('adds the file of git for the repository when the configured helper keeps nothing', () => {
    git('config', '--local', 'credential.helper', '!true');
    const result = storeGitCredentials(credentials, repo, probes({}));
    expect(result).to.deep.equal({ stored: true, helper: 'store', configuredScope: 'local' });
    expect(listGitCredentialHelpers(repo)).to.deep.equal(['!true', 'store']);
  });

  it('forgets credentials the remote refused', () => {
    git('config', '--local', 'credential.helper', helper);
    storeGitCredentials(credentials, repo, probes({}));
    forgetGitCredentials(credentials, repo);
    expect(readStoredGitCredentials(url, repo)).to.equal(null);
  });

  it('reads nothing, and asks nothing, when no credentials are stored', () => {
    git('config', '--local', 'credential.helper', helper);
    expect(readStoredGitCredentials(url, repo)).to.equal(null);
  });

  it('ignores the helpers an empty entry resets', () => {
    git('config', '--local', 'credential.helper', 'cache');
    git('config', '--local', '--add', 'credential.helper', '');
    git('config', '--local', '--add', 'credential.helper', helper);
    expect(listGitCredentialHelpers(repo)).to.deep.equal([helper]);
  });

  it('refuses a line break, which would forge another field', () => {
    git('config', '--local', 'credential.helper', helper);
    const result = storeGitCredentials({ ...credentials, password: 'x\nhost=evil.example' }, repo, probes({}));
    expect(result.stored).to.be.false;
  });
});
