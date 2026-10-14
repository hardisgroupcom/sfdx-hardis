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
    accessKind: reference.accessKind,
  }));
}

async function writeProjectFile(root: string, relativePath: string, content: string) {
  const file = path.join(root, relativePath);
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, content);
}

async function buildFixture(root: string) {
  // Visualforce page embedding a custom component, pointing at another page, and at itself
  await writeProjectFile(root, `${METADATA_ROOT}/pages/MyVfPage.page`, `<apex:page standardController="Account" extensions="MyVfPageExtension">
  <c:MyVfComponent recordId="{!Account.Id}" />
  <apex:outputLink value="{!$Page.OtherPage}">Other</apex:outputLink>
  <apex:outputLink value="{!$Page.MyVfPage}">Myself</apex:outputLink>
</apex:page>`);
  await writeProjectFile(root, `${METADATA_ROOT}/pages/MyVfPage.page-meta.xml`, `<ApexPage><label>My VF Page</label></ApexPage>`);
  await writeProjectFile(root, `${METADATA_ROOT}/pages/OtherPage.page`, `<apex:page>Other</apex:page>`);
  await writeProjectFile(root, `${METADATA_ROOT}/pages/OtherPage.page-meta.xml`, `<ApexPage><label>Other Page</label></ApexPage>`);

  await writeProjectFile(root, `${METADATA_ROOT}/components/MyVfComponent.component`, `<apex:component>
  <apex:attribute name="recordId" type="Id" required="true" description="Record" />
</apex:component>`);
  await writeProjectFile(root, `${METADATA_ROOT}/components/MyVfComponent.component-meta.xml`, `<ApexComponent><label>My VF Component</label></ApexComponent>`);

  // Aura bundle extending another one and opening a Visualforce page
  await writeProjectFile(root, `${METADATA_ROOT}/aura/myAuraCmp/myAuraCmp.cmp`, `<aura:component extends="c:baseAuraCmp" implements="flexipage:availableForRecordHome,c:baseAuraCmp" controller="MyAuraController">
  <aura:dependency resource="markup://c:baseAuraCmp" />
</aura:component>`);
  await writeProjectFile(root, `${METADATA_ROOT}/aura/myAuraCmp/myAuraCmp.cmp-meta.xml`, `<AuraDefinitionBundle><description>My Aura Component</description></AuraDefinitionBundle>`);
  await writeProjectFile(root, `${METADATA_ROOT}/aura/myAuraCmp/myAuraCmpController.js`, `({
  openPage: function (component) {
    window.open('/apex/MyVfPage');
  }
})`);
  await writeProjectFile(root, `${METADATA_ROOT}/aura/baseAuraCmp/baseAuraCmp.cmp`, `<aura:component abstract="true" />`);
  await writeProjectFile(root, `${METADATA_ROOT}/aura/baseAuraCmp/baseAuraCmp.cmp-meta.xml`, `<AuraDefinitionBundle><description>Base</description></AuraDefinitionBundle>`);

  // Lightning Web Component opening the same Visualforce page
  await writeProjectFile(root, `${METADATA_ROOT}/lwc/myLwc/myLwc.js`, `import { LightningElement } from 'lwc';
export default class MyLwc extends LightningElement {
  url = '/apex/MyVfPage';
}`);
  await writeProjectFile(root, `${METADATA_ROOT}/lwc/myLwc/myLwc.js-meta.xml`, `<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>`);

  // Tab pointing at both a Visualforce page and an Aura component
  await writeProjectFile(root, `${METADATA_ROOT}/tabs/My_Tab.tab-meta.xml`, `<CustomTab>
  <label>My Tab</label>
  <page>MyVfPage</page>
  <auraComponent>c:myAuraCmp</auraComponent>
</CustomTab>`);

  // Layout embedding the page twice, to check the deduplication
  await writeProjectFile(root, `${METADATA_ROOT}/layouts/Account-MyLayout.layout-meta.xml`, `<Layout>
  <layoutSections>
    <layoutColumns><layoutItems><page>MyVfPage</page></layoutItems></layoutColumns>
    <layoutColumns><layoutItems><page>MyVfPage</page></layoutItems></layoutColumns>
  </layoutSections>
</Layout>`);

  // Page access granted on one profile, revoked on another
  await writeProjectFile(root, `${METADATA_ROOT}/profiles/Admin.profile-meta.xml`, `<Profile>
  <pageAccesses><apexPage>MyVfPage</apexPage><enabled>true</enabled></pageAccesses>
</Profile>`);
  await writeProjectFile(root, `${METADATA_ROOT}/profiles/Standard.profile-meta.xml`, `<Profile>
  <pageAccesses><apexPage>MyVfPage</apexPage><enabled>false</enabled></pageAccesses>
</Profile>`);

  // Action overrides of an object, one Visualforce and one Lightning component
  await writeProjectFile(root, `${METADATA_ROOT}/objects/Account/Account.object-meta.xml`, `<CustomObject>
  <actionOverrides><actionName>View</actionName><type>Visualforce</type><content>MyVfPage</content></actionOverrides>
  <actionOverrides><actionName>Edit</actionName><type>LightningComponent</type><content>c__myAuraCmp</content></actionOverrides>
</CustomObject>`);

  await writeProjectFile(root, `${METADATA_ROOT}/quickActions/Account.Log_Call.quickAction-meta.xml`, `<QuickAction>
  <type>VisualforcePage</type>
  <page>MyVfPage</page>
</QuickAction>`);

  // Apex class opening the Visualforce page, and a trigger that references nothing
  await writeProjectFile(root, `${METADATA_ROOT}/classes/MyVfPageExtension.cls`, `public with sharing class MyVfPageExtension {
  public PageReference open() {
    return Page.MyVfPage;
  }
}`);
  await writeProjectFile(root, `${METADATA_ROOT}/triggers/AccountTrigger.trigger`, `trigger AccountTrigger on Account (before insert) {
  System.debug('nothing to see here');
}`);

  // Flow screen embedding the Lightning Web Component
  await writeProjectFile(root, `${METADATA_ROOT}/flows/My_Screen_Flow.flow-meta.xml`, `<Flow>
  <screens>
    <fields>
      <name>myLwcField</name>
      <extensionName>c:myLwc</extensionName>
      <fieldType>ComponentInstance</fieldType>
    </fields>
    <fields>
      <name>standardField</name>
      <extensionName>flowruntime:image</extensionName>
      <fieldType>ComponentInstance</fieldType>
    </fields>
  </screens>
</Flow>`);

  // Lightning page embedding the Visualforce page, the Aura component and the LWC
  await writeProjectFile(root, `${METADATA_ROOT}/flexipages/Account_Record_Page.flexipage-meta.xml`, `<FlexiPage>
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
    let index: ComponentReferenceIndex;

    before(async () => {
      tmpDir = path.join(os.tmpdir(), `sfdx-hardis-metadata-references-${Date.now()}`);
      await fs.ensureDir(tmpDir);
      await buildFixture(tmpDir);
      index = await buildComponentReferenceIndex([{ path: path.join(tmpDir, PACKAGE_DIR) }], {
        apexPages: ['MyVfPage', 'OtherPage'],
        apexComponents: ['MyVfComponent'],
        auraBundles: ['myAuraCmp', 'baseAuraCmp'],
        lwcBundles: ['myLwc'],
      });
    });

    after(async () => {
      await fs.remove(tmpDir);
    });

    it('collects every holder of a Visualforce page, deduplicated and without self-reference', () => {
      expect(summarize(getComponentReferences(index, 'apexPages', 'MyVfPage'))).to.deep.equal([
        { metadataType: 'ApexClass', name: 'MyVfPageExtension', detail: 'Code reference', docLink: 'apex/MyVfPageExtension.md', accessKind: undefined },
        { metadataType: 'AuraDefinitionBundle', name: 'myAuraCmp', detail: 'Visualforce URL reference', docLink: 'aura/myAuraCmp.md', accessKind: undefined },
        { metadataType: 'CustomObject', name: 'Account', detail: 'Action override: View', docLink: 'objects/Account.md', accessKind: undefined },
        { metadataType: 'CustomTab', name: 'My_Tab', detail: 'Tab target', docLink: undefined, accessKind: undefined },
        { metadataType: 'FlexiPage', name: 'Account_Record_Page', detail: 'Page component', docLink: 'pages/Account_Record_Page.md', accessKind: undefined },
        { metadataType: 'Layout', name: 'Account-MyLayout', detail: 'Layout item', docLink: undefined, accessKind: undefined },
        { metadataType: 'LightningComponentBundle', name: 'myLwc', detail: 'Visualforce URL reference', docLink: 'lwc/myLwc.md', accessKind: undefined },
        { metadataType: 'Profile', name: 'Admin', detail: 'Access enabled', docLink: 'profiles/Admin.md', accessKind: 'enabled' },
        { metadataType: 'Profile', name: 'Standard', detail: 'Access disabled', docLink: 'profiles/Standard.md', accessKind: 'disabled' },
        { metadataType: 'QuickAction', name: 'Account.Log_Call', detail: 'Quick Action target', docLink: undefined, accessKind: undefined },
      ]);
    });

    it('collects the page embedding a Visualforce component', () => {
      expect(summarize(getComponentReferences(index, 'apexComponents', 'MyVfComponent'))).to.deep.equal([
        { metadataType: 'ApexPage', name: 'MyVfPage', detail: 'Markup reference', docLink: 'visualforce/MyVfPage.md', accessKind: undefined },
      ]);
    });

    it('collects the page referenced from another page markup', () => {
      expect(summarize(getComponentReferences(index, 'apexPages', 'OtherPage'))).to.deep.equal([
        { metadataType: 'ApexPage', name: 'MyVfPage', detail: 'Code reference', docLink: 'visualforce/MyVfPage.md', accessKind: undefined },
      ]);
    });

    it('resolves a c: reference to an Aura bundle when a bundle of that name exists', () => {
      expect(summarize(getComponentReferences(index, 'auraBundles', 'myAuraCmp'))).to.deep.equal([
        { metadataType: 'CustomObject', name: 'Account', detail: 'Action override: Edit', docLink: 'objects/Account.md', accessKind: undefined },
        { metadataType: 'CustomTab', name: 'My_Tab', detail: 'Tab target', docLink: undefined, accessKind: undefined },
        { metadataType: 'FlexiPage', name: 'Account_Record_Page', detail: 'Page component', docLink: 'pages/Account_Record_Page.md', accessKind: undefined },
      ]);
    });

    it('resolves a c: reference to a Lightning Web Component when no Aura bundle matches', () => {
      expect(summarize(getComponentReferences(index, 'lwcBundles', 'myLwc'))).to.deep.equal([
        { metadataType: 'FlexiPage', name: 'Account_Record_Page', detail: 'Page component', docLink: 'pages/Account_Record_Page.md', accessKind: undefined },
        { metadataType: 'Flow', name: 'My_Screen_Flow', detail: 'Flow screen component', docLink: 'flows/My_Screen_Flow.md', accessKind: undefined },
      ]);
    });

    it('reports the Aura bundle extending another one', () => {
      expect(summarize(getComponentReferences(index, 'auraBundles', 'baseAuraCmp'))).to.deep.equal([
        { metadataType: 'AuraDefinitionBundle', name: 'myAuraCmp', detail: 'Extended by', docLink: 'aura/myAuraCmp.md', accessKind: undefined },
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
          { metadataType: 'Profile', name: 'Admin', detail: 'Access enabled', docLink: 'profiles/Admin.md', accessKind: 'enabled' },
          { metadataType: 'Profile', name: 'Standard', detail: 'Access disabled', docLink: 'profiles/Standard.md', accessKind: 'disabled' },
          { metadataType: 'Profile', name: 'ReadOnly', detail: 'Access disabled', docLink: 'profiles/ReadOnly.md', accessKind: 'disabled' },
        ],
        '../'
      );
      expect(lines.join('\n')).to.include('| Profile | [Admin](../profiles/Admin.md) | Access enabled |');
      expect(lines.join('\n')).to.not.include('Standard');
      expect(lines.join('\n')).to.include('2 profile or permission set entries with access disabled are not listed.');
    });

    it('summarizes the granted access rows when they would flood the table, keeping the structural ones', () => {
      const grantedAccesses = Array.from({ length: 11 }, (unused, position) => ({
        metadataType: 'Profile',
        name: `Profile_${position}`,
        detail: 'Access enabled',
        docLink: `profiles/Profile_${position}.md`,
        accessKind: 'enabled' as const,
      }));
      const lines = buildReferencesTable(
        [{ metadataType: 'CustomTab', name: 'My_Tab', detail: 'Tab target' }, ...grantedAccesses],
        '../'
      );
      expect(lines.join('\n')).to.include('| CustomTab | My_Tab | Tab target |');
      expect(lines.join('\n')).to.not.include('Profile_0');
      expect(lines.join('\n')).to.include('11 profile or permission set entries with access enabled are not listed.');
    });

    it('keeps the granted access rows below the structural ones while they stay readable', () => {
      const lines = buildReferencesTable(
        [
          { metadataType: 'Profile', name: 'Admin', detail: 'Access enabled', docLink: 'profiles/Admin.md', accessKind: 'enabled' },
          { metadataType: 'CustomTab', name: 'My_Tab', detail: 'Tab target' },
        ],
        '../'
      );
      const rows = lines.filter(line => line.startsWith('| ') && !line.startsWith('| :') && !line.startsWith('| Metadata'));
      expect(rows).to.deep.equal([
        '| CustomTab | My_Tab | Tab target |',
        '| Profile | [Admin](../profiles/Admin.md) | Access enabled |',
      ]);
    });
  });

  describe('extractVisualforceDependencies()', () => {
    it('lists components, pages, static resources and labels without duplicates or self-references', () => {
      const markup = `<apex:page>
  <c:PersonalRecord />
  <c:PersonalRecord />
  <apex:include pageName="OtherPage" />
  <apex:outputLink value="{!$Page.OtherPage}" />
  <apex:stylesheet value="{!$Resource.SiteStyles}" />
  <apex:outputText value="{!$Label.site.register}" />
  <apex:outputLink value="{!$Page.MySelf}" />
</apex:page>`;
      expect(extractVisualforceDependencies(markup, 'MySelf')).to.deep.equal([
        { kind: 'apexComponents', name: 'PersonalRecord', docLink: 'visualforce/PersonalRecord-component.md' },
        { kind: 'apexPages', name: 'OtherPage', docLink: 'visualforce/OtherPage.md' },
        { kind: 'staticResources', name: 'SiteStyles' },
        { kind: 'customLabels', name: 'site.register' },
      ]);
    });
  });

  describe('buildUsesTable()', () => {
    it('builds a linked Uses table', () => {
      const lines = buildUsesTable(
        [
          { kind: 'apexComponents', name: 'PersonalRecord', docLink: 'visualforce/PersonalRecord-component.md' },
          { kind: 'staticResources', name: 'SiteStyles' },
        ],
        '../'
      );
      expect(lines).to.deep.equal([
        '## Uses',
        '',
        '| Type | Name |',
        '| :--: | :---- |',
        '| Visualforce Component | [PersonalRecord](../visualforce/PersonalRecord-component.md) |',
        '| Static Resource | SiteStyles |',
        '',
      ]);
    });
  });
});
