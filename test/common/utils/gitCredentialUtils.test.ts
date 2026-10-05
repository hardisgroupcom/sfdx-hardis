/* eslint-disable @typescript-eslint/no-unused-expressions */
// Git credentials kept by git's credential helper. The store tests run the real git in a scratch
// repository, with the home folder and the global and system git configurations replaced by
// temporary ones: nothing of the machine's own git configuration or credential store is read or
// written, the clear text file of the `store` helper included (it lives in the home folder).
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
  hasManager: async () => false,
  hasBundledHelper: async () => false,
  ...overrides,
});

// GIT_CONFIG_GLOBAL, which keeps the tests away from the real global configuration, came with git 2.32
function gitIsolatesItsGlobalConfig(): boolean {
  try {
    const [major, minor] = execFileSync('git', ['--version'], { encoding: 'utf8' })
      .replace(/^git version /, '')
      .split('.')
      .map(Number);
    return major > 2 || (major === 2 && minor >= 32);
  } catch {
    return false;
  }
}

describe('git credential input and output', () => {
  it('builds what git credential reads, ended by an empty line', () => {
    expect(buildGitCredentialInput({ url: 'https://gitlab.com/acme/crm.git', username: 'jane', password: 'fake-1' })).to.equal(
      'url=https://gitlab.com/acme/crm.git\nusername=jane\npassword=fake-1\n\n'
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
  it('prefers the protected store of the platform, and always ends with the file of git', async () => {
    expect(await listCandidateGitCredentialHelpers(probes({ platform: 'win32', hasManager: async () => true }))).to.deep.equal([
      'manager',
      'store',
    ]);
    expect(
      await listCandidateGitCredentialHelpers(probes({ platform: 'darwin', hasBundledHelper: async (name) => name === 'osxkeychain' }))
    ).to.deep.equal(['osxkeychain', 'store']);
    expect(
      await listCandidateGitCredentialHelpers(
        probes({ platform: 'linux', hasManager: async () => true, hasBundledHelper: async (name) => name === 'libsecret' })
      )
    ).to.deep.equal(['libsecret', 'manager', 'store']);
    expect(await listCandidateGitCredentialHelpers(probes({ platform: 'linux' }))).to.deep.equal(['store']);
  });

  it('uses Windows Credential Manager through wincred on a Git for Windows without Git Credential Manager', async () => {
    expect(
      await listCandidateGitCredentialHelpers(probes({ platform: 'win32', hasBundledHelper: async (name) => name === 'wincred' }))
    ).to.deep.equal(['wincred', 'store']);
  });

  it('does not offer the helper of another platform', async () => {
    expect(await listCandidateGitCredentialHelpers(probes({ platform: 'linux', hasBundledHelper: async () => true }))).to.deep.equal([
      'libsecret',
      'store',
    ]);
  });
});

describe('git credentials in the credential helper (real git)', function () {
  this.timeout(60000);
  const url = 'https://git.example.invalid/acme/crm.git';
  const credentials = { url, username: 'jane', password: 'fake-pass/with@odd:chars' };
  const isolated = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME'];
  const envBefore = { ...process.env };
  let workDir: string;
  let home: string;
  let repo: string;
  let helper: string;
  let storeFile: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const globalHelpers = () => {
    try {
      return git('config', '--global', '--get-all', 'credential.helper').split(/\r?\n/);
    } catch {
      return [];
    }
  };
  const localHelpers = () => {
    try {
      return git('config', '--local', '--get-all', 'credential.helper').split(/\r?\n/);
    } catch {
      return [];
    }
  };

  before(function () {
    if (!gitIsolatesItsGlobalConfig()) {
      this.skip();
    }
  });

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-git-cred-'));
    home = path.join(workDir, 'home');
    repo = path.join(workDir, 'repo');
    fs.mkdirSync(home);
    fs.mkdirSync(repo);
    storeFile = path.join(workDir, 'credentials').replace(/\\/g, '/');
    helper = `store --file "${storeFile}"`;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    process.env.GIT_CONFIG_GLOBAL = path.join(home, '.gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
    git('init', '-q');
  });

  afterEach(() => {
    for (const key of isolated) {
      if (envBefore[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBefore[key];
      }
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('keeps credentials in the configured helper, and reads them back', async () => {
    git('config', '--local', 'credential.helper', helper);
    const result = await storeGitCredentials(credentials, repo, { candidates: [] });
    expect(result.stored).to.be.true;
    expect(result.helper).to.equal(helper);
    expect(result.configuredScope).to.equal(null);
    expect(await readStoredGitCredentials(url, repo, 'jane')).to.deep.equal({ username: 'jane', password: credentials.password });
    // The repository configuration is never where the password goes
    expect(fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8')).to.not.include('fake-pass');
  });

  it('gives a protected helper to the whole machine when it has none, so the credentials are asked once', async () => {
    const result = await storeGitCredentials(credentials, repo, { forcedHelper: helper });
    expect(result.stored).to.be.true;
    expect(result.configuredScope).to.equal('global');
    expect(globalHelpers()).to.deep.equal([helper]);
    // Another repository of the machine finds them too
    const other = path.join(workDir, 'other');
    fs.mkdirSync(other);
    execFileSync('git', ['init', '-q'], { cwd: other });
    expect((await readStoredGitCredentials(url, other))?.password).to.equal(credentials.password);
  });

  it('goes on to the next helper when one keeps nothing, and leaves nothing of the first', async () => {
    const result = await storeGitCredentials(credentials, repo, { candidates: ['!true', helper] });
    expect(result.stored).to.be.true;
    expect(result.helper).to.equal(helper);
    expect(globalHelpers()).to.deep.equal([helper]);
    expect(localHelpers()).to.deep.equal([]);
  });

  it('keeps the clear text file of git inside the repository that needed it', async () => {
    const result = await storeGitCredentials(credentials, repo, { candidates: ['store'] });
    expect(result.stored).to.be.true;
    expect(result.configuredScope).to.equal('local');
    expect(globalHelpers()).to.deep.equal([]);
    expect(localHelpers()).to.deep.equal(['store']);
    // In the temporary home folder of the test, not in the real one
    expect(fs.readFileSync(path.join(home, '.git-credentials'), 'utf8')).to.include('git.example.invalid');
  });

  it('adds to the repository only, next to helpers the user already configured', async () => {
    git('config', '--global', 'credential.helper', '!true');
    const result = await storeGitCredentials(credentials, repo, { candidates: [helper] });
    expect(result.stored).to.be.true;
    expect(result.configuredScope).to.equal('local');
    expect(globalHelpers()).to.deep.equal(['!true']);
    expect(localHelpers()).to.deep.equal([helper]);
  });

  it('falls back to the repository when the global configuration cannot be written', async () => {
    // A global configuration under a path that is a file: git reads it as missing, and cannot write it
    fs.writeFileSync(path.join(home, 'blocker'), '');
    process.env.GIT_CONFIG_GLOBAL = path.join(home, 'blocker', 'gitconfig');
    const result = await storeGitCredentials(credentials, repo, { candidates: [helper] });
    expect(result.stored).to.be.true;
    expect(result.configuredScope).to.equal('local');
  });

  it('leaves nothing behind when no helper keeps the credentials', async () => {
    const result = await storeGitCredentials(credentials, repo, { candidates: ['!true'] });
    expect(result.stored).to.be.false;
    expect(result.error).to.equal('noHelperKept');
    expect(globalHelpers()).to.deep.equal([]);
    expect(localHelpers()).to.deep.equal([]);
    expect(fs.existsSync(path.join(home, '.git-credentials'))).to.be.false;
  });

  it('sees a helper scoped to the URL, and writes no other', async () => {
    git('config', '--global', 'credential.https://git.example.invalid.helper', helper);
    expect(await listGitCredentialHelpers(url, repo)).to.deep.equal([helper]);
    const result = await storeGitCredentials(credentials, repo, { candidates: ['store'] });
    expect(result.stored).to.be.true;
    expect(result.configuredScope).to.equal(null);
    expect(globalHelpers()).to.deep.equal([]);
    expect(localHelpers()).to.deep.equal([]);
  });

  it('undo puts back the credentials that were stored before', async () => {
    git('config', '--local', 'credential.helper', helper);
    await storeGitCredentials({ ...credentials, password: 'previous-valid' }, repo, { candidates: [] });
    const result = await storeGitCredentials({ ...credentials, password: 'typed-and-refused' }, repo, { candidates: [] });
    expect((await readStoredGitCredentials(url, repo, 'jane'))?.password).to.equal('typed-and-refused');
    await result.undo();
    expect((await readStoredGitCredentials(url, repo, 'jane'))?.password).to.equal('previous-valid');
  });

  it('undo removes the credentials and the helper it configured when nothing was there before', async () => {
    const result = await storeGitCredentials(credentials, repo, { forcedHelper: helper });
    expect(globalHelpers()).to.deep.equal([helper]);
    await result.undo();
    expect(globalHelpers()).to.deep.equal([]);
    expect(fs.existsSync(storeFile) ? fs.readFileSync(storeFile, 'utf8').trim() : '').to.equal('');
  });

  it('names the user in the repository when the helper answers with another account, and undoes it', async () => {
    // A helper holding alice's account, which it gives when git names no user: what Git
    // Credential Manager or the Keychain do with several accounts for one host
    git(
      'config',
      '--local',
      'credential.helper',
      '!f() { test "$1" = get || exit 0; if grep -q "^username=jane"; then exit 0; fi; echo username=alice; echo password=alice-pass; }; f'
    );
    git('config', '--local', '--add', 'credential.helper', helper);
    expect((await readStoredGitCredentials(url, repo))?.username).to.equal('alice');
    const result = await storeGitCredentials(credentials, repo, { candidates: [] });
    expect(result.stored).to.be.true;
    // Without it git would send alice, the first account the helper holds
    expect(git('config', '--local', '--get', 'credential.https://git.example.invalid.username')).to.equal('jane');
    expect((await readStoredGitCredentials(url, repo))?.username).to.equal('jane');
    await result.undo();
    expect((await readStoredGitCredentials(url, repo))?.username).to.equal('alice');
  });

  it('forgets credentials', async () => {
    git('config', '--local', 'credential.helper', helper);
    await storeGitCredentials(credentials, repo, { candidates: [] });
    await forgetGitCredentials(credentials, repo);
    expect(await readStoredGitCredentials(url, repo, 'jane')).to.equal(null);
  });

  it('reads nothing, and asks nothing, when no credentials are stored', async () => {
    git('config', '--local', 'credential.helper', helper);
    expect(await readStoredGitCredentials(url, repo)).to.equal(null);
  });

  it('ignores the helpers an empty entry resets', async () => {
    git('config', '--local', 'credential.helper', 'cache');
    git('config', '--local', '--add', 'credential.helper', '');
    git('config', '--local', '--add', 'credential.helper', helper);
    expect(await listGitCredentialHelpers(url, repo)).to.deep.equal([helper]);
  });

  it('refuses a line break, which would forge another field', async () => {
    git('config', '--local', 'credential.helper', helper);
    const result = await storeGitCredentials({ ...credentials, password: 'x\nhost=evil.example' }, repo, { candidates: [] });
    expect(result.stored).to.be.false;
    expect(result.error).to.equal('lineBreak');
  });
});
