import { expect } from 'chai';
import ScratchCreate from '../../../../src/commands/hardis/scratch/create.js';
import { SCRATCH_SNAPSHOT_DISABLED_ENV } from '../../../../src/common/utils/scratchSnapshotUtils.js';
import { getCurrentGitBranch } from '../../../../src/common/utils/index.js';

// Records which source the command asks for, without a Dev Hub
class CreateProbe extends ScratchCreate {
  public calls: string[] = [];
  public poolOrg: any = null;
  public async take() {
    await this.takeOrgSource({});
  }
  public async branchFor(branch: string | undefined, ci: boolean) {
    return this.snapshotBranch(branch, ci);
  }
  protected async fetchFromPool(): Promise<any> {
    this.calls.push('pool');
    return this.poolOrg;
  }
  public branches: Array<string | undefined> = [];
  protected async resolveSnapshot(_flags: any, branch?: string): Promise<any> {
    this.calls.push('snapshot');
    this.branches.push(branch);
    return { name: 'SH0000000000001', sha: 'a'.repeat(40) };
  }
}

function probe(poolOrg: any, poolConfig: any = { maxScratchOrgsNumber: 2 }): CreateProbe {
  const command = Object.create(CreateProbe.prototype) as CreateProbe;
  Object.assign(command, { calls: [], branches: [], poolOrg, pool: false, configInfo: { poolConfig } });
  return command;
}

describe('hardis:scratch:create pool or snapshot', () => {
  afterEach(() => {
    delete process.env[SCRATCH_SNAPSHOT_DISABLED_ENV];
  });

  it('takes an org from the pool before looking up a snapshot', async () => {
    const command = probe({ scratchOrgAlias: 'PO-1' });
    await command.take();
    expect(command.calls).to.deep.equal(['pool']);
    expect((command as any).scratchOrgFromPool).to.deep.equal({ scratchOrgAlias: 'PO-1' });
    expect((command as any).snapshot).to.equal(undefined);
  });

  it('uses a snapshot when the pool has no org left', async () => {
    const command = probe(null);
    await command.take();
    expect(command.calls).to.deep.equal(['pool', 'snapshot']);
    expect((command as any).snapshot.name).to.equal('SH0000000000001');
  });

  it('looks up a snapshot when the project has no pool', async () => {
    const command = probe(null, null);
    await command.take();
    expect(command.calls).to.deep.equal(['snapshot']);
  });

  it('never takes the source org of a snapshot from the pool', async () => {
    process.env[SCRATCH_SNAPSHOT_DISABLED_ENV] = 'true';
    const command = probe({ scratchOrgAlias: 'PO-1' });
    await command.take();
    expect(command.calls).to.deep.equal(['snapshot']);
  });

  it('treats an unset pool flag as a run that takes from the pool, not as a pool fill', async () => {
    const command = probe({ scratchOrgAlias: 'PO-1' });
    (command as any).pool = undefined;
    await command.take();
    expect(command.calls).to.deep.equal(['pool']);
  });

  it('fills a pool org from the snapshot of its own branch, never from the pool', async () => {
    const command = probe({ scratchOrgAlias: 'PO-1' });
    (command as any).pool = true;
    await command.take();
    expect(command.calls).to.deep.equal(['snapshot']);
    expect(command.branches).to.deep.equal([(await getCurrentGitBranch()) || '']);
  });

  it('looks up the Pull Request target, not a branch of its own, outside a pool fill', async () => {
    const command = probe(null);
    await command.take();
    expect(command.branches).to.deep.equal([undefined]);
  });

  it('looks up, outside CI, the snapshot of the branch the User Story started from (hardis:work:new)', async () => {
    const current = await getCurrentGitBranch();
    const command = probe(null);
    (command as any).configInfo = { developmentBranch: 'integration', localStorageBranchTargets: current ? { [current]: 'release' } : {} };
    expect(await command.branchFor(undefined, false)).to.equal(current ? 'release' : 'integration');
  });

  // A Dev Hub that fails the lookup, so only SCRATCH_ORG_SNAPSHOT can give a snapshot
  it('ignores SCRATCH_ORG_SNAPSHOT on a pool fill, and uses it otherwise', async () => {
    const previous = process.env.SCRATCH_ORG_SNAPSHOT;
    process.env.SCRATCH_ORG_SNAPSHOT = 'BaseMain';
    try {
      const take = async (pool?: boolean) => {
        let lookups = 0;
        const logs: string[] = [];
        const flags = { 'target-dev-hub': { getConnection: () => { lookups++; throw new Error('no Dev Hub'); } } };
        const command = Object.create(ScratchCreate.prototype) as any;
        Object.assign(command, { pool, configInfo: {}, ux: { log: (text: string) => logs.push(text) } });
        await command.takeOrgSource(flags);
        const ignored = logs.some((line) => line.includes('SCRATCH_ORG_SNAPSHOT is ignored on a pool fill'));
        return { snapshot: command.snapshot, lookups, ignored };
      };
      expect(await take(false)).to.deep.equal({ snapshot: { name: 'BaseMain', sha: '' }, lookups: 0, ignored: false });
      // A pool fill says it ignores the variable, then still looks up the snapshot of its own branch
      expect(await take(true)).to.deep.equal({ snapshot: null, lookups: 1, ignored: true });
      // An unset flag is not a pool fill, as everywhere else in the command
      expect(await take(undefined)).to.deep.equal({ snapshot: { name: 'BaseMain', sha: '' }, lookups: 0, ignored: false });
    } finally {
      if (previous === undefined) {
        delete process.env.SCRATCH_ORG_SNAPSHOT;
      } else {
        process.env.SCRATCH_ORG_SNAPSHOT = previous;
      }
    }
  });

  it('leaves the Pull Request target to the lookup in CI, and keeps the branch of a pool fill', async () => {
    const command = probe(null);
    (command as any).configInfo = { developmentBranch: 'integration' };
    expect(await command.branchFor(undefined, true)).to.equal(undefined);
    expect(await command.branchFor('main', false)).to.equal('main');
  });
});
