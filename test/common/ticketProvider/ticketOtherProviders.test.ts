import { expect } from 'chai';
// Load the barrel first, exactly as the CLI does, to resolve the pre-existing import cycle
import '../../../src/common/ticketProvider/index.js';
import { AhaProvider } from '../../../src/common/ticketProvider/ahaProvider.js';
import { ServiceNowProvider } from '../../../src/common/ticketProvider/serviceNowProvider.js';
import { TICKET_ERROR } from '../../../src/common/ticketProvider/utils/ticketOperations.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

/*
 * The ticket list / set-label / whoami / meta operations and the post-comment steps on ServiceNow
 * and Aha!. Every HTTP call is answered by a fake fetch that records it.
 */

const SERVICENOW_ENV = { SERVICENOW_URL: 'https://acme.service-now.com', SERVICENOW_USERNAME: 'integration', SERVICENOW_PASSWORD: 'secret' };
const AHA_ENV = { AHA_HOST: 'acme.aha.io', AHA_API_KEY: 'key' };

type Call = { method: string; url: URL; body: any };

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
      setFetchForTests(null);
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

/** Answers each call with the first route whose test matches; records every call */
function fakeFetch(routes: [(call: Call) => boolean, (call: Call) => { status?: number; body: any; headers?: Record<string, string> }][]): Call[] {
  const calls: Call[] = [];
  setFetchForTests(async (url: string, init: any = {}) => {
    const call: Call = { method: init.method || 'GET', url: new URL(url), body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const route = routes.find(([test]) => test(call));
    const answer = route ? route[1](call) : { status: 404, body: { error: { message: 'No route' } } };
    const status = answer.status ?? 200;
    return {
      ok: status < 300,
      status,
      statusText: String(status),
      headers: new Map(Object.entries({ 'content-type': 'application/json', ...(answer.headers || {}) })),
      text: async () => JSON.stringify(answer.body),
    } as any;
  });
  return calls;
}

async function rejectionOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('Expected a rejection');
}

const path = (fragment: string) => (call: Call) => call.url.pathname.includes(fragment);

