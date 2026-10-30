import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
// Load the barrel first, exactly as the CLI does, to resolve the pre-existing import cycle
import { TicketProvider } from '../../../src/common/ticketProvider/index.js';
import { AzureBoardsProvider } from '../../../src/common/ticketProvider/azureBoardsProvider.js';
import { JiraProvider } from '../../../src/common/ticketProvider/jiraProvider.js';
import { TICKET_ERROR } from '../../../src/common/ticketProvider/utils/ticketOperations.js';
import { newTicketDetails } from '../../../src/common/ticketProvider/utils/ticketDetails.js';
import {
  assertWiqlCondition,
  isTicketMarked,
  parseAllowedProjects,
  parseCommentVisibility,
  retryReadOn5xx,
  scopeJql,
  scopeWiql,
  toStrictMarkdown,
  withAdfMention,
  withCommentPrefix,
  withHtmlHeadingSpacers,
  withHtmlMention,
  withWikiMention,
} from '../../../src/common/ticketProvider/utils/ticketQualify.js';
import { markdownToAdf, markdownToJiraWiki } from '../../../src/common/ticketProvider/utils/markdownToTicketFormats.js';
import { convertMarkdownToHtml } from '../../../src/common/notifProvider/utils/markdownToHtml.js';
import TicketPostComment from '../../../src/commands/hardis/ticket/post-comment.js';
import TicketGet from '../../../src/commands/hardis/ticket/get.js';
import TicketMeta from '../../../src/commands/hardis/ticket/meta.js';
import TicketWhoami from '../../../src/commands/hardis/ticket/whoami.js';
import TicketLabel from '../../../src/commands/hardis/ticket/label.js';

/*
 * Port of the acceptance tests of the cloudity-qualify-ticket adapters (providers/jira.mjs and
 * azure.mjs, commit 5da3b01). Each test name starts with the baseline test it covers: [J<n>] for
 * jira.test.mjs, [A<n>] for azure.test.mjs, numbered in file order. The mapping, including the
 * tests that moved to the skill or were dropped, is in test-mapping.md of the qualify-ticket project folder.
 */

const NO_JIRA_ENV = { JIRA_HOST: '', JIRA_EMAIL: '', JIRA_TOKEN: '', JIRA_PAT: '', JIRA_CLIENT_ID: '', JIRA_CLIENT_SECRET: '' };
const JIRA_ENV = { ...NO_JIRA_ENV, JIRA_HOST: 'https://acme.atlassian.net', JIRA_EMAIL: 'bot@acme.com', JIRA_TOKEN: 'token' };
const JIRA_DC_ENV = { ...NO_JIRA_ENV, JIRA_HOST: 'https://jira.acme.com', JIRA_PAT: 'pat' };
const AZURE_ENV = {
  SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme',
  SYSTEM_TEAMPROJECT: 'Code',
  CI_SFDX_HARDIS_AZURE_TOKEN: 'token',
};
const GUID = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const PREFIX = '🤖 Qualification automatique (Claude)';

function withEnv(vars: Record<string, string>, run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(vars)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
    try {
      await run();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };
}

async function rejectionOf(promise: Promise<unknown> | (() => Promise<unknown>)): Promise<any> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (e) {
    return e;
  }
  throw new Error('Expected a rejection');
}

function httpError(status: number, data: any = {}): any {
  const error: any = new Error(`Request failed with status code ${status}`);
  error.status = status;
  error.response = { status, data };
  return error;
}

function stubbedJira(client: any): JiraProvider {
  const provider = new JiraProvider({});
  (provider as any).jiraClient = client;
  return provider;
}

