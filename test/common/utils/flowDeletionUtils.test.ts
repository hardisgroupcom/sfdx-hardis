/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { parsePackageXmlFile } from '../../../src/common/utils/xmlUtils.js';
import {
  detectPendingFlowDeletions,
  mergePendingFlowDeletions,
  stripFlowsFromDestructiveChanges,
  queryFlowVersions,
  queryFlowDefinitions,
  queryFlowInterviewIdsByFlow,
  queryFlowInterviewIdsForFlows,
  deactivateFlowViaToolingApi,
  deleteFlowVersionsViaToolingApi,
  runFlowDeletionPreflight,
  runFlowDeletionStep,
  resolveFlowDeletionRetrySettings,
  worstFlowDeletionStatus,
  buildFlowDeletionMarkdown,
  writeFlowDeletionReport,
  extractBlockingFlowInterviewIds,
  dedupeFlowInterviewIds,
} from '../../../src/common/utils/flowDeletionUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useTmpDir(prefix: string): { getDir: () => string } {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  return { getDir: () => tmpDir };
}

function buildPackageXml(types: Record<string, string[]>): string {
  const typesXml = Object.entries(types)
    .map(([name, members]) => {
      const membersXml = members.map((m) => `        <members>${m}</members>`).join('\n');
      return `    <types>\n${membersXml}\n        <name>${name}</name>\n    </types>`;
    })
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
    typesXml +
    '\n    <version>62.0</version>\n</Package>'
  );
}

async function writePackageXml(dir: string, name: string, types: Record<string, string[]>): Promise<string> {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, buildPackageXml(types));
  return filePath;
}

function flowVersionRecord(flowName: string, versionNumber: number, status = 'Obsolete'): any {
  return {
    Id: `301${flowName}${versionNumber}`.padEnd(18, '0'),
    VersionNumber: versionNumber,
    Status: status,
    Definition: { DeveloperName: flowName },
  };
}

function flowVersionViewRecord(flowName: string, versionNumber: number): any {
  return {
    DurableId: flowVersionRecord(flowName, versionNumber).Id,
    FlowDefinitionView: { ApiName: flowName },
  };
}

function flowInterviewRecord(id: string, flowName: string, versionNumber: number): any {
  return {
    Id: id,
    FlowVersionViewId: flowVersionRecord(flowName, versionNumber).Id.substring(0, 15),
  };
}

type MockConnOptions = {
  flowVersions?: any[];
  flowVersionsAfterDelete?: any[];
  flowDefinitions?: any[];
  versionViews?: any[];
  interviews?: any[];
  destroyResults?: any;
  destroyResultsSequence?: any[];
  destroyThrows?: boolean;
  flowQueryThrows?: boolean;
  definitionQueryThrows?: boolean;
  versionViewQueryThrows?: boolean;
  interviewQueryThrows?: boolean;
  updateThrows?: boolean;
  updateCalls?: any[];
  destroyCalls?: any[];
  capturedQueries?: string[];
};

// Mock of the pieces of a jsforce Connection the Flow deletion helpers touch.
// The Flow version query is answered twice: the live enumeration, then the post-deletion check.
function mockConn(opts: MockConnOptions = {}): any {
  let flowQueryCount = 0;
  return {
    tooling: {
      query: async (soql: string) => {
        opts.capturedQueries?.push(soql);
        if (soql.includes('FROM FlowDefinition')) {
          if (opts.definitionQueryThrows) {
            throw new Error('definition query boom');
          }
          return { records: opts.flowDefinitions || [] };
        }
        if (opts.flowQueryThrows) {
          throw new Error('flow query boom');
        }
        flowQueryCount++;
        if (flowQueryCount > 1) {
          return { records: opts.flowVersionsAfterDelete || [] };
        }
        return { records: opts.flowVersions || [] };
      },
      sobject: (name: string) => ({
        update: async (record: any) => {
          if (opts.updateThrows) {
            throw new Error('update boom');
          }
          opts.updateCalls?.push({ name, record });
          return { success: true };
        },
      }),
      // Fallback path of bulkDeleteTooling: unitary delete of a single record id.
      destroy: async (objectName: string, recordId: string) => {
        opts.destroyCalls?.push({ objectName, recordIds: [recordId] });
        return { id: recordId, success: true, errors: [] };
      },
    },
    // Emulates the Tooling composite endpoint used by bulkDeleteTooling.
    // opts.destroyResults lists the desired per-record outcomes ({ id|Id, success, errors|error });
    // any record not listed is deleted successfully.
    requestPost: async (url: string, payload: any) => {
      if (!url.includes('/tooling/composite')) {
        throw new Error(`Unexpected requestPost url: ${url}`);
      }
      const subRequests = payload?.compositeRequest || [];
      const objectName = subRequests[0]?.url.split('/').slice(-2, -1)[0];
      opts.destroyCalls?.push({ objectName, recordIds: subRequests.map((sub: any) => sub.url.split('/').pop()) });
      if (opts.destroyThrows) {
        throw new Error('destroy boom');
      }
      // destroyResultsSequence lists per-call outcomes, consumed one entry per composite request.
      const callResults =
        opts.destroyResultsSequence && opts.destroyResultsSequence.length > 0
          ? opts.destroyResultsSequence.shift()
          : opts.destroyResults;
      const outcomeList: any[] = Array.isArray(callResults) ? callResults : callResults?.results || [];
      const outcomeById = new Map(outcomeList.map((outcome: any) => [String(outcome.id ?? outcome.Id), outcome]));
      const compositeResponse = subRequests.map((sub: any) => {
        const recordId = sub.url.split('/').pop();
        const outcome: any = outcomeById.get(recordId);
        if (!outcome || outcome.success === true) {
          return { referenceId: sub.referenceId, httpStatusCode: 204, body: null };
        }
        const body = Array.isArray(outcome.errors)
          ? outcome.errors.map((err: any) => ({ errorCode: err.statusCode, message: err.message }))
          : [{ errorCode: 'ERROR', message: String(outcome.error ?? 'error') }];
        return { referenceId: sub.referenceId, httpStatusCode: 400, body };
      });
      return { compositeResponse };
    },
    query: async (soql: string) => {
      opts.capturedQueries?.push(soql);
      if (opts.versionViewQueryThrows) {
        throw new Error('version view query boom');
      }
      return { done: true, records: opts.versionViews || [] };
    },
    queryMore: async () => ({ done: true, records: [] }),
    bulk2: {
      pollInterval: 0,
      pollTimeout: 0,
      query: async (soql: string) => {
        opts.capturedQueries?.push(soql);
        if (opts.interviewQueryThrows) {
          throw new Error('interview query boom');
        }
        return { on: () => undefined, toArray: async () => opts.interviews || [] };
      },
    },
    getApiVersion: () => '65.0',
    getUsername: () => 'test@example.com',
  };
}

