/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import fs from '../../../src/common/utils/fsUtils.js';
import { BackpromoteRetrieveRunners, BackpromoteSourceMemberRow, retrieveItemsForComparison } from '../../../src/common/utils/backpromoteOrgUtils.js';

// The org is faked: SourceMember rows and Metadata API dates by "Type:Name" answer the validation,
// and the retrieve writes the files of the keys the org has into the blank project, like sf does
type FakeOrg = {
  /** SourceMember row by "Type:Name" (source-tracked validation); no row = never modified */
  members?: Record<string, { RevisionCounter: number; LastModifiedDate: string; IsNameObsolete?: boolean }>;
  /** lastModifiedDate by "Type:Name" (Metadata API validation) */
  dates?: Record<string, string>;
  /** Source content by "Type:Name", written under force-app/main/default/<folder>/ */
  sources: Record<string, { folder: string; file: string; content: string }[]>;
  /** Types whose validation call fails */
  failingTypes?: string[];
};

type Calls = { sourceMemberQueries: { type: string; names: string[] }[]; listed: string[]; retrieved: string[]; projectsCreated: number };

function splitKey(key: string): [string, string] {
  return [key.substring(0, key.indexOf(':')), key.substring(key.indexOf(':') + 1)];
}

function fakeRunners(org: FakeOrg, calls: Calls, validators = true): Partial<BackpromoteRetrieveRunners> {
  const runners: Partial<BackpromoteRetrieveRunners> = {
    retrieve: async (command, cwd) => {
      calls.retrieved.push(command);
      const files: any[] = [];
      for (const [key, sources] of Object.entries(org.sources)) {
        const [type, fullName] = splitKey(key);
        for (const source of sources) {
          const relative = path.join('force-app', 'main', 'default', source.folder, source.file);
          await fs.ensureDir(path.dirname(path.join(cwd, relative)));
          await fs.writeFile(path.join(cwd, relative), source.content, 'utf8');
          // sf gives absolute paths; one relative path checks that both forms are read
          files.push({ type, fullName, state: 'Changed', filePath: files.length === 0 ? relative : path.join(cwd, relative) });
        }
      }
      return { status: 0, result: { files } };
    },
    createBlankProject: async (runDir) => {
      calls.projectsCreated += 1;
      const project = path.join(runDir, 'sfdx-hardis-blank-project');
      await fs.ensureDir(path.join(project, 'force-app'));
      return project;
    },
  };
  if (!validators) {
    return runners;
  }
  runners.readSourceMembers = async (type, names) => {
    calls.sourceMemberQueries.push({ type, names });
    if ((org.failingTypes || []).includes(type)) {
      throw new Error(`Cannot query SourceMember for ${type}`);
    }
    const rows: BackpromoteSourceMemberRow[] = [];
    for (const [key, row] of Object.entries(org.members || {})) {
      const [memberType, memberName] = splitKey(key);
      if (memberType === type && names.includes(memberName)) {
        rows.push({ MemberName: memberName, ...row });
      }
    }
    return rows;
  };
  runners.listMetadataDates = async (type) => {
    calls.listed.push(type);
    if ((org.failingTypes || []).includes(type)) {
      return null;
    }
    const dates: Record<string, string> = {};
    for (const [key, lastModifiedDate] of Object.entries(org.dates || {})) {
      const [listedType, fullName] = splitKey(key);
      if (listedType === type) {
        dates[fullName] = lastModifiedDate;
      }
    }
    return dates;
  };
  return runners;
}

const apex = { folder: 'classes', file: 'InvoiceCalculator.cls', content: 'public class InvoiceCalculator {}' };
const apexMeta = { folder: 'classes', file: 'InvoiceCalculator.cls-meta.xml', content: '<ApexClass/>' };
const field = { folder: 'objects/Account/fields', file: 'Region__c.field-meta.xml', content: '<CustomField/>' };
const report = { folder: 'reports/Sales', file: 'Pipe.report-meta.xml', content: '<Report/>' };
const APEX = 'ApexClass:InvoiceCalculator';
const FIELD = 'CustomField:Account.Region__c';
const ORG_ID = '00D000000000001';