/** An AzureBoardsProvider whose node api is replaced; calls are recorded */
function stubbedAzure(wit: any, extra: any = {}): AzureBoardsProvider {
  const provider = new AzureBoardsProvider({});
  (provider as any).azureApi = { getWorkItemTrackingApi: async () => wit, ...extra };
  return provider;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe('ticket qualification helpers', () => {
  it('[J3][J22] scopeJql bounds the query to the projects, keeps ORDER BY, quoted ORDER BY stays a filter', () => {
    expect(scopeJql(['ACME', 'OPS'], 'status = Open ORDER BY priority DESC')).to.equal(
      'project in ("ACME", "OPS") AND (status = Open) ORDER BY priority DESC'
    );
    expect(scopeJql(['ACME'], '')).to.equal('project in ("ACME") ORDER BY created ASC');
    expect(scopeJql(['ACME'], 'summary ~ "ORDER BY x"')).to.equal('project in ("ACME") AND (summary ~ "ORDER BY x") ORDER BY created ASC');
  });

  it('[J16] scopeJql refuses unbalanced parentheses outside quoted strings', () => {
    expect(scopeJql(['ACME'], 'summary ~ "a)"')).to.contain('(summary ~ "a)")');
    for (const query of ['status = Open) OR (project = OTHER', 'status = "Open', '((a = 1)']) {
      expect(() => scopeJql(['ACME'], query), query).to.throw().with.property('name', TICKET_ERROR.queryInvalid);
    }
  });

  it('[A3] assertWiqlCondition refuses statement keywords and unbalanced input', () => {
    for (const condition of ['SELECT [System.Id] FROM WorkItems', "[System.State] = 'New' ORDER BY [System.Id]", 'a = 1 ASOF x', '(a = 1']) {
      expect(() => assertWiqlCondition(condition), condition).to.throw().with.property('name', TICKET_ERROR.queryInvalid);
    }
    expect(assertWiqlCondition("[System.Title] CONTAINS 'select from'")).to.equal("[System.Title] CONTAINS 'select from'");
  });

  it('[A6][A5] scopeWiql bounds the condition to the projects, quotes escaped', () => {
    expect(scopeWiql(["O'Brien", 'CRM'], "[System.State] = 'New'")).to.equal(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] IN ('O''Brien', 'CRM') AND ([System.State] = 'New') ORDER BY [System.CreatedDate] ASC"
    );
    expect(scopeWiql(['CRM'], '')).to.contain("WHERE [System.TeamProject] IN ('CRM') ORDER BY");
  });

  it('parseAllowedProjects: absent stays null, empty is refused', () => {
    expect(parseAllowedProjects(undefined)).to.equal(null);
    expect(parseAllowedProjects(' ACME , OPS ')).to.deep.equal(['ACME', 'OPS']);
    expect(() => parseAllowedProjects(' , ')).to.throw();
  });

  it('[J5][J36][A11] marker: label (any case), or own prefixed comment despite emoji, spacing and decomposed accents', () => {
    const own = { authorId: 'me', body: 'Qualification  automatique (Claude)\n\nGrid...' };
    expect(isTicketMarked({ labels: ['IA-Qualifie'], comments: [], myId: 'me', prefix: PREFIX, label: 'ia-qualifie' })).to.equal(true);
    expect(isTicketMarked({ labels: [], comments: [own], myId: 'me', prefix: PREFIX })).to.equal(true);
    // NFD accents in the stored comment
    const decomposed = { authorId: 'me', body: 'Qualification automatique (Claude)'.normalize('NFD') };
    expect(isTicketMarked({ labels: [], comments: [decomposed], myId: 'me', prefix: PREFIX })).to.equal(true);
    // Somebody else's comment, or no identity: never counts
    expect(isTicketMarked({ labels: [], comments: [{ ...own, authorId: 'other' }], myId: 'me', prefix: PREFIX })).to.equal(false);
    expect(isTicketMarked({ labels: [], comments: [own], myId: null, prefix: PREFIX })).to.equal(false);
    expect(isTicketMarked({ labels: ['other'], comments: [], myId: 'me', prefix: PREFIX, label: 'ia-qualifie' })).to.equal(false);
  });

  it('[J9] prefix: added as first line, never twice', () => {
    expect(withCommentPrefix('Body', PREFIX)).to.equal(`${PREFIX}\n\nBody`);
    expect(withCommentPrefix(`${PREFIX}\n\nBody`, PREFIX)).to.equal(`${PREFIX}\n\nBody`);
    expect(withCommentPrefix('Qualification automatique (Claude)\n\nBody', PREFIX)).to.equal('Qualification automatique (Claude)\n\nBody');
    expect(withCommentPrefix('Body', null)).to.equal('Body');
  });

  // --strict-markdown: the reference subset, rendered by the regular conversions of sfdx-hardis
  const HOSTILE = [
    '[x](http://evil)',
    '![a](http://evil/i.png)',
    '@user',
    '<img src=x onerror=alert(1)>',
    '[[wiki]]',
    '!image.png!',
    '{code}',
    '{{x}}',
    '[~admin]',
    '{html}<b>x</b>{html}',
  ].join(' ');
  const strictAdf = (markdown: string) => markdownToAdf(toStrictMarkdown(markdown));
  const strictWiki = (markdown: string) => markdownToJiraWiki(toStrictMarkdown(markdown));
  const strictHtml = async (markdown: string) => withHtmlHeadingSpacers(await convertMarkdownToHtml(toStrictMarkdown(markdown)));
  const adfNodes = (node: any): any[] => [node, ...(node.content || []).flatMap(adfNodes)];

  it('[J7] strict markdown to ADF: heading, bullets, numbered list, bold and code; hostile text stays literal', () => {
    const doc = strictAdf('# Title\n\nSome **bold** and `code`\n\n- one\n- two\n\n1. first');
    expect(doc.content!.map((node) => node.type)).to.deep.equal(['heading', 'paragraph', 'bulletList', 'orderedList']);
    expect(doc.content![1].content).to.deep.equal([
      { type: 'text', text: 'Some ' },
      { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'code', marks: [{ type: 'code' }] },
    ]);
    const hostile = strictAdf(HOSTILE);
    const nodes = adfNodes(hostile);
    expect(nodes.some((node) => node.type === 'mention' || (node.marks || []).some((mark: any) => mark.type === 'link'))).to.equal(false);
    expect(nodes.filter((node) => node.type === 'text').map((node) => node.text).join('')).to.equal(HOSTILE);
  });

  it('[J27][J48] strict markdown to wiki: headings, bullets, bold, code; every wiki special of the text escaped', () => {
    expect(strictWiki('## Title\n\n- **one**\n- `two`\n\nText')).to.equal('h2. Title\n\n* *one*\n* {{two}}\n\nText');
    const wiki = strictWiki(HOSTILE);
    // No link, image, mention, macro or monospace span can open: every bracket, brace, ! and ~ is escaped
    expect(wiki).to.not.match(/(^|[^\\])[[\]{}!~|]/);
    expect(wiki.replace(/\\(.)/g, '$1')).to.equal(HOSTILE);
  });

  it('[J48] strict markdown: a code block and nested backticks stay literal text, never a {code} block', () => {
    const wiki = strictWiki('```\n{code}\n```\n\n```` ```inner``` ````');
    expect(wiki).to.not.contain('{noformat}');
    expect(wiki).to.not.match(/(^|[^\\])\{/);
    expect(strictAdf('```\n{code}\n```').content![0].type).to.equal('paragraph');
  });

  it('[A10][A28] strict markdown to HTML: subset, spacer before each heading but the first, numbered lists, text escaped', async () => {
    expect(await strictHtml('# A\n\ntext\n\n## B\n\n1. x\n2. y\n\n- z')).to.equal(
      '<h1>A</h1>\n<p>text</p>\n<div><br></div><h2>B</h2>\n<ol>\n<li>x</li>\n<li>y</li>\n</ol>\n<ul>\n<li>z</li>\n</ul>\n'
    );
    const html = await strictHtml(HOSTILE);
    expect(html).to.not.match(/<(a|img|b|script)\b/);
    expect(html).to.not.contain('data-vss-mention');
    expect(html).to.contain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('[J56][A29] mentions: ADF node and [~name] after the first block, GUID only on Azure, malformed ids dropped', () => {
    const doc = withAdfMention(markdownToAdf('Prefix\n\nBody'), { id: '5b10:abc-1', displayName: 'Ann' });
    expect(doc.content[1].content[1]).to.deep.equal({ type: 'mention', attrs: { id: '5b10:abc-1', text: '@Ann' } });
    expect(withAdfMention(markdownToAdf('P'), { id: 'bad id"', displayName: 'x' }).content).to.have.length(1);
    expect(withWikiMention('Prefix\n\nBody', { id: 'ann.dupont', displayName: null })).to.equal('Prefix\n\nPour : [~ann.dupont]\n\nBody');
    expect(withWikiMention('Prefix', { id: 'a]b', displayName: null })).to.equal('Prefix');
    const html = withHtmlMention('<p>Prefix</p><p>Body</p>', { id: GUID, displayName: '<Ann>' });
    expect(html).to.equal(`<p>Prefix</p><p>Pour : <a href="#" data-vss-mention="version:2.0,${GUID}">@&lt;Ann&gt;</a></p><p>Body</p>`);
    expect(withHtmlMention('<p>P</p>', { id: 'not-a-guid', displayName: 'x' })).to.equal('<p>P</p>');
    expect(withHtmlMention('<p>P</p>', null)).to.equal('<p>P</p>');
  });

  it('[J24] visibility: role or group with a value, anything else refused', () => {
    expect(parseCommentVisibility('role:Developers')).to.deep.equal({ type: 'role', value: 'Developers' });
    expect(parseCommentVisibility('group:jira-users')).to.deep.equal({ type: 'group', value: 'jira-users' });
    expect(parseCommentVisibility(undefined)).to.equal(null);
    for (const value of ['role:', 'team:x', 'Developers']) {
      expect(() => parseCommentVisibility(value), value).to.throw();
    }
  });

  it('[A16] retryReadOn5xx: one retry on 5xx, none on 4xx', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) {
        throw httpError(503);
      }
      return 'ok';
    };
    expect(await retryReadOn5xx(flaky, 0)).to.equal('ok');
    expect(calls).to.equal(2);
    calls = 0;
    const refused = async () => {
      calls++;
      throw httpError(400);
    };
    await rejectionOf(retryReadOn5xx(refused, 0));
    expect(calls).to.equal(1);
  });
});

