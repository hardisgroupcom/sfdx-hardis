/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  BACKUP_TRUNCATED_ITEMS_FILE,
  countDroppedItems,
  describeDroppedTypes,
  isRetrieveFileLimitError,
  listTruncationAttempts,
  removeTruncatedItemsManifest,
  retrieveWithTruncation,
  splitManifestForTruncation,
  writeTruncatedItemsManifest,
} from '../../../src/common/monitoring/monitoringBackupTruncation.js';
import { parsePackageXmlFile, writePackageXmlFile } from '../../../src/common/utils/xmlUtils.js';

const commandThis = { ux: { log: () => { } } };

const FILE_LIMIT_ERROR = 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is: 10000';

const ORG_CONTENT = {
  ApexClass: ['MyClass'],
  CustomObject: ['Account'],
  ExperienceBundle: ['MySite1'],
  Report: ['MyFolder/MyReport', 'MyFolder/OtherReport'],
  StaticResource: ['jquery'],
  WaveDashboard: ['Sales'],
};

// A retrieve that the org refuses for too many files the given number of times, then accepts.
// Records what each call received.
function orgRefusing(refusals: number, calls: { types: string[]; lastAttempt: boolean }[], error = FILE_LIMIT_ERROR) {
  return async (manifestFile: string, lastAttempt: boolean) => {
    calls.push({ types: Object.keys(await parsePackageXmlFile(manifestFile)).sort(), lastAttempt });
    if (calls.length <= refusals) {
      throw new Error(error);
    }
  };
}

