import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import CreateAdminPermset from '../../../../../src/commands/hardis/project/metadata/create-admin-permset.js';

/* eslint-disable @typescript-eslint/no-unused-expressions */

describe('hardis:project:metadata:create-admin-permset', () => {
  const $$ = new TestContext();
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    stubSfCommandUx($$.SANDBOX);
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-admin-permset-'));

    // Setup minimal sfdx project
    await fs.writeJson(path.join(tmpDir, 'sfdx-project.json'), {
      packageDirectories: [{ path: 'force-app', default: true }],
    });
  });

  afterEach(async () => {
    $$.restore();
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  it('generates permission set with default name', async () => {
    // Setup test object with field
    const objectDir = path.join(tmpDir, 'force-app/main/default/objects/TestObject__c/fields');
    await fs.ensureDir(objectDir);
    await fs.writeFile(
      path.join(objectDir, 'TestField__c.field-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>TestField__c</fullName>
  <type>Text</type>
  <length>255</length>
</CustomField>`
    );

    process.chdir(tmpDir);
    const result = await CreateAdminPermset.run([]);

    // Verify file created
    const outFile = path.join(tmpDir, 'force-app/main/default/permissionsets/ObjectRightsModifyAll.permissionset-meta.xml');
    expect(await fs.pathExists(outFile)).to.be.true;

    // Verify structure
    expect(result).to.have.property('PermissionSet');
    expect((result as any).PermissionSet.objectPermissions).to.have.lengthOf(1);
    expect((result as any).PermissionSet.objectPermissions[0].object).to.equal('TestObject__c');
  });

  it('uses custom name from --name flag', async () => {
    const objectDir = path.join(tmpDir, 'force-app/main/default/objects/Account/fields');
    await fs.ensureDir(objectDir);

    process.chdir(tmpDir);
    await CreateAdminPermset.run(['--name', 'CustomAdminPS']);

    const outFile = path.join(tmpDir, 'force-app/main/default/permissionsets/CustomAdminPS.permissionset-meta.xml');
    expect(await fs.pathExists(outFile)).to.be.true;
  });

  it('skips platform events and custom metadata types', async () => {
    await fs.ensureDir(path.join(tmpDir, 'force-app/main/default/objects/MyEvent__e/fields'));
    await fs.ensureDir(path.join(tmpDir, 'force-app/main/default/objects/MySetting__mdt/fields'));
    await fs.ensureDir(path.join(tmpDir, 'force-app/main/default/objects/ValidObject__c/fields'));
    await fs.writeFile(
      path.join(tmpDir, 'force-app/main/default/objects/ValidObject__c/fields/Field__c.field-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Field__c</fullName>
  <type>Text</type>
  <length>255</length>
</CustomField>`
    );

    process.chdir(tmpDir);
    const result = await CreateAdminPermset.run([]);

    const objectNames = (result as any).PermissionSet.objectPermissions.map((o: any) => o.object);
    expect(objectNames).to.include('ValidObject__c');
    expect(objectNames).to.not.include('MyEvent__e');
    expect(objectNames).to.not.include('MySetting__mdt');
  });

  it('marks formula fields as non-editable', async () => {
    const objectDir = path.join(tmpDir, 'force-app/main/default/objects/TestObj__c/fields');
    await fs.ensureDir(objectDir);
    await fs.writeFile(
      path.join(objectDir, 'FormulaField__c.field-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>FormulaField__c</fullName>
  <type>Text</type>
  <formula>Name &amp; " Test"</formula>
</CustomField>`
    );

    process.chdir(tmpDir);
    const result = await CreateAdminPermset.run([]);

    const formulaField = (result as any).PermissionSet.fieldPermissions.find(
      (f: any) => f.field === 'TestObj__c.FormulaField__c'
    );
    expect(formulaField.readable).to.be.true;
    expect(formulaField.editable).to.be.false;
  });

  it('skips MasterDetail fields', async () => {
    const objectDir = path.join(tmpDir, 'force-app/main/default/objects/ChildObj__c/fields');
    await fs.ensureDir(objectDir);
    await fs.writeFile(
      path.join(objectDir, 'ParentRef__c.field-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>ParentRef__c</fullName>
  <type>MasterDetail</type>
  <referenceTo>ParentObj__c</referenceTo>
</CustomField>`
    );
    await fs.writeFile(
      path.join(objectDir, 'RegularField__c.field-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>RegularField__c</fullName>
  <type>Text</type>
  <length>255</length>
</CustomField>`
    );

    process.chdir(tmpDir);
    const result = await CreateAdminPermset.run([]);

    const fieldNames = (result as any).PermissionSet.fieldPermissions.map((f: any) => f.field);
    expect(fieldNames).to.include('ChildObj__c.RegularField__c');
    expect(fieldNames).to.not.include('ChildObj__c.ParentRef__c');
  });

  it('handles missing objects directory gracefully', async () => {
    // No objects directory created
    process.chdir(tmpDir);
    const result = await CreateAdminPermset.run([]);

    expect(result).to.have.property('PermissionSet');
    expect((result as any).PermissionSet.objectPermissions).to.have.lengthOf(0);
    expect((result as any).PermissionSet.fieldPermissions).to.have.lengthOf(0);
  });
});