// Runs the callback with the given env vars set, then restores what was there before.
async function withEnv(
  vars: Record<string, string | undefined>,
  callback: () => Promise<void> | void
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(vars)) {
    previous[name] = process.env[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  try {
    await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// detectPendingFlowDeletions
// ---------------------------------------------------------------------------
describe('detectPendingFlowDeletions', () => {
  const tmp = useTmpDir('flow-detect');

  it('reports a bare member as a whole-Flow deletion', async () => {
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', { Flow: ['MyFlow', 'OtherFlow'] });
    const { pendingFlowDeletions, hasWildcard } = await detectPendingFlowDeletions(file);
    expect(pendingFlowDeletions).to.deep.equal([
      { flowName: 'MyFlow', requestedVersions: null },
      { flowName: 'OtherFlow', requestedVersions: null },
    ]);
    expect(hasWildcard).to.be.false;
  });

  it('groups versioned members per Flow', async () => {
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', {
      Flow: ['MyFlow-3', 'MyFlow-4', 'Other-1'],
    });
    const { pendingFlowDeletions } = await detectPendingFlowDeletions(file);
    expect(pendingFlowDeletions).to.deep.equal([
      { flowName: 'MyFlow', requestedVersions: [3, 4] },
      { flowName: 'Other', requestedVersions: [1] },
    ]);
  });

  it('lets a bare member win over versioned members of the same Flow', async () => {
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', { Flow: ['MyFlow-3', 'MyFlow'] });
    const { pendingFlowDeletions } = await detectPendingFlowDeletions(file);
    expect(pendingFlowDeletions).to.deep.equal([{ flowName: 'MyFlow', requestedVersions: null }]);
  });

  it('flags a wildcard and does not treat it as a Flow to delete', async () => {
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', { Flow: ['*'] });
    const { pendingFlowDeletions, hasWildcard } = await detectPendingFlowDeletions(file);
    expect(hasWildcard).to.be.true;
    expect(pendingFlowDeletions).to.be.empty;
  });

  it('returns empty when the file does not exist, is undefined, or has no Flow type', async () => {
    expect((await detectPendingFlowDeletions(path.join(tmp.getDir(), 'nope.xml'))).pendingFlowDeletions).to.be.empty;
    expect((await detectPendingFlowDeletions(undefined)).pendingFlowDeletions).to.be.empty;
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', { ApexClass: ['MyClass'] });
    expect((await detectPendingFlowDeletions(file)).pendingFlowDeletions).to.be.empty;
  });
});

// ---------------------------------------------------------------------------
// mergePendingFlowDeletions
// ---------------------------------------------------------------------------
describe('mergePendingFlowDeletions', () => {
  it('unions the requested versions of the same Flow', () => {
    const merged = mergePendingFlowDeletions(
      [{ flowName: 'MyFlow', requestedVersions: [1, 2] }],
      [{ flowName: 'MyFlow', requestedVersions: [2, 3] }]
    );
    expect(merged).to.deep.equal([{ flowName: 'MyFlow', requestedVersions: [1, 2, 3] }]);
  });

  it('lets a whole-Flow deletion absorb versioned requests, whatever the order', () => {
    expect(
      mergePendingFlowDeletions([{ flowName: 'F', requestedVersions: [1] }], [{ flowName: 'F', requestedVersions: null }])
    ).to.deep.equal([{ flowName: 'F', requestedVersions: null }]);
    expect(
      mergePendingFlowDeletions([{ flowName: 'F', requestedVersions: null }], [{ flowName: 'F', requestedVersions: [1] }])
    ).to.deep.equal([{ flowName: 'F', requestedVersions: null }]);
  });

  it('keeps distinct Flows apart', () => {
    const merged = mergePendingFlowDeletions([
      { flowName: 'A', requestedVersions: null },
      { flowName: 'B', requestedVersions: [2] },
    ]);
    expect(merged).to.have.length(2);
  });
});

// ---------------------------------------------------------------------------
// stripFlowsFromDestructiveChanges
// ---------------------------------------------------------------------------
describe('stripFlowsFromDestructiveChanges', () => {
  const tmp = useTmpDir('flow-strip');

  it('removes the Flow type and keeps the other types', async () => {
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', {
      Flow: ['MyFlow', 'Other-2'],
      ApexClass: ['MyClass'],
    });
    const stripped = await stripFlowsFromDestructiveChanges(file, tmp.getDir(), 'stripped.xml');
    expect(stripped).to.not.be.null;
    const content = await parsePackageXmlFile(stripped as string);
    expect(content['Flow']).to.be.undefined;
    expect(content['ApexClass']).to.deep.equal(['MyClass']);
  });

  it('rejects a wildcard instead of forwarding it to the destructive deployment', async () => {
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', { Flow: ['*', 'MyFlow'] });
    let error: Error | undefined;
    try {
      await stripFlowsFromDestructiveChanges(file, tmp.getDir(), 'stripped.xml');
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).to.contain('wildcard');
    expect(fs.existsSync(path.join(tmp.getDir(), 'stripped.xml'))).to.be.false;
  });

  it('returns null when there is nothing to strip', async () => {
    const noFlow = await writePackageXml(tmp.getDir(), 'a.xml', { ApexClass: ['MyClass'] });
    expect(await stripFlowsFromDestructiveChanges(noFlow, tmp.getDir(), 'stripped.xml')).to.be.null;
  });

  it('does not mutate the original manifest', async () => {
    const file = await writePackageXml(tmp.getDir(), 'destructiveChanges.xml', { Flow: ['MyFlow'] });
    await stripFlowsFromDestructiveChanges(file, tmp.getDir(), 'stripped.xml');
    const original = await parsePackageXmlFile(file);
    expect(original['Flow']).to.deep.equal(['MyFlow']);
  });
});