describe('monitoringBackupTruncation', () => {
  let projectDir: string;
  let previousCwd: string;
  let manifestFile: string;

  // The full mocha run resets the cwd between tests: change it in beforeEach
  beforeEach(async () => {
    previousCwd = process.cwd();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-truncation-'));
    fs.mkdirSync(path.join(projectDir, 'manifest'));
    process.chdir(projectDir);
    manifestFile = path.join(projectDir, 'manifest', 'package-backup-items.xml');
    await writePackageXmlFile(manifestFile, ORG_CONTENT);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  describe('isRetrieveFileLimitError', () => {
    it('recognizes the error of a retrieve with too many files', () => {
      expect(isRetrieveFileLimitError(new Error(FILE_LIMIT_ERROR))).to.be.true;
      expect(isRetrieveFileLimitError(FILE_LIMIT_ERROR)).to.be.true;
      // A retrieve result with a status code and no message
      expect(isRetrieveFileLimitError(new Error('LIMIT_EXCEEDED'))).to.be.true;
    });

    it('does not take another limit for it', () => {
      expect(isRetrieveFileLimitError(new Error('REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded.'))).to.be.false;
      expect(isRetrieveFileLimitError(new Error('INVALID_SESSION_ID'))).to.be.false;
      expect(isRetrieveFileLimitError(null)).to.be.false;
    });
  });

  describe('splitManifestForTruncation', () => {
    it('drops the low-value types and the Wave types first, and keeps the others', () => {
      const { kept, dropped } = splitManifestForTruncation(ORG_CONTENT, 0);
      expect(Object.keys(dropped).sort()).to.deep.equal(['Report', 'StaticResource', 'WaveDashboard']);
      expect(Object.keys(kept).sort()).to.deep.equal(['ApexClass', 'CustomObject', 'ExperienceBundle']);
    });

    it('also drops ExperienceBundle at the second step', () => {
      const { kept, dropped } = splitManifestForTruncation(ORG_CONTENT, 1);
      expect(Object.keys(dropped).sort()).to.deep.equal(['ExperienceBundle', 'Report', 'StaticResource', 'WaveDashboard']);
      expect(Object.keys(kept).sort()).to.deep.equal(['ApexClass', 'CustomObject']);
    });

    it('leaves out the types without members', () => {
      const { kept, dropped } = splitManifestForTruncation({ ApexClass: [], Report: [] }, 1);
      expect(kept).to.deep.equal({});
      expect(dropped).to.deep.equal({});
    });
  });

  describe('listTruncationAttempts', () => {
    it('skips a step that drops nothing new', () => {
      const attempts = listTruncationAttempts({ ApexClass: ['MyClass'], ExperienceBundle: ['MySite1'] });
      expect(attempts.map((attempt) => Object.keys(attempt.dropped))).to.deep.equal([[], ['ExperienceBundle']]);
    });

    it('has a single attempt when there is nothing to drop', () => {
      expect(listTruncationAttempts({ ApexClass: ['MyClass'] })).to.have.length(1);
    });
  });

  describe('retrieveWithTruncation', () => {
    it('retrieves once when the org accepts the retrieve', async () => {
      const calls: { types: string[]; lastAttempt: boolean }[] = [];
      const result = await retrieveWithTruncation({ manifestFile, retrieve: orgRefusing(0, calls), commandThis });
      expect(result.dropped).to.deep.equal({});
      expect(calls).to.have.length(1);
      expect(calls[0].lastAttempt).to.be.false;
    });

    it('retries without the low-value types after a refusal for too many files', async () => {
      const calls: { types: string[]; lastAttempt: boolean }[] = [];
      const result = await retrieveWithTruncation({ manifestFile, retrieve: orgRefusing(1, calls), commandThis });
      expect(Object.keys(result.dropped).sort()).to.deep.equal(['Report', 'StaticResource', 'WaveDashboard']);
      expect(calls[1]).to.deep.equal({ types: ['ApexClass', 'CustomObject', 'ExperienceBundle'], lastAttempt: false });
      // The manifest of the backup lists what was actually retrieved
      expect(Object.keys(await parsePackageXmlFile(manifestFile)).sort()).to.deep.equal(['ApexClass', 'CustomObject', 'ExperienceBundle']);
    });

    it('leaves out ExperienceBundle only after a second refusal', async () => {
      const calls: { types: string[]; lastAttempt: boolean }[] = [];
      const result = await retrieveWithTruncation({ manifestFile, retrieve: orgRefusing(2, calls), commandThis });
      expect(Object.keys(result.dropped).sort()).to.deep.equal(['ExperienceBundle', 'Report', 'StaticResource', 'WaveDashboard']);
      expect(calls).to.have.length(3);
      expect(calls[2]).to.deep.equal({ types: ['ApexClass', 'CustomObject'], lastAttempt: true });
    });

    it('fails with the error of the last retrieve when no type is left to drop', async () => {
      const calls: { types: string[]; lastAttempt: boolean }[] = [];
      let error: any = null;
      try {
        await retrieveWithTruncation({ manifestFile, retrieve: orgRefusing(3, calls), commandThis });
      } catch (e) {
        error = e;
      }
      expect(error?.message).to.equal(FILE_LIMIT_ERROR);
      expect(calls).to.have.length(3);
    });

    it('does not retry after another error', async () => {
      const calls: { types: string[]; lastAttempt: boolean }[] = [];
      let error: any = null;
      try {
        await retrieveWithTruncation({ manifestFile, retrieve: orgRefusing(1, calls, 'INVALID_SESSION_ID'), commandThis });
      } catch (e) {
        error = e;
      }
      expect(error?.message).to.equal('INVALID_SESSION_ID');
      expect(calls).to.have.length(1);
      expect(Object.keys(await parsePackageXmlFile(manifestFile))).to.have.length(Object.keys(ORG_CONTENT).length);
    });

    it('marks the first retrieve as the last attempt when there is nothing to drop', async () => {
      await writePackageXmlFile(manifestFile, { ApexClass: ['MyClass'] });
      const calls: { types: string[]; lastAttempt: boolean }[] = [];
      let error: any = null;
      try {
        await retrieveWithTruncation({ manifestFile, retrieve: orgRefusing(1, calls), commandThis });
      } catch (e) {
        error = e;
      }
      expect(error?.message).to.equal(FILE_LIMIT_ERROR);
      expect(calls).to.deep.equal([{ types: ['ApexClass'], lastAttempt: true }]);
    });
  });

  describe('truncated items manifest', () => {
    it('describes and counts the dropped items', () => {
      const dropped = { StaticResource: ['jquery'], Report: ['A/B', 'A/C'] };
      expect(describeDroppedTypes(dropped)).to.equal('Report (2), StaticResource (1)');
      expect(countDroppedItems(dropped)).to.equal(3);
    });

    it('writes the dropped items, replacing the file of an older backup, and removes it', async () => {
      await writeTruncatedItemsManifest({ Report: ['Old/Report'], Dashboard: ['Old/Dashboard'] });
      await writeTruncatedItemsManifest({ Report: ['MyFolder/MyReport'] });
      expect(await parsePackageXmlFile(BACKUP_TRUNCATED_ITEMS_FILE)).to.deep.equal({ Report: ['MyFolder/MyReport'] });
      await removeTruncatedItemsManifest();
      expect(fs.existsSync(BACKUP_TRUNCATED_ITEMS_FILE)).to.be.false;
      await removeTruncatedItemsManifest();
    });
  });
});
