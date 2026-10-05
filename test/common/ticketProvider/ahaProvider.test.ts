import { expect } from 'chai';
// Load the barrel first, exactly as the CLI does: see ticketProviders.test.ts for the import cycle
import { Ticket, TicketProvider, activeTicketProviders, allTicketProviders } from '../../../src/common/ticketProvider/index.js';
import { AhaProvider } from '../../../src/common/ticketProvider/ahaProvider.js';
import { getTicketCollectionIssues, clearTicketCollectionIssues } from '../../../src/common/ticketProvider/ticketProviderRoot.js';
import { HttpError, httpGet, setFetchForTests } from '../../../src/common/utils/httpUtils.js';

const TICKETING_VARS = ['AHA_HOST', 'AHA_API_KEY', 'AHA_TICKET_REGEX', 'JIRA_HOST', 'JIRA_EMAIL', 'JIRA_TOKEN', 'JIRA_PAT', 'JIRA_TICKET_REGEX', 'DEPLOYED_TAG_TEMPLATE'];

/** Runs one test with exactly these ticketing variables, and restores whatever was there before */
function withEnv(vars: Record<string, string>, run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const previous: Record<string, string | undefined> = {};
    for (const key of TICKETING_VARS) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
    Object.assign(process.env, vars);
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

const AHA_ENV = { AHA_HOST: 'acme.aha.io', AHA_API_KEY: 'secret' };

type RecordedCall = { url: string; method: string; body: any; auth: string };

/** Records every call and answers it from the handler, which returns [status, body] */
function stubAha(handler: (url: string, method: string) => [number, any]): RecordedCall[] {
  const calls: RecordedCall[] = [];
  setFetchForTests(async (url: string, init: any) => {
    const method = init?.method || 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization || '' });
    const [status, body] = handler(url, method);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

describe('AhaProvider', () => {
  afterEach(() => setFetchForTests(null));

  describe('connectors reading the references of a project', () => {
    const keys = (config: any) => activeTicketProviders(config).map((provider) => provider.providerKey);

    it('runs every connector except Aha! when ticketingProvider is not set', withEnv(AHA_ENV, async () => {
      // An Aha! host and an API key change nothing: PROJ-123 is a JIRA key by default
      expect(keys({ ahaHost: 'acme.aha.io' })).to.deep.equal(['jira', 'generic', 'azure', 'servicenow']);
      expect(keys({})).to.not.include('aha');
    }));

    it('runs the connector ticketingProvider names, and no other', () => {
      expect(keys({ ticketingProvider: 'AHA' })).to.deep.equal(['aha']);
      expect(keys({ ticketingProvider: 'JIRA' })).to.deep.equal(['jira']);
      expect(keys({ ticketingProvider: 'SERVICENOW' })).to.deep.equal(['servicenow']);
      expect(keys({ ticketingProvider: 'azure' })).to.deep.equal(['azure']);
    });

    it('falls back on the default when ticketingProvider names nothing known', () => {
      expect(keys({ ticketingProvider: 'TRELLO' })).to.deep.equal(keys({}));
    });

    it('has a connector for every value ticketingProvider accepts', async () => {
      const fs = await import('fs');
      const schema = JSON.parse(fs.readFileSync('config/sfdx-hardis.jsonschema.json', 'utf8'));
      const names = allTicketProviders.map((provider) => provider.providerKey.toUpperCase()).sort();
      expect([...schema.properties.ticketingProvider.enum].sort()).to.deep.equal(names);
    });

    it('needs a host and an API key to be available', withEnv({}, async () => {
      expect(AhaProvider.isAvailable({ ahaHost: 'acme.aha.io' })).to.equal(false);
      process.env.AHA_API_KEY = 'secret';
      expect(AhaProvider.isAvailable({})).to.equal(false);
      expect(AhaProvider.isAvailable({ ahaHost: 'acme.aha.io' })).to.equal(true);
      process.env.AHA_HOST = '$(AHA_HOST)';
      // An Azure Pipelines variable that was never defined comes as its own expression
      expect(AhaProvider.isAvailable({})).to.equal(false);
    }));
  });

  describe('identifier routing', () => {
    it('recognizes a feature reference, and nothing else', () => {
      expect(AhaProvider.matchesTicketId('PROD-12')).to.equal(true);
      for (const id of ['PROD-12-3', 'PROD-E-4', 'PROD-R-2', '2026-09', '1234', 'INC0012345']) {
        expect(AhaProvider.matchesTicketId(id), id).to.equal(false);
      }
    });

    /** Fails on any call that does not go to the Aha! account */
    function stubAhaOnly(): RecordedCall[] {
      return stubAha((url) => {
        if (!url.startsWith('https://acme.aha.io/api/v1/')) {
          return [500, { error: `unexpected call to ${url}` }];
        }
        return url.includes('/comments') ? [200, { comments: [], pagination: { total_pages: 0 } }] : [200, { feature: { reference_num: 'PROD-12', name: 'Close date' } }];
      });
    }

    /** TicketProvider.getTicketDetails() reads the project configuration from the working directory */
    async function inProject(configYaml: string, run: () => Promise<void>): Promise<void> {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aha-ticket-'));
      fs.mkdirSync(path.join(dir, 'config'));
      fs.writeFileSync(path.join(dir, 'config', '.sfdx-hardis.yml'), configYaml);
      const previous = process.cwd();
      process.chdir(dir);
      try {
        await run();
      } finally {
        process.chdir(previous);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    it('reads a reference from Aha! in a project that declares Aha!', withEnv({ ...AHA_ENV, JIRA_HOST: 'acme.atlassian.net', JIRA_PAT: 'token' }, async () => {
      await inProject('ticketingProvider: AHA\n', async () => {
        stubAhaOnly();
        const details = await TicketProvider.getTicketDetails('PROD-12', { downloadAttachments: false });
        expect(details!.provider).to.equal('AHA');
      });
    }));

    it('leaves a reference to JIRA in a project that declares nothing', withEnv(AHA_ENV, async () => {
      await inProject('ahaHost: acme.aha.io\n', async () => {
        const calls = stubAhaOnly();
        let message = '';
        try {
          await TicketProvider.getTicketDetails('PROD-12', { downloadAttachments: false });
        } catch (e: any) {
          message = e.message;
        }
        // JIRA has no credentials here: the error names it, and Aha! is never called
        expect(message).to.contain('JIRA');
        expect(calls).to.deep.equal([]);
      });
    }));

    it('reads from the connector --provider names, whatever the project declares', withEnv(AHA_ENV, async () => {
      await inProject('ticketingProvider: JIRA\n', async () => {
        stubAhaOnly();
        const details = await TicketProvider.getTicketDetails('PROD-12', { downloadAttachments: false, providerKey: 'aha' });
        expect(details!.provider).to.equal('AHA');
      });
    }));
  });

  describe('getTicketsFromString', () => {
    const text = [
      'PROD-12 block a past close date',
      'branch features/dev/prod-7',
      'see https://acme.aha.io/features/MOBILE-3 and PROD-12 again',
      'requirement PROD-12-3, epic PROD-E-4, release PROD-R-2, date 2026-09',
    ].join('\n');

    it('collects the features of a commit, a branch and a link, and nothing else', withEnv({ AHA_HOST: 'https://acme.aha.io/' }, async () => {
      const tickets = await AhaProvider.getTicketsFromString(text, { config: {} });
      expect(tickets.map((ticket) => ticket.id)).to.deep.equal(['MOBILE-3', 'PROD-12', 'PROD-7']);
      expect(tickets.every((ticket) => ticket.provider === 'AHA')).to.equal(true);
      expect(tickets[1].url).to.equal('https://acme.aha.io/features/PROD-12');
      // A reference written in lowercase in a branch name is the same feature
      expect(tickets[2].url).to.equal('https://acme.aha.io/features/PROD-7');
    }));

    it('keeps a link as it was written, regional host included', withEnv({ AHA_HOST: 'acme.aha.io' }, async () => {
      const tickets = await AhaProvider.getTicketsFromString('https://acme.euw4.aha.io/features/PROD-9', { config: {} });
      expect(tickets).to.deep.equal([{ provider: 'AHA', id: 'PROD-9', url: 'https://acme.euw4.aha.io/features/PROD-9' }]);
    }));

    it('collects nothing in a project that does not name its Aha! account', withEnv({}, async () => {
      expect(await AhaProvider.getTicketsFromString(text, { config: {} })).to.deep.equal([]);
    }));

    it('leaves alone a link to a feature of another account', withEnv({ AHA_HOST: 'acme.aha.io' }, async () => {
      // Its reference would be read, then commented on, in the account of the project
      const tickets = await AhaProvider.getTicketsFromString('see https://partner.aha.io/features/APP-7, and PROD-12', { config: {} });
      expect(tickets.map((ticket) => ticket.url)).to.deep.equal(['https://acme.aha.io/features/PROD-12']);
    }));

    it('always calls the account over https', withEnv({ AHA_HOST: 'http://acme.aha.io/products/PROD', AHA_API_KEY: 'secret' }, async () => {
      const tickets = await AhaProvider.getTicketsFromString('PROD-12', { config: {} });
      expect(tickets[0].url).to.equal('https://acme.aha.io/features/PROD-12');
      const calls = stubAha(() => [200, { feature: { name: 'Close date' } }]);
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(calls[0].url.startsWith('https://acme.aha.io/api/v1/')).to.equal(true);
    }));

    it('accepts an account whose name starts with http', withEnv({ AHA_HOST: 'httpworks.aha.io', AHA_API_KEY: 'secret' }, async () => {
      expect(AhaProvider.isAvailable({})).to.equal(true);
      const tickets = await AhaProvider.getTicketsFromString('PROD-12', { config: {} });
      expect(tickets[0].url).to.equal('https://httpworks.aha.io/features/PROD-12');
    }));

    it('narrows the detection down to the project regex', withEnv({ ...AHA_ENV, AHA_TICKET_REGEX: '(MOBILE-[0-9]+)' }, async () => {
      const tickets = await AhaProvider.getTicketsFromString('PROD-12 and MOBILE-8', { config: {} });
      expect(tickets.map((ticket) => ticket.id)).to.deep.equal(['MOBILE-8']);
    }));

    it('collects nothing, and does not throw, on a malformed project regex', withEnv({ ...AHA_ENV, AHA_TICKET_REGEX: '([' }, async () => {
      expect(await AhaProvider.getTicketsFromString('PROD-12', { config: {} })).to.deep.equal([]);
    }));

    it('lists a reference once, as an Aha! feature, in a project that declares Aha!', withEnv({ JIRA_HOST: 'acme.atlassian.net' }, async () => {
      const config = { ticketingProvider: 'AHA', ahaHost: 'acme.aha.io' };
      const tickets = await TicketProvider.getProvidersTicketsFromString('PROD-12 block a past close date', { config });
      expect(tickets.map((ticket) => `${ticket.provider} ${ticket.id}`)).to.deep.equal(['AHA PROD-12']);
      expect(tickets[0].url).to.equal('https://acme.aha.io/features/PROD-12');
    }));

    it('lists a reference once, as a JIRA ticket, in a project that declares nothing', withEnv({ AHA_HOST: 'acme.aha.io', JIRA_HOST: 'acme.atlassian.net' }, async () => {
      // The link to the Aha! feature is not read either: Aha! only runs when it is declared
      const tickets = await TicketProvider.getProvidersTicketsFromString('PROD-12 block a past close date, see https://acme.aha.io/features/PROD-12', { config: {} });
      expect(tickets.map((ticket) => `${ticket.provider} ${ticket.id}`)).to.deep.equal(['JIRA PROD-12']);
      expect(tickets[0].url).to.equal('https://acme.atlassian.net/browse/PROD-12');
    }));

    it('only reads JIRA references in a project that declares JIRA', withEnv({ SERVICENOW_URL: 'https://acme.service-now.com', SERVICENOW_USERNAME: 'ci', SERVICENOW_PASSWORD: 'secret' }, async () => {
      const text = 'ACME-12 and INC0012345';
      const declared = await TicketProvider.getProvidersTicketsFromString(text, { config: { ticketingProvider: 'JIRA', jiraHost: 'acme.atlassian.net' } });
      expect(declared.map((ticket) => `${ticket.provider} ${ticket.id}`)).to.deep.equal(['JIRA ACME-12']);
      const undeclared = await TicketProvider.getProvidersTicketsFromString(text, { config: { jiraHost: 'acme.atlassian.net' } });
      expect(undeclared.map((ticket) => `${ticket.provider} ${ticket.id}`)).to.deep.equal(['JIRA ACME-12', 'SERVICENOW INC0012345']);
    }));
  });

  describe('collectTicketsInfo', () => {
    const feature = {
      reference_num: 'PROD-12',
      name: 'Block a past close date',
      url: 'https://acme.aha.io/features/PROD-12',
      workflow_status: { id: '700', name: 'In development' },
      assigned_to_user: { id: '11', name: 'Alice Martin' },
      created_by_user: { id: '22', name: 'Bob Durand' },
      description: { body: '<p>The rule must block a past date.</p>' },
    };

    it('fills the name, the status and the owner, and sends the API key', withEnv({ ...AHA_ENV, AHA_HOST: 'acme.euw4.aha.io' }, async () => {
      const calls = stubAha(() => [200, { feature }]);
      const tickets: Ticket[] = [
        { provider: 'AHA', id: 'PROD-12', url: 'https://acme.euw4.aha.io/features/PROD-12' },
        { provider: 'JIRA', id: 'ACME-1', url: '' },
      ];
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].url).to.contain('https://acme.euw4.aha.io/api/v1/features/PROD-12?fields=');
      expect(calls[0].auth).to.equal('Bearer secret');
      expect(tickets[0]).to.include({
        foundOnServer: true,
        subject: 'Block a past close date',
        body: 'The rule must block a past date.',
        status: '700',
        statusLabel: 'In development',
        assigneeLabel: 'Alice Martin',
        reporterLabel: 'Bob Durand',
        authorLabel: 'Alice Martin',
        // The link Aha! answers with replaces the one built from the configured host
        url: 'https://acme.aha.io/features/PROD-12',
      });
      expect(tickets[1].foundOnServer).to.equal(undefined);
    }));

    it('falls back on the creator when nobody is assigned', withEnv(AHA_ENV, async () => {
      stubAha(() => [200, { feature: { ...feature, assigned_to_user: null } }]);
      const tickets: Ticket[] = [{ provider: 'AHA', id: 'PROD-12', url: '' }];
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(tickets[0].assigneeLabel).to.equal(undefined);
      expect(tickets[0].authorLabel).to.equal('Bob Durand');
    }));

    it('leaves a reference Aha! does not know as a bare link, without reporting it', withEnv(AHA_ENV, async () => {
      clearTicketCollectionIssues();
      stubAha((url) => (url.includes('UTF-8') ? [404, { error: 'Record not found.' }] : [200, { feature }]));
      const tickets: Ticket[] = [
        { provider: 'AHA', id: 'PROD-12', url: '' },
        { provider: 'AHA', id: 'UTF-8', url: 'kept' },
      ];
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(tickets[0].foundOnServer).to.equal(true);
      expect(tickets[1].foundOnServer).to.equal(undefined);
      expect(tickets[1].url).to.equal('kept');
      // UTF-8 is not a feature: saying so in every Pull Request comment would be noise
      expect(getTicketCollectionIssues()).to.deep.equal([]);
    }));

    it('reports nothing either when the only reference of a Pull Request is not a feature', withEnv(AHA_ENV, async () => {
      clearTicketCollectionIssues();
      stubAha(() => [404, { error: 'Record not found.' }]);
      const tickets: Ticket[] = [{ provider: 'AHA', id: 'UTF-8', url: '' }];
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(tickets[0].foundOnServer).to.equal(undefined);
      expect(getTicketCollectionIssues()).to.deep.equal([]);
    }));

    it('reads a throttled feature again, after the delay Aha! asked for', withEnv(AHA_ENV, async () => {
      let attempts = 0;
      setFetchForTests(async () => {
        attempts++;
        return attempts === 1
          ? new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } })
          : new Response(JSON.stringify({ feature }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const tickets: Ticket[] = [{ provider: 'AHA', id: 'PROD-12', url: '' }];
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(attempts).to.equal(2);
      expect(tickets[0].foundOnServer).to.equal(true);
    }));

    it('gives the headers of a refused request to whoever catches it', async () => {
      setFetchForTests(async () => new Response('{}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7' } }));
      let caught: any = null;
      try {
        await httpGet('https://acme.aha.io/api/v1/me');
      } catch (e) {
        caught = e;
      }
      expect(caught).to.be.instanceOf(HttpError);
      expect(caught.response.headers['retry-after']).to.equal('7');
    });

    it('reports the features that could not be read for another reason', withEnv(AHA_ENV, async () => {
      clearTicketCollectionIssues();
      stubAha((url) => (url.includes('PROD-13') ? [403, { error: 'Forbidden' }] : [200, { feature }]));
      const tickets: Ticket[] = [
        { provider: 'AHA', id: 'PROD-12', url: '' },
        { provider: 'AHA', id: 'PROD-13', url: '' },
      ];
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(getTicketCollectionIssues()).to.have.lengthOf(1);
      expect(getTicketCollectionIssues()[0]).to.contain('1 of 2');
    }));

    it('reports a refused API key once, whatever the number of features', withEnv(AHA_ENV, async () => {
      clearTicketCollectionIssues();
      stubAha(() => [401, { error: 'Unauthorized' }]);
      const tickets: Ticket[] = [
        { provider: 'AHA', id: 'PROD-12', url: '' },
        { provider: 'AHA', id: 'PROD-13', url: '' },
      ];
      await new AhaProvider({}).collectTicketsInfo(tickets);
      expect(getTicketCollectionIssues()).to.have.lengthOf(1);
      expect(getTicketCollectionIssues()[0]).to.contain('AHA_API_KEY');
    }));
  });

  describe('getTicketDetails', () => {
    const feature = {
      reference_num: 'PROD-12',
      name: 'Block a past close date',
      url: 'https://acme.aha.io/features/PROD-12',
      created_at: '2026-08-01T09:00:00.000Z',
      updated_at: '2026-08-12T15:30:00.000Z',
      workflow_kind: { name: 'Improvement' },
      workflow_status: { name: 'In development' },
      assigned_to_user: { name: 'Alice Martin' },
      created_by_user: { name: 'Bob Durand' },
      tags: ['salesforce', 'UAT_DEPLOYED'],
      score: 11,
      due_date: '2026-09-28',
      original_estimate: { value: 5, units: 'points' },
      custom_fields: [{ key: 'business_unit', value: 'Sales' }, { key: 'owners', value: ['a', 'b'] }],
      epic_reference_num: 'PROD-E-4',
      epic: { reference_num: 'PROD-E-4', name: 'Opportunity quality', url: 'https://acme.aha.io/epics/PROD-E-4' },
      release: { reference_num: 'PROD-R-2', name: 'October release', url: 'https://acme.aha.io/releases/PROD-R-2' },
      description: {
        body: '<p>The rule must block a past date.</p><p>Assign the permission set manually after deploy.</p>',
        attachments: [{ file_name: 'wireframe.png', content_type: 'image/png', file_size: 1234, download_url: 'https://acme.aha.io/attachments/1/token/abc.download' }],
      },
      attachments: [{ file_name: 'spec.pdf', content_type: 'application/pdf', file_size: 20, download_url: 'https://acme.aha.io/attachments/2/token/def.download' }],
      requirements: [{ reference_num: 'PROD-12-1', name: 'Validation rule', workflow_status: { name: 'Done' }, url: 'https://acme.aha.io/requirements/PROD-12-1' }],
      feature_links: [
        {
          link_type: 'Depends on',
          parent_record: { reference_num: 'PROD-12', name: 'Block a past close date' },
          child_record: { reference_num: 'PROD-9', name: 'Close date field', url: 'https://acme.aha.io/features/PROD-9' },
        },
        {
          link_type: 'Relates to',
          parent_record: { reference_num: 'MOBILE-3', name: 'Mobile layout', url: 'https://acme.aha.io/features/MOBILE-3' },
          child_record: { reference_num: 'PROD-12', name: 'Block a past close date' },
        },
      ],
    };

    /** Two pages of comments, newest first like Aha! serves them */
    function stubFeature(): RecordedCall[] {
      return stubAha((url) => {
        if (url.includes('/comments')) {
          return /[?&]page=2(&|$)/.test(url)
            ? [200, { comments: [{ body: '<p>Reproduced on UAT.</p>', created_at: '2026-08-02T10:00:00.000Z', user: { name: 'Alice Martin' } }], pagination: { total_pages: 2 } }]
            : [200, { comments: [{ body: '<p>Fixed.</p>', created_at: '2026-08-05T10:00:00.000Z', user: { name: 'Bob Durand' } }], pagination: { total_pages: 2 } }];
        }
        return [200, { feature }];
      });
    }

    it('maps the header fields, converting the HTML to text', withEnv(AHA_ENV, async () => {
      const calls = stubFeature();
      // A reference typed in lowercase is not found by Aha!: it is sent in uppercase
      const details = await new AhaProvider({}).getTicketDetails('prod-12', { downloadAttachments: false });
      expect(calls[0].url).to.equal('https://acme.aha.io/api/v1/features/PROD-12');
      expect(details!.provider).to.equal('AHA');
      expect(details!.id).to.equal('PROD-12');
      expect(details!.url).to.equal('https://acme.aha.io/features/PROD-12');
      expect(details!.subject).to.equal('Block a past close date');
      expect(details!.type).to.equal('Improvement');
      expect(details!.status).to.equal('In development');
      expect(details!.assignee).to.equal('Alice Martin');
      expect(details!.reporter).to.equal('Bob Durand');
      expect(details!.labels).to.deep.equal(['salesforce', 'UAT_DEPLOYED']);
      expect(details!.fixVersions).to.deep.equal(['October release']);
      expect(details!.epic).to.equal('PROD-E-4');
      expect(details!.storyPoints).to.equal('5 points');
      expect(details!.description).to.equal('The rule must block a past date.\n\nAssign the permission set manually after deploy.');
      expect(details!.extra).to.include({ score: 11, due_date: '2026-09-28', business_unit: 'Sales' });
      expect(details!.extra.owners).to.equal(undefined);
      expect(details!.manualActions.join(' ')).to.contain('permission set');
    }));

    it('reads every page of comments, oldest first', withEnv(AHA_ENV, async () => {
      stubFeature();
      const details = await new AhaProvider({}).getTicketDetails('PROD-12', { downloadAttachments: false });
      expect(details!.comments.map((comment) => comment.body)).to.deep.equal(['Reproduced on UAT.', 'Fixed.']);
      expect(details!.comments[0].author).to.equal('Alice Martin');
      expect(details!.commentsTruncated).to.equal(false);
    }));

    it('lists the requirements, the linked features and the records the feature belongs to', withEnv(AHA_ENV, async () => {
      stubFeature();
      const details = await new AhaProvider({}).getTicketDetails('PROD-12', { downloadAttachments: false });
      expect(details!.subtasks.map((subtask) => `${subtask.id} ${subtask.status}`)).to.deep.equal(['PROD-12-1 Done']);
      expect(details!.links.map((link) => `${link.relation} ${link.id}`)).to.deep.equal([
        'Depends on PROD-9',
        'Relates to MOBILE-3',
        'epic PROD-E-4',
        'release PROD-R-2',
      ]);
    }));

    it('lists the attachments of the feature and of its description', withEnv(AHA_ENV, async () => {
      stubFeature();
      const details = await new AhaProvider({}).getTicketDetails('PROD-12', { downloadAttachments: false });
      expect(details!.attachments.map((attachment) => `${attachment.filename} ${attachment.kind}`)).to.deep.equal(['spec.pdf document', 'wireframe.png image']);
      expect(details!.attachments[0].localPath).to.equal(null);
    }));

    it('still returns the feature when its comments cannot be read', withEnv(AHA_ENV, async () => {
      stubAha((url) => (url.includes('/comments') ? [403, { error: 'Forbidden' }] : [200, { feature }]));
      const details = await new AhaProvider({}).getTicketDetails('PROD-12', { downloadAttachments: false });
      expect(details!.subject).to.equal('Block a past close date');
      expect(details!.comments).to.deep.equal([]);
      // Nothing was read: the list must not pass for a feature without comments
      expect(details!.commentsTruncated).to.equal(true);
    }));

    it('flags the comments as incomplete when a page is missing, and keeps them oldest first', withEnv(AHA_ENV, async () => {
      stubAha((url) => {
        if (!url.includes('/comments')) {
          return [200, { feature }];
        }
        return /[?&]page=1(&|$)/.test(url)
          ? [200, { comments: [{ body: '<p>Second</p>', created_at: '2026-08-05T10:00:00.000Z' }, { body: '<p>First</p>', created_at: '2026-08-02T10:00:00.000Z' }], pagination: { total_pages: 2 } }]
          : [500, { error: 'Server error' }];
      });
      const details = await new AhaProvider({}).getTicketDetails('PROD-12', { downloadAttachments: false });
      expect(details!.comments.map((comment) => comment.body)).to.deep.equal(['First', 'Second']);
      expect(details!.commentsTruncated).to.equal(true);
    }));
  });

  describe('postDeploymentComments', () => {
    const pullRequestInfo: any = {
      webUrl: 'https://github.com/acme/sfdx-project/pull/812',
      title: 'Block a past <close> date',
      authorName: 'Alice Martin',
    };

    function stubWrites(currentTags: string[]): RecordedCall[] {
      return stubAha((url, method) => {
        if (method === 'POST') {
          return [200, { comment: { id: '1' } }];
        }
        return [200, { feature: { tags: currentTags } }];
      });
    }

    it('comments the features that were found, and only those of Aha!', withEnv({ ...AHA_ENV, DEPLOYED_TAG_TEMPLATE: 'DEPLOYED_TO_{BRANCH}' }, async () => {
      const calls = stubWrites([]);
      const tickets: Ticket[] = [
        { provider: 'AHA', id: 'PROD-12', url: '', foundOnServer: true },
        { provider: 'JIRA', id: 'ACME-1', url: '', foundOnServer: true },
        { provider: 'AHA', id: 'UTF-8', url: '' },
      ];
      await new AhaProvider({}).postDeploymentComments(tickets, 'https://acme--uat.sandbox.my.salesforce.com', pullRequestInfo);
      const comments = calls.filter((call) => call.method === 'POST');
      expect(comments).to.have.lengthOf(1);
      expect(comments[0].url).to.equal('https://acme.aha.io/api/v1/features/PROD-12/comments');
      const body: string = comments[0].body.comment.body;
      expect(body).to.contain('Deployed by <a href="https://sfdx-hardis.cloudity.com/">sfdx-hardis</a>');
      expect(body).to.contain('<a href="https://acme--uat.sandbox.my.salesforce.com">acme--uat.sandbox</a>');
      // What comes from the Pull Request is escaped before it lands in an HTML comment
      expect(body).to.contain('<a href="https://github.com/acme/sfdx-project/pull/812">Block a past &lt;close&gt; date</a>, by Alice Martin');
      expect(calls.some((call) => call.url.includes('ACME-1') || call.url.includes('UTF-8'))).to.equal(false);
    }));

    it('adds the deployment tag without losing the tags of the feature', withEnv({ ...AHA_ENV, DEPLOYED_TAG_TEMPLATE: 'DEPLOYED_TO_{BRANCH}' }, async () => {
      const calls = stubWrites(['salesforce', 'priority, high']);
      const tickets: Ticket[] = [{ provider: 'AHA', id: 'PROD-12', url: '', foundOnServer: true }];
      await new AhaProvider({}).postDeploymentComments(tickets, 'https://acme.my.salesforce.com', null);
      const updates = calls.filter((call) => call.method === 'PUT');
      expect(updates).to.have.lengthOf(1);
      expect(updates[0].url).to.contain('https://acme.aha.io/api/v1/features/PROD-12');
      const tags: string[] = updates[0].body.feature.tags;
      expect(tags.slice(0, 2)).to.deep.equal(['salesforce', 'priority, high']);
      expect(tags).to.have.lengthOf(3);
      expect(tags[2]).to.match(/^DEPLOYED_TO_.+/);
    }));

    it('does not update a feature that already carries the tag', withEnv({ ...AHA_ENV, DEPLOYED_TAG_TEMPLATE: 'ALREADY_{BRANCH}' }, async () => {
      const provider = new AhaProvider({});
      const calls = stubWrites([await provider.getDeploymentTag()]);
      const tickets: Ticket[] = [{ provider: 'AHA', id: 'PROD-12', url: '', foundOnServer: true }];
      await provider.postDeploymentComments(tickets, 'https://acme.my.salesforce.com', null);
      expect(calls.some((call) => call.method === 'PUT')).to.equal(false);
      expect(calls.filter((call) => call.method === 'POST')).to.have.lengthOf(1);
    }));

    it('writes to every feature of a deployment', withEnv(AHA_ENV, async () => {
      const calls = stubWrites([]);
      const tickets: Ticket[] = Array.from({ length: 12 }, (_unused, index) => ({ provider: 'AHA', id: `PROD-${index + 1}`, url: '', foundOnServer: true }));
      await new AhaProvider({}).postDeploymentComments(tickets, 'https://acme.my.salesforce.com', null);
      expect(calls.filter((call) => call.method === 'POST')).to.have.lengthOf(12);
      expect(calls.filter((call) => call.method === 'PUT')).to.have.lengthOf(12);
    }));

    it('still tags a feature whose comment was refused', withEnv(AHA_ENV, async () => {
      const calls = stubAha((url, method) => (method === 'POST' ? [403, { error: 'Forbidden' }] : [200, { feature: { tags: [] } }]));
      const tickets: Ticket[] = [{ provider: 'AHA', id: 'PROD-12', url: '', foundOnServer: true }];
      await new AhaProvider({}).postDeploymentComments(tickets, 'https://acme.my.salesforce.com', null);
      expect(calls.filter((call) => call.method === 'PUT')).to.have.lengthOf(1);
    }));
  });
});
