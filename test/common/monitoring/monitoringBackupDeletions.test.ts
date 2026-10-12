/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applyBackupDeletions,
  backupChangeType,
  confirmDeletedComponents,
  findFilesOfDeletedComponents,
  isBackupDeletionsDisabled,
  ReadMetadata,
  RetrievedFilesCollector,
  retrieveFailureMessage,
  retrieveJsonErrorMessage,
} from '../../../src/common/monitoring/monitoringBackupDeletions.js';

const commandThis = { ux: { log: () => { } } };

const CLASS_META = '<?xml version="1.0" encoding="UTF-8"?><ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>66.0</apiVersion></ApexClass>';
const FIELD = '<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>X</fullName></CustomField>';
const OBJECT = '<?xml version="1.0" encoding="UTF-8"?><CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>';
const LWC_META = '<?xml version="1.0" encoding="UTF-8"?><LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>66.0</apiVersion></LightningComponentBundle>';
const LAYOUT = '<?xml version="1.0" encoding="UTF-8"?><Layout xmlns="http://soap.sforce.com/2006/04/metadata"></Layout>';
const LABELS = '<?xml version="1.0" encoding="UTF-8"?><CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata"></CustomLabels>';

// An org that returns the components named here, and an empty answer for the others
function orgWith(existing: string[] = [], calls: string[][] = []): ReadMetadata {
  return async (type, fullNames) => {
    calls.push(fullNames);
    return fullNames.map((fullName) => (existing.includes(`${type}:${fullName}`) ? { fullName } : {}));
  };
}

