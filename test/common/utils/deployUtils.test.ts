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
        <types>
          <members>Case.PreventInvalidQuotes</members>
          <name>ValidationRule</name>
        </types>
        <types>
          <members>WorkPlan</members>
          <name>CustomObject</name>
        </types>
        <types>
          <members>SomeDataType.one_record</members>
          <name>CustomMetadata</name>
        </types>
        <types>
          <members>SomeLabel</members>
          <name>CustomLabel</name>
        </types>
        <types>
          <members>Global_quick_action</members>
          <name>QuickAction</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    /** 
     * All possible translation languages are expected.
     * They are to be filtered out with the package intersection.
     */
    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity-Some layout 1</members>
          <members>Opportunity-Some layout 2</members>
          <name>Layout</name>
        </types>
        <types>
          <members>Case.PreventInvalidQuotes</members>
          <name>ValidationRule</name>
        </types>
        <types>
          <members>WorkPlan</members>
          <members>SomeDataType_mdt</members>
          <name>CustomObject</name>
        </types>
        <types>
          <members>SomeLabel</members>
          <name>CustomLabel</name>
        </types>
        <types>
          <members>Account-de</members>
          <members>Opportunity-de</members>
          <members>Opportunity-zh_CN</members>
          <members>Opportunity-zh_TW</members>
          <members>Opportunity-da</members>
          <members>Opportunity-nl</members>
          <members>Opportunity-fi</members>
          <members>Opportunity-fr</members>
          <members>Opportunity-it</members>
          <members>Opportunity-ja</members>
          <members>Opportunity-ko</members>
          <members>Opportunity-no</members>
          <members>Opportunity-pt_BR</members>
          <members>Opportunity-ru</members>
          <members>Opportunity-es</members>
          <members>Opportunity-es_MX</members>
          <members>Opportunity-sv</members>
          <members>Opportunity-th</members>
          <members>Case-zh_CN</members>
          <members>Case-zh_TW</members>
          <members>Case-da</members>
          <members>Case-nl</members>
          <members>Case-fi</members>
          <members>Case-fr</members>
          <members>Case-de</members>
          <members>Case-it</members>
          <members>Case-ja</members>
          <members>Case-ko</members>
          <members>Case-no</members>
          <members>Case-pt_BR</members>
          <members>Case-ru</members>
          <members>Case-es</members>
          <members>Case-es_MX</members>
          <members>Case-sv</members>
          <members>Case-th</members>
          <members>WorkPlan-zh_CN</members>
          <members>WorkPlan-zh_TW</members>
          <members>WorkPlan-da</members>
          <members>WorkPlan-nl</members>
          <members>WorkPlan-fi</members>
          <members>WorkPlan-fr</members>
          <members>WorkPlan-de</members>
          <members>WorkPlan-it</members>
          <members>WorkPlan-ja</members>
          <members>WorkPlan-ko</members>
          <members>WorkPlan-no</members>
          <members>WorkPlan-pt_BR</members>
          <members>WorkPlan-ru</members>
          <members>WorkPlan-es</members>
          <members>WorkPlan-es_MX</members>
          <members>WorkPlan-sv</members>
          <members>WorkPlan-th</members>
          <name>CustomObjectTranslation</name>
        </types>
        <types>
          <members>SomeDataType.one_record</members>
          <name>CustomMetadata</name>
        </types>
        <types>
          <members>zh_CN</members>
          <members>zh_TW</members>
          <members>da</members>
          <members>nl</members>
          <members>fi</members>
          <members>fr</members>
          <members>de</members>
          <members>it</members>
          <members>ja</members>
          <members>ko</members>
          <members>no</members>
          <members>pt_BR</members>
          <members>ru</members>
          <members>es</members>
          <members>es_MX</members>
          <members>sv</members>
          <members>th</members>
          <name>Translations</name>
        </types>
        <types>
          <members>Global_quick_action</members>
          <name>QuickAction</name>
        </types>
        <version>63.0</version>
      </Package>`; 

    await extendPackageFileWithDependencies(deltaXmlFile);
    const fileXml = await xml2js.parseStringPromise(fs.readFileSync(deltaXmlFile, 'utf8'));

    const expectedXml = await xml2js.parseStringPromise(expectedXmlString);
    expect(fileXml.Package.types).to.have.deep.members(expectedXml.Package.types);
  });
});