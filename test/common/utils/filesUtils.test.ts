import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { countLinesInFile } from '../../../src/common/utils/filesUtils.js';

describe('filesUtils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-filesutils-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('countLinesInFile()', () => {
    it('counts lines in a multi-line file', async () => {
      const file = path.join(tmpDir, 'multiline.txt');
      await fs.writeFile(file, 'line1\nline2\nline3\n');
      const count = await countLinesInFile(file);
      expect(count).to.equal(3);
    });

    it('counts a single line without trailing newline', async () => {
      const file = path.join(tmpDir, 'single.txt');
      await fs.writeFile(file, 'only one line');
      const count = await countLinesInFile(file);
      expect(count).to.equal(1);
    });

    it('returns 0 for an empty file', async () => {
      const file = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(file, '');
      const count = await countLinesInFile(file);
      expect(count).to.equal(0);
    });

    it('handles CRLF line endings', async () => {
      const file = path.join(tmpDir, 'crlf.txt');
      await fs.writeFile(file, 'line1\r\nline2\r\nline3\r\n');
      const count = await countLinesInFile(file);
      expect(count).to.equal(3);
    });

    it('counts a large file correctly', async () => {
      const file = path.join(tmpDir, 'large.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
      await fs.writeFile(file, lines);
      const count = await countLinesInFile(file);
      expect(count).to.equal(100);
    });
  });
});
