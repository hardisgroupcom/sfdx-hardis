/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Load the barrel first, exactly as the CLI does: see ticketProviders.test.ts for the import cycle
import { TicketProvider, ticketCommentProviderKeys } from '../../../src/common/ticketProvider/index.js';
import { JiraProvider } from '../../../src/common/ticketProvider/jiraProvider.js';
import { AzureBoardsProvider } from '../../../src/common/ticketProvider/azureBoardsProvider.js';
import { ServiceNowProvider } from '../../../src/common/ticketProvider/serviceNowProvider.js';
import { AhaProvider } from '../../../src/common/ticketProvider/ahaProvider.js';
import {
  assertValidMarker,
  escapeMarkdownText,
  hasMarker,
  htmlMarker,
  markdownMarkerFooter,
} from '../../../src/common/ticketProvider/utils/ticketComment.js';
import { markdownToAdf, markdownToJiraWiki, markdownToPlainText } from '../../../src/common/ticketProvider/utils/markdownToTicketFormats.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

const VARS = [
  'JIRA_HOST',
  'JIRA_EMAIL',
  'JIRA_TOKEN',
  'JIRA_PAT',
  'JIRA_CLIENT_ID',
  'JIRA_CLIENT_SECRET',
  'SYSTEM_COLLECTIONURI',
  'SYSTEM_TEAMPROJECT',
  'CI_SFDX_HARDIS_AZURE_TOKEN',
  'SERVICENOW_URL',
  'SERVICENOW_USERNAME',
  'SERVICENOW_PASSWORD',
  'SERVICENOW_COMMENT_FIELD',
  'AHA_HOST',
  'AHA_API_KEY',
];

/** Runs one test with exactly these variables, and restores whatever was there before */
function withEnv(vars: Record<string, string>, run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const previous: Record<string, string | undefined> = {};
    for (const key of VARS) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
    Object.assign(process.env, vars);
    try {
      await run();
    } finally {
      for (const key of VARS) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    }
  };
}

type RecordedCall = { url: string; method: string; body: any };

