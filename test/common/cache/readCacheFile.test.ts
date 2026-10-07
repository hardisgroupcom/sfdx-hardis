import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCacheFile } from '../../../src/common/cache/index.js';

describe('readCacheFile()', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-hardis-cache-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a valid cache file', async () => {
    const file = path.join(dir, '.sfdx-hardis-cache.json');
    fs.writeFileSync(file, JSON.stringify({ key: 'value' }));
    expect(await readCacheFile(file)).to.deep.equal({ key: 'value' });
  });

  it('returns {} when there is no cache file', async () => {
    expect(await readCacheFile(path.join(dir, 'missing.json'))).to.deep.equal({});
  });

  // A file cut short by a process killed while writing it used to stop every command
  for (const [label, content] of [
    ['cut short', '{"key": "val'],
    ['empty', ''],
    ['not an object', '[1, 2]'],
  ]) {
    it(`resets a cache file that is ${label} to {} instead of failing`, async () => {
      const file = path.join(dir, '.sfdx-hardis-cache.json');
      fs.writeFileSync(file, content);
      expect(await readCacheFile(file)).to.deep.equal({});
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({});
    });
  }
});
