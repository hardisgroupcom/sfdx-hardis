import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs, { copy, emptyDir, ensureDir, move, pathExists, readJson, readJsonSync, remove, writeJson, writeJsonSync } from '../../../src/common/utils/fsUtils.js';
import { removeTempDir } from '../../../src/common/utils/index.js';

describe('fsUtils (fs-extra replacement)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-fs-'));
  });

  afterEach(async () => {
    await remove(tmpDir);
  });

  it('exposes node:fs sync functions and promise-based async functions', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'hello');
    expect(fs.existsSync(file)).to.equal(true);
    expect(await fs.readFile(file, 'utf8')).to.equal('hello');
    expect(fs.readFileSync(file, 'utf8')).to.equal('hello');
    expect((await fs.stat(file)).isFile()).to.equal(true);
    expect(await fs.readdir(tmpDir)).to.deep.equal(['a.txt']);
    expect(typeof fs.createReadStream).to.equal('function');
    expect(typeof fs.promises.readFile).to.equal('function');
    expect(await fs.exists(file)).to.equal(true);
    expect(await fs.exists(path.join(tmpDir, 'missing'))).to.equal(false);
  });

  it('ensureDir creates nested directories and tolerates existing ones', async () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    await ensureDir(nested);
    await ensureDir(nested);
    expect(fs.statSync(nested).isDirectory()).to.equal(true);
    fs.ensureDirSync(path.join(tmpDir, 'x', 'y'));
    expect(fs.existsSync(path.join(tmpDir, 'x', 'y'))).to.equal(true);
  });

  it('removeTempDir never throws when the folder can not be deleted', async () => {
    // A path holding a NUL character makes the underlying removal reject, the same way a temp
    // folder still locked by a child command does on Windows: it must never break the caller
    await removeTempDir('\u0000-cannot-be-removed');
    // A regular temp folder is still deleted
    const dir = path.join(tmpDir, 'to-delete');
    await ensureDir(dir);
    await removeTempDir(dir);
    expect(await pathExists(dir)).to.equal(false);
  });

  it('remove deletes files and directories and ignores missing paths', async () => {
    const dir = path.join(tmpDir, 'dir');
    await ensureDir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'f.txt'), 'x');
    await remove(dir);
    expect(fs.existsSync(dir)).to.equal(false);
    await remove(path.join(tmpDir, 'does-not-exist'));
    fs.removeSync(path.join(tmpDir, 'does-not-exist'));
  });

  it('emptyDir empties an existing directory or creates it', async () => {
    const dir = path.join(tmpDir, 'dir');
    await ensureDir(dir);
    await fs.writeFile(path.join(dir, 'f.txt'), 'x');
    await emptyDir(dir);
    expect(await fs.readdir(dir)).to.deep.equal([]);
    await emptyDir(path.join(tmpDir, 'new'));
    expect(fs.existsSync(path.join(tmpDir, 'new'))).to.equal(true);
  });

  it('pathExists works for files and directories', async () => {
    expect(await pathExists(tmpDir)).to.equal(true);
    expect(await pathExists(path.join(tmpDir, 'nope'))).to.equal(false);
    expect(await fs.pathExists(tmpDir)).to.equal(true);
  });

  it('copy copies files and directory trees, honoring overwrite and filter', async () => {
    const src = path.join(tmpDir, 'src');
    await ensureDir(path.join(src, 'sub'));
    await fs.writeFile(path.join(src, 'a.txt'), 'A');
    await fs.writeFile(path.join(src, 'sub', 'b.txt'), 'B');
    await fs.writeFile(path.join(src, 'sub', 'skip.log'), 'L');
    const dest = path.join(tmpDir, 'dest');
    await copy(src, dest, { filter: (file) => !file.endsWith('.log') });
    expect(await fs.readFile(path.join(dest, 'a.txt'), 'utf8')).to.equal('A');
    expect(await fs.readFile(path.join(dest, 'sub', 'b.txt'), 'utf8')).to.equal('B');
    expect(fs.existsSync(path.join(dest, 'sub', 'skip.log'))).to.equal(false);
    // single file copy with overwrite (default)
    await fs.writeFile(path.join(src, 'a.txt'), 'A2');
    await copy(path.join(src, 'a.txt'), path.join(dest, 'a.txt'), { overwrite: true });
    expect(await fs.readFile(path.join(dest, 'a.txt'), 'utf8')).to.equal('A2');
    // overwrite false keeps the destination silently
    await fs.writeFile(path.join(src, 'a.txt'), 'A3');
    await copy(path.join(src, 'a.txt'), path.join(dest, 'a.txt'), { overwrite: false });
    expect(await fs.readFile(path.join(dest, 'a.txt'), 'utf8')).to.equal('A2');
    // sync variant
    fs.copySync(path.join(src, 'a.txt'), path.join(tmpDir, 'sync.txt'));
    expect(fs.readFileSync(path.join(tmpDir, 'sync.txt'), 'utf8')).to.equal('A3');
  });

  it('move renames, refuses to overwrite by default and overwrites on request', async () => {
    const src = path.join(tmpDir, 'm.txt');
    const dest = path.join(tmpDir, 'moved', 'm.txt');
    await fs.writeFile(src, 'M');
    await move(src, dest);
    expect(fs.existsSync(src)).to.equal(false);
    expect(await fs.readFile(dest, 'utf8')).to.equal('M');
    await fs.writeFile(src, 'M2');
    let error: Error | null = null;
    try {
      await move(src, dest);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.equal('dest already exists.');
    await move(src, dest, { overwrite: true });
    expect(await fs.readFile(dest, 'utf8')).to.equal('M2');
  });

  it('reads and writes JSON like fs-extra (spaces, final newline, BOM)', async () => {
    const file = path.join(tmpDir, 'data.json');
    await writeJson(file, { a: 1, b: [1, 2] }, { spaces: 2 });
    expect(await fs.readFile(file, 'utf8')).to.equal('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
    expect(await readJson(file)).to.deep.equal({ a: 1, b: [1, 2] });
    expect(readJsonSync(file)).to.deep.equal({ a: 1, b: [1, 2] });
    writeJsonSync(file, { c: true });
    expect(fs.readFileSync(file, 'utf8')).to.equal('{"c":true}\n');
    await fs.writeFile(file, '﻿{"bom":1}');
    expect(await fs.readJson(file)).to.deep.equal({ bom: 1 });
    expect(await fs.readJSON(file)).to.deep.equal({ bom: 1 });
    await fs.writeJSON(file, { d: 1 }, { spaces: 2, EOL: '\r\n' });
    expect(await fs.readFile(file, 'utf8')).to.equal('{\r\n  "d": 1\r\n}\r\n');
  });

  it('readJson reports the file name on invalid JSON, or returns null with throws false', async () => {
    const file = path.join(tmpDir, 'bad.json');
    await fs.writeFile(file, '{ not json');
    let error: Error | null = null;
    try {
      await readJson(file);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.contain('bad.json');
    expect(await readJson(file, { throws: false })).to.equal(null);
    expect(readJsonSync(file, { throws: false })).to.equal(null);
  });

  it('outputFile creates parent directories', async () => {
    const file = path.join(tmpDir, 'deep', 'er', 'out.txt');
    await fs.outputFile(file, 'content');
    expect(await fs.readFile(file, 'utf8')).to.equal('content');
  });
});
