import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import * as os from 'node:os'
import { mkdtemp } from 'node:fs/promises';
import * as xml2js from 'xml2js';

import { extendPackageFileWithDependencies } from '../../../src/common/utils/deltaUtils.js';

describe('deployUtils.extendPackageFileWithDependencies', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'extendPackageFileWithDependencies'));
  const deltaXmlFile = path.join(tmpDir, 'deltaPackage.xml');
  const deltaDestructiveXmlFile = path.join(tmpDir, 'deltaDestructiveChanges.xml');
  const fullXmlFile = path.join(tmpDir, 'package.xml');

  before(async () => {
    await fs.ensureDir(tmpDir);
    fs.writeFileSync(
      fullXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity</members>
          <members>SomeDataType__mdt</members>
          <name>CustomObject</name>
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
        <types>
          <members>SomeDataType.record_one</members>
          <members>SomeDataType.record_two</members>
          <members>SomeAnotherDataType.record_one</members>
          <members>SomeAnotherDataType.record_two</members>
          <name>CustomMetadata</name>
        </types>
        <types>
          <members>SomeDataType__mdt.SomeField1__c</members>
          <members>SomeDataType__mdt.SomeField2__c</members>
          <name>CustomField</name>
        </types>
        <types>
          <members>Opportunity.Type1</members>
          <members>Opportunity.Type2</members>
          <name>RecordType</name>
        </types>
        <types>
          <members>LeadConvertSettings</members>
          <name>LeadConvertSettings</name>
        </types>
        <types>
          <members>de</members>
          <members>fr</members>
          <name>Translations</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );
  });

  after(async () => {
    await fs.remove(tmpDir);
  });

  const expectXmlEquals = async (expectedXmlString, deltaXmlFile) => {
    const fileXml = await xml2js.parseStringPromise(fs.readFileSync(deltaXmlFile, 'utf8'));
    const expectedXml = await xml2js.parseStringPromise(expectedXmlString);
    expect(fileXml.Package.types).to.have.deep.members(expectedXml.Package.types);
  }

  it('should add all custom metadata records if CustomField was changed', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>SomeDataType__mdt.SomeField__c</members>
          <name>CustomField</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>SomeDataType.record_one</members>
          <members>SomeDataType.record_two</members>
          <name>CustomMetadata</name>
        </types>
        <types>
          <members>SomeDataType__mdt.SomeField__c</members>
          <name>CustomField</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
  });

  it('should add object translation, record types, LeadConvertSettings if Opportunity.CustomField was changed', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity.SomeField__c</members>
          <name>CustomField</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity.SomeField__c</members>
          <name>CustomField</name>
        </types>
        <types>
          <members>Opportunity-de</members>
          <members>Opportunity-fr</members>
          <name>CustomObjectTranslation</name>
        </types>
        <types>
          <members>Opportunity.Type1</members>
          <members>Opportunity.Type2</members>
          <name>RecordType</name>
        </types>
        <types>
            <members>LeadConvertSettings</members>
            <name>LeadConvertSettings</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
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
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Opportunity-Some layout 1</members>
          <members>Opportunity-Some layout 2</members>
          <name>Layout</name>
        </types>
        <types>
          <members>Opportunity-de</members>
          <members>Opportunity-fr</members>
          <name>CustomObjectTranslation</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
  });

  it('should add object translations to validation rules', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Case.PreventInvalidQuotes</members>
          <name>ValidationRule</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>Case.PreventInvalidQuotes</members>
          <name>ValidationRule</name>
        </types>
        <types>
          <members>Case-de</members>
          <members>Case-fr</members>
          <name>CustomObjectTranslation</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
  });

  it('should add object translations to any object', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>WorkPlan</members>
          <name>CustomObject</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>WorkPlan</members>
          <name>CustomObject</name>
        </types>
        <types>
          <members>WorkPlan-de</members>
          <members>WorkPlan-fr</members>
          <name>CustomObjectTranslation</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
  });

  it('should add all fields when custom metadata record changes', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>SomeDataType.record_one</members>
          <name>CustomMetadata</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>SomeDataType.record_one</members>
          <name>CustomMetadata</name>
        </types>
        <types>
          <members>SomeDataType__mdt.SomeField1__c</members>
          <members>SomeDataType__mdt.SomeField2__c</members>
          <name>CustomField</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
  });

  it('should add global translations to custom labels', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
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

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>SomeLabel</members>
          <name>CustomLabel</name>
        </types>
        <types>
          <members>Global_quick_action</members>
          <name>QuickAction</name>
        </types>
        <types>
          <members>de</members>
          <members>fr</members>
          <name>Translations</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
  });

  it('should add global translations when flow deleted', async () => {

    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
      </Package>`,
      'utf8'
    );

    fs.writeFileSync(
      deltaDestructiveXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
            <members>Flow_to_delete</members>
            <name>Flow</name>
        </types>
        <version>63.0</version>
      </Package>`,
      'utf8'
    );

    const expectedXmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <types>
          <members>de</members>
          <members>fr</members>
          <name>Translations</name>
        </types>
        <version>63.0</version>
      </Package>`;

    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile, deltaDestructiveXmlFile);
    await expectXmlEquals(expectedXmlString, deltaXmlFile);
  });

  it('should not fail when package is empty', async () => {
    fs.writeFileSync(
      deltaXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
      </Package>`,
      'utf8'
    );
    await extendPackageFileWithDependencies(deltaXmlFile, fullXmlFile);
  });
});

