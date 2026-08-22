import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as path from 'path';
import {
  RemovePackageXmlItemsAction,
  findInvalidPackageXmlItems,
  normalizePackageXmlItems,
  parsePackageXmlItems,
} from '../../../src/common/actionsProvider/removePackageXmlItemsAction.js';
import { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { parsePackageXmlFile } from '../../../src/common/utils/xmlUtils.js';
import { setupTmpDir } from '../utils/actionTestHelper.js';

const PACKAGE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>MyClass1</members>
        <members>MyClass2</members>
        <members>MyClass3</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>MyLayout1</members>
        <members>MyLayout2</members>
        <name>Layout</name>
    </types>
    <version>62.0</version>
</Package>
`;

function buildCmd(packageXmlItems: string[] | string): PrePostCommand {
  return {
    id: 'test-remove',
    label: 'Remove items from package.xml',
    type: 'remove-packagexml-items',
    command: '',
    context: 'all',
    parameters: { packageXmlItems },
  };
}

describe('removePackageXmlItemsAction', () => {
  const ctx = setupTmpDir('sfdx-hardis-remove-pkg-test');

  afterEach(() => {
    delete globalThis.pendingDeploymentPackageXmlFiles;
  });

  describe('normalizePackageXmlItems', () => {
    it('wraps a single string entry in an array', () => {
      expect(normalizePackageXmlItems('ApexClass:MyClass1')).to.deep.equal(['ApexClass:MyClass1']);
    });

    it('returns arrays as-is', () => {
      expect(normalizePackageXmlItems(['ApexClass:MyClass1'])).to.deep.equal(['ApexClass:MyClass1']);
    });

    it('returns an empty array for blank string, undefined or other types', () => {
      expect(normalizePackageXmlItems('   ')).to.deep.equal([]);
      expect(normalizePackageXmlItems(undefined)).to.deep.equal([]);
      expect(normalizePackageXmlItems({ foo: 'bar' })).to.deep.equal([]);
    });
  });

  describe('parsePackageXmlItems', () => {
    it('parses items into inline remove types', () => {
      const result = parsePackageXmlItems(['ApexClass:MyClass1,MyClass3', 'Layout:MyLayout1']);
      expect(result).to.deep.equal([
        { name: ['ApexClass'], members: ['MyClass1', 'MyClass3'] },
        { name: ['Layout'], members: ['MyLayout1'] },
      ]);
    });

    it('merges duplicate types and deduplicates members', () => {
      const result = parsePackageXmlItems(['ApexClass:MyClass1', 'ApexClass:MyClass1,MyClass2']);
      expect(result).to.deep.equal([{ name: ['ApexClass'], members: ['MyClass1', 'MyClass2'] }]);
    });

    it('keeps only wildcard when * is present for a type', () => {
      const result = parsePackageXmlItems(['ApexClass:MyClass1,*']);
      expect(result).to.deep.equal([{ name: ['ApexClass'], members: ['*'] }]);
    });
  });

  describe('findInvalidPackageXmlItems', () => {
    it('accepts valid entries', () => {
      expect(findInvalidPackageXmlItems(['ApexClass:MyClass1,MyClass3', 'Layout:*'])).to.deep.equal([]);
    });

    it('rejects entries without a colon or without members', () => {
      expect(findInvalidPackageXmlItems(['NoColon', 'ApexClass:'])).to.deep.equal(['NoColon', 'ApexClass:']);
    });
  });

  describe('run', () => {
    it('removes requested members from deployment package.xml files', async () => {
      const packageXmlFile = path.join(ctx.getDir(), 'calculated-package.xml');
      await fs.writeFile(packageXmlFile, PACKAGE_XML);
      globalThis.pendingDeploymentPackageXmlFiles = [packageXmlFile];

      const action = new RemovePackageXmlItemsAction();
      const result = await action.run(buildCmd(['ApexClass:MyClass1,MyClass3', 'Layout:MyLayout2']));

      expect(result.statusCode).to.equal('success');
      const parsed = await parsePackageXmlFile(packageXmlFile);
      expect(parsed.ApexClass).to.deep.equal(['MyClass2']);
      expect(parsed.Layout).to.deep.equal(['MyLayout1']);
    });

    it('removes a whole type when wildcard is used', async () => {
      const packageXmlFile = path.join(ctx.getDir(), 'calculated-package.xml');
      await fs.writeFile(packageXmlFile, PACKAGE_XML);
      globalThis.pendingDeploymentPackageXmlFiles = [packageXmlFile];

      const action = new RemovePackageXmlItemsAction();
      const result = await action.run(buildCmd(['Layout:*']));

      expect(result.statusCode).to.equal('success');
      const parsed = await parsePackageXmlFile(packageXmlFile);
      expect(parsed.Layout).to.equal(undefined);
      expect(parsed.ApexClass).to.deep.equal(['MyClass1', 'MyClass2', 'MyClass3']);
    });

    it('is skipped when no deployment package.xml is in context', async () => {
      const action = new RemovePackageXmlItemsAction();
      const result = await action.run(buildCmd(['ApexClass:MyClass1']));
      expect(result.statusCode).to.equal('skipped');
    });

    it('accepts a single string packageXmlItems parameter', async () => {
      const packageXmlFile = path.join(ctx.getDir(), 'calculated-package.xml');
      await fs.writeFile(packageXmlFile, PACKAGE_XML);
      globalThis.pendingDeploymentPackageXmlFiles = [packageXmlFile];

      const action = new RemovePackageXmlItemsAction();
      const result = await action.run(buildCmd('ApexClass:MyClass1,MyClass3'));

      expect(result.statusCode).to.equal('success');
      const parsed = await parsePackageXmlFile(packageXmlFile);
      expect(parsed.ApexClass).to.deep.equal(['MyClass2']);
    });

    it('fails when packageXmlItems parameter is missing', async () => {
      const action = new RemovePackageXmlItemsAction();
      const result = await action.run(buildCmd([]));
      expect(result.statusCode).to.equal('failed');
    });
  });
});
