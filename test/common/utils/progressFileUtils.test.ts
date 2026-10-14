import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { reportCommandProgress } from '../../../src/common/utils/progressFileUtils.js';

describe('reportCommandProgress()', () => {
  let dir: string;
  const previous = process.env.SFDX_HARDIS_PROGRESS_FILE;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-progress-'));
  });

  afterEach(async () => {
    if (previous === undefined) {
      delete process.env.SFDX_HARDIS_PROGRESS_FILE;
    } else {
      process.env.SFDX_HARDIS_PROGRESS_FILE = previous;
    }
    await fs.remove(dir).catch(() => null);
  });

  it('appends one JSON line per step to the file the panel gave', async () => {
    const progressFile = path.join(dir, 'progress.jsonl');
    process.env.SFDX_HARDIS_PROGRESS_FILE = progressFile;
    reportCommandProgress({ step: 'listing', message: 'Listing the Pull Requests merged in integration' });
    reportCommandProgress({ step: 'delta', message: 'Computing what Pull Request #12 deploys (2 of 5)', current: 2, total: 5 });
    const lines = (await fs.readFile(progressFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.step)).to.deep.equal(['listing', 'delta']);
    expect(lines[0]).to.not.have.property('current');
    expect(lines[1]).to.include({ message: 'Computing what Pull Request #12 deploys (2 of 5)', current: 2, total: 5 });
    expect(Date.parse(lines[1].time)).to.be.a('number').and.not.NaN;
  });

  it('writes nothing without the variable, and never fails on a file it cannot write', async () => {
    delete process.env.SFDX_HARDIS_PROGRESS_FILE;
    reportCommandProgress({ step: 'listing', message: 'Listing' });
    expect(await fs.readdir(dir)).to.deep.equal([]);
    process.env.SFDX_HARDIS_PROGRESS_FILE = path.join(dir, 'missing-folder', 'progress.jsonl');
    expect(() => reportCommandProgress({ step: 'listing', message: 'Listing' })).to.not.throw();
  });
});