describe('retrieveItemsForComparison() cross-run cache', () => {
  let cacheRoot: string;
  let calls: Calls;
  let runCounter = 0;

  beforeEach(async () => {
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-backpromote-cache-'));
    calls = { sourceMemberQueries: [], listed: [], retrieved: [], projectsCreated: 0 };
  });

  afterEach(async () => {
    await fs.remove(cacheRoot);
  });

  async function run(org: FakeOrg, keys: string[], options: { runId?: string; force?: boolean; tracksSource?: boolean; validators?: boolean } = {}) {
    runCounter += 1;
    return retrieveItemsForComparison({
      username: 'dev@example.com',
      keys,
      orgId: ORG_ID,
      runId: options.runId || `run${runCounter}`,
      commandThis: null,
      force: options.force,
      tracksSource: options.tracksSource,
      runners: fakeRunners(org, calls, options.validators !== false),
      cacheRoot,
    });
  }

  function indexFile(): string {
    return path.join(cacheRoot, 'retrieve-cache', ORG_ID, 'index.json');
  }

  function indexItems(): Record<string, any> {
    return JSON.parse(fs.readFileSync(indexFile(), 'utf8')).items;
  }

  describe('source-tracked org (SourceMember validation)', () => {
    const tracked = { tracksSource: true };

    it('serves an unchanged org from the cache without a retrieve, files copied into the run', async () => {
      const org: FakeOrg = {
        members: { [APEX]: { RevisionCounter: 12, LastModifiedDate: '2026-09-10T10:00:00.000+0000' } },
        sources: { [APEX]: [apex, apexMeta], [FIELD]: [field] },
      };
      const first = await run(org, [APEX, FIELD], tracked);
      expect(calls.retrieved).to.have.length(1);
      expect(calls.listed).to.be.empty;
      expect(calls.sourceMemberQueries.map((query) => query.type)).to.deep.equal(['ApexClass', 'CustomField']);
      expect(calls.sourceMemberQueries[1].names).to.deep.equal(['Account.Region__c']);
      expect(first.filesByTail.has('classes/InvoiceCalculator.cls')).to.be.true;
      const items = indexItems();
      expect(items[APEX].validator).to.equal('12:2026-09-10T10:00:00.000+0000');
      expect(items[APEX].files).to.have.members(['main/default/classes/InvoiceCalculator.cls', 'main/default/classes/InvoiceCalculator.cls-meta.xml']);
      // Never modified since the tracking began: no row, a stable fact
      expect(items[FIELD].validator).to.equal('none');

      calls.retrieved = [];
      calls.projectsCreated = 0;
      const second = await run(org, [APEX, FIELD], tracked);
      expect(calls.retrieved).to.be.empty;
      expect(calls.projectsCreated).to.equal(0);
      expect(second.orgDir).to.not.equal(first.orgDir);
      expect(second.filesByTail.get('classes/InvoiceCalculator.cls')).to.equal(path.join(second.orgDir, 'main', 'default', 'classes', 'InvoiceCalculator.cls'));
      expect(await fs.readFile(second.filesByTail.get('classes/InvoiceCalculator.cls')!, 'utf8')).to.equal(apex.content);
      expect(second.filesByTail.has('objects/Account/fields/Region__c.field-meta.xml')).to.be.true;
      expect(fs.existsSync(path.join(path.dirname(second.orgDir), '..', 'retrieved.json'))).to.be.true;
    });

    it('retrieves again when the RevisionCounter changed, and updates the cache', async () => {
      const org: FakeOrg = { members: { [APEX]: { RevisionCounter: 12, LastModifiedDate: '2026-09-10T10:00:00.000+0000' } }, sources: { [APEX]: [apex, apexMeta] } };
      await run(org, [APEX], tracked);
      org.members![APEX] = { RevisionCounter: 13, LastModifiedDate: '2026-09-11T09:30:00.000+0000' };
      org.sources[APEX] = [{ ...apex, content: 'public class InvoiceCalculator { Integer v2; }' }, apexMeta];
      const second = await run(org, [APEX], tracked);
      expect(calls.retrieved).to.have.length(2);
      expect(await fs.readFile(second.filesByTail.get('classes/InvoiceCalculator.cls')!, 'utf8')).to.contain('v2');
      expect(indexItems()[APEX].validator).to.equal('13:2026-09-11T09:30:00.000+0000');
      const cachedFile = path.join(cacheRoot, 'retrieve-cache', ORG_ID, 'force-app', 'main', 'default', 'classes', 'InvoiceCalculator.cls');
      expect(await fs.readFile(cachedFile, 'utf8')).to.contain('v2');
    });

    it('retrieves again when a row appears for an item that had none', async () => {
      const org: FakeOrg = { members: {}, sources: { [APEX]: [apex, apexMeta] } };
      await run(org, [APEX], tracked);
      expect(indexItems()[APEX].validator).to.equal('none');
      await run(org, [APEX], tracked);
      expect(calls.retrieved).to.have.length(1);
      org.members![APEX] = { RevisionCounter: 1, LastModifiedDate: '2026-09-12T07:00:00.000+0000' };
      await run(org, [APEX], tracked);
      expect(calls.retrieved).to.have.length(2);
      expect(indexItems()[APEX].validator).to.equal('1:2026-09-12T07:00:00.000+0000');
    });

    it('keeps an item the retrieve did not bring back as missing while its row does not change', async () => {
      const org: FakeOrg = { members: {}, sources: {} };
      const first = await run(org, ['ApexClass:Gone'], tracked);
      expect(calls.retrieved).to.have.length(1);
      expect(first.filesByTail.size).to.equal(0);
      expect(indexItems()['ApexClass:Gone']).to.include({ missing: true, validator: 'none' });
      const second = await run(org, ['ApexClass:Gone'], tracked);
      expect(calls.retrieved).to.have.length(1);
      expect(calls.projectsCreated).to.equal(1);
      expect(second.filesByTail.size).to.equal(0);
      // Created in the org since: its row makes the item stale and retrieved
      org.members!['ApexClass:Gone'] = { RevisionCounter: 1, LastModifiedDate: '2026-09-12T07:00:00.000+0000' };
      org.sources['ApexClass:Gone'] = [{ folder: 'classes', file: 'Gone.cls', content: 'public class Gone {}' }];
      const later = await run(org, ['ApexClass:Gone'], tracked);
      expect(calls.retrieved).to.have.length(2);
      expect(later.filesByTail.has('classes/Gone.cls')).to.be.true;
      expect(indexItems()['ApexClass:Gone'].missing).to.be.undefined;
    });

    it('always retrieves a type whose SourceMember query fails, and does not write it in the cache', async () => {
      const org: FakeOrg = { members: {}, sources: { [APEX]: [apex, apexMeta] }, failingTypes: ['ApexClass'] };
      await run(org, [APEX], tracked);
      await run(org, [APEX], tracked);
      expect(calls.retrieved).to.have.length(2);
      expect(indexItems()).to.deep.equal({});
    });

    it('queries the names in chunks of 200', async () => {
      const names = Array.from({ length: 450 }, (_, position) => `Class${position}`);
      const org: FakeOrg = { members: {}, sources: {} };
      await run(org, names.map((name) => `ApexClass:${name}`), tracked);
      expect(calls.sourceMemberQueries.map((query) => query.names.length)).to.deep.equal([200, 200, 50]);
    });
  });

  describe('org without source tracking (Metadata API validation)', () => {
    it('serves an unchanged org from the cache without a retrieve', async () => {
      const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z', [FIELD]: '2026-09-01T08:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta], [FIELD]: [field] } };
      await run(org, [APEX, FIELD]);
      expect(calls.listed).to.deep.equal(['ApexClass', 'CustomField']);
      expect(calls.sourceMemberQueries).to.be.empty;
      expect(indexItems()[APEX].validator).to.equal('2026-09-10T10:00:00.000Z');
      expect(indexItems()[FIELD].files).to.deep.equal(['main/default/objects/Account/fields/Region__c.field-meta.xml']);
      const second = await run(org, [APEX, FIELD]);
      expect(calls.retrieved).to.have.length(1);
      expect(calls.projectsCreated).to.equal(1);
      expect(await fs.readFile(second.filesByTail.get('classes/InvoiceCalculator.cls')!, 'utf8')).to.equal(apex.content);
      expect(second.filesByTail.has('objects/Account/fields/Region__c.field-meta.xml')).to.be.true;
    });

    it('retrieves again when the org date changed, and updates the cache', async () => {
      const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta] } };
      await run(org, [APEX]);
      org.dates![APEX] = '2026-09-11T09:30:00.000Z';
      org.sources[APEX] = [{ ...apex, content: 'public class InvoiceCalculator { Integer v2; }' }, apexMeta];
      const second = await run(org, [APEX]);
      expect(calls.retrieved).to.have.length(2);
      expect(await fs.readFile(second.filesByTail.get('classes/InvoiceCalculator.cls')!, 'utf8')).to.contain('v2');
      expect(indexItems()[APEX].validator).to.equal('2026-09-11T09:30:00.000Z');
    });

    it('retrieves everything when one item is stale, and serves the others from the cache next time', async () => {
      const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z', [FIELD]: '2026-09-01T08:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta], [FIELD]: [field] } };
      await run(org, [APEX]);
      await run(org, [APEX, FIELD]);
      expect(calls.retrieved).to.have.length(2);
      expect(calls.retrieved[1]).to.contain('retrieve-package.xml');
      await run(org, [APEX, FIELD]);
      expect(calls.retrieved).to.have.length(2);
    });

    it('always retrieves a folder based type', async () => {
      const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta], 'Report:Sales/Pipe': [report] } };
      await run(org, [APEX, 'Report:Sales/Pipe']);
      await run(org, [APEX, 'Report:Sales/Pipe']);
      expect(calls.retrieved).to.have.length(2);
      expect(calls.listed).to.not.include('Report');
      expect(indexItems()).to.not.have.property('Report:Sales/Pipe');
      expect(indexItems()[APEX].validator).to.equal('2026-09-10T10:00:00.000Z');
    });

    it('always retrieves a type whose listing fails, and does not write it in the cache', async () => {
      const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta] }, failingTypes: ['ApexClass'] };
      await run(org, [APEX]);
      await run(org, [APEX]);
      expect(calls.retrieved).to.have.length(2);
      expect(indexItems()).to.deep.equal({});
    });

    it('records an item the listing does not know as missing, without a retrieve', async () => {
      const org: FakeOrg = { dates: {}, sources: {} };
      const result = await run(org, ['ApexClass:Gone']);
      expect(calls.retrieved).to.be.empty;
      expect(calls.projectsCreated).to.equal(0);
      expect(result.filesByTail.size).to.equal(0);
      expect(indexItems()['ApexClass:Gone']).to.include({ missing: true, validator: null });
      // Once the item exists in the org, it is retrieved
      org.dates!['ApexClass:Gone'] = '2026-09-12T07:00:00.000Z';
      org.sources['ApexClass:Gone'] = [{ folder: 'classes', file: 'Gone.cls', content: 'public class Gone {}' }];
      const later = await run(org, ['ApexClass:Gone']);
      expect(calls.retrieved).to.have.length(1);
      expect(later.filesByTail.has('classes/Gone.cls')).to.be.true;
      expect(indexItems()['ApexClass:Gone'].missing).to.be.undefined;
    });

    it('retrieves again when a cached file disappeared', async () => {
      const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta] } };
      await run(org, [APEX]);
      await fs.remove(path.join(cacheRoot, 'retrieve-cache', ORG_ID, 'force-app'));
      await run(org, [APEX]);
      expect(calls.retrieved).to.have.length(2);
    });
  });

  it('never touches the cache without a connection', async () => {
    const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta] } };
    const first = await run(org, [APEX], { validators: false });
    await run(org, [APEX], { validators: false, tracksSource: true });
    expect(calls.retrieved).to.have.length(2);
    expect(calls.listed).to.be.empty;
    expect(calls.sourceMemberQueries).to.be.empty;
    expect(fs.existsSync(path.join(cacheRoot, 'retrieve-cache'))).to.be.false;
    expect(first.filesByTail.has('classes/InvoiceCalculator.cls')).to.be.true;
  });

  it('force bypasses the cache: no validation, one retrieve', async () => {
    const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta] } };
    await run(org, [APEX]);
    calls.listed = [];
    await run(org, [APEX], { force: true });
    expect(calls.listed).to.be.empty;
    expect(calls.retrieved).to.have.length(2);
  });

  it('a run marker holding a superset of the keys wins over the cache', async () => {
    const org: FakeOrg = { dates: { [APEX]: '2026-09-10T10:00:00.000Z', [FIELD]: '2026-09-01T08:00:00.000Z' }, sources: { [APEX]: [apex, apexMeta], [FIELD]: [field] } };
    await run(org, [APEX, FIELD], { runId: 'same' });
    calls.listed = [];
    const again = await run(org, [APEX], { runId: 'same' });
    expect(calls.listed).to.be.empty;
    expect(calls.retrieved).to.have.length(1);
    expect(again.filesByTail.has('classes/InvoiceCalculator.cls')).to.be.true;
    expect(again.filesByTail.has('objects/Account/fields/Region__c.field-meta.xml')).to.be.true;
  });
});
