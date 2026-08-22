import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import { which, whichSync } from '../../../src/common/utils/whichUtils.js';

describe('whichUtils', () => {
  let tmpDir: string;
  let binDir: string;
  let otherDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-which-'));
    binDir = path.join(tmpDir, 'bin');
    otherDir = path.join(tmpDir, 'other');
    await fs.ensureDir(binDir);
    await fs.ensureDir(otherDir);
    await fs.writeFile(path.join(binDir, 'mytool.cmd'), '@echo off');
    await fs.writeFile(path.join(binDir, 'plain'), '#!/bin/sh\n', { mode: 0o755 });
    await fs.writeFile(path.join(otherDir, 'notexec'), 'data', { mode: 0o644 });
    // A directory with the command name must not be returned
    await fs.ensureDir(path.join(otherDir, 'mytool.cmd'));
  });

  after(async () => {
    await fs.remove(tmpDir);
  });

  it('finds a command through PATHEXT on Windows', () => {
    const found = whichSync('mytool', { path: [otherDir, binDir].join(path.delimiter), pathExt: '.EXE;.CMD', windows: true });
    // The PATHEXT extension is appended as written (.CMD): compare case-insensitively
    expect((found || '').toLowerCase()).to.equal(path.join(binDir, 'mytool.cmd').toLowerCase());
  });

  it('finds a command given with its extension on Windows', () => {
    const found = whichSync('mytool.cmd', { path: binDir, pathExt: '.EXE;.CMD', windows: true });
    expect(found).to.equal(path.join(binDir, 'mytool.cmd'));
  });

  it('finds a plain executable on POSIX', function () {
    if (process.platform === 'win32') {
      // File modes are not enforced on Windows, the POSIX branch is covered on Linux CI
      this.skip();
    }
    const found = whichSync('plain', { path: binDir, windows: false });
    expect(found).to.equal(path.join(binDir, 'plain'));
    expect(whichSync('notexec', { path: otherDir, windows: false, nothrow: true })).to.equal(null);
  });

  it('returns null with nothrow when the command is missing', async () => {
    expect(whichSync('does-not-exist-xyz', { path: binDir, nothrow: true })).to.equal(null);
    expect(await which('does-not-exist-xyz', { path: binDir, nothrow: true })).to.equal(null);
  });

  it('throws without nothrow when the command is missing', async () => {
    expect(() => whichSync('does-not-exist-xyz', { path: binDir })).to.throw('not found: does-not-exist-xyz');
    let error: Error | null = null;
    try {
      await which('does-not-exist-xyz', { path: binDir });
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.equal('not found: does-not-exist-xyz');
  });

  it('finds real executables of the current machine', async () => {
    const command = process.platform === 'win32' ? 'cmd' : 'sh';
    const found = await which(command, { nothrow: true });
    expect(found).to.be.a('string');
    expect(fs.existsSync(found as string)).to.equal(true);
  });
});