// ---------------------------------------------------------------------------
// queryFlowVersions
// ---------------------------------------------------------------------------
describe('queryFlowVersions', () => {
  it('returns nothing and never queries the org for an empty Flow list', async () => {
    const conn = mockConn({ flowQueryThrows: true });
    expect(await queryFlowVersions([], conn, null)).to.deep.equal({});
  });

  it('groups versions per Flow, sorted oldest first', async () => {
    const conn = mockConn({
      flowVersions: [
        flowVersionRecord('MyFlow', 3),
        flowVersionRecord('MyFlow', 1),
        flowVersionRecord('MyFlow', 2, 'Active'),
        flowVersionRecord('Other', 7),
      ],
    });
    const result = await queryFlowVersions(['MyFlow', 'Other'], conn, null);
    expect(result['MyFlow'].map((v) => v.versionNumber)).to.deep.equal([1, 2, 3]);
    expect(result['MyFlow'][1].status).to.equal('Active');
    expect(result['Other'].map((v) => v.versionNumber)).to.deep.equal([7]);
  });

  it('only asks for deletable manageable states', async () => {
    const captured: string[] = [];
    await queryFlowVersions(['MyFlow'], mockConn({ capturedQueries: captured }), null);
    expect(captured[0]).to.contain('ManageableState');
    expect(captured[0]).to.contain('unmanaged');
  });

  it('escapes the Flow names it interpolates into the query', async () => {
    const captured: string[] = [];
    await queryFlowVersions(["My'Flow"], mockConn({ capturedQueries: captured }), null);
    expect(captured[0]).to.contain("'My\\'Flow'");
  });

  it('skips records without a Flow name, version number or Id', async () => {
    const conn = mockConn({
      flowVersions: [
        flowVersionRecord('MyFlow', 1),
        { VersionNumber: 2, Definition: {} },
        { Id: '301x', Definition: { DeveloperName: 'MyFlow' } },
        { Id: '', VersionNumber: 3, Definition: { DeveloperName: 'MyFlow' } },
      ],
    });
    const result = await queryFlowVersions(['MyFlow'], conn, null);
    expect(result['MyFlow']).to.have.length(1);
  });

  it('fails fast when the query can not run', async () => {
    let threw = false;
    try {
      await queryFlowVersions(['MyFlow'], mockConn({ flowQueryThrows: true }), null);
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// queryFlowDefinitions
// ---------------------------------------------------------------------------
describe('queryFlowDefinitions', () => {
  it('reports whether each Flow has an active version', async () => {
    const conn = mockConn({
      flowDefinitions: [
        { Id: '300xx01', DeveloperName: 'ActiveFlow', ActiveVersionId: '301xx05' },
        { Id: '300xx02', DeveloperName: 'InactiveFlow', ActiveVersionId: null },
      ],
    });
    const result = await queryFlowDefinitions(['ActiveFlow', 'InactiveFlow'], conn, null);
    expect(result['ActiveFlow']).to.deep.equal({ id: '300xx01', hasActiveVersion: true });
    expect(result['InactiveFlow']).to.deep.equal({ id: '300xx02', hasActiveVersion: false });
  });

  it('returns nothing for an empty Flow list', async () => {
    expect(await queryFlowDefinitions([], mockConn({ definitionQueryThrows: true }), null)).to.deep.equal({});
  });

  it('escapes the Flow names it interpolates into the query', async () => {
    const captured: string[] = [];
    await queryFlowDefinitions(["My'Flow"], mockConn({ capturedQueries: captured }), null);
    expect(captured[0]).to.contain("'My\\'Flow'");
  });

  it('fails fast when the query can not run', async () => {
    let threw = false;
    try {
      await queryFlowDefinitions(['MyFlow'], mockConn({ definitionQueryThrows: true }), null);
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// queryFlowInterviewIdsByFlow
// ---------------------------------------------------------------------------
describe('queryFlowInterviewIdsByFlow', () => {
  it('returns nothing without Flow names', async () => {
    expect(await queryFlowInterviewIdsByFlow([], mockConn(), null)).to.deep.equal({});
  });

  it('fails closed without a Salesforce connection', async () => {
    let error: Error | undefined;
    try {
      await queryFlowInterviewIdsByFlow(['MyFlow'], null, null);
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).to.contain('Missing Salesforce connection');
  });

  it('returns nothing when the Flows have no version view', async () => {
    expect(await queryFlowInterviewIdsByFlow(['MyFlow'], mockConn({ versionViews: [] }), null)).to.deep.equal({});
  });

  it('groups the interview Ids per Flow and dedupes them', async () => {
    const conn = mockConn({
      versionViews: [
        { DurableId: '301AB0000012345678', FlowDefinitionView: { ApiName: 'MyFlow' } },
        { DurableId: '301CD0000087654321', FlowDefinitionView: { ApiName: 'OtherFlow' } },
      ],
      interviews: [
        { Id: '0Fo1', FlowVersionViewId: '301AB0000012345' },
        { Id: '0Fo1', FlowVersionViewId: '301AB0000012345678' },
        { Id: '0Fo2', FlowVersionViewId: '301CD0000087654321' },
      ],
    });
    const result = await queryFlowInterviewIdsByFlow(['MyFlow', 'OtherFlow'], conn, null);
    expect(result['MyFlow']).to.deep.equal(['0Fo1']);
    expect(result['OtherFlow']).to.deep.equal(['0Fo2']);
  });

  it('restricts interviews to the exact requested Flow versions', async () => {
    const conn = mockConn({
      versionViews: [
        { DurableId: '301AB0000011111111', FlowDefinitionView: { ApiName: 'MyFlow' } },
        { DurableId: '301AB0000022222222', FlowDefinitionView: { ApiName: 'MyFlow' } },
      ],
      interviews: [
        { Id: '0FoOld', FlowVersionViewId: '301AB0000011111' },
        { Id: '0FoActive', FlowVersionViewId: '301AB0000022222' },
      ],
    });
    const result = await queryFlowInterviewIdsByFlow(['MyFlow'], conn, null, {
      versionIdsByFlow: { MyFlow: ['301AB0000011111111'] },
    });
    expect(result).to.deep.equal({ MyFlow: ['0FoOld'] });
  });

  it('matches FlowInterview on both the 18-char and 15-char DurableId (Salesforce quirk)', async () => {
    const captured: string[] = [];
    const conn = mockConn({
      versionViews: [{ DurableId: '301AB0000012345678', FlowDefinitionView: { ApiName: 'MyFlow' } }],
      interviews: [{ Id: '0Fo1', FlowVersionViewId: '301AB0000012345' }],
      capturedQueries: captured,
    });
    await queryFlowInterviewIdsByFlow(['MyFlow'], conn, null);
    const interviewQuery = captured.find((q) => q.includes('FROM FlowInterview')) || '';
    expect(interviewQuery).to.contain("'301AB0000012345'");
    expect(interviewQuery).to.contain("'301AB0000012345678'");
  });

  it('does not filter on InterviewStatus: any surviving interview blocks the deletion', async () => {
    const captured: string[] = [];
    const conn = mockConn({
      versionViews: [{ DurableId: '301AB0000012345678', FlowDefinitionView: { ApiName: 'MyFlow' } }],
      interviews: [{ Id: '0Fo1', FlowVersionViewId: '301AB0000012345' }],
      capturedQueries: captured,
    });
    await queryFlowInterviewIdsByFlow(['MyFlow'], conn, null);
    const interviewQuery = captured.find((q) => q.includes('FROM FlowInterview')) || '';
    expect(interviewQuery).to.not.contain('InterviewStatus');
  });

  it('chunks the FlowInterview query, so many Flow versions can not overflow the SOQL length limit', async () => {
    // 500 versions = 1000 Ids in the IN clause (18-char and 15-char form of each), chunked by 400.
    // The varying digits stay inside the first 15 characters, so each version has a distinct 15-char form.
    const versionViews = Array.from({ length: 500 }, (_, index) => ({
      DurableId: `301MyFl${String(index + 1).padStart(8, '0')}AAA`,
      FlowDefinitionView: { ApiName: 'MyFlow' },
    }));
    const captured: string[] = [];
    const conn = mockConn({
      versionViews,
      interviews: [{ Id: '0Fo1', FlowVersionViewId: '301MyFl00000001' }],
      capturedQueries: captured,
    });
    const result = await queryFlowInterviewIdsByFlow(['MyFlow'], conn, null);
    // Every chunk answers with the same interview, so the grouping must still report it once.
    expect(result).to.deep.equal({ MyFlow: ['0Fo1'] });
    const interviewQueries = captured.filter((q) => q.includes('FROM FlowInterview'));
    expect(interviewQueries).to.have.length(3);
    for (const query of interviewQueries) {
      expect(query.length).to.be.lessThan(20000);
    }
  });

  it('escapes the Flow names it interpolates into the version view query', async () => {
    const captured: string[] = [];
    await queryFlowInterviewIdsByFlow(["My'Flow"], mockConn({ versionViews: [], capturedQueries: captured }), null);
    const versionViewQuery = captured.find((q) => q.includes('FROM FlowVersionView')) || '';
    expect(versionViewQuery).to.contain("'My\\'Flow'");
  });

  it('ignores interviews whose version view is unknown', async () => {
    const conn = mockConn({
      versionViews: [{ DurableId: '301AB0000012345678', FlowDefinitionView: { ApiName: 'MyFlow' } }],
      interviews: [{ Id: '0Fo9', FlowVersionViewId: '301ZZ0000099999' }],
    });
    expect(await queryFlowInterviewIdsByFlow(['MyFlow'], conn, null)).to.deep.equal({});
  });

  it('throws when either safety query fails', async () => {
    for (const conn of [
      mockConn({ versionViewQueryThrows: true }),
      mockConn({
        versionViews: [{ DurableId: '301AB0000012345678', FlowDefinitionView: { ApiName: 'MyFlow' } }],
        interviewQueryThrows: true,
      }),
    ]) {
      let error: Error | undefined;
      try {
        await queryFlowInterviewIdsByFlow(['MyFlow'], conn, null);
      } catch (caught) {
        error = caught as Error;
      }
      expect(error?.message).to.contain('Flow Interviews');
    }
  });

  it('allows the purge fallback to opt out of query failures explicitly', async () => {
    expect(
      await queryFlowInterviewIdsByFlow(['MyFlow'], mockConn({ versionViewQueryThrows: true }), null, {
        failOnError: false,
      })
    ).to.deep.equal({});
  });

  it('flattens to a plain Id list for hardis:org:purge:flow', async () => {
    const conn = mockConn({
      versionViews: [
        { DurableId: '301AB0000012345678', FlowDefinitionView: { ApiName: 'MyFlow' } },
        { DurableId: '301CD0000087654321', FlowDefinitionView: { ApiName: 'OtherFlow' } },
      ],
      interviews: [
        { Id: '0Fo1', FlowVersionViewId: '301AB0000012345' },
        { Id: '0Fo2', FlowVersionViewId: '301CD0000087654' },
      ],
    });
    expect(await queryFlowInterviewIdsForFlows(['MyFlow', 'OtherFlow'], conn, null)).to.have.members(['0Fo1', '0Fo2']);
  });
});

// ---------------------------------------------------------------------------
// deactivateFlowViaToolingApi
// ---------------------------------------------------------------------------
describe('deactivateFlowViaToolingApi', () => {
  it('sets activeVersionNumber to 0 on the FlowDefinition', async () => {
    const updateCalls: any[] = [];
    await deactivateFlowViaToolingApi('MyFlow', '300xx01', mockConn({ updateCalls }), null);
    expect(updateCalls).to.have.length(1);
    expect(updateCalls[0].name).to.equal('FlowDefinition');
    expect(updateCalls[0].record).to.deep.equal({ Id: '300xx01', Metadata: { activeVersionNumber: 0 } });
  });

  it('throws when the update fails', async () => {
    let threw = false;
    try {
      await deactivateFlowViaToolingApi('MyFlow', '300xx01', mockConn({ updateThrows: true }), null);
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// deleteFlowVersionsViaToolingApi
// ---------------------------------------------------------------------------
describe('deleteFlowVersionsViaToolingApi', () => {
  function version(versionNumber: number): any {
    return { id: `301id${versionNumber}`, versionNumber, status: 'Obsolete' };
  }

  it('deletes oldest version first', async () => {
    const destroyCalls: any[] = [];
    const conn = mockConn({ destroyCalls });
    const res = await deleteFlowVersionsViaToolingApi('MyFlow', [version(3), version(1), version(2)], conn, null);
    expect(destroyCalls[0].recordIds).to.deep.equal(['301id1', '301id2', '301id3']);
    expect(res.deletedVersions).to.deep.equal([1, 2, 3]);
    expect(res.errors).to.be.empty;
  });

  it('does nothing for an empty version list', async () => {
    const destroyCalls: any[] = [];
    const res = await deleteFlowVersionsViaToolingApi('MyFlow', [], mockConn({ destroyCalls }), null);
    expect(destroyCalls).to.be.empty;
    expect(res.deletedVersions).to.be.empty;
  });

  it('chunks the deletes to the 25-subrequest Tooling composite limit', async () => {
    const destroyCalls: any[] = [];
    const versions = Array.from({ length: 27 }, (_unused, index) => version(index + 1));
    await deleteFlowVersionsViaToolingApi('MyFlow', versions, mockConn({ destroyCalls }), null);
    expect(destroyCalls).to.have.length(2);
    expect(destroyCalls[0].recordIds).to.have.length(25);
    expect(destroyCalls[1].recordIds).to.have.length(2);
  });

  it('treats an already deleted version as a success (idempotency)', async () => {
    const conn = mockConn({
      destroyResults: [{ id: '301id1', success: false, errors: [{ statusCode: 'ENTITY_IS_DELETED', message: 'entity is deleted' }] }],
    });
    const res = await deleteFlowVersionsViaToolingApi('MyFlow', [version(1)], conn, null);
    expect(res.deletedVersions).to.deep.equal([1]);
    expect(res.errors).to.be.empty;
  });

  it('treats a stale version id as a success (real Tooling FIELD_INTEGRITY_EXCEPTION wording)', async () => {
    const conn = mockConn({
      destroyResults: [
        {
          id: '301id1',
          success: false,
          errors: [{ statusCode: 'FIELD_INTEGRITY_EXCEPTION', message: 'Unable to load specified entity 301S70000009RJfIAM' }],
        },
      ],
    });
    const res = await deleteFlowVersionsViaToolingApi('MyFlow', [version(1)], conn, null);
    expect(res.deletedVersions).to.deep.equal([1]);
    expect(res.errors).to.be.empty;
  });

  it('reports a Flow Interview block so the caller can retry', async () => {
    const conn = mockConn({
      destroyResults: [
        { id: '301id1', success: false, errors: [{ message: 'This flow version is referenced in a flow interview : Flow Interview - 0FoS800000CylEs' }] },
      ],
    });
    const res = await deleteFlowVersionsViaToolingApi('MyFlow', [version(1)], conn, null);
    expect(res.blockedByInterviews).to.be.true;
    expect(res.deletedVersions).to.be.empty;
    expect(res.errors).to.have.length(1);
  });

  it('reports a non-interview failure without flagging an interview block', async () => {
    const conn = mockConn({
      destroyResults: { results: [{ Id: '301id1', success: false, error: 'INSUFFICIENT_ACCESS' }] },
    });
    const res = await deleteFlowVersionsViaToolingApi('MyFlow', [version(1)], conn, null);
    expect(res.blockedByInterviews).to.be.false;
    expect(res.errors).to.have.length(1);
    expect(res.errors[0]).to.contain('INSUFFICIENT_ACCESS');
  });

  it('falls back to unitary deletes when the composite call fails', async () => {
    const destroyCalls: any[] = [];
    const conn = mockConn({ destroyCalls, destroyThrows: true });
    const res = await deleteFlowVersionsViaToolingApi('MyFlow', [version(1), version(2)], conn, null);
    // First entry is the failed composite attempt, then one unitary delete per record.
    expect(destroyCalls).to.have.length(3);
    expect(destroyCalls[1].recordIds).to.deep.equal(['301id1']);
    expect(destroyCalls[2].recordIds).to.deep.equal(['301id2']);
    expect(res.deletedVersions).to.deep.equal([1, 2]);
    expect(res.errors).to.be.empty;
  });
});

// ---------------------------------------------------------------------------
// runFlowDeletionPreflight (validation, read-only)
// ---------------------------------------------------------------------------
describe('runFlowDeletionPreflight', () => {
  it('returns nothing when no Flow is pending deletion', async () => {
    expect(await runFlowDeletionPreflight([], mockConn(), null, false)).to.be.empty;
  });

  it('plans a whole-Flow deletion and names the active version', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2, 'Active')],
    });
    const outcomes = await runFlowDeletionPreflight([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(outcomes[0].versionsToDelete).to.deep.equal([1, 2]);
    expect(outcomes[0].previousActiveVersion).to.equal(2);
    expect(outcomes[0].wholeFlow).to.be.true;
  });

  it('restricts the plan to the requested versions', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2), flowVersionRecord('MyFlow', 3)],
    });
    const outcomes = await runFlowDeletionPreflight([{ flowName: 'MyFlow', requestedVersions: [2] }], conn, null, false);
    expect(outcomes[0].versionsToDelete).to.deep.equal([2]);
    expect(outcomes[0].wholeFlow).to.be.false;
  });

  it('ignores interviews on versions that are not requested', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2, 'Active')],
      versionViews: [flowVersionViewRecord('MyFlow', 1), flowVersionViewRecord('MyFlow', 2)],
      interviews: [flowInterviewRecord('0FoActive', 'MyFlow', 2)],
    });
    const outcomes = await runFlowDeletionPreflight(
      [{ flowName: 'MyFlow', requestedVersions: [1] }],
      conn,
      null,
      false
    );
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(outcomes[0].interviewCount).to.equal(0);
  });

  it('reports an absent Flow as a no-op, not an error', async () => {
    const outcomes = await runFlowDeletionPreflight(
      [{ flowName: 'GoneFlow', requestedVersions: null }],
      mockConn({ flowVersions: [] }),
      null,
      false
    );
    expect(outcomes[0].status).to.equal('FLOW_DELETE_NOOP');
  });

  it('blocks when interviews exist and their deletion is not authorized', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1)],
      versionViews: [flowVersionViewRecord('MyFlow', 1)],
      interviews: [flowInterviewRecord('0Fo1', 'MyFlow', 1)],
    });
    const outcomes = await runFlowDeletionPreflight([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('FLOW_DELETE_BLOCKED');
    expect(outcomes[0].interviewCount).to.equal(1);
    expect(outcomes[0].message).to.contain('FLOW_DELETE_INTERVIEWS');
  });

  it('passes when interviews exist and their deletion is authorized', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1)],
      versionViews: [flowVersionViewRecord('MyFlow', 1)],
      interviews: [flowInterviewRecord('0Fo1', 'MyFlow', 1)],
    });
    const outcomes = await runFlowDeletionPreflight([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, true);
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(outcomes[0].interviewCount).to.equal(1);
  });

  it('never mutates the org', async () => {
    const updateCalls: any[] = [];
    const destroyCalls: any[] = [];
    const conn = mockConn({ flowVersions: [flowVersionRecord('MyFlow', 1, 'Active')], updateCalls, destroyCalls });
    await runFlowDeletionPreflight([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, true);
    expect(updateCalls).to.be.empty;
    expect(destroyCalls).to.be.empty;
  });
});

