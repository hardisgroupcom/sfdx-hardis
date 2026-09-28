import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { clearOrgApiCache } from '../../../src/common/cache/orgApiCache.js';
import {
  buildCustomFieldLookupSoql,
  buildLookupSoql,
  buildSetupPath,
  buildUsedBySoql,
  customFieldDeveloperName,
  enrichUsedByRows,
  findLocalFiles,
  isMetadataType,
  isStandardObjectName,
  lookupListedComponent,
  isSalesforceId,
  mapUsedByRows,
  parseCustomFieldName,
  parseCustomObjectName,
  sanitizeFsName,
  soqlString,
  stripCustomSuffix,
} from '../../../src/common/utils/metadataDepsUtils.js';

describe('metadataDepsUtils', () => {
  describe('lookup SOQL', () => {
    it('uses Name for Apex metadata', () => {
      const query = buildLookupSoql('ApexClass', "My'Class");
      expect(query).to.equal("SELECT Id, Name FROM ApexClass WHERE Name = 'My\\'Class'");
    });

    for (const type of [
      'AuraDefinitionBundle',
      'LightningComponentBundle',
      'FlexiPage',
      'CustomPermission',
    ]) {
      it(`uses DeveloperName for ${type}`, () => {
        const query = buildLookupSoql(type, 'MyComponent');
        expect(query).to.contain(`FROM ${type} WHERE DeveloperName = 'MyComponent'`);
        expect(query).not.to.contain('WHERE Name');
      });
    }

    it('resolves Flow through FlowDefinition, not the Flow version DeveloperName', () => {
      const query = buildLookupSoql('Flow', 'MyFlow');
      expect(query).to.contain("FROM FlowDefinition WHERE DeveloperName = 'MyFlow'");
      expect(query).to.contain('ActiveVersionId');
      expect(query).to.contain('LatestVersionId');
    });

    it('strips the custom suffix for CustomObject', () => {
      expect(stripCustomSuffix('MyObject__c')).to.equal('MyObject');
      expect(stripCustomSuffix('MyType__mdt')).to.equal('MyType');
      expect(stripCustomSuffix('MyEvent__e')).to.equal('MyEvent');
      expect(buildLookupSoql('CustomObject', 'MyObject__c')).to.contain("DeveloperName = 'MyObject'");
      expect(buildLookupSoql('CustomObject', 'MyType__mdt')).to.contain("DeveloperName = 'MyType'");
    });

    it('filters CustomObject on NamespacePrefix when the name is namespaced', () => {
      expect(parseCustomObjectName('ns__Obj__c')).to.deep.equal({ namespace: 'ns', developerName: 'Obj' });
      expect(parseCustomObjectName('Obj__c')).to.deep.equal({ developerName: 'Obj' });
      const query = buildLookupSoql('CustomObject', 'ns__Obj__c');
      expect(query).to.contain("DeveloperName = 'Obj'");
      expect(query).to.contain("NamespacePrefix = 'ns'");
    });

    it('escapes SOQL backslashes and quotes', () => {
      expect(soqlString("A\\B'C")).to.equal("'A\\\\B\\'C'");
    });
  });

  describe('Metadata API lookup', () => {
    // Fake connection: records the listMetadata queries and returns the given components
    const fakeConnection = (components: unknown, queries: unknown[] = []) =>
      ({
        getApiVersion: () => '65.0',
        metadata: {
          list: async (query: unknown) => {
            queries.push(query);
            if (components instanceof Error) {
              throw components;
            }
            return components;
          },
        },
      }) as any;

    it('returns the Id of the component with this API name', async () => {
      const connection = fakeConnection([
        { fullName: 'Account.Other__c', id: '00N000000000001' },
        { fullName: 'Account.Status__c', id: '00N000000000002' },
      ]);
      expect(await lookupListedComponent(connection, 'CustomField', 'Account.Status__c')).to.deep.equal({
        id: '00N000000000002',
        fromCache: false,
      });
    });

    it('matches URL-encoded names such as layouts', async () => {
      const connection = fakeConnection({ fullName: 'Account-Account %28Sales%29 Layout', id: '00h000000000001' });
      expect(await lookupListedComponent(connection, 'Layout', 'Account-Account (Sales) Layout')).to.deep.equal({
        id: '00h000000000001',
        fromCache: false,
      });
      expect(await lookupListedComponent(connection, 'Layout', 'Account-Account %28Sales%29 Layout')).to.deep.equal({
        id: '00h000000000001',
        fromCache: false,
      });
    });

    it('lists folder types in the folder of the name', async () => {
      const queries: unknown[] = [];
      const connection = fakeConnection([{ fullName: 'Sales/MyReport', id: '00O000000000001' }], queries);
      expect(await lookupListedComponent(connection, 'Report', 'Sales/MyReport')).to.deep.equal({
        id: '00O000000000001',
        fromCache: false,
      });
      expect(queries[0]).to.deep.equal([{ type: 'Report', folder: 'Sales' }]);
    });

    describe('with the org API cache', () => {
      const previousEnv = { ...process.env };
      let root: string;
      // Same fake connection, on an org with an Id so that the cache applies
      const cachedConnection = (components: unknown[], queries: unknown[]) =>
        ({ ...fakeConnection(components, queries), getAuthInfoFields: () => ({ orgId: '00DCACHE' }) }) as any;

      beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-deps-cache-'));
        process.env.SFDX_HARDIS_ORG_API_CACHE_DIR = root;
        delete process.env.NO_CACHE;
        await clearOrgApiCache();
      });

      afterEach(async () => {
        process.env = { ...previousEnv };
        await fs.remove(root);
      });

      it('serves a second lookup from the cache, and lists again when the name is missing', async () => {
        const queries: unknown[] = [];
        const components = [{ fullName: 'MyClass', id: '01p000000000001' }];
        const connection = cachedConnection(components, queries);
        expect(await lookupListedComponent(connection, 'ApexClass', 'MyClass')).to.deep.equal({
          id: '01p000000000001',
          fromCache: false,
        });
        expect(await lookupListedComponent(connection, 'ApexClass', 'MyClass')).to.deep.equal({
          id: '01p000000000001',
          fromCache: true,
        });
        expect(queries).to.have.length(1);
        // Deployed after the list was cached
        components.push({ fullName: 'NewClass', id: '01p000000000002' });
        expect(await lookupListedComponent(connection, 'ApexClass', 'NewClass')).to.deep.equal({
          id: '01p000000000002',
          fromCache: false,
        });
        expect(queries).to.have.length(2);
      });

      it('never caches Flow, whose Id changes when another version is activated', async () => {
        const queries: unknown[] = [];
        const connection = cachedConnection([{ fullName: 'MyFlow', id: '301000000000001' }], queries);
        await lookupListedComponent(connection, 'Flow', 'MyFlow');
        expect((await lookupListedComponent(connection, 'Flow', 'MyFlow'))?.fromCache).to.equal(false);
        expect(queries).to.have.length(2);
      });
    });

    it('returns an empty Id for a standard object, and null when nothing matches or the type cannot be listed', async () => {
      expect(await lookupListedComponent(fakeConnection([{ fullName: 'Account', id: '' }]), 'CustomObject', 'Account')).to.deep.equal({
        id: '',
        fromCache: false,
      });
      expect(await lookupListedComponent(fakeConnection([]), 'ApexClass', 'Missing')).to.equal(null);
      expect(await lookupListedComponent(fakeConnection(new Error('INVALID_TYPE')), 'StandardEntity', 'Account')).to.equal(null);
    });
  });

  describe('dependent rows for the VS Code panel', () => {
    const row = (usedById: string, usedByType: string, usedByName: string) => ({
      usedById,
      usedByName,
      usedByType,
      targetId: '01Ixx0000000001AAA',
      targetName: 'Installation',
      targetType: 'CustomObject',
      usedByApiName: '',
      usedBySetupPath: '',
      usedByLocalFile: '',
    });

    it('builds the Setup path of a component', () => {
      expect(buildSetupPath('ApexClass', '01p000000000001AAA')).to.equal('/01p000000000001AAA');
      expect(buildSetupPath('Flow', '301000000000001AAA')).to.equal(
        '/builder_platform_interaction/flowBuilder.app?flowId=301000000000001AAA'
      );
      expect(buildSetupPath('LightningComponentBundle', '0Rb000000000001AAA')).to.equal(
        '/lightning/setup/LightningComponentBundles/home'
      );
      expect(buildSetupPath('AuraDefinitionBundle', '0Ab000000000001AAA')).to.equal(
        '/lightning/setup/LightningComponents/home'
      );
    });

    it('adds the Metadata API name matched on the Id, with one listing per type', async () => {
      const queries: any[] = [];
      const listings: Record<string, unknown> = {
        Layout: [{ fullName: 'Account-Account Layout', id: '00h000000000001AAA' }],
        CustomField: [{ fullName: 'Installation__c.Crew_Workload__c', id: '00N000000000001AAA' }],
      };
      const connection = {
        getApiVersion: () => '65.0',
        metadata: {
          list: async (query: any[]) => {
            queries.push(query);
            const listing = listings[query[0].type];
            if (!listing) {
              throw new Error('INVALID_TYPE');
            }
            return listing;
          },
        },
      } as any;
      const rows = await enrichUsedByRows(connection, [
        row('00h000000000001AAA', 'Layout', 'Account Layout'),
        row('00N000000000001', 'CustomField', 'Crew_Workload'),
        row('00N000000000002AAA', 'CustomField', 'Other'),
        row('08e000000000001AAA', 'CronTrigger', '08e000000000001AAA'),
      ]);
      expect(rows.map((r) => r.usedByApiName)).to.deep.equal([
        'Account-Account Layout',
        'Installation__c.Crew_Workload__c',
        '',
        '',
      ]);
      expect(rows[0].usedBySetupPath).to.equal('/00h000000000001AAA');
      expect(queries.map((query) => query[0].type)).to.have.members(['Layout', 'CustomField', 'CronTrigger']);
    });

    it('lists a type again when a dependent is missing from the cached listing', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-deps-enrich-'));
      const previousDir = process.env.SFDX_HARDIS_ORG_API_CACHE_DIR;
      process.env.SFDX_HARDIS_ORG_API_CACHE_DIR = root;
      await clearOrgApiCache();
      try {
        const listing = [{ fullName: 'OldClass', id: '01p000000000001AAA' }];
        let calls = 0;
        const connection = {
          getApiVersion: () => '65.0',
          getAuthInfoFields: () => ({ orgId: '00DENRICH' }),
          metadata: {
            list: async () => {
              calls++;
              return listing;
            },
          },
        } as any;
        await enrichUsedByRows(connection, [row('01p000000000001AAA', 'ApexClass', 'OldClass')]);
        // Created after the listing was cached
        listing.push({ fullName: 'NewClass', id: '01p000000000002AAA' });
        const rows = await enrichUsedByRows(connection, [row('01p000000000002AAA', 'ApexClass', 'NewClass')]);
        expect(rows[0].usedByApiName).to.equal('NewClass');
        expect(calls).to.equal(2);
      } finally {
        process.env.SFDX_HARDIS_ORG_API_CACHE_DIR = previousDir;
        await clearOrgApiCache();
        await fs.remove(root);
      }
    });

    it('finds the local files of plain names, object children and bundles', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-deps-files-'));
      const previousCwd = process.cwd();
      const base = 'force-app/main/default';
      const files = [
        `${base}/classes/MyClass.cls`,
        `${base}/classes/MyClass.cls-meta.xml`,
        `${base}/objects/Account/fields/Total__c.field-meta.xml`,
        `${base}/objects/Account/validationRules/Amount_Positive.validationRule-meta.xml`,
        `${base}/lwc/myLwc/myLwc.html`,
        `${base}/lwc/myLwc/myLwc.js`,
        `${base}/lwc/myLwc/myLwc.js-meta.xml`,
      ];
      await fs.outputFile(
        path.join(root, 'sfdx-project.json'),
        JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
      );
      for (const file of files) {
        await fs.outputFile(path.join(root, file), '<x/>');
      }
      try {
        process.chdir(root);
        const classes = await findLocalFiles('ApexClass', ['MyClass', 'Missing']);
        expect(classes.get('MyClass')).to.match(/classes\/MyClass\.cls/);
        expect(classes.has('Missing')).to.equal(false);
        expect((await findLocalFiles('CustomField', ['Account.Total__c'])).get('Account.Total__c')).to.equal(
          'force-app/main/default/objects/Account/fields/Total__c.field-meta.xml'
        );
        expect(
          (await findLocalFiles('ValidationRule', ['Account.Amount_Positive'])).get('Account.Amount_Positive')
        ).to.equal('force-app/main/default/objects/Account/validationRules/Amount_Positive.validationRule-meta.xml');
        expect((await findLocalFiles('LightningComponentBundle', ['myLwc'])).get('myLwc')).to.equal(
          'force-app/main/default/lwc/myLwc/myLwc.js'
        );
      } finally {
        process.chdir(previousCwd);
        await fs.remove(root);
      }
    });
  });

  describe('standard objects', () => {
    it('treats a name without __ as a standard object', () => {
      expect(isStandardObjectName('Account')).to.equal(true);
      expect(isStandardObjectName('Installation__c')).to.equal(false);
      expect(isStandardObjectName('ns__Obj__c')).to.equal(false);
      expect(isStandardObjectName('MyType__mdt')).to.equal(false);
    });
  });

  describe('CustomField lookup', () => {
    it('splits an object-qualified custom field', () => {
      expect(parseCustomFieldName('Account.Status__c')).to.deep.equal({
        table: 'Account',
        developerName: 'Status',
      });
    });

    it('supports an unqualified namespaced custom field', () => {
      expect(customFieldDeveloperName('ns__Status__c')).to.equal('Status');
      expect(parseCustomFieldName('Amount__c')).to.deep.equal({ developerName: 'Amount' });
    });

    it('filters by DeveloperName and object keys without FullName', () => {
      const query = buildCustomFieldLookupSoql('Status', ['Account', '01I000000000001']);
      expect(query).to.contain("DeveloperName = 'Status'");
      expect(query).to.contain("TableEnumOrId = 'Account'");
      expect(query).to.contain("EntityDefinitionId = '01I000000000001'");
      expect(query).not.to.contain('FullName');
    });
  });

  describe('used-by SOQL', () => {
    it('filters the referenced component and dependent type', () => {
      const query = buildUsedBySoql('01pxx0000000001AAA', 'ApexClass', 'Flow');
      expect(query).to.contain("RefMetadataComponentId = '01pxx0000000001AAA'");
      expect(query).to.contain("RefMetadataComponentType = 'ApexClass'");
      expect(query).to.contain("MetadataComponentType = 'Flow'");
    });

    it('does not filter RefMetadataComponentType when the type is unknown (--id only)', () => {
      expect(buildUsedBySoql('01pxx0000000001AAA', 'Unknown')).not.to.contain('RefMetadataComponentType =');
      expect(buildUsedBySoql('01pxx0000000001AAA')).not.to.contain('RefMetadataComponentType =');
    });

    it('does not filter RefMetadataComponentType for StandardEntity', () => {
      const query = buildUsedBySoql('01Ixx0000000001AAA', 'StandardEntity');
      expect(query).not.to.contain('RefMetadataComponentType =');
    });

    it('maps the Tooling direction to used-by columns', () => {
      expect(
        mapUsedByRows([
          {
            MetadataComponentId: '301A',
            MetadataComponentName: 'UsesTarget',
            MetadataComponentType: 'Flow',
            RefMetadataComponentId: '01pA',
            RefMetadataComponentName: 'Target',
            RefMetadataComponentType: 'ApexClass',
          },
        ])
      ).to.deep.equal([
        {
          usedById: '301A',
          usedByName: 'UsesTarget',
          usedByType: 'Flow',
          targetId: '01pA',
          targetName: 'Target',
          targetType: 'ApexClass',
          usedByApiName: '',
          usedBySetupPath: '',
          usedByLocalFile: '',
        },
      ]);
    });
  });

  describe('validation and paths', () => {
    it('validates Salesforce Ids', () => {
      expect(isSalesforceId('01pxx0000000001')).to.equal(true);
      expect(isSalesforceId('01pxx0000000001AAA')).to.equal(true);
      expect(isSalesforceId('not-an-id')).to.equal(false);
    });

    it('validates metadata type identifiers', () => {
      expect(isMetadataType('LightningComponentBundle')).to.equal(true);
      expect(isMetadataType('Bad Type')).to.equal(false);
    });

    it('sanitizes Windows path characters and bounds length', () => {
      expect(sanitizeFsName('Account<>:"/\\|?*Status')).to.equal('Account_________Status');
      expect(sanitizeFsName('a'.repeat(120))).to.have.length(100);
      expect(sanitizeFsName('___')).to.equal('unknown');
      expect(sanitizeFsName(`A${String.fromCharCode(1)}B`)).to.equal('A_B');
    });
  });
});
