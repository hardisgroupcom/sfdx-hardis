import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findPicklistValueByLabel } from '../../../src/common/utils/picklistSourceUtils.js';

const FIELD_INLINE = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Features__c</fullName>
    <type>Picklist</type>
    <valueSet>
        <valueSetDefinition>
            <value><fullName>Satnav</fullName><default>false</default><label>Navigation</label></value>
            <value><fullName>Rear%2C_camera</fullName><default>false</default><label>Rear &amp; camera</label></value>
        </valueSetDefinition>
    </valueSet>
</CustomField>`;

const FIELD_GLOBAL = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Region__c</fullName>
    <type>Picklist</type>
    <valueSet><valueSetName>Regions</valueSetName></valueSet>
</CustomField>`;

const GLOBAL_VALUE_SET = `<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue><fullName>EMEA_Region</fullName><default>false</default><label>EMEA</label></customValue>
    <masterLabel>Regions</masterLabel>
</GlobalValueSet>`;

const STANDARD_VALUE_SET = `<?xml version="1.0" encoding="UTF-8"?>
<StandardValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <standardValue><fullName>Partner_Referral</fullName><default>false</default><label>Partner Referral</label></standardValue>
    <standardValue><fullName>Web</fullName><default>false</default></standardValue>
</StandardValueSet>`;

describe('Picklist values in the local sources', () => {
  let projectDir: string;

  before(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-hardis-picklists-'));
    fs.writeFileSync(path.join(projectDir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
    const files: Record<string, string> = {
      'force-app/main/default/objects/Vehicle__c/fields/Features__c.field-meta.xml': FIELD_INLINE,
      'force-app/main/default/objects/Account/fields/Region__c.field-meta.xml': FIELD_GLOBAL,
      'force-app/main/default/globalValueSets/Regions.globalValueSet-meta.xml': GLOBAL_VALUE_SET,
      'force-app/main/default/standardValueSets/LeadSource.standardValueSet-meta.xml': STANDARD_VALUE_SET,
    };
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(projectDir, file)), { recursive: true });
      fs.writeFileSync(path.join(projectDir, file), content);
    }
  });

  after(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('Finds the value of a field by its label, with its API name decoded', async () => {
    const found = await findPicklistValueByLabel('Vehicle__c.Features__c', 'Navigation', projectDir);
    expect(found).to.deep.include({ metadataType: 'CustomField', metadataFullName: 'Vehicle__c.Features__c', apiName: 'Satnav', label: 'Navigation' });
    const encoded = await findPicklistValueByLabel('Vehicle__c.Features__c', 'Rear & camera', projectDir);
    expect(encoded?.apiName).to.equal('Rear,_camera');
  });

  it('Follows a field to the global value set that holds its values', async () => {
    const found = await findPicklistValueByLabel('Account.Region__c', 'EMEA', projectDir);
    expect(found).to.deep.include({ metadataType: 'GlobalValueSet', metadataFullName: 'Regions', apiName: 'EMEA_Region' });
    expect((await findPicklistValueByLabel('Regions', 'EMEA', projectDir))?.metadataType).to.equal('GlobalValueSet');
  });

  it('Finds the value of a standard value set, a value without label being labelled by its API name', async () => {
    expect(await findPicklistValueByLabel('LeadSource', 'Partner Referral', projectDir)).to.deep.include({
      metadataType: 'StandardValueSet',
      apiName: 'Partner_Referral',
    });
    expect((await findPicklistValueByLabel('LeadSource', 'Web', projectDir))?.apiName).to.equal('Web');
  });

  it('Returns null when the sources do not have the value', async () => {
    expect(await findPicklistValueByLabel('Vehicle__c.Features__c', 'Sunroof', projectDir)).to.equal(null);
    expect(await findPicklistValueByLabel('Vehicle__c.Missing__c', 'Navigation', projectDir)).to.equal(null);
    expect(await findPicklistValueByLabel('Industry', 'Banking', projectDir)).to.equal(null);
    expect(await findPicklistValueByLabel('', 'Navigation', projectDir)).to.equal(null);
  });
});