// ---------------------------------------------------------------------------
// runFlowDeletionPostStep (real deployment)
// ---------------------------------------------------------------------------
describe('runFlowDeletionPostStep', () => {
  it('returns nothing when no Flow is pending deletion', async () => {
    expect(await runFlowDeletionStep([], mockConn(), null, false)).to.be.empty;
  });

  it('deactivates then deletes every version of a whole Flow', async () => {
    const updateCalls: any[] = [];
    const destroyCalls: any[] = [];
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2, 'Active')],
      flowVersionsAfterDelete: [],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: '301xx02' }],
      updateCalls,
      destroyCalls,
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(outcomes[0].previousActiveVersion).to.equal(2);
    expect(outcomes[0].versionsDeleted).to.deep.equal([1, 2]);
    expect(updateCalls).to.have.length(1);
    expect(destroyCalls[0].recordIds).to.have.length(2);
  });

  it('skips an absent Flow without touching the org', async () => {
    const updateCalls: any[] = [];
    const destroyCalls: any[] = [];
    const conn = mockConn({ flowVersions: [], flowDefinitions: [], updateCalls, destroyCalls });
    const outcomes = await runFlowDeletionStep([{ flowName: 'GoneFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('FLOW_DELETE_NOOP');
    expect(updateCalls).to.be.empty;
    expect(destroyCalls).to.be.empty;
  });

  it('does not deactivate a Flow that has no active version', async () => {
    const updateCalls: any[] = [];
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1)],
      flowVersionsAfterDelete: [],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
      updateCalls,
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(updateCalls).to.be.empty;
  });

  it('deactivates a whole Flow on ActiveVersionId even when no listed version reports Active', async () => {
    // The manageable-state filter can hide the active version from the version list, so a whole-Flow
    // deletion trusts FlowDefinition.ActiveVersionId rather than the listed statuses.
    const updateCalls: any[] = [];
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1)],
      flowVersionsAfterDelete: [],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: '301hidden' }],
      updateCalls,
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(outcomes[0].previousActiveVersion).to.be.null;
    expect(updateCalls).to.have.length(1);
  });

  it('does not take a live Flow offline when only an obsolete version is deleted', async () => {
    const updateCalls: any[] = [];
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2, 'Active')],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: '301xx02' }],
      updateCalls,
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: [1] }], conn, null, false);
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(outcomes[0].versionsDeleted).to.deep.equal([1]);
    expect(updateCalls).to.be.empty;
  });

  it('deactivates when the requested version is the active one', async () => {
    const updateCalls: any[] = [];
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2, 'Active')],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: '301xx02' }],
      updateCalls,
    });
    await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: [2] }], conn, null, false);
    expect(updateCalls).to.have.length(1);
  });

  it('blocks after deactivating when interviews remain and their deletion is not authorized', async () => {
    const updateCalls: any[] = [];
    const destroyCalls: any[] = [];
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1, 'Active')],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: '301xx01' }],
      versionViews: [flowVersionViewRecord('MyFlow', 1)],
      interviews: [flowInterviewRecord('0Fo1', 'MyFlow', 1)],
      updateCalls,
      destroyCalls,
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('FLOW_DELETE_BLOCKED');
    // Deactivation happened first, so no new interview can accrue and a retry converges
    expect(updateCalls).to.have.length(1);
    expect(destroyCalls).to.be.empty;
    expect(outcomes[0].message).to.contain('FLOW_DELETE_BLOCKED');
  });

  it('reports a missing FlowDefinition as an error instead of aborting the batch', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MissingDefinition', 1, 'Active'), flowVersionRecord('OkFlow', 1)],
      flowDefinitions: [{ Id: '300xx02', DeveloperName: 'OkFlow', ActiveVersionId: null }],
    });
    const outcomes = await runFlowDeletionStep(
      [
        { flowName: 'MissingDefinition', requestedVersions: null },
        { flowName: 'OkFlow', requestedVersions: [1] },
      ],
      conn,
      null,
      false
    );
    expect(outcomes.map((outcome) => outcome.status)).to.deep.equal(['FLOW_DELETE_ERROR', 'SUCCESS']);
    expect(outcomes[0].message).to.contain('FlowDefinition');
  });

  it('reports a non-interview deletion failure as an error, not an interview block', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1)],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
      destroyResults: [{ id: '301MyFlow100000000', success: false, error: 'INSUFFICIENT_ACCESS' }],
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('FLOW_DELETE_ERROR');
    expect(outcomes[0].versionsDeleted).to.be.empty;
    expect(outcomes[0].message).to.contain('INSUFFICIENT_ACCESS');
  });

  it('reports a transport error as an error with a FLOW_DELETE_ERROR message', async () => {
    // The version query dies mid-run (network fault): the Flow must not report as interview-blocked.
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1)],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
      versionViewQueryThrows: true,
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('FLOW_DELETE_ERROR');
    expect(outcomes[0].message).to.contain('FLOW_DELETE_ERROR');
  });

  it('retries the version deletion when the blocking interviews resolved on their own', async () => {
    const previousDelay = process.env.FLOW_DELETE_RETRY_DELAY_MS;
    process.env.FLOW_DELETE_RETRY_DELAY_MS = '0';
    try {
      const conn = mockConn({
        flowVersions: [flowVersionRecord('MyFlow', 1)],
        flowVersionsAfterDelete: [],
        flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
        // The interview blocking the first delete attempt finished on its own: no query sees it.
        destroyResultsSequence: [
          [
            {
              id: flowVersionRecord('MyFlow', 1).Id,
              success: false,
              errors: [{ message: 'This flow version is referenced in a flow interview : Flow Interview - 0FoS800000CylEs' }],
            },
          ],
          [],
        ],
      });
      const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, true);
      expect(outcomes[0].status).to.equal('SUCCESS');
      expect(outcomes[0].versionsDeleted).to.deep.equal([1]);
    } finally {
      if (previousDelay === undefined) {
        delete process.env.FLOW_DELETE_RETRY_DELAY_MS;
      } else {
        process.env.FLOW_DELETE_RETRY_DELAY_MS = previousDelay;
      }
    }
  });

  it('still deletes the versions when the attempt count env var is unusable', async () => {
    // A NaN (or zero) attempt count must not turn the retry loop into zero delete attempts.
    await withEnv({ FLOW_DELETE_MAX_ATTEMPTS: 'abc', FLOW_DELETE_RETRY_DELAY_MS: '0' }, async () => {
      const conn = mockConn({
        flowVersions: [flowVersionRecord('MyFlow', 1)],
        flowVersionsAfterDelete: [],
        flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
      });
      const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, true);
      expect(outcomes[0].status).to.equal('SUCCESS');
      expect(outcomes[0].versionsDeleted).to.deep.equal([1]);
    });
  });

  it('uses the retry settings it is given instead of reading the environment', async () => {
    await withEnv({ FLOW_DELETE_MAX_ATTEMPTS: '9', FLOW_DELETE_RETRY_DELAY_MS: '60000' }, async () => {
      const conn = mockConn({
        flowVersions: [flowVersionRecord('MyFlow', 1)],
        flowVersionsAfterDelete: [],
        flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
        // Blocked on every attempt: with maxAttempts 1 the run must not wait for the 60s delay.
        destroyResults: [
          {
            id: flowVersionRecord('MyFlow', 1).Id,
            success: false,
            errors: [{ message: 'This flow version is referenced in a flow interview : Flow Interview - 0FoS800000CylEs' }],
          },
        ],
      });
      const outcomes = await runFlowDeletionStep(
        [{ flowName: 'MyFlow', requestedVersions: null }],
        conn,
        null,
        true,
        'post',
        { maxAttempts: 1, retryDelayMs: 0 }
      );
      expect(outcomes[0].status).to.equal('FLOW_DELETE_BLOCKED');
    });
  });

  it('processes Flows independently, so one blocked Flow does not stop the others', async () => {
    // BlockedFlow has an interview, OkFlow has none: the version views only map to BlockedFlow
    const conn = mockConn({
      flowVersions: [flowVersionRecord('BlockedFlow', 1), flowVersionRecord('OkFlow', 1)],
      flowVersionsAfterDelete: [],
      flowDefinitions: [
        { Id: '300xx01', DeveloperName: 'BlockedFlow', ActiveVersionId: null },
        { Id: '300xx02', DeveloperName: 'OkFlow', ActiveVersionId: null },
      ],
      versionViews: [flowVersionViewRecord('BlockedFlow', 1)],
      interviews: [flowInterviewRecord('0Fo1', 'BlockedFlow', 1)],
    });
    const outcomes = await runFlowDeletionStep(
      [
        { flowName: 'BlockedFlow', requestedVersions: null },
        { flowName: 'OkFlow', requestedVersions: null },
      ],
      conn,
      null,
      false
    );
    expect(outcomes.map((outcome) => outcome.status)).to.deep.equal(['FLOW_DELETE_BLOCKED', 'SUCCESS']);
  });

  it('reports an error when a whole-Flow deletion leaves a version behind', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1)],
      // A version appeared mid-run, or the deletion did not take: either way the Flow is not gone.
      flowVersionsAfterDelete: [flowVersionRecord('MyFlow', 2)],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: null }], conn, null, false);
    expect(outcomes[0].status).to.equal('FLOW_DELETE_ERROR');
  });

  // A "not found" delete counts as already deleted, so a systematically wrong endpoint or API version
  // would report every version as deleted. The org query after the deletion is what catches it.
  it('reports an error when a versioned member is still in the org after a "not found" delete', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2)],
      flowVersionsAfterDelete: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2)],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
      destroyResults: [
        {
          id: flowVersionRecord('MyFlow', 1).Id,
          success: false,
          errors: [{ statusCode: 'NOT_FOUND', message: 'The requested resource does not exist' }],
        },
      ],
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: [1] }], conn, null, false);
    expect(outcomes[0].status).to.equal('FLOW_DELETE_ERROR');
    expect(outcomes[0].message).to.contain('MyFlow');
  });

  it('lets a versioned member succeed while the versions it did not ask for stay in the org', async () => {
    const conn = mockConn({
      flowVersions: [flowVersionRecord('MyFlow', 1), flowVersionRecord('MyFlow', 2)],
      flowVersionsAfterDelete: [flowVersionRecord('MyFlow', 2)],
      flowDefinitions: [{ Id: '300xx01', DeveloperName: 'MyFlow', ActiveVersionId: null }],
    });
    const outcomes = await runFlowDeletionStep([{ flowName: 'MyFlow', requestedVersions: [1] }], conn, null, false);
    expect(outcomes[0].status).to.equal('SUCCESS');
    expect(outcomes[0].versionsDeleted).to.deep.equal([1]);
  });
});

