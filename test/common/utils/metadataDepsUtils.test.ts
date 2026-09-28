import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { clearOrgApiCache } from '../../../src/common/cache/orgApiCache.js';
import {
  buildCustomFieldLookupSoql,
  buildLookupSoql,
  buildSetupPath,
  buildDependenciesSoql,
  customFieldDeveloperName,
  enrichDependencies,
  findLocalFiles,
  formatFlowVersions,
  mergeFlowVersions,
  isMetadataType,
  isStandardObjectName,
  lookupListedComponent,
  isSalesforceId,
  mapDependencies,
  parseCustomFieldName,
  parseCustomObjectName,
  queryFolderedNames,
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
        ({ ...fakeConnection(components, queries), getAuthInfoFields: () => ({ orgId: '00D000000000001' }) }) as any;

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
    const row = (id: string, type: string, name: string) => ({
      id,
      name,
      type,
      apiName: '',
      setupPath: '',
      localFile: '',
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
      expect(buildSetupPath('StandardEntity', 'Account')).to.equal('/lightning/setup/ObjectManager/Account/Details/view');
      expect(buildSetupPath('User', 'User')).to.equal('');
    });

    it('names a used standard object by its API name, without listing it', async () => {
      const connection = {
        getApiVersion: () => '65.0',
        metadata: {
          list: async () => {
            throw new Error('the standard objects must not be listed');
          },
        },
      } as any;
      const [account] = await enrichDependencies(connection, [row('Account', 'StandardEntity', 'Account')]);
      expect(account.apiName).to.equal('Account');
      expect(account.setupPath).to.equal('/lightning/setup/ObjectManager/Account/Details/view');
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
      const rows = await enrichDependencies(connection, [
        row('00h000000000001AAA', 'Layout', 'Account Layout'),
        row('00N000000000001', 'CustomField', 'Crew_Workload'),
        row('00N000000000002AAA', 'CustomField', 'Other'),
        row('08e000000000001AAA', 'CronTrigger', '08e000000000001AAA'),
      ]);
      expect(rows.map((r) => r.apiName)).to.deep.equal([
        'Account-Account Layout',
        'Installation__c.Crew_Workload__c',
        '',
        '',
      ]);
      expect(rows[0].setupPath).to.equal('/00h000000000001AAA');
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
          getAuthInfoFields: () => ({ orgId: '00D000000000002' }),
          metadata: {
            list: async () => {
              calls++;
              return listing;
            },
          },
        } as any;
        await enrichDependencies(connection, [row('01p000000000001AAA', 'ApexClass', 'OldClass')]);
        // Created after the listing was cached
        listing.push({ fullName: 'NewClass', id: '01p000000000002AAA' });
        const rows = await enrichDependencies(connection, [row('01p000000000002AAA', 'ApexClass', 'NewClass')]);
        expect(rows[0].apiName).to.equal('NewClass');
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

  describe('folder types (Report, Dashboard, EmailTemplate, Document)', () => {
    // Fake connection answering SOQL queries on Report and Folder, and refusing any listMetadata call
    const soqlConnection = (records: Record<string, any[]>) =>
      ({
        getApiVersion: () => '65.0',
        query: async (query: string) => ({
          records: records[query.includes('FROM Folder') ? 'Folder' : 'Report'] ?? [],
          done: true,
          totalSize: 0,
        }),
        metadata: {
          list: async () => {
            throw new Error('folder types must not be listed without a folder');
          },
        },
      }) as any;

    it('names reports Folder/DeveloperName, unfiled$public for the org folder, nothing for a personal folder', async () => {
      const connection = soqlConnection({
        Report: [
          { Id: '00O000000000001AAA', DeveloperName: 'Pipeline', OwnerId: '00l000000000001AAA' },
          { Id: '00O000000000002AAA', DeveloperName: 'Public_One', OwnerId: '00D000000000001AAA' },
          { Id: '00O000000000003AAA', DeveloperName: 'Mine', OwnerId: '005000000000001AAA' },
        ],
        Folder: [{ Id: '00l000000000001AAA', DeveloperName: 'SalesReports' }],
      });
      const names = await queryFolderedNames(connection, 'Report', [
        '00O000000000001AAA',
        '00O000000000002AAA',
        '00O000000000003AAA',
      ]);
      expect(names.get('00O000000000001')).to.equal('SalesReports/Pipeline');
      expect(names.get('00O000000000002')).to.equal('unfiled$public/Public_One');
      expect(names.has('00O000000000003')).to.equal(false);
    });

    it('resolves report dependencies without listing Report', async () => {
      const connection = soqlConnection({
        Report: [{ Id: '00O000000000001AAA', DeveloperName: 'Pipeline', OwnerId: '00l000000000001AAA' }],
        Folder: [{ Id: '00l000000000001AAA', DeveloperName: 'SalesReports' }],
      });
      const [report] = await enrichDependencies(connection, [
        { id: '00O000000000001AAA', name: 'Pipeline', type: 'Report', apiName: '', setupPath: '', localFile: '' },
      ]);
      expect(report.apiName).to.equal('SalesReports/Pipeline');
      expect(report.setupPath).to.equal('/00O000000000001AAA');
    });
  });

  describe('Flow versions', () => {
    const flowRow = (id: string, versionNumber: number, status: string) => ({
      id,
      name: 'Installation Assign Crew',
      type: 'Flow',
      apiName: 'Installation_Assign_Crew',
      setupPath: `/builder_platform_interaction/flowBuilder.app?flowId=${id}`,
      localFile: '',
      versions: [{ id, versionNumber, status }],
    });

    it('merges the versions of a Flow into one row that keeps the active version', () => {
      const merged = mergeFlowVersions([
        flowRow('301000000000001AAA', 1, 'Obsolete'),
        flowRow('301000000000004AAA', 4, 'Active'),
        flowRow('301000000000003AAA', 3, 'Obsolete'),
      ]);
      expect(merged).to.have.length(1);
      expect(merged[0].id).to.equal('301000000000004AAA');
      expect(merged[0].setupPath).to.contain('301000000000004AAA');
      expect(merged[0].versions?.map((version) => version.versionNumber)).to.deep.equal([4, 3, 1]);
      expect(formatFlowVersions(merged[0].versions)).to.equal('4 (Active); 3; 1');
    });

    it('keeps the newest version when no version is active, and leaves other rows alone', () => {
      const other = { ...flowRow('01p000000000001AAA', 0, ''), type: 'ApexClass', versions: undefined };
      const merged = mergeFlowVersions([
        flowRow('301000000000002AAA', 2, 'Obsolete'),
        other,
        flowRow('301000000000005AAA', 5, 'Draft'),
      ]);
      expect(merged).to.have.length(2);
      expect(merged[0].id).to.equal('301000000000005AAA');
      expect(merged[1]).to.equal(other);
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

  describe('dependencies SOQL and mapping', () => {
    const record = {
      MetadataComponentId: '301A',
      MetadataComponentName: 'UsesTarget',
      MetadataComponentType: 'Flow',
      RefMetadataComponentId: '01pA',
      RefMetadataComponentName: 'Target',
      RefMetadataComponentType: 'ApexClass',
    };

    it('used-by: filters on the referenced component, and on the type of the component that uses it', () => {
      const query = buildDependenciesSoql('01pxx0000000001AAA', 'ApexClass', 'Flow');
      expect(query).to.contain("RefMetadataComponentId = '01pxx0000000001AAA'");
      expect(query).to.contain("RefMetadataComponentType = 'ApexClass'");
      expect(query).to.contain("AND MetadataComponentType = 'Flow'");
    });

    it('uses: filters on the component that uses, and on the type of the used component', () => {
      const query = buildDependenciesSoql('301xx0000000001AAA', 'Flow', 'CustomField', 'uses');
      expect(query).to.contain("WHERE MetadataComponentId = '301xx0000000001AAA'");
      expect(query).to.contain("AND MetadataComponentType = 'Flow'");
      expect(query).to.contain("RefMetadataComponentType = 'CustomField'");
      expect(query).not.to.contain('RefMetadataComponentId =');
    });

    it('does not filter the selected type when it is unknown (--id only) or StandardEntity', () => {
      expect(buildDependenciesSoql('01pxx0000000001AAA', 'Unknown')).not.to.contain('RefMetadataComponentType =');
      expect(buildDependenciesSoql('01pxx0000000001AAA')).not.to.contain('RefMetadataComponentType =');
      expect(buildDependenciesSoql('01Ixx0000000001AAA', 'StandardEntity')).not.to.contain('RefMetadataComponentType =');
      expect(buildDependenciesSoql('01pxx0000000001AAA', 'Unknown', undefined, 'uses')).not.to.contain(
        'AND MetadataComponentType ='
      );
    });

    it('maps the other component of each row, in both directions', () => {
      const empty = { apiName: '', setupPath: '', localFile: '' };
      expect(mapDependencies([record])).to.deep.equal([{ id: '301A', name: 'UsesTarget', type: 'Flow', ...empty }]);
      expect(mapDependencies([record], 'uses')).to.deep.equal([
        { id: '01pA', name: 'Target', type: 'ApexClass', ...empty },
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