describe('monitoringBackupDeletions', () => {
  let projectDir: string;
  let packageDir: string;

  // Writes the files of a backup, and returns their paths in the same order
  function write(files: Record<string, string>): string[] {
    return Object.entries(files).map(([relativePath, content]) => {
      const file = path.join(packageDir, 'main', 'default', relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return file;
    });
  }

  // What sf project retrieve start --json returns for the files the org sent back
  function retrieved(files: { file?: string; type: string; fullName: string; state?: string }[]): RetrievedFilesCollector {
    const collector = new RetrievedFilesCollector();
    collector.add({
      result: { files: files.map((item) => ({ filePath: item.file, type: item.type, fullName: item.fullName, state: item.state || 'Changed' })) },
    });
    return collector;
  }

  function relative(file: string): string {
    return path.relative(path.join(packageDir, 'main', 'default'), file).replace(/\\/g, '/');
  }

  async function find(collector: RetrievedFilesCollector, currentManifest: any, previousManifest: any = null): Promise<string[]> {
    const found = await findFilesOfDeletedComponents({ packageDirs: [packageDir], retrieved: collector, currentManifest, previousManifest });
    return found.map((item) => relative(item.file));
  }

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-deletions-'));
    packageDir = path.join(projectDir, 'force-app');
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  describe('findFilesOfDeletedComponents', () => {
    it('finds the files of a class that is gone from the org, and keeps the retrieved one', async () => {
      const [keptCls, keptMeta] = write({
        'classes/Kept.cls': 'public class Kept {}',
        'classes/Kept.cls-meta.xml': CLASS_META,
        'classes/Gone.cls': 'public class Gone {}',
        'classes/Gone.cls-meta.xml': CLASS_META,
      });
      const collector = retrieved([
        { file: keptCls, type: 'ApexClass', fullName: 'Kept' },
        { file: keptMeta, type: 'ApexClass', fullName: 'Kept' },
      ]);
      expect(await find(collector, { ApexClass: ['Kept'] })).to.deep.equal(['classes/Gone.cls', 'classes/Gone.cls-meta.xml']);
    });

    it('keeps a component that exists in the org and is not retrieved', async () => {
      write({ 'classes/Skipped.cls': 'public class Skipped {}', 'classes/Skipped.cls-meta.xml': CLASS_META });
      expect(await find(retrieved([]), { ApexClass: ['Skipped'] })).to.deep.equal([]);
    });

    it('keeps a file that is not metadata', async () => {
      write({ 'classes/notes.txt': 'not metadata', 'classes/Kept.cls-meta.xml': CLASS_META });
      expect(await find(retrieved([]), { ApexClass: ['Kept'] })).to.deep.equal([]);
    });

    it('finds a custom field deleted from a retrieved object, and keeps the standard fields the org returned', async () => {
      const [objectFile, standardField] = write({
        'objects/Account/Account.object-meta.xml': OBJECT,
        'objects/Account/fields/Industry.field-meta.xml': FIELD,
        'objects/Account/fields/Old__c.field-meta.xml': FIELD,
      });
      const collector = retrieved([
        { file: objectFile, type: 'CustomObject', fullName: 'Account' },
        { file: standardField, type: 'CustomField', fullName: 'Account.Industry' },
      ]);
      const manifest = { CustomObject: ['Account'], CustomField: ['Account.Other__c'] };
      expect(await find(collector, manifest)).to.deep.equal(['objects/Account/fields/Old__c.field-meta.xml']);
    });

    it('keeps the fields of an object that is not retrieved, except the ones the previous backup listed', async () => {
      write({
        'objects/Case/Case.object-meta.xml': OBJECT,
        'objects/Case/fields/Status.field-meta.xml': FIELD,
        'objects/Case/fields/Removed__c.field-meta.xml': FIELD,
      });
      const manifest = { CustomObject: ['Case'], CustomField: ['Account.Other__c'] };
      const previous = { CustomObject: ['Case'], CustomField: ['Account.Other__c', 'Case.Removed__c'] };
      expect(await find(retrieved([]), manifest)).to.deep.equal([]);
      expect(await find(retrieved([]), manifest, previous)).to.deep.equal(['objects/Case/fields/Removed__c.field-meta.xml']);
    });

    it('does not count a component that failed to retrieve as retrieved', async () => {
      const [, otherField] = write({
        'objects/Account/fields/Industry.field-meta.xml': FIELD,
        'objects/Contact/fields/Level__c.field-meta.xml': FIELD,
      });
      const collector = retrieved([
        { type: 'CustomObject', fullName: 'Account', state: 'Failed' },
        { file: otherField, type: 'CustomField', fullName: 'Contact.Level__c' },
      ]);
      const manifest = { CustomObject: ['Account', 'Contact'], CustomField: ['Contact.Level__c'] };
      expect(collector.components.has('CustomObject:Account')).to.be.false;
      expect(await find(collector, manifest)).to.deep.equal([]);
    });

    it('keeps the other files of a component the org just returned', async () => {
      const [js, meta] = write({
        'lwc/timeline/timeline.js': 'export default class Timeline {}',
        'lwc/timeline/timeline.js-meta.xml': LWC_META,
        'lwc/timeline/__tests__/timeline.test.js': 'test',
      });
      const collector = retrieved([
        { file: js, type: 'LightningComponentBundle', fullName: 'timeline' },
        { file: meta, type: 'LightningComponentBundle', fullName: 'timeline' },
      ]);
      expect(await find(collector, { LightningComponentBundle: ['other'] })).to.deep.equal([]);
    });

    it('keeps a type that the org does not list by name, unless the previous backup listed the component', async () => {
      write({ 'labels/CustomLabels.labels-meta.xml': LABELS, 'lwc/last/last.js': 'export default class Last {}', 'lwc/last/last.js-meta.xml': LWC_META });
      const manifest = { ApexClass: ['Kept'] };
      expect(await find(retrieved([]), manifest)).to.deep.equal([]);
      expect(await find(retrieved([]), manifest, { ApexClass: ['Kept'], LightningComponentBundle: ['last'] })).to.deep.equal([
        'lwc/last/last.js',
        'lwc/last/last.js-meta.xml',
      ]);
    });

    it('keeps the stale files of a type of which nothing was retrieved, except the ones the previous backup listed', async () => {
      write({
        'classes/Old.cls': 'public class Old {}',
        'classes/Old.cls-meta.xml': CLASS_META,
        'classes/Removed.cls': 'public class Removed {}',
        'classes/Removed.cls-meta.xml': CLASS_META,
      });
      const manifest = { ApexClass: ['Kept'] };
      expect(await find(retrieved([]), manifest)).to.deep.equal([]);
      expect(await find(retrieved([]), manifest, { ApexClass: ['Kept', 'Removed'] })).to.deep.equal([
        'classes/Removed.cls',
        'classes/Removed.cls-meta.xml',
      ]);
    });

    it('never finds a value set translation, even when the previous backup listed it', async () => {
      const [french] = write({
        'globalValueSetTranslations/Sector-fr.globalValueSetTranslation-meta.xml': '<GlobalValueSetTranslation/>',
        'globalValueSetTranslations/Sector-en_US.globalValueSetTranslation-meta.xml': '<GlobalValueSetTranslation/>',
      });
      const collector = retrieved([{ file: french, type: 'GlobalValueSetTranslation', fullName: 'Sector-fr' }]);
      const manifest = { GlobalValueSetTranslation: ['Sector-fr'] };
      expect(await find(collector, manifest, { GlobalValueSetTranslation: ['Sector-fr', 'Sector-en_US'] })).to.deep.equal([]);
    });

    it('compares encoded names decoded', async () => {
      const [, , other] = write({
        'layouts/Account-Account %28Sales%29 Layout.layout-meta.xml': LAYOUT,
        'layouts/Account-Account %28Old%29 Layout.layout-meta.xml': LAYOUT,
        'layouts/Case-Case Layout.layout-meta.xml': LAYOUT,
      });
      const collector = retrieved([{ file: other, type: 'Layout', fullName: 'Case-Case Layout' }]);
      expect(await find(collector, { Layout: ['Account-Account (Sales) Layout', 'Case-Case Layout'] })).to.deep.equal([
        'layouts/Account-Account %28Old%29 Layout.layout-meta.xml',
      ]);
    });

    it('keeps every file below a folder the retrieve returned', async () => {
      const [meta] = write({ 'staticresources/site.resource-meta.xml': '<StaticResource/>', 'staticresources/site/index.html': '<html/>' });
      const collector = retrieved([
        { file: meta, type: 'StaticResource', fullName: 'site' },
        { file: path.join(path.dirname(meta), 'site'), type: 'StaticResource', fullName: 'other' },
      ]);
      expect(await find(collector, { StaticResource: ['site'] })).to.deep.equal([]);
    });
  });

  describe('confirmDeletedComponents', () => {
    const found = (type: string, names: string[]) => names.map((name) => ({ file: `${name}.xml`, type, name }));

    it('confirms only the components the org does not return', async () => {
      const gone = await confirmDeletedComponents(found('ApexClass', ['Gone', 'StillThere']), orgWith(['ApexClass:StillThere']));
      expect([...gone]).to.deep.equal(['ApexClass:Gone']);
    });

    it('asks 10 names by call, each component once', async () => {
      const calls: string[][] = [];
      const names = Array.from({ length: 12 }, (_, i) => `Class${i}`);
      const gone = await confirmDeletedComponents([...found('ApexClass', names), ...found('ApexClass', ['Class0'])], orgWith([], calls));
      expect(calls.map((call) => call.length)).to.deep.equal([10, 2]);
      expect(gone.size).to.equal(12);
    });

    it('reads an encoded name both ways, and keeps the component when the org returns one of them', async () => {
      const calls: string[][] = [];
      const layout = 'Account-Account %28Sales%29 Layout';
      const gone = await confirmDeletedComponents(found('Layout', [layout]), orgWith(['Layout:Account-Account (Sales) Layout'], calls));
      expect(calls[0]).to.deep.equal([layout, 'Account-Account (Sales) Layout']);
      expect(gone.size).to.equal(0);
    });

    it('does not confirm a component the org can not be asked about, and still answers for the others of the call', async () => {
      const read: ReadMetadata = async (type, fullNames) => {
        if (fullNames.includes('Broken')) {
          throw new Error('UNKNOWN_EXCEPTION');
        }
        return fullNames.map(() => ({}));
      };
      const gone = await confirmDeletedComponents(found('SharingRules', ['Broken', 'Gone']), read);
      expect([...gone]).to.deep.equal(['SharingRules:Gone']);
    });

    it('confirms nothing for a type the org refuses to read', async () => {
      const read: ReadMetadata = async () => {
        throw new Error('type is not a valid metadata type for reading');
      };
      expect((await confirmDeletedComponents(found('Settings', ['Social', 'Web']), read)).size).to.equal(0);
    });
  });

  describe('applyBackupDeletions', () => {
    it('deletes the files of the components the org confirms, and the folders left empty', async () => {
      const [objectFile, , , stillThere] = write({
        'objects/Account/Account.object-meta.xml': OBJECT,
        'objects/Gone__c/Gone__c.object-meta.xml': OBJECT,
        'objects/Gone__c/fields/Name__c.field-meta.xml': FIELD,
        'objects/Listed_Wrong__c/Listed_Wrong__c.object-meta.xml': OBJECT,
      });
      const result = await applyBackupDeletions({
        packageDirs: [packageDir],
        retrieved: retrieved([{ file: objectFile, type: 'CustomObject', fullName: 'Account' }]),
        currentManifest: { CustomObject: ['Account'], CustomField: ['Account.Other__c'] },
        previousManifest: { CustomObject: ['Account', 'Gone__c', 'Listed_Wrong__c'], CustomField: ['Account.Other__c', 'Gone__c.Name__c'] },
        readMetadata: orgWith(['CustomObject:Listed_Wrong__c']),
        commandThis,
      });
      expect(result.deletedFiles.map(relative)).to.deep.equal(['objects/Gone__c/Gone__c.object-meta.xml', 'objects/Gone__c/fields/Name__c.field-meta.xml']);
      expect(result.notConfirmedFiles.map(relative)).to.deep.equal(['objects/Listed_Wrong__c/Listed_Wrong__c.object-meta.xml']);
      expect(result.skipped).to.be.false;
      expect(fs.existsSync(path.join(packageDir, 'main', 'default', 'objects', 'Gone__c'))).to.be.false;
      expect(fs.existsSync(objectFile)).to.be.true;
      expect(fs.existsSync(stillThere)).to.be.true;
    });

    it('deletes nothing and asks the org nothing when the run is skipped', async () => {
      const [gone] = write({ 'classes/Gone.cls': 'public class Gone {}', 'classes/Gone.cls-meta.xml': CLASS_META });
      const calls: string[][] = [];
      for (const skipReason of [
        { kind: 'disabled' as const },
        { kind: 'partialRetrieve' as const, detail: '--start-chunk' },
        { kind: 'noFileList' as const },
      ]) {
        const result = await applyBackupDeletions({
          packageDirs: [packageDir],
          retrieved: retrieved([]),
          currentManifest: { ApexClass: ['Kept'] },
          previousManifest: { ApexClass: ['Kept', 'Gone'] },
          skipReason,
          readMetadata: orgWith([], calls),
          commandThis,
        });
        expect(result).to.deep.equal({ deletedFiles: [], notConfirmedFiles: [], skipped: true });
      }
      expect(calls).to.deep.equal([]);
      expect(fs.existsSync(gone)).to.be.true;
    });
  });

  describe('RetrievedFilesCollector', () => {
    it('is not complete when a retrieve returns no list of files', () => {
      const collector = new RetrievedFilesCollector();
      collector.add({ result: { files: [] } });
      expect(collector.complete).to.be.true;
      collector.add({ status: 0, stdout: 'not json' });
      expect(collector.complete).to.be.false;
    });
  });

  describe('backupChangeType', () => {
    it('marks new files A and deleted files D, and leaves modified files as git reports them', () => {
      expect(backupChangeType({ index: '?', working_dir: '?' })).to.equal('A');
      expect(backupChangeType({ index: ' ', working_dir: 'D' })).to.equal('D');
      expect(backupChangeType({ index: ' ', working_dir: 'M' })).to.equal(' ');
    });
  });

  describe('isBackupDeletionsDisabled', () => {
    afterEach(() => {
      delete process.env.MONITORING_BACKUP_SKIP_DELETIONS;
    });

    it('reads the config key and the environment variable', () => {
      expect(isBackupDeletionsDisabled({})).to.be.false;
      expect(isBackupDeletionsDisabled({ monitoringBackupSkipDeletions: true })).to.be.true;
      process.env.MONITORING_BACKUP_SKIP_DELETIONS = 'true';
      expect(isBackupDeletionsDisabled({})).to.be.true;
    });
  });

  describe('retrieveFailureMessage', () => {
    it('reads the failure of a retrieve that the CLI reports with status 0', () => {
      const refused = {
        status: 0,
        result: { done: true, success: false, status: 'Failed', errorStatusCode: 'LIMIT_EXCEEDED', errorMessage: 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is: 10000', files: [] },
      };
      expect(retrieveFailureMessage(refused)).to.equal('LIMIT_EXCEEDED: Too many files in retrieve call, limit is: 10000');
      expect(retrieveFailureMessage({ status: 0, result: { success: true, status: 'Succeeded', files: [] } })).to.be.null;
      expect(retrieveFailureMessage({ status: 0, stdout: 'not json' })).to.be.null;
    });
  });

  describe('retrieveJsonErrorMessage', () => {
    it('returns the message of the JSON output of a failed command', () => {
      expect(retrieveJsonErrorMessage({ stdout: JSON.stringify({ status: 1, name: 'Error', message: ' No such org ' }) })).to.equal('No such org');
      expect(retrieveJsonErrorMessage({ stdout: 'plain text' })).to.be.null;
      expect(retrieveJsonErrorMessage(new Error('boom'))).to.be.null;
    });
  });
});