describe('ServiceNowProvider ticket operations', () => {
  const states = { result: [{ value: '1', label: 'New' }, { value: '2', label: 'In Progress' }, { value: '6', label: 'Resolved' }] };
  const incident = {
    sys_id: { value: 'sys1', display_value: 'sys1' },
    number: { value: 'INC0010001', display_value: 'INC0010001' },
    short_description: { value: 'Login fails', display_value: 'Login fails' },
    sys_class_name: { value: 'incident', display_value: 'Incident' },
    state: { value: '2', display_value: 'In Progress' },
    priority: { value: '1', display_value: '1 - Critical' },
    assigned_to: { value: 'u1', display_value: 'Ann Smith' },
    'assigned_to.user_name': { value: 'ann', display_value: 'ann' },
    sys_created_on: { value: '2026-10-01 08:00:00', display_value: '01/10/2026 10:00:00' },
    sys_updated_on: { value: '2026-10-02 08:00:00', display_value: '02/10/2026 10:00:00' },
    assignment_group: { value: 'g1', display_value: 'Service Desk' },
  };

  it('list: the criteria become an encoded query on the table, labels through label_entry, pages by offset', withEnv(SERVICENOW_ENV, async () => {
    const calls = fakeFetch([
      [path('/sys_choice'), () => ({ body: states })],
      [path('/label_entry'), () => ({ body: { result: [{ table_key: 'sys1' }] } })],
      [path('/table/incident'), () => ({ body: { result: [incident] }, headers: { 'x-total-count': '3' } })],
    ]);
    const provider = new ServiceNowProvider({});
    const result = await provider.searchTickets(
      { projects: ['incident'], statuses: ['in progress', '6'], assignee: 'me', labels: ['ia'], text: 'login', createdAfter: '2026-10-01', openOnly: true, orderBy: 'updated', descending: true },
      { maxResults: 1 }
    );
    const search = calls.find((call) => call.url.pathname.endsWith('/table/incident'))!;
    expect(search.url.searchParams.get('sysparm_query')).to.equal(
      'stateIN2,6^assigned_to.user_name=integration^sys_idINsys1^short_descriptionLIKElogin^ORdescriptionLIKElogin^sys_created_on>=2026-10-01 00:00:00^active=true^ORDERBYDESCsys_updated_on'
    );
    expect(calls.find((call) => call.url.pathname.endsWith('/label_entry'))!.url.searchParams.get('sysparm_query')).to.equal('label.nameINia^table=incident');
    expect(result.tickets[0]).to.deep.include({
      id: 'INC0010001',
      subject: 'Login fails',
      type: 'incident',
      status: 'In Progress',
      assignee: 'Ann Smith',
      assigneeId: 'ann',
      project: 'incident',
      areaPath: 'Service Desk',
      created: '2026-10-01T08:00:00Z',
    });
    expect(result).to.include({ nextPageToken: '1', truncated: true });
  }));

  it('list: a project is required, several are searched in task, reserved characters are refused', withEnv(SERVICENOW_ENV, async () => {
    const calls = fakeFetch([[path('/table/task'), () => ({ body: { result: [] } })]]);
    const provider = new ServiceNowProvider({});
    expect((await rejectionOf(provider.searchTickets({ statuses: ['New'] }, { maxResults: 5 }))).name).to.equal(TICKET_ERROR.queryInvalid);
    await provider.searchTickets({ projects: ['incident', 'rm_story'], assignee: 'none' }, { maxResults: 5 });
    expect(calls[0].url.searchParams.get('sysparm_query')).to.equal('sys_class_nameINincident,rm_story^assigned_toISEMPTY^ORDERBYsys_created_on');
    expect((await rejectionOf(provider.searchTickets({ projects: ['incident'], text: 'a^ORactive=false' }, { maxResults: 5 }))).name).to.equal(TICKET_ERROR.queryInvalid);
    expect((await rejectionOf(provider.searchTickets({ projects: ['incident;drop'] }, { maxResults: 5 }))).name).to.equal(TICKET_ERROR.queryInvalid);
  }));

  it('whoami, projects and meta: user name as id, tables as projects, states from the choice list', withEnv(SERVICENOW_ENV, async () => {
    fakeFetch([
      [path('/sys_user'), () => ({ body: { result: [{ user_name: 'integration', name: 'Integration', email: 'i@acme.com' }] } })],
      [(call) => call.url.pathname.includes('/sys_choice') && call.url.searchParams.get('sysparm_query')!.startsWith('name=rm_story'), () => ({ body: { result: [] } })],
      [path('/sys_choice'), () => ({ body: states })],
    ]);
    const provider = new ServiceNowProvider({});
    expect(await provider.whoAmI()).to.deep.equal({ id: 'integration', displayName: 'Integration', email: 'i@acme.com' });
    expect((await provider.listProjects()).map((project) => project.key)).to.include.members(['incident', 'rm_story', 'change_request']);
    // rm_story has no choices of its own: the ones of task are taken
    expect(await provider.getProjectMeta('rm_story')).to.deep.equal({
      project: 'rm_story',
      issueTypes: [{ id: 'rm_story', name: 'rm_story' }],
      statuses: [{ id: '1', name: 'New' }, { id: '2', name: 'In Progress' }, { id: '6', name: 'Resolved' }],
      statusesByType: { rm_story: ['New', 'In Progress', 'Resolved'] },
    });
  }));

  it('transition and points: state by label, points written only when empty, a record without the field skipped', withEnv(SERVICENOW_ENV, async () => {
    let storyPoints: any = '0';
    const calls = fakeFetch([
      [path('/sys_choice'), () => ({ body: states })],
      [(call) => call.method === 'PATCH', () => ({ body: { result: {} } })],
      [(call) => call.url.pathname.endsWith('/rm_story/sys1'), () => ({ body: { result: storyPoints === undefined ? {} : { story_points: storyPoints } } })],
      [path('/table/'), () => ({ body: { result: [incident] } })],
    ]);
    const provider = new ServiceNowProvider({});
    expect(await provider.transitionTicket('inc0010001', 'resolved')).to.equal('Resolved');
    expect(calls.find((call) => call.method === 'PATCH')!.body).to.deep.equal({ state: '6' });
    expect((await rejectionOf(provider.transitionTicket('INC0010001', 'Flying'))).name).to.equal(TICKET_ERROR.transitionInvalid);
    expect(await provider.setTicketPoints('STRY0010001', 5)).to.deep.equal({ status: 'done', value: 5, field: 'story_points' });
    storyPoints = '3';
    expect((await provider.setTicketPoints('STRY0010001', 5)).reason).to.equal('already-set');
    storyPoints = undefined;
    expect((await provider.setTicketPoints('STRY0010001', 5)).reason).to.equal('field-not-on-issue');
  }));

  it('comment: --visibility refused before any call, the assignee named under the first block', withEnv(SERVICENOW_ENV, async () => {
    const calls = fakeFetch([
      [(call) => call.method === 'PATCH', () => ({ body: { result: {} } })],
      [path('/table/incident'), () => ({ body: { result: [incident] } })],
    ]);
    const provider = new ServiceNowProvider({});
    const error = await rejectionOf(provider.postComment('INC0010001', 'x', { visibility: { type: 'role', value: 'itil' } }));
    expect(error.name).to.equal(TICKET_ERROR.providerNotSupported);
    expect(calls).to.deep.equal([]);
    await provider.postComment('INC0010001', 'Prefix\n\nBody', { mention: { id: 'ann', displayName: 'Ann Smith' } });
    expect(calls.find((call) => call.method === 'PATCH')!.body.work_notes).to.equal('Prefix\n\nFor: Ann Smith\n\nBody');
  }));

  it('set-label: a tag ServiceNow saved with blank fields (no write ACL on label_entry) is an error, not "done"', withEnv(SERVICENOW_ENV, async () => {
    let entryFields: any = { label: { value: '' }, table_key: { value: '' } };
    fakeFetch([
      [(call) => call.url.pathname.endsWith('/label_entry') && call.method === 'POST', () => ({ status: 201, body: { result: { sys_id: 'e1', ...entryFields } } })],
      [path('/label_entry'), () => ({ body: { result: [] } })],
      [path('/table/label'), () => ({ body: { result: [{ sys_id: 'l1' }] } })],
      [path('/table/incident'), () => ({ body: { result: [incident] } })],
    ]);
    const provider = new ServiceNowProvider({});
    expect((await rejectionOf(provider.addTicketLabel('INC0010001', 'ia'))).message).to.contain('label_entry');
    entryFields = { label: { value: 'l1' }, table_key: { value: 'sys1' } };
    await provider.addTicketLabel('INC0010001', 'ia');
  }));

  it('get: when sys_journal_field is denied, the work notes of the record are split by entry and our own get our id', withEnv(SERVICENOW_ENV, async () => {
    const workNotes = [
      '2026-11-01 02:41:05 - sfdx-hardis Integration (Work notes)',
      'Automatic qualification',
      '',
      'Grid: M',
      '',
      '2026-10-30 09:00:00 - Beth Anglin (Work notes)',
      'Checked the access point',
    ].join('\n');
    fakeFetch([
      [path('/sys_journal_field'), () => ({ body: { result: [] } })],
      [path('/sys_user'), () => ({ body: { result: [{ user_name: 'integration', name: 'sfdx-hardis Integration' }] } })],
      [path('/label_entry'), () => ({ body: { result: [] } })],
      [path('/api/now/attachment'), () => ({ body: { result: [] } })],
      [path('/table/incident'), () => ({ body: { result: [{ ...incident, work_notes: { value: '', display_value: workNotes } }] } })],
    ]);
    const details = await new ServiceNowProvider({}).getTicketDetails('INC0010001', { downloadAttachments: false });
    expect(details!.comments.map((comment) => ({ author: comment.author, authorId: comment.authorId, body: comment.body }))).to.deep.equal([
      { author: 'Beth Anglin', authorId: null, body: 'Checked the access point\n\n[work_notes]' },
      { author: 'sfdx-hardis Integration', authorId: 'integration', body: 'Automatic qualification\n\nGrid: M\n\n[work_notes]' },
    ]);
    expect(details!.project).to.equal('incident');
  }));

  it('errors: a 401 is TicketProviderNotConfigured, the ServiceNow reason is kept', withEnv(SERVICENOW_ENV, async () => {
    fakeFetch([[path('/sys_user'), () => ({ status: 401, body: { error: { message: 'User is not authenticated', detail: 'Required to provide Auth information' } } })]]);
    const error = await rejectionOf(new ServiceNowProvider({}).whoAmI());
    expect(error.name).to.equal(TICKET_ERROR.providerNotConfigured);
    expect(error.message).to.contain('User is not authenticated');
  }));
});

