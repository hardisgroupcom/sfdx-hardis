/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import * as path from 'path';
import { extractZipSafely, isLocalCopyCurrent, listExtractedFiles, toSafeFolderName } from '../../../src/common/utils/jobArtifactsUtils.js';

describe('Job artifacts', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-artifacts-test-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  function buildZip(entries: Record<string, string>): string {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(entries)) {
      zip.addFile(name, Buffer.from(content, 'utf8'));
    }
    const zipFile = path.join(workDir, 'artifact.zip');
    zip.writeZip(zipFile);
    return zipFile;
  }

  it('extracts the files of an archive with their folders', async () => {
    const zipFile = buildZip({ 'deploy-result.json': '{}', 'xls/deployment-components.xlsx': 'xlsx', 'coverage/coverage-summary.json': '{"total":{}}' });
    const target = path.join(workDir, 'out');
    extractZipSafely(zipFile, target);
    const files = await listExtractedFiles(target);
    expect(files.map((file) => file.path)).to.deep.equal(['coverage/coverage-summary.json', 'deploy-result.json', 'xls/deployment-components.xlsx']);
    expect(files.find((file) => file.path === 'deploy-result.json')?.sizeBytes).to.equal(2);
  });

  it('skips an entry that would be written outside the target folder', () => {
    const zipFile = buildZip({ 'report.txt': 'ok' });
    // adm-zip cleans the names it is given: the hostile name is set on the entry itself
    const zip = new AdmZip(zipFile);
    zip.addFile('placeholder.txt', Buffer.from('escaped', 'utf8'));
    zip.getEntries().find((entry) => entry.entryName === 'placeholder.txt')!.entryName = '../escaped.txt';
    zip.writeZip(zipFile);
    const target = path.join(workDir, 'out');
    const written = extractZipSafely(zipFile, target);
    expect(written.map((file) => path.basename(file))).to.deep.equal(['report.txt']);
    expect(fs.existsSync(path.join(workDir, 'escaped.txt'))).to.be.false;
  });

  it('lists nothing for a folder that does not exist, and leaves the manifest out', async () => {
    expect(await listExtractedFiles(path.join(workDir, 'missing'))).to.deep.equal([]);
    fs.writeFileSync(path.join(workDir, '.job-artifacts.json'), '{}');
    fs.writeFileSync(path.join(workDir, 'report.txt'), 'ok');
    expect((await listExtractedFiles(workDir)).map((file) => file.path)).to.deep.equal(['report.txt']);
  });

  it('knows a local copy from the artifacts its manifest recorded', async () => {
    const artifact = { id: '1', name: 'sfdx-hardis reports', sizeBytes: 10, expired: false, updatedAt: '2026-10-08T10:00:00Z' };
    expect(await isLocalCopyCurrent(workDir, [artifact])).to.be.false;
    fs.writeFileSync(path.join(workDir, '.job-artifacts.json'), JSON.stringify({ artifacts: [artifact] }));
    expect(await isLocalCopyCurrent(workDir, [artifact])).to.be.true;
    // The job ran again: same name, another artifact
    expect(await isLocalCopyCurrent(workDir, [{ ...artifact, id: '2', updatedAt: '2026-10-08T11:00:00Z' }])).to.be.false;
    expect(await isLocalCopyCurrent(workDir, [artifact, { ...artifact, id: '3', name: 'other' }])).to.be.false;
  });

  it('turns an artifact name into a folder name', () => {
    expect(toSafeFolderName('sfdx-hardis reports')).to.equal('sfdx-hardis-reports');
    expect(toSafeFolderName('../../etc')).to.equal('etc');
    expect(toSafeFolderName('')).to.equal('artifact');
  });
});
