// cspell:ignore apexclass
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  buildComponentTypesMarkdown,
  buildDeploymentComponentRows,
  buildNoOverwriteMarkdown,
  finalizeDeploymentComponentsReport,
  getDeploymentComponentsReportState,
  recordDeployResult,
  recordNoOverwriteFiltering,
  resetDeploymentComponentsReport,
} from '../../../src/common/utils/deploymentComponentsReport.js';

const NO_OVERWRITE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>*</members>
    <name>ListView</name>
  </types>
  <types>
    <members>Sales/Discount_Approved</members>
    <name>EmailTemplate</name>
  </types>
  <version>62.0</version>
</Package>
`;

async function writeNoOverwriteFile(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deployment-components-'));
  const file = path.join(tmpDir, 'package-no-overwrite.xml');
  await fs.writeFile(file, NO_OVERWRITE_XML, 'utf8');
  return file;
}

// The deploy results of the approved Pull Request comment sample
const SAMPLE_RESULT = {
  details: {
    componentSuccesses: [
      { componentType: 'ApexClass', fullName: 'OpportunityDiscountService', created: true, changed: true },
      { componentType: 'ApexClass', fullName: 'OpportunityDiscountServiceTest', created: true, changed: true },
      { componentType: 'CustomField', fullName: 'Opportunity.Discount_Rate__c', created: true },
      { componentType: 'CustomField', fullName: 'Opportunity.Discount_Approved__c', created: true },
      { componentType: 'ListView', fullName: 'Opportunity.High_Discount_Deals', created: true },
      { componentType: 'Flow', fullName: 'Opportunity_Discount_Approval', changed: true },
      { componentType: 'FlexiPage', fullName: 'Opportunity_Record_Page', changed: true },
      { componentType: 'Layout', fullName: 'Opportunity-Opportunity Layout', changed: true },
      { componentType: 'PermissionSet', fullName: 'Sales_Discount_Manager', changed: true },
      { componentType: 'CustomField', fullName: 'Opportunity.Legacy_Discount__c', deleted: true },
      { componentType: 'ApexClass', fullName: 'OpportunityHelper' },
      { componentType: 'ApexTrigger', fullName: 'OpportunityTrigger' },
      { componentType: 'CustomObject', fullName: 'Opportunity' },
      { componentType: 'CustomLabel', fullName: 'Discount_Too_High' },
    ],
  },
};

const NOT_OVERWRITTEN_ITEMS = [
  { type: 'ListView', member: 'Opportunity.My_Open_Deals' },
  { type: 'ListView', member: 'Account.Key_Accounts' },
  { type: 'EmailTemplate', member: 'Sales/Discount_Approved' },
];

describe('deploymentComponentsReport', () => {
  beforeEach(() => {
    resetDeploymentComponentsReport();
  });

  it('sorts the rows by status, then by Type and Name', async () => {
    await recordNoOverwriteFiltering(await writeNoOverwriteFile(), NOT_OVERWRITTEN_ITEMS);
    recordDeployResult(SAMPLE_RESULT);
    recordDeployResult({ details: { componentFailures: [{ componentType: 'Flow', fullName: 'Broken_Flow' }] } });
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    expect(rows.map((row) => row.status)).to.deep.equal([
      'Failed',
      'Created', 'Created', 'Created', 'Created', 'Created',
      'Updated', 'Updated', 'Updated', 'Updated',
      'Deleted',
      'Not overwritten', 'Not overwritten', 'Not overwritten',
      'Unchanged', 'Unchanged', 'Unchanged', 'Unchanged',
    ]);
    expect(rows.slice(1, 6).map((row) => `${row.type}:${row.name}`)).to.deep.equal([
      'ApexClass:OpportunityDiscountService',
      'ApexClass:OpportunityDiscountServiceTest',
      'CustomField:Opportunity.Discount_Approved__c',
      'CustomField:Opportunity.Discount_Rate__c',
      'ListView:Opportunity.High_Discount_Deals',
    ]);
  });

  it('marks the components package-no-overwrite.xml protects', async () => {
    await recordNoOverwriteFiltering(await writeNoOverwriteFile(), NOT_OVERWRITTEN_ITEMS);
    recordDeployResult(SAMPLE_RESULT);
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    const protectedRows = rows.filter((row) => row.noOverwriteFile !== '').map((row) => `${row.status}:${row.type}:${row.name}`);
    expect(protectedRows).to.deep.equal([
      'Created:ListView:Opportunity.High_Discount_Deals',
      'Not overwritten:EmailTemplate:Sales/Discount_Approved',
      'Not overwritten:ListView:Account.Key_Accounts',
      'Not overwritten:ListView:Opportunity.My_Open_Deals',
    ]);
    expect(rows.find((row) => row.noOverwriteFile !== '')?.noOverwriteFile).to.equal('package-no-overwrite.xml');
  });

  it('keeps a component failed when another deploy result succeeded with it', () => {
    recordDeployResult({ details: { componentFailures: { componentType: 'Flow', fullName: 'MyFlow' } } });
    recordDeployResult({ details: { componentSuccesses: [{ componentType: 'Flow', fullName: 'MyFlow', changed: true }] } });
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    expect(rows).to.deep.equal([{ type: 'Flow', name: 'MyFlow', status: 'Failed', noOverwriteFile: '' }]);
  });

  it('names a failed component from its file path with the metadata registry', () => {
    recordDeployResult({
      files: [
        { type: '', fullName: '', state: 'Failed', filePath: 'force-app/main/default/objects/Account/fields/Rate__c.field-meta.xml' },
        { type: 'EmailTemplate', fullName: '', state: 'Failed', filePath: 'force-app/main/default/email/Sales/Welcome.email-meta.xml' },
        { type: 'apexclass', fullName: '', state: 'Failed', filePath: 'force-app/main/default/classes/Foo.cls' },
      ],
    });
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    expect(rows.map((row) => `${row.type}:${row.name}`)).to.deep.equal([
      'ApexClass:Foo',
      'CustomField:Account.Rate__c',
      'EmailTemplate:Sales/Welcome',
    ]);
  });

  it('counts the changed components per metadata type, in the conditional wording of a validation', async () => {
    recordDeployResult(SAMPLE_RESULT);
    const markdown = buildComponentTypesMarkdown(buildDeploymentComponentRows(getDeploymentComponentsReportState()), true);
    expect(markdown).to.contain('<summary>📋 <b>10 components would change in the org</b></summary>');
    expect(markdown).to.contain('| Type | ➕ Created | ✏️ Updated | 🗑️ Deleted |');
    expect(markdown).to.contain('| CustomField | 2 |  | 1 |');
    expect(markdown).to.not.contain('Failed');
    expect(markdown).to.not.contain('CustomLabel');
    expect(markdown).to.contain('deployment-components.xlsx');
  });

  it('adds a Failed column first when components failed', () => {
    recordDeployResult(SAMPLE_RESULT);
    recordDeployResult({ details: { componentFailures: [{ componentType: 'Flow', fullName: 'Opportunity_Discount_Approval' }] } });
    const markdown = buildComponentTypesMarkdown(buildDeploymentComponentRows(getDeploymentComponentsReportState()), false);
    expect(markdown).to.contain('<b>1 component failed, 9 changed in the org</b>');
    expect(markdown).to.contain('| Type | ❌ Failed | ➕ Created | ✏️ Updated | 🗑️ Deleted |');
    expect(markdown).to.contain('| Flow | 1 |  |  |  |');
  });

  it('builds no types table when nothing changed or failed', () => {
    recordDeployResult({ details: { componentSuccesses: [{ componentType: 'ApexClass', fullName: 'Foo' }] } });
    expect(buildComponentTypesMarkdown(buildDeploymentComponentRows(getDeploymentComponentsReportState()), true)).to.equal('');
  });

  it('describes the protected components per type, with the doc link', async () => {
    await recordNoOverwriteFiltering(await writeNoOverwriteFile(), NOT_OVERWRITTEN_ITEMS);
    recordDeployResult(SAMPLE_RESULT);
    const state = getDeploymentComponentsReportState();
    const markdown = buildNoOverwriteMarkdown(buildDeploymentComponentRows(state), true, state);
    expect(markdown).to.contain('### 🛡️ Protected metadata (package-no-overwrite.xml)');
    expect(markdown).to.contain('**3 components of this Pull Request already exist in the target org and will not be overwritten**');
    expect(markdown).to.contain('such components are maintained manually in the org');
    expect(markdown).to.contain('**1 protected component does not exist in the target org yet and will be created.**');
    expect(markdown).to.contain('| Type | 🛡️ Not overwritten | ➕ Created this once |');
    // The sentences stay visible, the table per type is collapsed
    expect(markdown.indexOf('**3 components of this Pull Request')).to.be.lessThan(markdown.indexOf('<details>'));
    expect(markdown).to.contain('<summary>🛡️ <b>Protected components per metadata type (2 types)</b></summary>');
    expect(markdown.indexOf('| Type |')).to.be.greaterThan(markdown.indexOf('<details>'));
    expect(markdown.indexOf('| Type |')).to.be.lessThan(markdown.indexOf('</details>'));
    expect(markdown).to.contain('| EmailTemplate | 1 |  |');
    expect(markdown).to.contain('| ListView | 2 | 1 |');
    expect(markdown).to.contain('/salesforce-devops-config-overwrite/');
  });

  it('only shows the not overwritten components after a Quick Deploy, which names no component', async () => {
    await recordNoOverwriteFiltering(await writeNoOverwriteFile(), NOT_OVERWRITTEN_ITEMS);
    recordDeployResult({ numberComponentsDeployed: 12 }, { quickDeploy: true });
    const state = getDeploymentComponentsReportState();
    const rows = buildDeploymentComponentRows(state);
    expect(buildComponentTypesMarkdown(rows, false)).to.equal('');
    const markdown = buildNoOverwriteMarkdown(rows, false, state);
    expect(markdown).to.contain('were not overwritten');
    expect(markdown).to.contain('| Type | 🛡️ Not overwritten |');
    expect(markdown).to.not.contain('Created this once');
  });

  it('keeps the most significant status when several deploy results name the same component', () => {
    recordDeployResult({ details: { componentSuccesses: [{ componentType: 'CustomField', fullName: 'Account.X__c', created: true }] } });
    recordDeployResult({ details: { componentSuccesses: [{ componentType: 'CustomField', fullName: 'Account.X__c' }] } });
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    expect(rows.map((row) => row.status)).to.deep.equal(['Created']);
  });

  it('keeps only the failures of a real deployment that failed, as it was rolled back', () => {
    recordDeployResult(
      {
        details: {
          componentSuccesses: [{ componentType: 'ApexClass', fullName: 'Foo', created: true }],
          componentFailures: [{ componentType: 'ApexClass', fullName: 'Bar', problemType: 'Error' }],
        },
      },
      { failuresOnly: true }
    );
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    expect(rows.map((row) => `${row.status}:${row.name}`)).to.deep.equal(['Failed:Bar']);
    expect(buildComponentTypesMarkdown(rows, false)).to.contain('1 component failed, 0 changed in the org');
  });

  it('does not count warnings as failures', () => {
    recordDeployResult({
      details: {
        componentSuccesses: [{ componentType: 'CustomObjectTranslation', fullName: 'Account-fr', changed: true }],
        componentFailures: [{ componentType: 'CustomObjectTranslation', fullName: 'Account-fr', problemType: 'Warning' }],
      },
    });
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    expect(rows.map((row) => row.status)).to.deep.equal(['Updated']);
  });

  it('writes no types table when one deploy result named no component', async () => {
    recordDeployResult(SAMPLE_RESULT);
    recordDeployResult({ numberComponentsDeployed: 3 }, { quickDeploy: true });
    const report = await finalizeDeploymentComponentsReport(true);
    expect(report.componentTypesMarkdown).to.equal('');
    expect(report.reportFile).to.equal(null);
  });

  it('names every file of a failed bundle after its folder, and counts unnamed failures one by one', () => {
    recordDeployResult({
      files: [
        { type: '', fullName: '', state: 'Failed', filePath: 'force-app/main/default/lwc/myCmp/myCmp.js' },
        { type: '', fullName: '', state: 'Failed', filePath: 'force-app/main/default/lwc/myCmp/myCmp.html' },
        { type: '', fullName: '', state: 'Failed', filePath: 'force-app/main/default/lwc/myCmp/myCmp.js-meta.xml' },
      ],
    });
    recordDeployResult({ details: { componentFailures: [{ componentType: 'Flow' }, { componentType: 'Flow' }] } });
    const rows = buildDeploymentComponentRows(getDeploymentComponentsReportState());
    expect(rows.map((row) => `${row.type}:${row.name}`)).to.deep.equal(['Flow:', 'Flow:', 'LightningComponentBundle:myCmp']);
  });

  it('builds no protected section when package-no-overwrite.xml matched nothing', () => {
    recordDeployResult(SAMPLE_RESULT);
    const state = getDeploymentComponentsReportState();
    expect(buildNoOverwriteMarkdown(buildDeploymentComponentRows(state), true, state)).to.equal('');
  });
});