// ---------------------------------------------------------------------------------------------
// JIRA provider
// ---------------------------------------------------------------------------------------------

const jiraIssue = (key: string, project = key.split('-')[0]) => ({
  key,
  fields: {
    summary: `Summary of ${key}`,
    issuetype: { name: 'Story' },
    status: { name: 'À faire' },
    priority: { name: 'High' },
    assignee: { accountId: 'acc-1', displayName: 'Ann' },
    created: '2026-09-01T12:12:00.000+0200',
    updated: '2026-09-18T08:03:00.000+0000',
    labels: [],
    project: { key: project },
  },
});

describe('JiraProvider qualification operations', () => {
  it('[J13][J20] search (Cloud): bounded JQL sent, results of other projects dropped', withEnv(JIRA_ENV, async () => {
    const calls: any[] = [];
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async (parameters: any) => {
          calls.push(parameters);
          return { issues: [jiraIssue('ACME-1'), jiraIssue('OTHER-2')] };
        },
      },
    });
    const result = await provider.searchTickets('status = Open', { maxResults: 50, allowedProjects: ['ACME'] });
    expect(calls[0].jql).to.equal('project in ("ACME") AND (status = Open) ORDER BY created ASC');
    expect(result.tickets.map((ticket) => ticket.id)).to.deep.equal(['ACME-1']);
    expect(result.tickets[0]).to.include({ assigneeId: 'acc-1', project: 'ACME', areaPath: null });
    expect(result.warning ?? null).to.equal(null);
  }));

  it('[J32] search (Server/DC): /rest/api/2/search, other projects dropped, empty result warned', withEnv(JIRA_DC_ENV, async () => {
    const calls: any[] = [];
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlPost: async (parameters: any) => {
          calls.push(parameters);
          return { issues: [jiraIssue('OTHER-2')], total: 1 };
        },
      },
    });
    const result = await provider.searchTickets('', { maxResults: 10, allowedProjects: ['ACME'] });
    expect(calls[0].jql).to.equal('project in ("ACME") ORDER BY created ASC');
    expect(result.tickets).to.deep.equal([]);
    expect(result.warning).to.contain('ACME');
  }));

  it('[J8][J33] get: project, account ids of assignee, reporter and comment authors (Cloud accountId, Server name)', withEnv(JIRA_DC_ENV, async () => {
    const provider = stubbedJira({
      issues: {
        getIssue: async () => ({
          key: 'ACME-7',
          fields: {
            summary: 'S',
            project: { key: 'ACME' },
            assignee: { name: 'ann.dupont', key: 'JIRAUSER1', displayName: 'Ann' },
            reporter: { accountId: 'acc-9', displayName: 'Bob' },
            labels: [],
          },
          renderedFields: {},
        }),
      },
      issueComments: {
        getComments: async () => ({ comments: [{ author: { name: 'bot', displayName: 'Bot' }, body: `${PREFIX}\n\nGrid`, created: '' }], total: 1 }),
      },
    });
    const details = await provider.getTicketDetails('ACME-7', { downloadAttachments: false });
    expect(details!.project).to.equal('ACME');
    expect(details!.assigneeId).to.equal('ann.dupont');
    expect(details!.reporterId).to.equal('acc-9');
    expect(details!.comments[0].authorId).to.equal('bot');
    expect(isTicketMarked({ labels: [], comments: details!.comments.map((c) => ({ authorId: c.authorId!, body: c.body })), myId: 'bot', prefix: PREFIX })).to.equal(true);
  }));

  it('--skip-comments: no comment call', withEnv(JIRA_ENV, async () => {
    let commentCalls = 0;
    const provider = stubbedJira({
      issues: { getIssue: async () => ({ key: 'ACME-7', fields: { summary: 'S', labels: [] } }) },
      issueComments: {
        getComments: async () => {
          commentCalls++;
          return { comments: [] };
        },
      },
    });
    const details = await provider.getTicketDetails('ACME-7', { downloadAttachments: false, skipComments: true });
    expect(commentCalls).to.equal(0);
    expect(details!.project).to.equal('ACME');
  }));

  it('[J9][J23] comment (Cloud, markdown): ADF body, mention, visibility; public by default', withEnv(JIRA_ENV, async () => {
    const posted: any[] = [];
    const provider = stubbedJira({
      issueComments: {
        addComment: async (parameters: any) => {
          posted.push(parameters);
          return { id: '10' };
        },
      },
    });
    const result = await provider.postComment('acme-1', `${PREFIX}\n\n## Grid`, {
      mention: { id: 'acc-1', displayName: 'Ann' },
      visibility: { type: 'role', value: 'Developers' },
    });
    expect(result.url).to.equal('https://acme.atlassian.net/browse/ACME-1?focusedCommentId=10');
    expect(posted[0].comment.content[0].content[0].text).to.equal(PREFIX);
    expect(posted[0].comment.content[1].content[1].type).to.equal('mention');
    expect(posted[0].comment.content[2].type).to.equal('heading');
    expect(posted[0].visibility).to.deep.equal({ type: 'role', value: 'Developers' });
    await provider.postComment('ACME-1', 'x');
    expect(posted[1]).to.not.have.property('visibility');
    // [Q12] Without --marker, no tag of any kind is added to the comment
    expect(JSON.stringify(posted[1].comment)).to.not.contain('sfdx-hardis:');
  }));

  it('[J34] comment (Server/DC, markdown): wiki markup with the prefix as first line, [~name] mention', withEnv(JIRA_DC_ENV, async () => {
    const posted: any[] = [];
    const provider = stubbedJira({
      issueComments: {
        addComment: async (parameters: any) => {
          posted.push(parameters);
          return { id: '11' };
        },
      },
    });
    await provider.postComment('ACME-1', 'Prefix line\n\n- **one**', { mention: { id: 'ann', displayName: null } });
    expect(posted[0].comment).to.equal('Prefix line\n\nPour : [~ann]\n\n* *one*');
  }));

  it('[J12][J42][J35] transition: matches the target status by name, untranslated name or id, never the transition name', withEnv(JIRA_ENV, async () => {
    const done: any[] = [];
    const transitions = [
      { id: '11', name: 'Prêt', to: { id: '3', name: 'En cours', untranslatedName: 'In Progress' } },
      { id: '21', name: 'Ready for review', to: { id: '4', name: 'Terminé', untranslatedName: 'Done' } },
    ];
    const provider = stubbedJira({
      issues: {
        getTransitions: async () => ({ transitions }),
        doTransition: async (parameters: any) => {
          done.push(parameters.transition.id);
        },
      },
    });
    expect(await provider.transitionTicket('ACME-1', 'in progress')).to.equal('En cours');
    expect(await provider.transitionTicket('ACME-1', '4')).to.equal('Terminé');
    expect(done).to.deep.equal(['11', '21']);
    // The transition's own name is not a status
    await rejectionOf(provider.transitionTicket('ACME-1', 'Ready for review'));
    expect(done).to.have.length(2);
  }));

  it('[J55] points: customfield id required, writes only an empty field, overwrite on demand, absent field skipped', withEnv(JIRA_ENV, async () => {
    const edits: any[] = [];
    let current: any = { customfield_10016: null };
    const provider = stubbedJira({
      issues: {
        getIssue: async () => ({ fields: current }),
        editIssue: async (parameters: any) => {
          edits.push(parameters.fields);
        },
      },
    });
    await rejectionOf(provider.setTicketPoints('ACME-1', 3, { field: 'Story Points' }));
    expect(await provider.setTicketPoints('ACME-1', 3, { field: 'customfield_10016' })).to.deep.equal({ status: 'done', value: 3, field: 'customfield_10016' });
    current = { customfield_10016: 5 };
    expect((await provider.setTicketPoints('ACME-1', 3, { field: 'customfield_10016' })).reason).to.equal('already-set');
    expect((await provider.setTicketPoints('ACME-1', 3, { field: 'customfield_10016', overwrite: true })).status).to.equal('done');
    current = {};
    expect((await provider.setTicketPoints('ACME-1', 3, { field: 'customfield_10016' })).reason).to.equal('field-not-on-issue');
    expect(edits).to.deep.equal([{ customfield_10016: 3 }, { customfield_10016: 3 }]);
  }));

  it('whoami: accountId on Cloud, name on Server/DC', withEnv(JIRA_ENV, async () => {
    const cloud = stubbedJira({ myself: { getCurrentUser: async () => ({ accountId: 'acc-1', displayName: 'Bot', emailAddress: 'bot@acme.com' }) } });
    expect(await cloud.whoAmI()).to.deep.equal({ id: 'acc-1', displayName: 'Bot', email: 'bot@acme.com' });
    const server = stubbedJira({ myself: { getCurrentUser: async () => ({ name: 'bot', key: 'JIRAUSER9', displayName: 'Bot' }) } });
    expect((await server.whoAmI()).id).to.equal('bot');
  }));

  it('meta: issue types, each status once, statuses per type', withEnv(JIRA_ENV, async () => {
    const provider = stubbedJira({
      projects: {
        getAllStatuses: async () => [
          { id: '1', name: 'Story', statuses: [{ id: '10', name: 'À faire' }, { id: '11', name: 'Prêt' }] },
          { id: '2', name: 'Bug', statuses: [{ id: '10', name: 'À faire' }] },
        ],
      },
    });
    expect(await provider.getProjectMeta('ACME')).to.deep.equal({
      project: 'ACME',
      issueTypes: [{ id: '1', name: 'Story' }, { id: '2', name: 'Bug' }],
      statuses: [{ id: '10', name: 'À faire' }, { id: '11', name: 'Prêt' }],
      statusesByType: { Story: ['À faire', 'Prêt'], Bug: ['À faire'] },
    });
  }));

  it('[J14][J46] errors: a refused credential is TicketProviderNotConfigured, the JSON errors of JIRA are kept', withEnv(JIRA_ENV, async () => {
    const refused = stubbedJira({ myself: { getCurrentUser: async () => { throw httpError(401); } } });
    expect((await rejectionOf(refused.whoAmI())).name).to.equal(TICKET_ERROR.providerNotConfigured);
    const invalid = stubbedJira({
      issueSearch: { searchForIssuesUsingJqlEnhancedSearchPost: async () => { throw httpError(400, { errorMessages: ['Field "x" does not exist'] }); } },
    });
    const error = await rejectionOf(invalid.searchTickets('x = 1', { maxResults: 5 }));
    expect(error.name).to.equal(TICKET_ERROR.queryInvalid);
    expect(error.message).to.contain('Field "x" does not exist');
  }));
});

