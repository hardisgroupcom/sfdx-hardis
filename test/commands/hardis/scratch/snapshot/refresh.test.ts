import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import ScratchSnapshotRefresh from '../../../../../src/commands/hardis/scratch/snapshot/refresh.js';
import { clearListMajorOrgsCache } from '../../../../../src/common/utils/orgConfigUtils.js';
import { t } from '../../../../../src/common/utils/i18n.js';

// Counts the requests for the Dev Hub instead of reaching it, whatever default Dev Hub the runner has
class RefreshProbe extends ScratchSnapshotRefresh {
  public static logins = 0;
  protected async getDevHub(): Promise<any> {
    RefreshProbe.logins++;
    throw new Error('Dev Hub login reached');
  }
}

describe('hardis:scratch:snapshot:refresh Dev Hub login', () => {
  const originalCwd = process.cwd();
  let projectDir = '';

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-refresh-'));
    fs.mkdirSync(path.join(projectDir, 'config', 'branches'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
    fs.writeFileSync(path.join(projectDir, 'config', '.sfdx-hardis.yml'), 'projectName: acme\n');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: projectDir });
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    process.chdir(projectDir);
    clearListMajorOrgsCache();
    RefreshProbe.logins = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    clearListMajorOrgsCache();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('does not log in to the Dev Hub when the branch does not use snapshots', async () => {
    const result: any = await RefreshProbe.run([]);
    expect(result.outputString).to.equal('Snapshots are not enabled for branch main');
    expect(RefreshProbe.logins).to.equal(0);
  });

  it('logs in to the Dev Hub once the branch is known to use snapshots', async () => {
    fs.writeFileSync(path.join(projectDir, 'config', 'branches', '.sfdx-hardis.main.yml'), 'useScratchOrgSnapshot: true\n');
    let error: Error | null = null;
    try {
      await RefreshProbe.run([]);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.equal('Dev Hub login reached');
    expect(RefreshProbe.logins).to.equal(1);
  });
});

// A command whose auth hook connects the given username, or nothing
const refreshWithAuthHook = (username: string | null): any =>
  new (ScratchSnapshotRefresh as any)([], {
    runHook: async () => {
      (globalThis as any).justConnectedOrg = username ? { username } : null;
      return { successes: [], failures: [] };
    },
  });

describe('hardis:scratch:snapshot:refresh loginDevHub', () => {
  const originalConnectedOrg = (globalThis as any).justConnectedOrg;

  afterEach(() => {
    (globalThis as any).justConnectedOrg = originalConnectedOrg;
  });

  it('opens the Dev Hub the auth hook connected', async () => {
    let error: Error | null = null;
    try {
      await refreshWithAuthHook('hub-from-hook@example.com').loginDevHub();
    } catch (e) {
      error = e as Error;
    }
    // No such login on the runner: reaching Org.create with that username is what is checked
    expect(error?.name).to.equal('NamedOrgNotFoundError');
    expect(error?.message).to.contain('hub-from-hook@example.com');
  });

  it('fails when the auth hook connects no Dev Hub', async () => {
    let error: Error | null = null;
    try {
      await refreshWithAuthHook(null).loginDevHub();
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.equal(t('pleaseSelectOrLoginIntoDevHub'));
  });
});

// Counts the logins and returns a marker instead of a Dev Hub
class DevHubChoiceProbe extends ScratchSnapshotRefresh {
  public logins = 0;
  public choose(flags: any, ci: boolean): Promise<any> {
    return this.getDevHub(flags, ci);
  }
  protected async loginDevHub(): Promise<any> {
    this.logins++;
    return 'hub from the job credentials';
  }
}

describe('hardis:scratch:snapshot:refresh Dev Hub choice', () => {
  it('in CI, logs in from the job credentials even when a default Dev Hub is saved on the machine', async () => {
    const probe = new (DevHubChoiceProbe as any)([], {});
    expect(await probe.choose({ 'target-dev-hub': 'saved default hub' }, true)).to.equal('hub from the job credentials');
    expect(probe.logins).to.equal(1);
  });

  it('in CI, uses a Dev Hub passed on the command line', async () => {
    for (const argv of [['--target-dev-hub', 'MyHub'], ['-v', 'MyHub'], ['--target-dev-hub=MyHub']]) {
      const probe = new (DevHubChoiceProbe as any)(argv, {});
      expect(await probe.choose({ 'target-dev-hub': 'MyHub' }, true)).to.equal('MyHub');
      expect(probe.logins).to.equal(0);
    }
  });

  it('outside CI, uses the default Dev Hub of the workstation', async () => {
    const probe = new (DevHubChoiceProbe as any)([], {});
    expect(await probe.choose({ 'target-dev-hub': 'saved default hub' }, false)).to.equal('saved default hub');
    expect(probe.logins).to.equal(0);
  });
});

// A Dev Hub answering the snapshot queries, and a snapshot signup that returns the given result
class OutputProbe extends ScratchSnapshotRefresh {
  // Status of the snapshot record at each successive lookup; the last one repeats
  public static statuses: string[] = [];
  public static created = true;
  public static pruneFails = false;
  protected async getDevHub(): Promise<any> {
    let lookups = 0;
    const conn = {
      instanceUrl: 'https://hub.example.com',
      limits: async () => ({}),
      query: async (soql: string) => {
        if (soql.includes('SnapshotName =')) {
          const status = OutputProbe.statuses[Math.min(lookups++, OutputProbe.statuses.length - 1)];
          return { done: true, records: status ? [{ Status: status }] : [] };
        }
        if (OutputProbe.pruneFails) {
          throw new Error('Dev Hub session expired');
        }
        return { done: true, records: [] };
      },
    };
    return { getConnection: () => conn, getUsername: () => 'hub@example.com' };
  }
  protected async createSnapshot(): Promise<boolean> {
    return OutputProbe.created;
  }
}

describe('hardis:scratch:snapshot:refresh GitHub Actions output', () => {
  const originalCwd = process.cwd();
  const originalOutput = process.env.GITHUB_OUTPUT;
  let projectDir = '';
  let outputFile = '';

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-output-'));
    fs.mkdirSync(path.join(projectDir, 'config', 'branches'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
    fs.writeFileSync(path.join(projectDir, 'config', '.sfdx-hardis.yml'), 'projectName: acme\n');
    fs.writeFileSync(path.join(projectDir, 'config', 'branches', '.sfdx-hardis.main.yml'), 'useScratchOrgSnapshot: true\n');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: projectDir });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    outputFile = path.join(projectDir, 'github-output');
    fs.writeFileSync(outputFile, '');
    process.env.GITHUB_OUTPUT = outputFile;
    process.chdir(projectDir);
    clearListMajorOrgsCache();
    OutputProbe.statuses = [];
    OutputProbe.created = true;
    OutputProbe.pruneFails = false;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalOutput === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = originalOutput;
    }
    clearListMajorOrgsCache();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('reports a snapshot taken by this run, so the workflow starts the pool refresh', async () => {
    const result: any = await OutputProbe.run([]);
    expect(fs.readFileSync(outputFile, 'utf8')).to.equal(`snapshot=${result.snapshotName}\n`);
  });

  it('reports nothing when the snapshot of this commit was already Active', async () => {
    OutputProbe.statuses = ['Active'];
    await OutputProbe.run([]);
    expect(fs.readFileSync(outputFile, 'utf8')).to.equal('');
  });

  it('reports a snapshot of this commit it waited for, as the run that started it may have died before reporting', async () => {
    OutputProbe.statuses = ['InProgress', 'Active'];
    const result: any = await OutputProbe.run([]);
    expect(fs.readFileSync(outputFile, 'utf8')).to.equal(`snapshot=${result.snapshotName}\n`);
  });

  it('reports a new snapshot before pruning the older ones, so a failed prune still starts the pool refresh', async () => {
    OutputProbe.pruneFails = true;
    let error: Error | null = null;
    try {
      await OutputProbe.run([]);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.contain('Dev Hub session expired');
    expect(fs.readFileSync(outputFile, 'utf8')).to.match(/^snapshot=SH/);
  });

  it('reports nothing when the Dev Hub refused the snapshot', async () => {
    OutputProbe.created = false;
    const result: any = await OutputProbe.run([]);
    expect(result.outputString).to.contain('not taken: limit reached');
    expect(fs.readFileSync(outputFile, 'utf8')).to.equal('');
  });
});