function stubFetch(handler: (url: string, method: string, body: any) => [number, any]): RecordedCall[] {
  const calls: RecordedCall[] = [];
  setFetchForTests(async (url: string, init: any) => {
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    const [status, answer] = handler(url, method, body);
    return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

const JIRA_CLOUD_ENV = { JIRA_HOST: 'https://acme.atlassian.net', JIRA_EMAIL: 'bot@acme.test', JIRA_TOKEN: 'token' };
const JIRA_SERVER_ENV = { JIRA_HOST: 'https://jira.acme.test', JIRA_EMAIL: 'bot', JIRA_TOKEN: 'token' };
const AZURE_ENV = { SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme/', SYSTEM_TEAMPROJECT: 'Sales', CI_SFDX_HARDIS_AZURE_TOKEN: 'token' };
const SERVICENOW_ENV = { SERVICENOW_URL: 'https://acme.service-now.com', SERVICENOW_USERNAME: 'integration', SERVICENOW_PASSWORD: 'secret' };
const AHA_ENV = { AHA_HOST: 'acme.aha.io', AHA_API_KEY: 'secret' };

describe('ticket comments', () => {
  afterEach(() => setFetchForTests(null));

  describe('markdown conversion', () => {
    const markdown = [
      `Deployed in **[acme\\-\\-uat](https://acme.test)** from branch ${escapeMarkdownText('feat_x_<y>')}`,
      '',
      '- one',
      '  - nested',
      '1. first',
      '',
      '| Case | Result |',
      '|---|---|',
      '| F01 | `created` |',
      '',
      '```js',
      'const a = 1;',
      '```',
    ].join('\n');

    it('builds an Atlassian document with marks, nested lists, a table and a code block', () => {
      const doc = markdownToAdf(markdown);
      expect(doc.type).to.equal('doc');
      expect(doc.version).to.equal(1);
      const json = JSON.stringify(doc);
      expect(json).to.contain('{"type":"text","text":"acme--uat","marks":[{"type":"strong"},{"type":"link","attrs":{"href":"https://acme.test"}}]}');
      expect(json).to.contain('feat_x_<y>');
      expect(doc.content!.map((node) => node.type)).to.deep.equal(['paragraph', 'bulletList', 'orderedList', 'table', 'codeBlock']);
      expect(doc.content![1].content![0].content!.map((node) => node.type)).to.deep.equal(['paragraph', 'bulletList']);
      expect(doc.content![3].content![0].content![0].type).to.equal('tableHeader');
      expect(doc.content![4]).to.deep.equal({ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const a = 1;' }] });
      // ADF refuses an empty text node
      expect(json).to.not.contain('"text":""');
    });

    it('writes wiki markup, escaping what Jira would read as formatting', () => {
      const wiki = markdownToJiraWiki(markdown);
      expect(wiki).to.contain('*[acme\\--uat|https://acme.test]*');
      expect(wiki).to.contain('feat\\_x\\_<y>');
      expect(wiki).to.contain('* one\n** nested');
      expect(wiki).to.contain('# first');
      expect(wiki).to.contain('||Case||Result||\n|F01|{{created}}|');
      expect(wiki).to.contain('{code:js}\nconst a = 1;\n{code}');
    });

    it('writes plain text with the URLs spelled out and no markup left', () => {
      const text = markdownToPlainText(markdown);
      expect(text).to.contain('Deployed in acme--uat (https://acme.test) from branch feat_x_<y>');
      expect(text).to.contain('- one\n  - nested');
      expect(text).to.contain('1. first');
      expect(text).to.contain('Case | Result\nF01 | created');
      expect(text).to.not.match(/\*\*|\\_|&lt;/);
    });
  });

  describe('markers', () => {
    it('matches a marker exactly, never a longer one starting the same way', () => {
      expect(hasMarker('x <span title="sfdx-hardis:test-cases"></span>', 'test-cases')).to.be.true;
      expect(hasMarker('x <span title="sfdx-hardis:test-cases:xray"></span>', 'test-cases')).to.be.false;
      expect(hasMarker({ type: 'doc', content: [{ type: 'text', text: 'sfdx-hardis:design' }] }, 'design')).to.be.true;
      expect(hasMarker(null, 'design')).to.be.false;
    });

    it('refuses a marker holding a character a comment could alter', () => {
      expect(() => assertValidMarker('test-cases:xray_1.0')).to.not.throw();
      expect(() => assertValidMarker(undefined)).to.not.throw();
      expect(() => assertValidMarker('two words')).to.throw();
      expect(() => assertValidMarker('a'.repeat(81))).to.throw();
    });

    it('hides the marker in HTML and shows it as code elsewhere', () => {
      expect(htmlMarker('design')).to.equal('<span title="sfdx-hardis:design"></span>');
      expect(markdownMarkerFooter('design')).to.equal('\n\n`sfdx-hardis:design`');
      expect(htmlMarker(undefined) + markdownMarkerFooter(undefined)).to.equal('');
    });
  });

  describe('JiraProvider.postComment', () => {
    function stubbedJira(comments: any[] = []): { provider: JiraProvider; added: any[]; updated: any[] } {
      const provider = new JiraProvider({});
      const added: any[] = [];
      const updated: any[] = [];
      (provider as any).authValidated = true;
      (provider as any).jiraClient = {
        issueComments: {
          getComments: async () => ({ comments, total: comments.length }),
          addComment: async (params: any) => {
            added.push(params);
            return { id: '10001' };
          },
          updateComment: async (params: any) => {
            updated.push(params);
            return { id: params.id };
          },
        },
      };
      return { provider, added, updated };
    }

    it('posts an Atlassian document on Jira Cloud', withEnv(JIRA_CLOUD_ENV, async () => {
      const { provider, added } = stubbedJira();
      const result = await provider.postComment('acme-12', 'Fixed in **UAT**');
      expect(added).to.have.lengthOf(1);
      expect(added[0].issueIdOrKey).to.equal('ACME-12');
      expect(added[0].comment.type).to.equal('doc');
      expect(result).to.deep.equal({
        ticketId: 'ACME-12',
        provider: 'JIRA',
        action: 'created',
        commentId: '10001',
        url: 'https://acme.atlassian.net/browse/ACME-12?focusedCommentId=10001',
      });
    }));

    it('posts wiki markup on Jira Server', withEnv(JIRA_SERVER_ENV, async () => {
      const { provider, added } = stubbedJira();
      await provider.postComment('ACME-12', 'Fixed in **UAT**');
      expect(added[0].comment).to.equal('Fixed in *UAT*');
    }));

    it('updates the most recent comment holding the marker', withEnv(JIRA_CLOUD_ENV, async () => {
      const { provider, added, updated } = stubbedJira([
        { id: '1', body: 'sfdx-hardis:design' },
        { id: '2', body: 'unrelated' },
        { id: '3', body: { type: 'doc', content: [{ type: 'text', text: 'sfdx-hardis:design' }] } },
      ]);
      const result = await provider.postComment('ACME-12', 'New design', { marker: 'design' });
      expect(added).to.be.empty;
      expect(updated).to.have.lengthOf(1);
      expect(updated[0].id).to.equal('3');
      // jira.js reads `comment` on v2 and `body` on the v3 update
      expect(updated[0].body.type).to.equal('doc');
      expect(updated[0].comment).to.equal(updated[0].body);
      expect(JSON.stringify(updated[0].body)).to.contain('sfdx-hardis:design');
      expect(result.action).to.equal('updated');
    }));

    it('adds a comment ending with the marker when none holds it yet', withEnv(JIRA_SERVER_ENV, async () => {
      const { provider, added } = stubbedJira([{ id: '1', body: 'sfdx-hardis:other' }]);
      await provider.postComment('ACME-12', 'Status', { marker: 'design' });
      expect(added[0].comment).to.equal('Status\n\n{{sfdx-hardis:design}}');
    }));
  });

  describe('AzureBoardsProvider.postComment', () => {
    // The work item answers in the project of the repository unless a test says otherwise
    function stubbedAzure(pages: any[] = [{ comments: [] }], workItemProject = 'Sales'): { provider: AzureBoardsProvider; calls: any[] } {
      const provider = new AzureBoardsProvider({});
      const calls: any[] = [];
      let page = 0;
      (provider as any).azureApi = {
        getWorkItemTrackingApi: async () => ({
          // Not recorded: the expectations below count the comment calls only
          getWorkItem: async () => ({ fields: { 'System.TeamProject': workItemProject } }),
          getComments: async (...args: any[]) => {
            calls.push(['getComments', ...args]);
            return pages[page++] ?? { comments: [] };
          },
          addComment: async (...args: any[]) => {
            calls.push(['addComment', ...args]);
            return { id: 77 };
          },
          updateComment: async (...args: any[]) => {
            calls.push(['updateComment', ...args]);
            return { id: args[3] };
          },
        }),
      };
      return { provider, calls };
    }

    it('posts the markdown as sanitized HTML on the work item', withEnv(AZURE_ENV, async () => {
      const { provider, calls } = stubbedAzure();
      const result = await provider.postComment('AB-1234', 'Fixed in **UAT** <script>alert(1)</script>');
      expect(calls).to.have.lengthOf(1);
      const [name, request, project, workItemId] = calls[0];
      expect([name, project, workItemId]).to.deep.equal(['addComment', 'Sales', 1234]);
      expect(request.text).to.contain('<strong>UAT</strong>');
      expect(request.text).to.not.contain('<script>');
      expect(result.url).to.equal('https://dev.azure.com/acme/Sales/_workitems/edit/1234');
      expect(result.action).to.equal('created');
    }));

    it('updates the most recent marked comment, reading every page', withEnv(AZURE_ENV, async () => {
      const { provider, calls } = stubbedAzure([
        { comments: [{ id: 5, text: '<p>a</p><span title="sfdx-hardis:status"></span>', createdDate: '2026-10-01T10:00:00Z' }], continuationToken: 'next' },
        { comments: [{ id: 9, text: '<p>b</p><span title="sfdx-hardis:status"></span>', createdDate: '2026-10-02T10:00:00Z' }] },
      ]);
      const result = await provider.postComment('1234', 'Status', { marker: 'status' });
      expect(calls.filter((call) => call[0] === 'getComments')).to.have.lengthOf(2);
      const update = calls.find((call) => call[0] === 'updateComment');
      expect(update[4]).to.equal(9);
      expect(update[1].text.endsWith('<span title="sfdx-hardis:status"></span>')).to.be.true;
      expect(result.action).to.equal('updated');
    }));

    it('comments in the project of the work item, not in the one of the repository', withEnv(AZURE_ENV, async () => {
      const { provider, calls } = stubbedAzure([{ comments: [] }], 'Backlog');
      const result = await provider.postComment('1234', 'x');
      expect(calls[0].slice(2)).to.deep.equal(['Backlog', 1234]);
      expect(result.url).to.equal('https://dev.azure.com/acme/Backlog/_workitems/edit/1234');
    }));

    it('adds no marker of any kind when no --marker is given', withEnv(AZURE_ENV, async () => {
      const { provider, calls } = stubbedAzure();
      await provider.postComment('1234', 'Plain');
      expect(calls[0][1].text).to.not.contain('sfdx-hardis:');
      expect(calls[0][1].text).to.not.contain('<span');
    }));

    it('refuses an identifier that is not a work item number', withEnv(AZURE_ENV, async () => {
      const { provider } = stubbedAzure();
      let message = '';
      try {
        await provider.postComment('ACME-12', 'x');
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).to.not.equal('');
    }));
  });

  describe('ServiceNowProvider.postComment', () => {
    const record = { sys_id: { value: 'abc123', display_value: 'abc123' } };

    function stubServiceNow(): RecordedCall[] {
      return stubFetch((url, method) => (method === 'PATCH' ? [200, { result: record }] : [200, { result: [record] }]));
    }

    it('writes the plain text in the work notes and returns the record link', withEnv(SERVICENOW_ENV, async () => {
      const calls = stubServiceNow();
      const result = await new ServiceNowProvider({}).postComment('inc0012345', 'See [the spec](https://spec.test) **now**');
      const write = calls.find((call) => call.method === 'PATCH')!;
      expect(write.url).to.equal('https://acme.service-now.com/api/now/table/incident/abc123');
      expect(write.body).to.deep.equal({ work_notes: 'See the spec (https://spec.test) now' });
      expect(result).to.deep.equal({
        ticketId: 'INC0012345',
        provider: 'ServiceNow',
        action: 'created',
        url: 'https://acme.service-now.com/incident.do?sys_id=abc123',
      });
    }));

    it('writes in the field of the option, before SERVICENOW_COMMENT_FIELD', withEnv({ ...SERVICENOW_ENV, SERVICENOW_COMMENT_FIELD: 'comments' }, async () => {
      const calls = stubServiceNow();
      await new ServiceNowProvider({}).postComment('INC0012345', 'x', { serviceNowField: 'close_notes' });
      expect(Object.keys(calls.find((call) => call.method === 'PATCH')!.body)).to.deep.equal(['close_notes']);
      await new ServiceNowProvider({}).postComment('INC0012345', 'x');
      expect(Object.keys(calls.filter((call) => call.method === 'PATCH')[1].body)).to.deep.equal(['comments']);
    }));

    it('refuses a field that is not a column name, without writing', withEnv(SERVICENOW_ENV, async () => {
      const calls = stubServiceNow();
      let message = '';
      try {
        await new ServiceNowProvider({}).postComment('INC0012345', 'x', { serviceNowField: 'work_notes": "x' });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).to.not.equal('');
      expect(calls.some((call) => call.method === 'PATCH')).to.be.false;
    }));

    it('adds a new note ending with the marker, since a journal entry cannot be edited', withEnv(SERVICENOW_ENV, async () => {
      const calls = stubServiceNow();
      const result = await new ServiceNowProvider({}).postComment('INC0012345', 'Status', { marker: 'status' });
      expect(calls.find((call) => call.method === 'PATCH')!.body.work_notes).to.equal('Status\n\nsfdx-hardis:status');
      expect(result.action).to.equal('created');
    }));
  });

  describe('AhaProvider.postComment', () => {
    it('posts the HTML on the feature', withEnv(AHA_ENV, async () => {
      const calls = stubFetch(() => [200, { comment: { id: '42', url: 'https://acme.aha.io/comments/42' } }]);
      const result = await new AhaProvider({}).postComment('PROD-12', '**Done**');
      expect(calls[0].method).to.equal('POST');
      expect(calls[0].url).to.equal('https://acme.aha.io/api/v1/features/PROD-12/comments');
      expect(calls[0].body.comment.body).to.contain('<strong>Done</strong>');
      expect(result).to.deep.equal({ ticketId: 'PROD-12', provider: 'Aha!', action: 'created', commentId: '42', url: 'https://acme.aha.io/comments/42' });
    }));

    it('updates the most recent comment holding the marker', withEnv(AHA_ENV, async () => {
      const calls = stubFetch((url, method) => {
        if (method === 'GET') {
          return [200, {
            comments: [
              { id: '7', body: '<p>old</p><span title="sfdx-hardis:status"></span>', created_at: '2026-10-01T10:00:00Z' },
              { id: '8', body: '<p>older</p><span title="sfdx-hardis:status"></span>', created_at: '2026-09-01T10:00:00Z' },
            ],
            pagination: { total_pages: 1 },
          }];
        }
        return [200, { comment: { id: '7' } }];
      });
      const result = await new AhaProvider({}).postComment('PROD-12', 'New status', { marker: 'status' });
      const update = calls.find((call) => call.method === 'PUT')!;
      expect(update.url).to.equal('https://acme.aha.io/api/v1/comments/7');
      expect(update.body.comment.body.endsWith('<span title="sfdx-hardis:status"></span>')).to.be.true;
      expect(calls.some((call) => call.method === 'POST')).to.be.false;
      expect(result.action).to.equal('updated');
    }));
  });

  describe('TicketProvider.postComment', () => {
    it('lists every connector able to comment, and not the generic one', () => {
      expect(ticketCommentProviderKeys()).to.have.members(['jira', 'azure', 'servicenow', 'aha']);
    });

    it('routes a ServiceNow number to ServiceNow', withEnv(SERVICENOW_ENV, async () => {
      const calls = stubFetch((url, method) => (method === 'PATCH' ? [200, { result: {} }] : [200, { result: [{ sys_id: { value: 's1' } }] }]));
      const result = await TicketProvider.postComment('INC0012345', 'Hello');
      expect(result.provider).to.equal('ServiceNow');
      expect(result.action).to.equal('created');
      expect(calls.some((call) => call.method === 'PATCH')).to.be.true;
    }));

    it('returns a failed result instead of throwing', withEnv({}, async () => {
      const unknown = await TicketProvider.postComment('not a ticket', 'Hello');
      expect(unknown.action).to.equal('failed');
      expect(unknown.error).to.be.a('string').and.not.empty;
      const notConfigured = await TicketProvider.postComment('INC0012345', 'Hello');
      expect(notConfigured.action).to.equal('failed');
      expect(notConfigured.error).to.contain('ServiceNow');
      const badMarker = await TicketProvider.postComment('INC0012345', 'Hello', { marker: 'two words' });
      expect(badMarker.action).to.equal('failed');
    }));
  });
});