// ---------------------------------------------------------------------------
// resolveFlowDeletionRetrySettings
// ---------------------------------------------------------------------------
describe('resolveFlowDeletionRetrySettings', () => {
  const CLEARED = { FLOW_DELETE_MAX_ATTEMPTS: undefined, FLOW_DELETE_RETRY_DELAY_MS: undefined };

  it('defaults to 3 attempts every 10 seconds', async () => {
    await withEnv(CLEARED, () => {
      expect(resolveFlowDeletionRetrySettings(null)).to.deep.equal({ maxAttempts: 3, retryDelayMs: 10000 });
    });
  });

  it('reads both env vars', async () => {
    await withEnv({ FLOW_DELETE_MAX_ATTEMPTS: '5', FLOW_DELETE_RETRY_DELAY_MS: '0' }, () => {
      expect(resolveFlowDeletionRetrySettings(null)).to.deep.equal({ maxAttempts: 5, retryDelayMs: 0 });
    });
  });

  it('reads the .sfdx-hardis.yml properties when no env var is set', async () => {
    await withEnv(CLEARED, () => {
      const settings = resolveFlowDeletionRetrySettings(null, { flowDeleteMaxAttempts: 4, flowDeleteRetryDelayMs: 500 });
      expect(settings).to.deep.equal({ maxAttempts: 4, retryDelayMs: 500 });
    });
  });

  it('lets the env var win over the config property', async () => {
    await withEnv({ FLOW_DELETE_MAX_ATTEMPTS: '7', FLOW_DELETE_RETRY_DELAY_MS: undefined }, () => {
      const settings = resolveFlowDeletionRetrySettings(null, { flowDeleteMaxAttempts: 4, flowDeleteRetryDelayMs: 500 });
      expect(settings).to.deep.equal({ maxAttempts: 7, retryDelayMs: 500 });
    });
  });

  // A NaN or zero attempt count used to make the retry loop run zero delete attempts, and report
  // "versions remaining" without a single attempt having been made.
  it('falls back to the default for a value that is not a usable integer', async () => {
    for (const rawValue of ['abc', '0', '-1', '2.5', '']) {
      await withEnv({ FLOW_DELETE_MAX_ATTEMPTS: rawValue, FLOW_DELETE_RETRY_DELAY_MS: undefined }, () => {
        expect(resolveFlowDeletionRetrySettings(null).maxAttempts, `value ${JSON.stringify(rawValue)}`).to.equal(3);
      });
    }
  });

  it('accepts a zero retry delay but refuses a negative one', async () => {
    await withEnv({ FLOW_DELETE_MAX_ATTEMPTS: undefined, FLOW_DELETE_RETRY_DELAY_MS: '0' }, () => {
      expect(resolveFlowDeletionRetrySettings(null).retryDelayMs).to.equal(0);
    });
    await withEnv({ FLOW_DELETE_MAX_ATTEMPTS: undefined, FLOW_DELETE_RETRY_DELAY_MS: '-5' }, () => {
      expect(resolveFlowDeletionRetrySettings(null).retryDelayMs).to.equal(10000);
    });
  });

  it('falls back to the default for an unusable config property too', async () => {
    await withEnv(CLEARED, () => {
      const settings = resolveFlowDeletionRetrySettings(null, {
        flowDeleteMaxAttempts: 'many',
        flowDeleteRetryDelayMs: -1,
      });
      expect(settings).to.deep.equal({ maxAttempts: 3, retryDelayMs: 10000 });
      // A boolean would pass as 1 through Number(), so it has to be refused as well
      expect(resolveFlowDeletionRetrySettings(null, { flowDeleteMaxAttempts: true }).maxAttempts).to.equal(3);
    });
  });
});

