/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Load the ticket barrel first, exactly as the CLI does: see ticketProviders.test.ts for the import cycle
import '../../../src/common/ticketProvider/index.js';
import { AzureDevopsTestProvider } from '../../../src/common/testManagementProvider/azureDevopsTestProvider.js';
import { XrayTestProvider } from '../../../src/common/testManagementProvider/xrayTestProvider.js';
import { ServiceNowTestProvider } from '../../../src/common/testManagementProvider/serviceNowTestProvider.js';
import {
  buildTestCasesSummaryMarkdown,
  postTestCasesSummaries,
  testCasesSummaryMarker,
} from '../../../src/common/testManagementProvider/testCasesSummary.js';
import { PushReport } from '../../../src/common/testManagementProvider/index.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookUtils.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

function makeCase(id: string, overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return { id, ticket: id.replace(/-[FT]?\d+$/, ''), kind: 'functional', title: `Title of ${id}`, expected: 'Done', ...overrides };
}

describe('test cases summary on the carrier ticket', () => {
  afterEach(() => setFetchForTests(null));

  it('tells each tool which tracker holds the carrier ticket', () => {
    expect(new AzureDevopsTestProvider(async () => ({}) as any).carrierTicketRef('DSI-2026-14545')).to.deep.equal({ ticketId: '14545', ticketProviderKey: 'azure' });
    expect(new XrayTestProvider().carrierTicketRef('PROJ-123')).to.deep.equal({ ticketId: 'PROJ-123', ticketProviderKey: 'jira' });
    expect(new ServiceNowTestProvider().carrierTicketRef('STRY0010001')).to.deep.equal({ ticketId: 'STRY0010001' });
  });

  it('keeps one summary per tool', () => {
    expect(testCasesSummaryMarker('xray')).to.equal('test-cases:xray');
    expect(testCasesSummaryMarker('xray')).to.not.equal(testCasesSummaryMarker('azure-devops'));
  });

  it('lists every case with its result and its link, escaping what would break the table', () => {
    const cases = [makeCase('PROJ-123-F01', { title: 'Quote | with a pipe' }), makeCase('PROJ-123-F02')];
    const markdown = buildTestCasesSummaryMarkdown('Xray Cloud', cases, [
      { provider: 'Xray Cloud', caseId: 'PROJ-123-F01', action: 'created', trackerId: 'PROJ-9', url: 'https://acme.atlassian.net/browse/PROJ-9' },
      { provider: 'Xray Cloud', caseId: 'PROJ-123-F02', action: 'failed', error: 'Jira refused the link' },
    ]);
    expect(markdown).to.contain('### Test cases in Xray Cloud');
    expect(markdown).to.contain('2 test cases: 1 created, 0 updated, 1 failed.');
    expect(markdown).to.contain('| PROJ-123-F01 | Quote \\| with a pipe | created | [PROJ-9](https://acme.atlassian.net/browse/PROJ-9) |');
    expect(markdown).to.contain('| PROJ-123-F02 | Title of PROJ-123-F02 | failed: Jira refused the link |  |');
    expect(markdown).to.match(/_Updated by sfdx-hardis on \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC_$/);
  });

  it('posts one summary per carrier ticket, on the tracker of the tool, with the marker of the tool', async () => {
    const previous = { ...process.env };
    Object.assign(process.env, { SERVICENOW_URL: 'https://acme.service-now.com', SERVICENOW_USERNAME: 'u', SERVICENOW_PASSWORD: 'p' });
    const patches: any[] = [];
    setFetchForTests(async (url: string, init: any) => {
      if (init?.method === 'PATCH') {
        patches.push({ url, body: JSON.parse(init.body) });
      }
      return new Response(JSON.stringify(init?.method === 'PATCH' ? { result: {} } : { result: [{ sys_id: { value: url.includes('STRY0010002') ? 's2' : 's1' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const cases = [makeCase('STRY0010001-F01'), makeCase('STRY0010001-F02'), makeCase('STRY0010002-F01')];
      const report: PushReport = {
        rows: cases.map((testCase, index) => ({ provider: 'ServiceNow', caseId: testCase.id, action: 'created', trackerId: `t${index}`, url: `https://acme.service-now.com/t${index}` })),
        created: 3,
        updated: 0,
        failed: 0,
        exitCode: 0,
        message: '',
      };
      const results = await postTestCasesSummaries('servicenow', new ServiceNowTestProvider(), cases, report);
      expect(results.map((result) => [result.ticketId, result.action])).to.deep.equal([
        ['STRY0010001', 'created'],
        ['STRY0010002', 'created'],
      ]);
      expect(patches).to.have.lengthOf(2);
      expect(patches[0].body.work_notes).to.contain('2 test cases: 2 created, 0 updated, 0 failed.');
      expect(patches[0].body.work_notes).to.contain('sfdx-hardis:test-cases:servicenow');
      expect(patches[1].body.work_notes).to.contain('1 test case: 1 created');
    } finally {
      for (const key of ['SERVICENOW_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD']) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    }
  });
});
