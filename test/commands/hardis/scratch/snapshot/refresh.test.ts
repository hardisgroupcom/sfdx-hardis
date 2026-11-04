import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import ScratchSnapshotRefresh from '../../../../../src/commands/hardis/scratch/snapshot/refresh.js';
import { clearListMajorOrgsCache } from '../../../../../src/common/utils/orgConfigUtils.js';

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