// ---------------------------------------------------------------------------
// worstFlowDeletionStatus
// ---------------------------------------------------------------------------
describe('worstFlowDeletionStatus', () => {
  function outcome(status: any): any {
    return { status };
  }

  it('lets a single blocked Flow win over successes', () => {
    expect(worstFlowDeletionStatus([outcome('SUCCESS'), outcome('FLOW_DELETE_BLOCKED')])).to.equal('FLOW_DELETE_BLOCKED');
  });

  it('lets an error win over an interview block', () => {
    expect(
      worstFlowDeletionStatus([outcome('FLOW_DELETE_BLOCKED'), outcome('FLOW_DELETE_ERROR'), outcome('SUCCESS')])
    ).to.equal('FLOW_DELETE_ERROR');
  });

  it('reports a no-op only when every Flow was a no-op', () => {
    expect(worstFlowDeletionStatus([outcome('FLOW_DELETE_NOOP'), outcome('FLOW_DELETE_NOOP')])).to.equal('FLOW_DELETE_NOOP');
    expect(worstFlowDeletionStatus([outcome('FLOW_DELETE_NOOP'), outcome('SUCCESS')])).to.equal('SUCCESS');
  });

  it('reports success for an empty list', () => {
    expect(worstFlowDeletionStatus([])).to.equal('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// buildFlowDeletionMarkdown
// ---------------------------------------------------------------------------
describe('buildFlowDeletionMarkdown', () => {
  function outcome(overrides: any = {}): any {
    return {
      flowName: 'MyFlow',
      status: 'SUCCESS',
      wholeFlow: true,
      previousActiveVersion: 2,
      versionsToDelete: [1, 2],
      versionsDeleted: [],
      interviewCount: 0,
      interviewsDeleted: 0,
      deleteInterviewsAllowed: false,
      message: '',
      ...overrides,
    };
  }

  it('returns an empty string with no outcome', () => {
    expect(buildFlowDeletionMarkdown([])).to.equal('');
  });

  function tableLine(markdown: string, startsWith: string): string {
    return markdown.split('\n').find((line) => line.startsWith(startsWith)) || '';
  }

  it('lists the Flow, its versions and its active version', () => {
    const markdown = buildFlowDeletionMarkdown([outcome()]);
    expect(markdown).to.contain('`MyFlow`');
    expect(markdown).to.contain('1, 2');
    expect(markdown).to.contain('✅');
  });

  it('shows the same columns as the console table', () => {
    const markdown = buildFlowDeletionMarkdown([
      outcome({ versionsDeleted: [1], interviewCount: 3, interviewsDeleted: 2 }),
    ]);
    expect(tableLine(markdown, '| Flow |')).to.equal(
      '| Flow | Status | Scope | Active version | Versions targeted | Versions deleted | Interviews blocking | Interviews deleted |'
    );
    expect(tableLine(markdown, '| `MyFlow`')).to.equal('| `MyFlow` | ✅ | Whole Flow | 2 | 1, 2 | 1 | 3 | 2 |');
  });

  it('spells out an inactive Flow and dashes the empty cells', () => {
    const markdown = buildFlowDeletionMarkdown([outcome({ previousActiveVersion: null, versionsToDelete: [] })]);
    expect(tableLine(markdown, '| `MyFlow`')).to.equal('| `MyFlow` | ✅ | Whole Flow | already inactive | - | - | 0 | 0 |');
  });

  it('reports a versioned deletion as a partial scope', () => {
    const markdown = buildFlowDeletionMarkdown([outcome({ wholeFlow: false, versionsToDelete: [3] })]);
    expect(tableLine(markdown, '| `MyFlow`')).to.contain('| Selected versions |');
  });

  it('warns about the Flow Interviews that are still to be deleted', () => {
    const notAuthorized = buildFlowDeletionMarkdown([outcome({ interviewCount: 4 })]);
    expect(notAuthorized).to.contain('| 4 | 0 |');
    expect(notAuthorized).to.not.contain('⚠️');
    const authorized = buildFlowDeletionMarkdown([outcome({ interviewCount: 4, deleteInterviewsAllowed: true })]);
    expect(authorized).to.contain('⚠️ 4 Flow Interview(s) will be deleted for good');
    const alreadyDeleted = buildFlowDeletionMarkdown([
      outcome({ interviewCount: 4, interviewsDeleted: 4, deleteInterviewsAllowed: true }),
    ]);
    expect(alreadyDeleted).to.not.contain('⚠️');
  });

  it('appends the blocking message of a blocked Flow', () => {
    const markdown = buildFlowDeletionMarkdown([outcome({ status: 'FLOW_DELETE_BLOCKED', message: 'blocked because reasons' })]);
    expect(markdown).to.contain('❌');
    expect(markdown).to.contain('> blocked because reasons');
  });

  it('marks an absent Flow as a no-op', () => {
    const markdown = buildFlowDeletionMarkdown([outcome({ status: 'FLOW_DELETE_NOOP', versionsToDelete: [] })]);
    expect(markdown).to.contain('➖');
  });
});

// ---------------------------------------------------------------------------
// extractBlockingFlowInterviewIds (still used by hardis:org:purge:flow)
// ---------------------------------------------------------------------------
describe('extractBlockingFlowInterviewIds', () => {
  it('extracts full 18 char and 15 char Ids and dedupes', async () => {
    const errorText =
      'Cannot delete: Flow Interview - 301xx000003TestAAC and Flow Interview - 301yy000004Case ' +
      'and again Flow Interview - 301xx000003TestAAC';
    const ids = await extractBlockingFlowInterviewIds(errorText);
    expect(ids).to.have.members(['301xx000003TestAAC', '301yy000004Case']);
    expect(ids).to.have.length(2);
  });

  it('returns empty when there is no interview reference', async () => {
    expect(await extractBlockingFlowInterviewIds('Some unrelated deployment error')).to.be.empty;
  });

  it('handles empty input', async () => {
    expect(await extractBlockingFlowInterviewIds('')).to.be.empty;
  });
});

// ---------------------------------------------------------------------------
// dedupeFlowInterviewIds
// ---------------------------------------------------------------------------
describe('dedupeFlowInterviewIds', () => {
  it('collapses the 15-char and 18-char forms of the same Id, keeping the 18-char one', () => {
    // The query source returns 18-char Ids, the deletion error source their 15-char prefix.
    expect(dedupeFlowInterviewIds(['301xx000003TestAAC', '301xx000003Test'])).to.deep.equal(['301xx000003TestAAC']);
    expect(dedupeFlowInterviewIds(['301xx000003Test', '301xx000003TestAAC'])).to.deep.equal(['301xx000003TestAAC']);
  });

  it('keeps the 15-char form when it is the only one available', () => {
    expect(dedupeFlowInterviewIds(['301xx000003Test', '301xx000003Test'])).to.deep.equal(['301xx000003Test']);
  });

  it('keeps distinct Ids and their input order', () => {
    expect(
      dedupeFlowInterviewIds(['301yy000004CaseAAC', '301xx000003Test', '301yy000004Case', '301zz000005Item'])
    ).to.deep.equal(['301yy000004CaseAAC', '301xx000003Test', '301zz000005Item']);
  });

  it('treats Ids differing only by case as different records', () => {
    // The 15-char form is case-sensitive: 301xx000003Test and 301xx000003test are two records.
    expect(dedupeFlowInterviewIds(['301xx000003Test', '301xx000003test'])).to.have.length(2);
  });

  it('drops empty entries and handles an empty list', () => {
    expect(dedupeFlowInterviewIds(['', '301xx000003Test'])).to.deep.equal(['301xx000003Test']);
    expect(dedupeFlowInterviewIds([])).to.be.empty;
  });
});

// ---------------------------------------------------------------------------
// writeFlowDeletionReport
// ---------------------------------------------------------------------------
// The console table must show the current phase only, while the CSV must hold every outcome of the
// run: generateReportPath('flow-deletion', '') is deterministic, so a post-destructive phase writing
// its own outcomes would otherwise overwrite (and lose) the pre-destructive phase's report.
describe('writeFlowDeletionReport', () => {
  // The temp dir is managed here rather than through useTmpDir, because the report path is derived
  // from process.cwd(): the working directory has to be restored before the directory is removed.
  let tmpDir = '';
  let previousCwd = '';
  const previousEnv: Record<string, string | undefined> = {};

  let logged: string[] = [];

  // uxLog writes through commandThis.ux.log when it is present, so a stub captures the table.
  const commandThis: any = { ux: { log: (text: string) => logged.push(text) } };

  function setEnv(name: string, value: string): void {
    previousEnv[name] = process.env[name];
    process.env[name] = value;
  }

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `flow-deletion-report-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tmpDir);
    previousCwd = process.cwd();
    process.chdir(tmpDir);
    // createXlsxFromCsv opens the workbook with the OS default application unless this is set.
    setEnv('NO_OPEN', 'true');
    // generateReportPath puts the current git branch in the file name. isGitRepo() is memoized on the
    // repository the suite started in, so from this temp cwd it still answers "yes" while the git call
    // itself fails. Naming the branch here keeps the report path deterministic and git-free.
    setEnv('CI_COMMIT_REF_NAME', 'unit-test');
    logged = [];
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await fs.remove(tmpDir);
  });

  function outcome(flowName: string, overrides: any = {}): any {
    return {
      flowName,
      status: 'SUCCESS',
      wholeFlow: true,
      previousActiveVersion: 1,
      versionsToDelete: [1],
      versionsDeleted: [1],
      interviewCount: 0,
      interviewsDeleted: 0,
      deleteInterviewsAllowed: false,
      message: '',
      ...overrides,
    };
  }

  // The written CSV, as its header line plus the value of the "Flow" column of every data row.
  async function csvFlows(csvFile: string): Promise<{ header: string; flows: string[] }> {
    const lines = (await fs.readFile(csvFile, 'utf8')).trim().split(/\r?\n/);
    return { header: lines[0], flows: lines.slice(1).map((line) => line.split(',')[0]) };
  }

  // uxLogTable colors its output with chalk, which re-opens the style at the start of every line
  // when the terminal supports colors (GitHub Actions, FORCE_COLOR=1), so strip the escapes first.
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (text: string): string => text.replace(/\u001B\[[0-9;]*m/g, '');

  // The rows of the console table, which uxLogTable emits as a single multi-line log entry.
  function tableFlows(): string[] {
    const table = logged.map(stripAnsi).find((text) => text.includes('Flow ') && text.includes('Versions Deleted'));
    expect(table, 'no console table was logged').to.not.be.undefined;
    return (table as string)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('HardisTest'))
      .map((line) => line.split('|')[0].trim());
  }

  it('writes only the given outcomes when called with two arguments', async () => {
    const outcomes = [outcome('HardisTestFlowOne'), outcome('HardisTestFlowTwo')];
    const result = await writeFlowDeletionReport(outcomes, commandThis);
    const { header, flows } = await csvFlows(result.csvFile);
    expect(header).to.equal('Flow,Status,Scope,Active Version,Versions Targeted,Versions Deleted,Interviews Blocking,Interviews Deleted');
    expect(flows).to.deep.equal(['HardisTestFlowOne', 'HardisTestFlowTwo']);
    expect(tableFlows()).to.deep.equal(['HardisTestFlowOne', 'HardisTestFlowTwo']);
  });

  it('writes every accumulated outcome to the CSV while the table stays on the current phase', async () => {
    const preOutcome = outcome('HardisTestFlowPre');
    const postOutcomes = [outcome('HardisTestFlowOne'), outcome('HardisTestFlowTwo')];
    const allOutcomes = [preOutcome, ...postOutcomes];
    const result = await writeFlowDeletionReport(postOutcomes, commandThis, allOutcomes);
    const { flows } = await csvFlows(result.csvFile);
    // The CSV keeps the pre-destructive row the previous phase already reported...
    expect(flows).to.deep.equal(['HardisTestFlowPre', 'HardisTestFlowOne', 'HardisTestFlowTwo']);
    // ...but the phase table must not grow, or the same Flow is reported twice in one run.
    expect(tableFlows()).to.deep.equal(['HardisTestFlowOne', 'HardisTestFlowTwo']);
  });

  it('writes nothing when the current phase has no outcome, so it cannot truncate a previous phase', async () => {
    const result = await writeFlowDeletionReport([], commandThis, [outcome('HardisTestFlowPre')]);
    expect(result).to.deep.equal({});
    expect(logged).to.be.empty;
    const reportDir = path.join(tmpDir, 'hardis-report');
    expect(fs.existsSync(reportDir) ? await fs.readdir(reportDir) : []).to.be.empty;
  });
});
