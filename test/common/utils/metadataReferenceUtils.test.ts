import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import {
  buildComponentReferenceIndex,
  buildReferencesTable,
  buildUsesTable,
  ComponentReferenceIndex,
  extractVisualforceDependencies,
  getComponentReferences,
} from '../../../src/common/utils/metadataReferenceUtils.js';

const PACKAGE_DIR = 'force-app';
const METADATA_ROOT = `${PACKAGE_DIR}/main/default`;

/** Shape used in the assertions, so a failure shows the whole reference and not only one field */
function summarize(references: any[]) {
  return references.map((reference) => ({
    metadataType: reference.metadataType,
    name: reference.name,
    detail: reference.detail,
    docLink: reference.docLink,
  }));
}

async function writeProjectFile(relativePath: string, content: string) {
  await fs.ensureDir(path.dirname(relativePath));
  await fs.writeFile(relativePath, content);
}

async function buildFixture() {
  // Visualforce page embedding a custom component, pointing at another page, and at itself
  await writeProjectFile(`${METADATA_ROOT}/pages/MyVfPage.page`, `<apex:page standardController="Account" extensions="MyVfPageExtension">
  <c:MyVfComponent recordId="{!Account.Id}" />
  <apex:outputLink value="{!$Page.OtherPage}">Other</apex:outputLink>
  <apex:outputLink value="{!$Page.MyVfPage}">Myself</apex:outputLink>
</apex:page>`);
  await writeProjectFile(`${METADATA_ROOT}/pages/MyVfPage.page-meta.xml`, `<ApexPage><label>My VF Page</label></ApexPage>`);
  await writeProjectFile(`${METADATA_ROOT}/pages/OtherPage.page`, `<apex:page>Other</apex:page>`);
  await writeProjectFile(`${METADATA_ROOT}/pages/OtherPage.page-meta.xml`, `<ApexPage><label>Other Page</label></ApexPage>`);

  await writeProjectFile(`${METADATA_ROOT}/components/MyVfComponent.component`, `<apex:component>
  <apex:attribute name="recordId" type="Id" required="true" description="Record" />
</apex:component>`);
  await writeProjectFile(`${METADATA_ROOT}/components/MyVfComponent.component-meta.xml`, `<ApexComponent><label>My VF Component</label></ApexComponent>`);

  // Aura bundle extending another one and opening a Visualforce page
  await writeProjectFile(`${METADATA_ROOT}/aura/myAuraCmp/myAuraCmp.cmp`, `<aura:component extends="c:baseAuraCmp" implements="flexipage:availableForRecordHome,c:baseAuraCmp" controller="MyAuraController">
  <aura:dependency resource="markup://c:baseAuraCmp" />
</aura:component>`);
  await writeProjectFile(`${METADATA_ROOT}/aura/myAuraCmp/myAuraCmp.cmp-meta.xml`, `<AuraDefinitionBundle><description>My Aura Component</description></AuraDefinitionBundle>`);
  await writeProjectFile(`${METADATA_ROOT}/aura/myAuraCmp/myAuraCmpController.js`, `({
  openPage: function (component) {
    window.open('/apex/MyVfPage');
  }
})`);
  await writeProjectFile(`${METADATA_ROOT}/aura/baseAuraCmp/baseAuraCmp.cmp`, `<aura:component abstract="true" />`);
  await writeProjectFile(`${METADATA_ROOT}/aura/baseAuraCmp/baseAuraCmp.cmp-meta.xml`, `<AuraDefinitionBundle><description>Base</description></AuraDefinitionBundle>`);

  // Lightning Web Component opening the same Visualforce page
  await writeProjectFile(`${METADATA_ROOT}/lwc/myLwc/myLwc.js`, `import { LightningElement } from 'lwc';
export default class MyLwc extends LightningElement {
  url = '/apex/MyVfPage';
}`);
  await writeProjectFile(`${METADATA_ROOT}/lwc/myLwc/myLwc.js-meta.xml`, `<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>`);

  // Tab pointing at both a Visualforce page and an Aura component
  await writeProjectFile(`${METADATA_ROOT}/tabs/My_Tab.tab-meta.xml`, `<CustomTab>
  <label>My Tab</label>
  <page>MyVfPage</page>
  <auraComponent>c:myAuraCmp</auraComponent>
</CustomTab>`);

  // Layout embedding the page twice, to check the deduplication
  await writeProjectFile(`${METADATA_ROOT}/layouts/Account-MyLayout.layout-meta.xml`, `<Layout>
  <layoutSections>
    <layoutColumns><layoutItems><page>MyVfPage</page></layoutItems></layoutColumns>
    <layoutColumns><layoutItems><page>MyVfPage</page></layoutItems></layoutColumns>
  </layoutSections>
</Layout>`);

  // Page access granted on one profile, revoked on another
  await writeProjectFile(`${METADATA_ROOT}/profiles/Admin.profile-meta.xml`, `<Profile>
  <pageAccesses><apexPage>MyVfPage</apexPage><enabled>true</enabled></pageAccesses>
</Profile>`);
  await writeProjectFile(`${METADATA_ROOT}/profiles/Standard.profile-meta.xml`, `<Profile>
  <pageAccesses><apexPage>MyVfPage</apexPage><enabled>false</enabled></pageAccesses>
</Profile>`);

  // Action overrides of an object, one Visualforce and one Lightning component
  await writeProjectFile(`${METADATA_ROOT}/objects/Account/Account.object-meta.xml`, `<CustomObject>
  <actionOverrides><actionName>View</actionName><type>Visualforce</type><content>MyVfPage</content></actionOverrides>
  <actionOverrides><actionName>Edit</actionName><type>LightningComponent</type><content>c__myAuraCmp</content></actionOverrides>
</CustomObject>`);

  await writeProjectFile(`${METADATA_ROOT}/quickActions/Account.Log_Call.quickAction-meta.xml`, `<QuickAction>
  <type>VisualforcePage</type>
  <page>MyVfPage</page>
</QuickAction>`);

  // Lightning page embedding the Visualforce page, the Aura component and the LWC
  await writeProjectFile(`${METADATA_ROOT}/flexipages/Account_Record_Page.flexipage-meta.xml`, `<FlexiPage>
  <flexiPageRegions>
    <itemInstances>
      <componentInstance>
        <componentName>flexipage:visualforcePage</componentName>
        <componentInstanceProperties><name>pageName</name><value>MyVfPage</value></componentInstanceProperties>
      </componentInstance>
    </itemInstances>
    <itemInstances>
      <componentInstance><componentName>c:myAuraCmp</componentName></componentInstance>
    </itemInstances>
    <itemInstances>
      <componentInstance><componentName>c:myLwc</componentName></componentInstance>
    </itemInstances>
  </flexiPageRegions>
</FlexiPage>`);
}

