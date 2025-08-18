import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import sinon from 'sinon';
import * as os from 'node:os'
import { mkdtemp } from 'node:fs/promises';
import * as xml2js from 'xml2js';

import { extendPackageFileWithDependencies } from '../../../src/common/utils/deployUtils.js';

describe('deployUtils.extendPackageFileWithDependencies', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'extendPackageFileWithDependencies'));
  const deltaXmlFile = path.join(tmpDir, 'deltaPackage.xml');
  const fullXmlFile = path.join(tmpDir, 'package.xml');

  beforeEach(async () => {
    await fs.ensureDir(tmpDir);
    fs.writeFileSync(
      fullXmlFile,
    `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity</members>
          <name>CustomObject</name>
        </types>
        <types>
          <members>Opportunity.SomeRecordType</members>
          <name>RecordType</name>
        </types>
        <types>
          <members>Opportunity-Some layout 1</members>
          <members>Opportunity-Some layout 2</members>
          <name>Layout</name>
        </types>
        <types>
          <members>Opportunity-de</members>
          <members>Opportunity-jp</members>
          <members>Account-de</members>
          <name>CustomObjectTranslation</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );
  });

  afterEach(async () => {
    sinon.restore();
    await fs.remove(tmpDir);
  });

  it('should add object translations to any layout', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity-Some layout 1</members>
          <members>Opportunity-Some layout 2</members>
          <name>Layout</name>
        </types>
        <types>
          <members>Account-de</members>
          <members>Opportunity-de</members>
          <name>CustomObjectTranslation</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    /** 
     * All possible translation languages are expected.
     * They are to be filtered out with the package intersection.
     */
    const expectedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity-Some layout 1</members>
          <members>Opportunity-Some layout 2</members>
          <name>Layout</name>
        </types>
        <types>
          <members>Account-de</members>
          <members>Opportunity-de</members>
          <members>Opportunity-jp</members>
          <name>CustomObjectTranslation</name>
        </types>
        <version>63.0</version>
      </Package>`; 

    await extendPackageFileWithDependencies(deltaXmlFile);
    const fileXml = await xml2js.parseStringPromise(fs.readFileSync(deltaXmlFile, 'utf8'));
    
    expect(fileXml).to.deep.equal(await xml2js.parseStringPromise(expectedXml));
  });
});