// ---------------------------------------------------------------------------------------------
// Azure Boards provider
// ---------------------------------------------------------------------------------------------

const workItem = (id: number, project = 'CRM', extra: any = {}) => ({
  id,
  rev: 7,
  fields: {
    'System.Title': `Title ${id}`,
    'System.WorkItemType': 'User Story',
    'System.State': 'New',
    'System.TeamProject': project,
    'System.AreaPath': `${project}\\Sales`,
    'System.Tags': 'existing',
    'System.AssignedTo': { id: GUID, displayName: 'Ann' },
    'System.CreatedDate': '2026-09-01T10:00:00Z',
    ...extra,
  },
});

describe('AzureBoardsProvider qualification operations', () => {
  it('[A15] list: WIQL bounded to the projects, then batch; results outside the projects dropped', withEnv(AZURE_ENV, async () => {
    const queries: any[] = [];
    const provider = stubbedAzure({
      queryByWiql: async (wiql: any, team: any, _precision: any, top: number) => {
        queries.push({ wiql: wiql.query, project: team.project, top });
        return { workItems: [{ id: 1 }, { id: 2 }] };
      },
      getWorkItemsBatch: async () => [workItem(1), workItem(2, 'Other')],
    });
    const result = await provider.searchTickets("[System.State] = 'New'", { maxResults: 5, allowedProjects: ['CRM'] });
    expect(queries[0].wiql).to.equal(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] IN ('CRM') AND ([System.State] = 'New') ORDER BY [System.CreatedDate] ASC"
    );
    expect(queries[0]).to.include({ project: 'CRM', top: 5 });
    expect(result.tickets.map((ticket) => ticket.id)).to.deep.equal(['AB-1']);
    expect(result.tickets[0]).to.include({ assigneeId: GUID, project: 'CRM', areaPath: 'CRM\\Sales', assignee: 'Ann' });
  }));

  it('list: bounded to the configured team project without --allowed-projects; 0 result warned', withEnv(AZURE_ENV, async () => {
    const queries: string[] = [];
    const provider = stubbedAzure({
      queryByWiql: async (wiql: any) => {
        queries.push(wiql.query);
        return { workItems: [] };
      },
    });
    const result = await provider.searchTickets('', { maxResults: 5 });
    expect(queries[0]).to.contain("[System.TeamProject] IN ('Code')");
    expect(result.warning).to.contain('Code');
  }));

  it('[A16] list: a 5xx on the WIQL is retried once', withEnv(AZURE_ENV, async () => {
    let calls = 0;
    const provider = stubbedAzure({
      queryByWiql: async () => {
        calls++;
        if (calls === 1) {
          const error: any = new Error('Service Unavailable');
          error.statusCode = 503;
          throw error;
        }
        return { workItems: [] };
      },
    });
    const clock = setTimeout;
    // The retry pause is not under test here
    (global as any).setTimeout = (fn: any) => clock(fn, 0);
    try {
      await provider.searchTickets('', { maxResults: 5 });
    } finally {
      (global as any).setTimeout = clock;
    }
    expect(calls).to.equal(2);
  }));

  it('[A18] get: project of the work item itself, comments read there, ids of assignee and authors', withEnv(AZURE_ENV, async () => {
    const commentProjects: string[] = [];
    const provider = stubbedAzure({
      getWorkItem: async () => workItem(5, 'CRM'),
      getComments: async (project: string) => {
        commentProjects.push(project);
        return { comments: [{ createdBy: { id: 'me-guid', displayName: 'Bot' }, text: `<p>${PREFIX}</p><p>Grid</p>` }] };
      },
    });
    const details = await provider.getTicketDetails('5', { downloadAttachments: false });
    expect(details!.project).to.equal('CRM');
    expect(commentProjects).to.deep.equal(['CRM']);
    expect(details!.assigneeId).to.equal(GUID);
    expect(details!.comments[0].authorId).to.equal('me-guid');
    expect(isTicketMarked({ labels: details!.labels, comments: details!.comments.map((c) => ({ authorId: c.authorId!, body: c.body })), myId: 'me-guid', prefix: PREFIX })).to.equal(true);
  }));

  it('[A20] comment: HTML body on the work item project, text escaped, Azure refuses --visibility', withEnv(AZURE_ENV, async () => {
    const posted: any[] = [];
    const provider = stubbedAzure({
      getWorkItem: async () => workItem(5, 'CRM'),
      addComment: async (request: any, project: string, id: number) => {
        posted.push({ text: request.text, project, id });
        return { id: 99 };
      },
    });
    const result = await provider.postComment('AB-5', `${PREFIX}\n\nGrid <script>alert(1)</script>`, { mention: { id: GUID, displayName: 'Ann' } });
    expect(result.commentId).to.equal('99');
    expect(posted[0]).to.include({ project: 'CRM', id: 5 });
    // The mention goes right after the first block (the prefix), and the script is stripped
    expect(posted[0].text.startsWith(`<p>${PREFIX}</p><p>Pour : <a href="#" data-vss-mention="version:2.0,${GUID}">@Ann</a></p>`)).to.equal(true);
    expect(posted[0].text).to.not.contain('<script');
    await rejectionOf(provider.postComment('5', 'x', { visibility: { type: 'role', value: 'Dev' } }));
    expect(posted).to.have.length(1);
  }));

  it('[A22][A8] label: json-patch with rev test, existing tags kept, no duplicate (any case)', withEnv(AZURE_ENV, async () => {
    const patches: any[] = [];
    const provider = stubbedAzure({
      getWorkItem: async () => workItem(5, 'CRM', { 'System.Tags': 'existing; IA-Qualifie' }),
      updateWorkItem: async (_headers: any, patch: any) => {
        patches.push(patch);
        return { id: 5 };
      },
    });
    await provider.addTicketLabel('5', 'ia-qualifie');
    expect(patches).to.have.length(0);
    await provider.addTicketLabel('5', 'other');
    expect(patches[0]).to.deep.equal([
      { op: 'test', path: '/rev', value: 7 },
      { op: 'add', path: '/fields/System.Tags', value: 'existing; IA-Qualifie; other' },
    ]);
  }));

  it("[A23] transition: checked against the type's states, without case", withEnv(AZURE_ENV, async () => {
    const patches: any[] = [];
    const provider = stubbedAzure({
      getWorkItem: async () => workItem(5),
      getWorkItemTypeStates: async () => [{ name: 'New' }, { name: 'Ready' }],
      updateWorkItem: async (_headers: any, patch: any) => {
        patches.push(patch);
        return { id: 5 };
      },
    });
    expect(await provider.transitionTicket('5', 'ready')).to.equal('Ready');
    expect(patches[0][1]).to.deep.equal({ op: 'add', path: '/fields/System.State', value: 'Ready' });
    await rejectionOf(provider.transitionTicket('5', 'Done'));
    expect(patches).to.have.length(1);
  }));

  it('[A26][A27] points: field found on the type, never overwrites, a type without the field is skipped', withEnv(AZURE_ENV, async () => {
    const patches: any[] = [];
    let fields: any = {};
    let typeFields = [{ referenceName: 'Microsoft.VSTS.Scheduling.Effort' }];
    const provider = stubbedAzure({
      getWorkItem: async () => workItem(5, 'CRM', fields),
      getWorkItemTypeFieldsWithReferences: async () => typeFields,
      updateWorkItem: async (_headers: any, patch: any) => {
        patches.push(patch);
        return { id: 5 };
      },
    });
    expect(await provider.setTicketPoints('5', 3)).to.deep.equal({ status: 'done', value: 3, field: 'Microsoft.VSTS.Scheduling.Effort' });
    fields = { 'Microsoft.VSTS.Scheduling.Effort': 8 };
    expect((await provider.setTicketPoints('5', 3)).reason).to.equal('already-set');
    typeFields = [];
    expect((await provider.setTicketPoints('5', 3)).reason).to.equal('type-has-no-points-field');
    expect(patches).to.have.length(1);
  }));

  it('[A13] whoami: connectionData identity', withEnv(AZURE_ENV, async () => {
    const provider = stubbedAzure({}, {
      connect: async () => ({ authenticatedUser: { id: GUID, providerDisplayName: 'Bot', properties: { Account: { $value: 'bot@acme.com' } } } }),
    });
    expect(await provider.whoAmI()).to.deep.equal({ id: GUID, displayName: 'Bot', email: 'bot@acme.com' });
  }));

  it('[A14] projects and meta.statusesByType, disabled types left out, missing states completed', withEnv(AZURE_ENV, async () => {
    const provider = stubbedAzure(
      {
        getWorkItemTypes: async () => [
          { name: 'User Story', states: [{ name: 'New' }, { name: 'Active' }] },
          { name: 'Bug', states: [] },
          { name: 'Old', isDisabled: true, states: [{ name: 'X' }] },
        ],
        getWorkItemTypeStates: async () => [{ name: 'New' }, { name: 'Resolved' }],
      },
      { getCoreApi: async () => ({ getProjects: async () => [{ name: 'CRM' }, { name: 'Code' }] }) }
    );
    expect(await provider.listProjects()).to.deep.equal([{ key: 'CRM', name: 'CRM' }, { key: 'Code', name: 'Code' }]);
    const meta = await provider.getProjectMeta('CRM');
    expect(meta.statusesByType).to.deep.equal({ 'User Story': ['New', 'Active'], Bug: ['New', 'Resolved'] });
    expect(meta.statuses.map((status) => status.name)).to.deep.equal(['New', 'Active', 'Resolved']);
    expect(meta.issueTypes.map((type) => type.name)).to.deep.equal(['User Story', 'Bug']);
  }));

  it('[A24] a refused credential (203 HTML sign-in page) is an auth error, the page is not echoed', withEnv(AZURE_ENV, async () => {
    const provider = stubbedAzure({}, {
      connect: async () => {
        throw new Error('Unexpected token < in JSON: <!DOCTYPE html><html><body>Sign in secret-page</body></html>');
      },
    });
    const error = await rejectionOf(provider.whoAmI());
    expect(error.name).to.equal(TICKET_ERROR.providerNotConfigured);
    expect(error.message).to.not.contain('secret-page');
  }));

  it('[A7] an identifier that is not a work item id is refused before any call', withEnv(AZURE_ENV, async () => {
    let called = false;
    const provider = stubbedAzure({
      getWorkItem: async () => {
        called = true;
        return workItem(1);
      },
    });
    expect((await rejectionOf(provider.transitionTicket('ACME-1', 'New'))).name).to.equal(TICKET_ERROR.notFound);
    expect(called).to.equal(false);
  }));
});