describe('metadataReferenceUtils', () => {
  describe('buildComponentReferenceIndex()', () => {
    let tmpDir: string;
    let previousCwd: string;
    let index: ComponentReferenceIndex;

    before(async () => {
      previousCwd = process.cwd();
      tmpDir = path.join(os.tmpdir(), `sfdx-hardis-metadata-references-${Date.now()}`);
      await fs.ensureDir(tmpDir);
      process.chdir(tmpDir);
      await buildFixture();
      // Optimistic links: docs for Visualforce/Aura/profiles may be written later in the same run
      await writeProjectFile('docs/objects/Account.md', '# Account');
      index = await buildComponentReferenceIndex([{ path: PACKAGE_DIR }], {
        apexPages: ['MyVfPage', 'OtherPage'],
        apexComponents: ['MyVfComponent'],
        auraBundles: ['myAuraCmp', 'baseAuraCmp'],
        lwcBundles: ['myLwc'],
      });
    });

    after(async () => {
      process.chdir(previousCwd);
      await fs.remove(tmpDir);
    });

    it('collects every holder of a Visualforce page, deduplicated and without self-reference', () => {
      expect(summarize(getComponentReferences(index, 'apexPages', 'MyVfPage'))).to.deep.equal([
        { metadataType: 'AuraDefinitionBundle', name: 'myAuraCmp', detail: 'Visualforce URL reference', docLink: 'aura/myAuraCmp.md' },
        { metadataType: 'CustomObject', name: 'Account', detail: 'Action override: View', docLink: 'objects/Account.md' },
        { metadataType: 'CustomTab', name: 'My_Tab', detail: 'Tab target', docLink: undefined },
        { metadataType: 'FlexiPage', name: 'Account_Record_Page', detail: 'Page component', docLink: 'pages/Account_Record_Page.md' },
        { metadataType: 'Layout', name: 'Account-MyLayout', detail: 'Layout item', docLink: undefined },
        { metadataType: 'LightningComponentBundle', name: 'myLwc', detail: 'Visualforce URL reference', docLink: 'lwc/myLwc.md' },
        { metadataType: 'Profile', name: 'Admin', detail: 'Access enabled', docLink: 'profiles/Admin.md' },
        { metadataType: 'Profile', name: 'Standard', detail: 'Access disabled', docLink: 'profiles/Standard.md' },
        { metadataType: 'QuickAction', name: 'Account.Log_Call', detail: 'Quick Action target', docLink: undefined },
      ]);
    });

    it('collects the page embedding a Visualforce component', () => {
      expect(summarize(getComponentReferences(index, 'apexComponents', 'MyVfComponent'))).to.deep.equal([
        { metadataType: 'ApexPage', name: 'MyVfPage', detail: 'Markup reference', docLink: 'visualforce/MyVfPage.md' },
      ]);
    });

    it('collects the page referenced from another page markup', () => {
      expect(summarize(getComponentReferences(index, 'apexPages', 'OtherPage'))).to.deep.equal([
        { metadataType: 'ApexPage', name: 'MyVfPage', detail: 'Code reference', docLink: 'visualforce/MyVfPage.md' },
      ]);
    });

    it('resolves a c: reference to an Aura bundle when a bundle of that name exists', () => {
      expect(summarize(getComponentReferences(index, 'auraBundles', 'myAuraCmp'))).to.deep.equal([
        { metadataType: 'CustomObject', name: 'Account', detail: 'Action override: Edit', docLink: 'objects/Account.md' },
        { metadataType: 'CustomTab', name: 'My_Tab', detail: 'Tab target', docLink: undefined },
        { metadataType: 'FlexiPage', name: 'Account_Record_Page', detail: 'Page component', docLink: 'pages/Account_Record_Page.md' },
      ]);
    });

    it('resolves a c: reference to a Lightning Web Component when no Aura bundle matches', () => {
      expect(summarize(getComponentReferences(index, 'lwcBundles', 'myLwc'))).to.deep.equal([
        { metadataType: 'FlexiPage', name: 'Account_Record_Page', detail: 'Page component', docLink: 'pages/Account_Record_Page.md' },
      ]);
    });

    it('reports the Aura bundle extending another one', () => {
      expect(summarize(getComponentReferences(index, 'auraBundles', 'baseAuraCmp'))).to.deep.equal([
        { metadataType: 'AuraDefinitionBundle', name: 'myAuraCmp', detail: 'Extended by', docLink: 'aura/myAuraCmp.md' },
      ]);
    });

    it('returns nothing for a component that is not referenced', () => {
      expect(getComponentReferences(index, 'apexComponents', 'UnknownComponent')).to.deep.equal([]);
    });
  });

  describe('buildComponentReferenceIndex() without known components', () => {
    it('returns an empty index without scanning anything', async () => {
      const index = await buildComponentReferenceIndex([{ path: 'force-app' }], {
        apexPages: [],
        apexComponents: [],
        auraBundles: [],
        lwcBundles: [],
      });
      expect(index).to.deep.equal({ apexPages: {}, apexComponents: {}, auraBundles: {}, lwcBundles: {} });
    });
  });

  describe('buildReferencesTable()', () => {
    it('states that nothing references the component when the list is empty', () => {
      const lines = buildReferencesTable([], '../');
      expect(lines[0]).to.equal('## Where Used');
      expect(lines).to.include('No reference to this component found in the project metadata.');
      expect(lines.join('\n')).to.not.include('| Metadata Type |');
    });

    it('builds a table and links the holders having their own documentation', () => {
      const lines = buildReferencesTable(
        [
          { metadataType: 'CustomObject', name: 'Account', detail: 'Action override: View', docLink: 'objects/Account.md' },
          { metadataType: 'CustomTab', name: 'My_Tab', detail: 'Tab target' },
        ],
        '../'
      );
      expect(lines).to.deep.equal([
        '## Where Used',
        '',
        '| Metadata Type | Name | Detail |',
        '| :-------- | :---- | :---------- |',
        '| CustomObject | [Account](../objects/Account.md) | Action override: View |',
        '| CustomTab | My_Tab | Tab target |',
        '',
      ]);
    });

    it('omits access-disabled profile rows and keeps a count note', () => {
      const lines = buildReferencesTable(
        [
          { metadataType: 'Profile', name: 'Admin', detail: 'Access enabled', docLink: 'profiles/Admin.md' },
          { metadataType: 'Profile', name: 'Standard', detail: 'Access disabled', docLink: 'profiles/Standard.md' },
          { metadataType: 'Profile', name: 'ReadOnly', detail: 'Access disabled', docLink: 'profiles/ReadOnly.md' },
        ],
        '../'
      );
      expect(lines.join('\n')).to.include('| Profile | [Admin](../profiles/Admin.md) | Access enabled |');
      expect(lines.join('\n')).to.not.include('Standard');
      expect(lines.join('\n')).to.include('2 profile or permission set entries with access disabled are not listed.');
    });
  });

  describe('extractVisualforceDependencies()', () => {
    it('lists components, pages, static resources and labels without duplicates or self-references', () => {
      const markup = `<apex:page>
  <c:PersonalRecord />
  <c:PersonalRecord />
  <apex:include pageName="OtherPage" />
  <apex:outputLink value="{!$Page.OtherPage}" />
  <apex:stylesheet value="{!$Resource.mentoresd}" />
  <apex:outputText value="{!$Label.site.register}" />
  <apex:outputLink value="{!$Page.MySelf}" />
</apex:page>`;
      expect(extractVisualforceDependencies(markup, 'MySelf')).to.deep.equal([
        { kind: 'apexComponents', name: 'PersonalRecord', docLink: 'visualforce/PersonalRecord-component.md' },
        { kind: 'apexPages', name: 'OtherPage', docLink: 'visualforce/OtherPage.md' },
        { kind: 'staticResources', name: 'mentoresd' },
        { kind: 'customLabels', name: 'site.register' },
      ]);
    });
  });

  describe('buildUsesTable()', () => {
    it('builds a linked Uses table', () => {
      const lines = buildUsesTable(
        [
          { kind: 'apexComponents', name: 'PersonalRecord', docLink: 'visualforce/PersonalRecord-component.md' },
          { kind: 'staticResources', name: 'mentoresd' },
        ],
        '../'
      );
      expect(lines).to.deep.equal([
        '## Uses',
        '',
        '| Type | Name |',
        '| :--: | :---- |',
        '| Visualforce Component | [PersonalRecord](../visualforce/PersonalRecord-component.md) |',
        '| Static Resource | mentoresd |',
        '',
      ]);
    });
  });
});
