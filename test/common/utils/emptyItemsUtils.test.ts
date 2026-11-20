/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as child from 'child_process';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  EMPTY_ITEM_CONSTRAINTS,
  isEmptyItemDeletable,
  isKnownCommit,
  isEmptyMetadataRoot,
  removeTypeMembersFromPackageXml,
} from '../../../src/common/utils/emptyItemsUtils.js';
import { parseXmlFile } from '../../../src/common/utils/xmlUtils.js';

const CUSTOM_OBJECT = EMPTY_ITEM_CONSTRAINTS.find((constraint) => constraint.metadataType === 'CustomObject')!;
const SHARING_RULES = EMPTY_ITEM_CONSTRAINTS.find((constraint) => constraint.metadataType === 'SharingRules')!;

const EMPTY_OBJECT = '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>\n';

describe('emptyItemsUtils', () => {
  // Under the repository, not the OS temp folder: see test/commands/hardis/project/clean/references-dispatch.test.ts
  const tmpRoot = path.join(process.cwd(), 'tmp');
  let tmpDir = '';
  let previousCwd = '';

  beforeEach(async () => {
    tmpDir = path.join(tmpRoot, `hardis-empty-items-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.ensureDir(tmpDir);
    previousCwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
  });

  describe('isEmptyMetadataRoot', () => {
    it('finds a CustomObject without any child empty', async () => {
      const file = path.join(tmpDir, 'Acme__c.object-meta.xml');
      await fs.writeFile(file, EMPTY_OBJECT);
      expect(isEmptyMetadataRoot(await parseXmlFile(file), 'CustomObject')).to.be.true;
    });

    it('finds a self-closing CustomObject empty', async () => {
      const file = path.join(tmpDir, 'Acme__c.object-meta.xml');
      await fs.writeFile(file, '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject/>\n');
      expect(isEmptyMetadataRoot(await parseXmlFile(file), 'CustomObject')).to.be.true;
    });

    it('keeps a CustomObject that has a label', async () => {
      const file = path.join(tmpDir, 'Acme__c.object-meta.xml');
      await fs.writeFile(
        file,
        '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n    <label>Acme</label>\n</CustomObject>\n'
      );
      expect(isEmptyMetadataRoot(await parseXmlFile(file), 'CustomObject')).to.be.false;
    });

    it('uses the child tag when one is configured', () => {
      expect(isEmptyMetadataRoot({ SharingRules: { $: {} } }, 'SharingRules', 'sharingOwnerRules')).to.be.true;
      expect(isEmptyMetadataRoot({ SharingRules: { sharingOwnerRules: [{}] } }, 'SharingRules', 'sharingOwnerRules')).to.be.false;
    });
  });

  describe('removeTypeMembersFromPackageXml', () => {
    it('removes only the given members, and the type when nothing is left', async () => {
      const packageXml = path.join(tmpDir, 'package.xml');
      await fs.writeFile(
        packageXml,
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
          '<types><members>Acme__c</members><members>Other__c</members><name>CustomObject</name></types>',
          '<types><members>Acme__c.Flag__c</members><name>CustomField</name></types>',
          '<version>65.0</version>',
          '</Package>',
        ].join('\n')
      );
      expect(await removeTypeMembersFromPackageXml(packageXml, 'CustomObject', ['Acme__c', 'Missing__c'])).to.deep.equal(['Acme__c']);
      let content = await fs.readFile(packageXml, 'utf8');
      expect(content).to.include('<members>Other__c</members>');
      expect(content).to.include('<members>Acme__c.Flag__c</members>');
      expect(content).to.not.match(/<members>Acme__c<\/members>/);

      await removeTypeMembersFromPackageXml(packageXml, 'CustomObject', ['Other__c']);
      content = await fs.readFile(packageXml, 'utf8');
      expect(content).to.not.include('<name>CustomObject</name>');
    });

    it('does nothing when the package.xml does not exist', async () => {
      expect(await removeTypeMembersFromPackageXml(path.join(tmpDir, 'none.xml'), 'CustomObject', ['Acme__c'])).to.deep.equal([]);
    });
  });

  describe('isEmptyItemDeletable', () => {
    const run = (args: string[]) => child.execFileSync('git', args, { cwd: tmpDir, windowsHide: true });

    // A throwaway git repository: commit 1 has committed.object-meta.xml, commit 2 adds story.object-meta.xml,
    // and new.object-meta.xml is never committed
    beforeEach(async () => {
      run(['init', '-q']);
      run(['config', 'user.email', 'test@example.com']);
      run(['config', 'user.name', 'test']);
      run(['config', 'commit.gpgsign', 'false']);
      await fs.writeFile(path.join(tmpDir, 'committed.object-meta.xml'), EMPTY_OBJECT);
      run(['add', '-A']);
      run(['commit', '-q', '-m', 'one']);
      await fs.writeFile(path.join(tmpDir, 'story.object-meta.xml'), EMPTY_OBJECT);
      run(['add', '-A']);
      run(['commit', '-q', '-m', 'two']);
      await fs.writeFile(path.join(tmpDir, 'new.object-meta.xml'), EMPTY_OBJECT);
      process.chdir(tmpDir);
    });

    it('without --delta-from, never deletes a CustomObject file already committed', async () => {
      expect(await isEmptyItemDeletable('committed.object-meta.xml', CUSTOM_OBJECT, null)).to.be.false;
      expect(await isEmptyItemDeletable('story.object-meta.xml', CUSTOM_OBJECT, null)).to.be.false;
      expect(await isEmptyItemDeletable('new.object-meta.xml', CUSTOM_OBJECT, null)).to.be.true;
    });

    it('with --delta-from, deletes what was added since that commit and keeps what already existed there', async () => {
      expect(await isEmptyItemDeletable('committed.object-meta.xml', CUSTOM_OBJECT, 'HEAD~1')).to.be.false;
      expect(await isEmptyItemDeletable('story.object-meta.xml', CUSTOM_OBJECT, 'HEAD~1')).to.be.true;
      expect(await isEmptyItemDeletable('new.object-meta.xml', CUSTOM_OBJECT, 'HEAD~1')).to.be.true;
    });

    it('knows the commits of the repository and nothing else', async () => {
      expect(await isKnownCommit('HEAD~1')).to.be.true;
      expect(await isKnownCommit('origin/never-fetched')).to.be.false;
    });

    it('keeps the former behavior of the other types when no commit is given', async () => {
      expect(await isEmptyItemDeletable('committed.object-meta.xml', SHARING_RULES, null)).to.be.true;
    });
  });
});
