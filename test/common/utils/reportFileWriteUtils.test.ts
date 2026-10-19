import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs, { remove } from '../../../src/common/utils/fsUtils.js';
import { reportFileRequestedPath, writeReportFile } from '../../../src/common/utils/reportFileWriteUtils.js';

// Error shaped like the one Windows returns when Excel holds the file open
function errorWithCode(code: string): Error {
  const error: any = new Error(`${code}: resource busy or locked`);
  error.code = code;
  return error;
}

// The fallback is on by default only on Windows outside CI: the tests force it, to run anywhere
const FALLBACK_ON = { fallback: true };

describe('writeReportFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-report-'));
  });

  afterEach(async () => {
    await remove(tmpDir);
  });

  // Writer that fails with a lock error on the given file names, and writes the others for real
  function writerLocking(lockedNames: string[], code = 'EBUSY') {
    const attempts: string[] = [];
    const write = async (filePath: string) => {
      attempts.push(path.basename(filePath));
      if (lockedNames.includes(path.basename(filePath))) {
        throw errorWithCode(code);
      }
      await fs.writeFile(filePath, 'new content');
    };
    return { write, attempts };
  }

  async function existingFile(name: string): Promise<string> {
    const filePath = path.join(tmpDir, name);
    await fs.writeFile(filePath, 'old content');
    return filePath;
  }

  it('writes the usual file when nothing locks it', async () => {
    const target = await existingFile('report.xlsx');
    const { write, attempts } = writerLocking([]);
    expect(await writeReportFile(target, write, null, FALLBACK_ON)).to.equal(target);
    expect(attempts).to.deep.equal(['report.xlsx']);
    expect(await fs.readFile(target, 'utf8')).to.equal('new content');
  });

  it('writes report-2 when the usual file is open in another application', async () => {
    const target = await existingFile('report.xlsx');
    const { write } = writerLocking(['report.xlsx']);
    const written = await writeReportFile(target, write, null, FALLBACK_ON);
    expect(written).to.equal(path.join(tmpDir, 'report-2.xlsx'));
    expect(await fs.readFile(written, 'utf8')).to.equal('new content');
    expect(await fs.readFile(target, 'utf8')).to.equal('old content');
  });

  it('goes on to report-3 when report-2 is open too, building each name from the usual one', async () => {
    const target = await existingFile('report.csv');
    await existingFile('report-2.csv');
    const { write, attempts } = writerLocking(['report.csv', 'report-2.csv'], 'EPERM');
    expect(await writeReportFile(target, write, null, FALLBACK_ON)).to.equal(path.join(tmpDir, 'report-3.csv'));
    expect(attempts).to.deep.equal(['report.csv', 'report-2.csv', 'report-3.csv']);
  });

  it('does not retry a lock error on a file that does not exist', async () => {
    const target = path.join(tmpDir, 'missing.xlsx');
    const { write, attempts } = writerLocking(['missing.xlsx'], 'EACCES');
    await expectRejection(writeReportFile(target, write, null, FALLBACK_ON), 'EACCES');
    expect(attempts).to.deep.equal(['missing.xlsx']);
  });

  it('does not retry an error that is not a lock', async () => {
    const target = await existingFile('report.xlsx');
    const write = async () => {
      throw errorWithCode('ENOSPC');
    };
    await expectRejection(writeReportFile(target, write, null, FALLBACK_ON), 'ENOSPC');
    expect(fs.existsSync(path.join(tmpDir, 'report-2.xlsx'))).to.equal(false);
  });

  it('gives up after report-10 when every name is locked', async () => {
    const target = await existingFile('report.xlsx');
    const lockedNames = ['report.xlsx'];
    for (let index = 2; index <= 10; index++) {
      lockedNames.push(`report-${index}.xlsx`);
      await existingFile(`report-${index}.xlsx`);
    }
    const { write, attempts } = writerLocking(lockedNames);
    await expectRejection(writeReportFile(target, write, null, FALLBACK_ON), 'EBUSY');
    expect(attempts.length).to.equal(10);
    expect(attempts[attempts.length - 1]).to.equal('report-10.xlsx');
  });

  it('never falls back when the fallback is off (outside Windows, or in CI)', async () => {
    const target = await existingFile('report.xlsx');
    const { write, attempts } = writerLocking(['report.xlsx'], 'EACCES');
    await expectRejection(writeReportFile(target, write, null, { fallback: false }), 'EACCES');
    expect(attempts).to.deep.equal(['report.xlsx']);
  });

  it('skips the names that already exist when only a new file may be written', async () => {
    const target = await existingFile('notebook.xlsx');
    await existingFile('notebook-2.xlsx');
    const { write, attempts } = writerLocking(['notebook.xlsx']);
    const written = await writeReportFile(target, write, null, { fallback: true, newFileOnly: true });
    expect(written).to.equal(path.join(tmpDir, 'notebook-3.xlsx'));
    expect(attempts).to.deep.equal(['notebook.xlsx', 'notebook-3.xlsx']);
    expect(await fs.readFile(path.join(tmpDir, 'notebook-2.xlsx'), 'utf8')).to.equal('old content');
  });

  it('remembers the usual name of a file written under another one', async () => {
    const target = await existingFile('Users.csv');
    const { write } = writerLocking(['Users.csv']);
    const written = await writeReportFile(target, write, null, FALLBACK_ON);
    expect(reportFileRequestedPath(written)).to.equal(target);
    expect(reportFileRequestedPath(target)).to.equal(target);
    // Written again under its own name later: it is no longer a fallback
    await writeReportFile(written, writerLocking([]).write, null, FALLBACK_ON);
    expect(reportFileRequestedPath(written)).to.equal(written);
  });

  it('puts the suffix before the extension of the file only', async () => {
    const dottedDir = path.join(tmpDir, 'my.reports');
    await fs.mkdir(dottedDir);
    const target = path.join(dottedDir, 'report.v1.xlsx');
    await fs.writeFile(target, 'old content');
    const noExtension = path.join(dottedDir, 'notebook');
    await fs.writeFile(noExtension, 'old content');
    const { write } = writerLocking(['report.v1.xlsx', 'notebook']);
    expect(await writeReportFile(target, write, null, FALLBACK_ON)).to.equal(path.join(dottedDir, 'report.v1-2.xlsx'));
    expect(await writeReportFile(noExtension, write, null, FALLBACK_ON)).to.equal(path.join(dottedDir, 'notebook-2'));
  });
});

async function expectRejection(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e: any) {
    expect(e.code).to.equal(code);
    return;
  }
  expect.fail(`Expected a ${code} error`);
}