// ---------------------------------------------------------------------------------------------
// Commands: order of the steps, checks before any write
// ---------------------------------------------------------------------------------------------

/** Fake provider recording every call in order */
function fakeProvider(options: { project?: string; labels?: string[]; comments?: any[]; failTransition?: boolean; failPoints?: boolean; providerKey?: string } = {}) {
  const calls: string[] = [];
  const details = newTicketDetails('JIRA', 'ACME-1');
  details.project = options.project ?? 'ACME';
  details.labels = options.labels ?? [];
  details.comments = options.comments ?? [];
  details.assignee = 'Ann';
  details.assigneeId = 'acc-1';
  const provider: any = {
    normalizeTicketId: (id: string) => id.toUpperCase(),
    getTicketDetails: async () => {
      calls.push('get');
      return details;
    },
    whoAmI: async () => {
      calls.push('whoami');
      return { id: 'me', displayName: 'Bot', email: null };
    },
    addTicketComment: async (_id: string, body: string, commentOptions: any) => {
      calls.push('comment');
      provider.lastComment = { body, ...commentOptions };
      return { commentId: '10', url: 'u' };
    },
    addTicketLabel: async () => {
      calls.push('label');
    },
    transitionTicket: async () => {
      calls.push('transition');
      if (options.failTransition) {
        throw new Error('No transition');
      }
      return 'Ready';
    },
    setTicketPoints: async () => {
      calls.push('points');
      if (options.failPoints) {
        throw new Error('points refused');
      }
      return { status: 'done', value: 3, field: 'customfield_1' };
    },
  };
  const providerClass = { providerKey: options.providerKey ?? 'jira', providerLabel: 'JIRA' };
  return { provider, calls, providerClass };
}