describe('AhaProvider ticket operations', () => {
  const feature = (reference: string, extra: any = {}) => ({
    reference_num: reference,
    name: `Feature ${reference}`,
    url: `https://acme.aha.io/features/${reference}`,
    workflow_kind: { id: 'k1', name: 'New' },
    workflow_status: { id: 's1', name: 'In design', complete: false },
    assigned_to_user: { id: 'u1', name: 'Ann' },
    tags: ['ia'],
    created_at: '2026-10-02T08:00:00Z',
    updated_at: '2026-10-03T08:00:00Z',
    ...extra,
  });

  it('list: server filters on one workspace, the others on each page, page token resumes inside a page', withEnv(AHA_ENV, async () => {
    const calls = fakeFetch([
      [path('/api/v1/me'), () => ({ body: { user: { id: 'u1', name: 'Ann', email: 'ann@acme.com' } } })],
      [
        path('/products/DEMO/features'),
        (call) => ({
          body: {
            features: call.url.searchParams.get('page') === '1'
              ? [feature('DEMO-1'), feature('DEMO-2', { workflow_status: { name: 'Shipped', complete: true } }), feature('DEMO-3')]
              : [feature('DEMO-4')],
            pagination: { total_pages: 2 },
          },
        }),
      ],
    ]);
    const provider = new AhaProvider({});
    const criteria = { projects: ['demo'], assignee: 'me', labels: ['ia'], text: 'cycling', updatedAfter: '2026-10-01', openOnly: true };
    const first = await provider.searchTickets(criteria, { maxResults: 1 });
    const search = calls.find((call) => call.url.pathname.endsWith('/features'))!;
    expect(Object.fromEntries(search.url.searchParams)).to.include({ q: 'cycling', tag: 'ia', assigned_to_user: 'u1', updated_since: '2026-10-01T00:00:00Z', page: '1' });
    expect(first.tickets.map((ticket) => ticket.id)).to.deep.equal(['DEMO-1']);
    expect(first.tickets[0]).to.deep.include({ project: 'DEMO', type: 'New', status: 'In design', assigneeId: 'u1', labels: ['ia'] });
    // The done feature is left out, and the next call starts at the next matching feature of page 1
    const second = await provider.searchTickets(criteria, { maxResults: 5, pageToken: first.nextPageToken });
    expect(second.tickets.map((ticket) => ticket.id)).to.deep.equal(['DEMO-3', 'DEMO-4']);
    expect(second.nextPageToken).to.equal(null);
  }));

  it('list: several workspaces, statuses, types and creation day filtered on each page of the account', withEnv(AHA_ENV, async () => {
    fakeFetch([
      [
        path('/api/v1/features'),
        () => ({
          body: {
            features: [feature('DEMO-1'), feature('PROD-2', { workflow_kind: { name: 'Bug' } }), feature('OTHER-3'), feature('PROD-4', { created_at: '2026-09-01T00:00:00Z' })],
            pagination: { total_pages: 1 },
          },
        }),
      ],
    ]);
    const result = await new AhaProvider({}).searchTickets(
      { projects: ['DEMO', 'PROD'], statuses: ['in design'], types: ['new', 'bug'], createdAfter: '2026-10-01', orderBy: 'created', descending: true },
      { maxResults: 10 }
    );
    expect(result.tickets.map((ticket) => ticket.id)).to.deep.equal(['DEMO-1', 'PROD-2']);
  }));

  it('whoami, projects, meta, set-label, transition and points', withEnv(AHA_ENV, async () => {
    let estimate: any = null;
    const calls = fakeFetch([
      [path('/api/v1/me'), () => ({ body: { user: { id: 'u1', name: 'Ann', email: 'ann@acme.com' } } })],
      [path('/api/v1/products/DEMO/workflows'), () => ({ body: { workflows: [{ statusable_type: 'Idea', workflow_statuses: [] }, { statusable_type: 'Feature', workflow_statuses: [{ id: 's1', name: 'In design' }, { id: 's2', name: 'Shipped' }] }] } })],
      [path('/api/v1/products/DEMO/features'), () => ({ body: { features: [{ workflow_kind: { id: 'k1', name: 'New' } }, { workflow_kind: { id: 'k2', name: 'Bug' } }] } })],
      [path('/api/v1/products'), () => ({ body: { products: [{ reference_prefix: 'DEMO', name: 'Demo' }] } })],
      [(call) => call.method === 'PUT' && Boolean(call.body?.feature?.workflow_status), (call) => ({ body: { feature: { workflow_status: { id: 's2', name: call.body.feature.workflow_status === 'shipped' ? 'Shipped' : 'In design' } } } })],
      [(call) => call.method === 'PUT', () => ({ body: { feature: {} } })],
      [path('/api/v1/features/DEMO-1'), () => ({ body: { feature: { tags: ['old'], original_estimate: estimate } } })],
    ]);
    const provider = new AhaProvider({});
    expect(await provider.whoAmI()).to.deep.equal({ id: 'u1', displayName: 'Ann', email: 'ann@acme.com' });
    expect(await provider.listProjects()).to.deep.equal([{ key: 'DEMO', name: 'Demo' }]);
    expect(await provider.getProjectMeta('demo')).to.deep.equal({
      project: 'DEMO',
      issueTypes: [{ id: 'k1', name: 'New' }, { id: 'k2', name: 'Bug' }],
      statuses: [{ id: 's1', name: 'In design' }, { id: 's2', name: 'Shipped' }],
      statusesByType: { New: ['In design', 'Shipped'], Bug: ['In design', 'Shipped'] },
    });
    await provider.addTicketLabel('demo-1', 'ia');
    expect(calls.filter((call) => call.method === 'PUT').pop()!.body).to.deep.equal({ feature: { tags: ['old', 'ia'] } });
    expect(await provider.transitionTicket('DEMO-1', 'shipped')).to.equal('Shipped');
    expect((await rejectionOf(provider.transitionTicket('DEMO-1', 'Flying'))).name).to.equal(TICKET_ERROR.transitionInvalid);
    expect(await provider.setTicketPoints('DEMO-1', 5)).to.deep.equal({ status: 'done', value: 5, field: 'original_estimate' });
    expect(calls.filter((call) => call.method === 'PUT').pop()!.body).to.deep.equal({ feature: { original_estimate: 5 } });
    estimate = 3;
    expect((await provider.setTicketPoints('DEMO-1', 5)).reason).to.equal('already-set');
  }));

  it('comment: --visibility refused before any call, the assignee named under the first block', withEnv(AHA_ENV, async () => {
    const calls = fakeFetch([[(call) => call.method === 'POST', () => ({ body: { comment: { id: 1, url: 'u' } } })]]);
    const provider = new AhaProvider({});
    expect((await rejectionOf(provider.postComment('DEMO-1', 'x', { visibility: { type: 'group', value: 'x' } }))).name).to.equal(TICKET_ERROR.providerNotSupported);
    expect(calls).to.deep.equal([]);
    await provider.postComment('DEMO-1', 'Prefix\n\nBody', { mention: { id: 'u1', displayName: '<Ann>' } });
    expect(calls[0].body.comment.body).to.match(/^<p>Prefix<\/p><p>For: <strong>&lt;Ann&gt;<\/strong><\/p>/);
  }));
});
