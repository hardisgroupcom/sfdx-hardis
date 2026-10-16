import { expect } from 'chai';
import { pickScratchSnapshot } from '../../../src/common/utils/scratchSnapshotUtils.js';

const shaNew = 'a'.repeat(40);
const shaOld = 'b'.repeat(40);
const record = (name: string, description: string) => ({ SnapshotName: name, Description: description });

describe('pickScratchSnapshot', () => {
  const records = [
    record('SHaaaaaaaaaaaaa', `sfdx-hardis branch=main sha=${shaNew}`),
    record('SHbbbbbbbbbbbbb', `sfdx-hardis branch=main sha=${shaOld}`),
  ];

  it('takes the newest snapshot whose commit is in the history of HEAD', () => {
    expect(pickScratchSnapshot(records, 'main', () => true)).to.deep.equal({ name: 'SHaaaaaaaaaaaaa', sha: shaNew });
  });

  it('takes an older snapshot when the newest commit is not in the history, as for a branch behind its target', () => {
    expect(pickScratchSnapshot(records, 'main', (sha) => sha === shaOld)).to.deep.equal({ name: 'SHbbbbbbbbbbbbb', sha: shaOld });
  });

  it('returns null when no snapshot commit is in the history', () => {
    expect(pickScratchSnapshot(records, 'main', () => false)).to.equal(null);
  });

  it('ignores the snapshots of a branch whose name only starts the same, which the LIKE query also returns', () => {
    const other = [record('SHccccccccccccc', `sfdx-hardis branch=main_v2 sha=${shaNew}`)];
    expect(pickScratchSnapshot(other, 'main', () => true)).to.equal(null);
  });

  it('ignores a description without a full commit sha', () => {
    const broken = [record('SHddddddddddddd', 'sfdx-hardis branch=main sha=abc123')];
    expect(pickScratchSnapshot(broken, 'main', () => true)).to.equal(null);
  });
});