describe('ticket post-comment / get / label / whoami / meta commands', () => {
  const original = TicketProvider.resolveProvider;
  const originalPostComment = TicketProvider.postComment;
  let tmpDir: string;
  let draft: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ticket-qualify-'));
    draft = path.join(tmpDir, 'draft.md');
    await fs.writeFile(draft, '## Grid\n\n- size: M');
  });

  afterEach(async () => {
    TicketProvider.resolveProvider = original;
    TicketProvider.postComment = originalPostComment;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function use(fake: ReturnType<typeof fakeProvider>) {
    TicketProvider.resolveProvider = async () => ({ provider: fake.provider, providerClass: fake.providerClass }) as any;
    // post-comment posts through TicketProvider.postComment: recorded on the same fake
    TicketProvider.postComment = async (ticketId: string, markdown: string, options: any) => {
      fake.calls.push('comment');
      fake.provider.lastComment = { body: markdown, ...options };
      return { ticketId, provider: 'JIRA', action: 'created', commentId: '10', url: 'u' };
    };
  }

  const fullArgs = (ids = 'acme-1') => [
    '--id', ids, '--file', draft, '--prefix', PREFIX, '--skip-if-marked', '--label', 'ia-qualifie',
    '--transition', 'Ready', '--points', '3', '--points-field', 'customfield_1', '--mention-assignee', '--visibility', 'role:Developers',
    '--allowed-projects', 'ACME', '--agent',
  ];

  it('[J9][A20][A30][J56] post-comment: checks, then comment, label, status, points, in that order; prefix first, mention from the ticket', async () => {
    const fake = fakeProvider();
    use(fake);
    const result: any = await TicketPostComment.run(fullArgs());
    expect(fake.calls).to.deep.equal(['get', 'whoami', 'comment', 'label', 'transition', 'points']);
    expect(fake.provider.lastComment.body.startsWith(`${PREFIX}\n\n## Grid`)).to.equal(true);
    expect(fake.provider.lastComment.mention).to.deep.equal({ id: 'acc-1', displayName: 'Ann' });
    expect(fake.provider.lastComment.visibility).to.deep.equal({ type: 'role', value: 'Developers' });
    expect(fake.provider.lastComment.marker).to.equal(undefined);
    expect(result).to.include({ created: 1, skipped: 0, failed: 0 });
    expect(result.results[0]).to.include({ action: 'created', commentId: '10' });
    expect(result.results[0].label).to.deep.equal({ status: 'done', value: 'ia-qualifie' });
    expect(result.results[0].transition).to.deep.equal({ status: 'done', value: 'Ready' });
    expect(result.results[0].points.status).to.equal('done');
  });

  it('[J10][A20] post-comment: an already marked ticket is skipped (TicketAlreadyMarked), nothing is written, exit code 0', async () => {
    for (const fake of [
      fakeProvider({ labels: ['IA-QUALIFIE'] }),
      fakeProvider({ comments: [{ author: 'Bot', authorId: 'me', date: '', body: `${PREFIX}\n\nold` }] }),
    ]) {
      use(fake);
      process.exitCode = undefined;
      const result: any = await TicketPostComment.run(fullArgs());
      expect(result.results[0]).to.include({ action: 'skipped', errorName: TICKET_ERROR.alreadyMarked });
      expect(result.skipped).to.equal(1);
      expect(fake.calls).to.not.include('comment');
      expect(process.exitCode ?? 0).to.equal(0);
    }
    // A prefixed comment of another account does not mark the ticket
    const other = fakeProvider({ comments: [{ author: 'Ann', authorId: 'acc-1', date: '', body: `${PREFIX}\n\nold` }] });
    use(other);
    const result: any = await TicketPostComment.run(fullArgs());
    expect(result.results[0].action).to.equal('created');
  });

  it('[J15][A19] post-comment: a ticket outside --allowed-projects is refused (TicketOutOfScope), nothing written', async () => {
    const fake = fakeProvider({ project: 'OTHER' });
    use(fake);
    process.exitCode = undefined;
    const result: any = await TicketPostComment.run(fullArgs());
    expect(result.results[0]).to.include({ action: 'refused', errorName: TICKET_ERROR.outOfScope });
    expect(fake.calls).to.deep.equal(['get']);
    expect(result.failed).to.equal(1);
    expect(process.exitCode).to.equal(1);
    process.exitCode = undefined;
  });

  it('[contract] post-comment: a failed status or points step keeps the comment and is reported per step', async () => {
    const fake = fakeProvider({ failTransition: true, failPoints: true });
    use(fake);
    const result: any = await TicketPostComment.run(fullArgs());
    expect(fake.calls).to.deep.equal(['get', 'whoami', 'comment', 'label', 'transition', 'points']);
    expect(result.results[0].action).to.equal('created');
    expect(result.results[0].transition).to.deep.equal({ status: 'failed', error: { name: 'Error', message: 'No transition' } });
    expect(result.results[0].points.status).to.equal('failed');
  });

  it('[contract] post-comment: a label failure after the comment fails the ticket, saying the comment is saved', async () => {
    const fake = fakeProvider();
    fake.provider.addTicketLabel = async () => {
      fake.calls.push('label');
      throw new Error('label refused');
    };
    use(fake);
    const result: any = await TicketPostComment.run(fullArgs());
    expect(fake.calls).to.deep.equal(['get', 'whoami', 'comment', 'label']);
    expect(result.results[0]).to.include({ action: 'failed', commentId: '10' });
    expect(result.results[0].label.status).to.equal('failed');
    process.exitCode = undefined;
  });

  it('[J55] post-comment: on JIRA, --points without a customfield id is refused before the comment', async () => {
    const fake = fakeProvider();
    use(fake);
    const result: any = await TicketPostComment.run(['--id', 'ACME-1', '--message', 'x', '--points', '3', '--agent']);
    expect(result.results[0].action).to.equal('failed');
    await rejectionOf(() => TicketPostComment.run(['--id', 'ACME-1', '--message', 'x', '--points', 'L', '--points-field', 'customfield_1', '--agent']));
    expect(fake.calls).to.deep.equal([]);
    process.exitCode = undefined;
  });

  it('post-comment: without the new options, nothing is read and every step says not-requested', async () => {
    const fake = fakeProvider();
    use(fake);
    const result: any = await TicketPostComment.run(['--id', 'ACME-1', '--message', 'x', '--agent']);
    expect(fake.calls).to.deep.equal(['comment']);
    expect(fake.provider.lastComment.body).to.equal('x');
    expect(result.results[0].transition.status).to.equal('not-requested');
    expect(result.results[0].points.status).to.equal('not-requested');
  });

  it('whoami returns the provider and the identity', async () => {
    const fake = fakeProvider();
    use(fake);
    const result: any = await TicketWhoami.run(['--agent']);
    expect(result).to.deep.equal({ provider: 'jira', id: 'me', displayName: 'Bot', email: null });
  });

  it('[J11][A22] label: adds the label alone; a ticket outside --allowed-projects is refused, nothing written', async () => {
    const fake = fakeProvider();
    use(fake);
    const result: any = await TicketLabel.run(['--id', 'acme-1', '--label', 'ia-qualif-erreur', '--allowed-projects', 'ACME', '--agent']);
    expect(fake.calls).to.deep.equal(['get', 'label']);
    expect(result).to.deep.equal({ provider: 'jira', ticket: 'ACME-1', label: { status: 'done', value: 'ia-qualif-erreur' } });
    const outside = fakeProvider({ project: 'OTHER' });
    use(outside);
    const error = await rejectionOf(() => TicketLabel.run(['--id', 'ACME-1', '--label', 'x', '--allowed-projects', 'ACME', '--agent']));
    expect(error.name).to.equal(TICKET_ERROR.outOfScope);
    expect(outside.calls).to.deep.equal(['get']);
    const plain = fakeProvider();
    use(plain);
    await TicketLabel.run(['--id', 'ACME-1', '--label', 'x', '--agent']);
    expect(plain.calls).to.deep.equal(['label']);
    await rejectionOf(() => TicketLabel.run(['--id', 'ACME-1', '--label', 'two words', '--agent']));
  });

  it('[A5] get --id a,b,c: one entry per id in the order asked, a failure never stops the others, exit 1 only when none is read', async () => {
    const originalGet = TicketProvider.getTicketDetails;
    const fake = fakeProvider();
    use(fake);
    TicketProvider.getTicketDetails = async (ticketId: string) => {
      if (ticketId === 'ACME-404') {
        const error = new Error('not found');
        error.name = TICKET_ERROR.notFound;
        throw error;
      }
      const details = newTicketDetails('JIRA', ticketId);
      details.project = ticketId.startsWith('OTHER') ? 'OTHER' : 'ACME';
      return details;
    };
    try {
      process.exitCode = undefined;
      const result: any = await TicketGet.run(['--id', 'ACME-2,ACME-404,OTHER-1', '--allowed-projects', 'ACME', '--skip-attachments', '--agent']);
      expect(result.tickets.map((entry: any) => [entry.id, entry.status])).to.deep.equal([
        ['ACME-2', 'ok'],
        ['ACME-404', 'failed'],
        ['OTHER-1', 'failed'],
      ]);
      expect(result.tickets[0].ticket.id).to.equal('ACME-2');
      expect(result.tickets[1].error).to.deep.equal({ name: TICKET_ERROR.notFound, message: 'not found' });
      expect(result.tickets[2].error.name).to.equal(TICKET_ERROR.outOfScope);
      expect(result).to.not.have.property('ticket');
      expect(process.exitCode ?? 0).to.equal(0);
      const none: any = await TicketGet.run(['--id', 'ACME-404,OTHER-1', '--allowed-projects', 'ACME', '--skip-attachments', '--agent']);
      expect(none.tickets.every((entry: any) => entry.status === 'failed')).to.equal(true);
      expect(process.exitCode).to.equal(1);
      // A single id keeps the historical shape
      const single: any = await TicketGet.run(['--id', 'ACME-2', '--skip-attachments', '--agent']);
      expect(single.ticket.id).to.equal('ACME-2');
      await rejectionOf(() => TicketGet.run(['--id', 'ACME-2,ACME-3', '--output-file', path.join(tmpDir, 'x.md'), '--agent']));
    } finally {
      TicketProvider.getTicketDetails = originalGet;
      process.exitCode = undefined;
    }
  });

  it('[A14] get without --allowed-projects still returns the project (setup: project of a known work item)', async () => {
    const originalGet = TicketProvider.getTicketDetails;
    const fake = fakeProvider({ project: 'DSI' });
    use(fake);
    TicketProvider.getTicketDetails = async () => fake.provider.getTicketDetails();
    try {
      const result: any = await TicketGet.run(['--id', 'ACME-1', '--skip-comments', '--skip-attachments', '--agent']);
      expect(result.ticket.project).to.equal('DSI');
      expect(result.ticket.markedByMe).to.equal(null);
    } finally {
      TicketProvider.getTicketDetails = originalGet;
    }
  });

  it('[J21] meta: a project outside --allowed-projects is refused before any call', async () => {
    let resolved = false;
    TicketProvider.resolveProvider = async () => {
      resolved = true;
      return {} as any;
    };
    const error = await rejectionOf(() => TicketMeta.run(['--project', 'OTHER', '--allowed-projects', 'ACME', '--agent']));
    expect(error.name).to.equal(TICKET_ERROR.outOfScope);
    expect(resolved).to.equal(false);
  });

  it('[J8][A18][A19] get: markedByMe, --allowed-projects and --skip-comments', async () => {
    const originalGet = TicketProvider.getTicketDetails;
    const fake = fakeProvider({ comments: [{ author: 'Bot', authorId: 'me', date: '', body: `${PREFIX} x` }] });
    use(fake);
    const asked: any[] = [];
    TicketProvider.getTicketDetails = async (_id: string, options: any) => {
      asked.push(options);
      return fake.provider.getTicketDetails();
    };
    try {
      const result: any = await TicketGet.run(['--id', 'ACME-1', '--marker', PREFIX, '--skip-comments', '--skip-attachments', '--agent']);
      expect(result.ticket.markedByMe).to.equal(true);
      expect(result.ticket.comments).to.deep.equal([]);
      // The marker check needs the comments: they are read, not returned
      expect(asked[0].skipComments).to.equal(false);
      const error = await rejectionOf(() => TicketGet.run(['--id', 'ACME-1', '--allowed-projects', 'OTHER', '--skip-attachments', '--agent']));
      expect(error.name).to.equal(TICKET_ERROR.outOfScope);
    } finally {
      TicketProvider.getTicketDetails = originalGet;
    }
  });
});
