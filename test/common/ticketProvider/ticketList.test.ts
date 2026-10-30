import { expect } from 'chai';
// Load the barrel first, exactly as the CLI does, to resolve the pre-existing import cycle
import { TicketProvider } from '../../../src/common/ticketProvider/index.js';
import { GenericTicketingProvider } from '../../../src/common/ticketProvider/genericProvider.js';
import { JiraProvider } from '../../../src/common/ticketProvider/jiraProvider.js';
import { ServiceNowProvider } from '../../../src/common/ticketProvider/serviceNowProvider.js';
import { TICKET_ERROR } from '../../../src/common/ticketProvider/utils/ticketOperations.js';

/*
 * ticket list (JIRA Cloud cursor, Server / Data Center offsets), provider resolution without an
 * identifier, and the operations a connector does not support. Ported from the
 * feat/jira-autopilot-ticket-commands branch, which never reached main.
 */

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

const SERVICENOW_ENV = {
  SERVICENOW_URL: 'https://acme.service-now.com',
  SERVICENOW_USERNAME: 'integration',
  SERVICENOW_PASSWORD: 'secret',
};


async function rejectionOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('Expected a rejection');
}

describe('ticket operations on providers that cannot do them', () => {
  // JIRA and Azure Boards support them all; ServiceNow and the generic connector none
  const providers = () => [new ServiceNowProvider({}), new GenericTicketingProvider({})];

  it('fail with TicketProviderNotSupported, never with an empty result', async () => {
    for (const provider of providers()) {
      const label = provider.getLabel();
      expect((await rejectionOf(provider.searchTickets('project = ACME', { maxResults: 50 }))).name, label).to.equal(TICKET_ERROR.providerNotSupported);
      expect((await rejectionOf(provider.addTicketLabel('ACME-1', 'tag'))).name, label).to.equal('TicketProviderNotSupported');
      for (const call of [() => provider.whoAmI(), () => provider.listProjects(), () => provider.getProjectMeta('ACME'), () => provider.transitionTicket('ACME-1', 'Done'), () => provider.setTicketPoints('ACME-1', 3)]) {
        expect((await rejectionOf(call())).name, label).to.equal('TicketProviderNotSupported');
      }
    }
  });
});

const NO_JIRA_ENV = { JIRA_HOST: '', JIRA_EMAIL: '', JIRA_TOKEN: '', JIRA_PAT: '', JIRA_CLIENT_ID: '', JIRA_CLIENT_SECRET: '' };

// Starts from NO_JIRA_ENV, so a JIRA_PAT or client credentials set on the machine never leak in
const JIRA_ENV = {
  ...NO_JIRA_ENV,
  JIRA_HOST: 'https://acme.atlassian.net',
  JIRA_EMAIL: 'bot@acme.com',
  JIRA_TOKEN: 'token',
};

describe('TicketProvider.resolveProvider', () => {
  // Azure's autoDetectFromGitRemote may write these while a test runs; withEnv only restores the keys it was given
  const AZURE_DETECTED_KEYS = ['SYSTEM_COLLECTIONURI', 'SYSTEM_TEAMPROJECT'];
  let detectedSnapshot: Record<string, string | undefined> = {};
  beforeEach(() => {
    detectedSnapshot = Object.fromEntries(AZURE_DETECTED_KEYS.map((key) => [key, process.env[key]]));
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(detectedSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns the JIRA connector for a JIRA key', withEnv(JIRA_ENV, async () => {
    const { provider, providerClass } = await TicketProvider.resolveProvider({ ticketId: 'ACME-123' });
    expect(providerClass.providerKey).to.equal('jira');
    expect(provider).to.be.instanceOf(JiraProvider);
  }));

  it('returns the forced provider when no identifier is given', withEnv(JIRA_ENV, async () => {
    const { providerClass } = await TicketProvider.resolveProvider({ providerKey: 'jira' });
    expect(providerClass.providerKey).to.equal('jira');
  }));

  it('names an unconfigured provider TicketProviderNotConfigured', withEnv(NO_JIRA_ENV, async () => {
    const error = await rejectionOf(TicketProvider.resolveProvider({ providerKey: 'jira' }));
    expect(error.name).to.equal('TicketProviderNotConfigured');
  }));

  it('names an identifier no provider recognizes TicketNotFound', withEnv(JIRA_ENV, async () => {
    const error = await rejectionOf(TicketProvider.resolveProvider({ ticketId: 'not a ticket' }));
    expect(error.name).to.equal('TicketNotFound');
  }));

  // Blanks the other connectors too, so an Azure or ServiceNow setup on the machine cannot make it ambiguous
  const ONLY_JIRA_ENV = {
    ...JIRA_ENV,
    SYSTEM_COLLECTIONURI: '',
    SYSTEM_TEAMPROJECT: '',
    CI_SFDX_HARDIS_AZURE_TOKEN: '',
    SYSTEM_ACCESSTOKEN: '',
    AZURE_DEVOPS_EXT_PAT: '',
    SERVICENOW_URL: '',
  };

  it('takes the only configured provider when neither an identifier nor a provider is given', withEnv(ONLY_JIRA_ENV, async () => {
    const { providerClass } = await TicketProvider.resolveProvider({});
    expect(providerClass.providerKey).to.equal('jira');
  }));

  it('asks for --provider when several providers are configured', withEnv(
    {
      ...JIRA_ENV,
      ...SERVICENOW_ENV,
      SYSTEM_COLLECTIONURI: '',
      SYSTEM_TEAMPROJECT: '',
      CI_SFDX_HARDIS_AZURE_TOKEN: '',
      SYSTEM_ACCESSTOKEN: '',
      AZURE_DEVOPS_EXT_PAT: '',
    },
    async () => {
      const error = await rejectionOf(TicketProvider.resolveProvider({}));
      expect(error.name).to.equal('TicketProviderNotConfigured');
      expect(error.message).to.contain('--provider');
    }
  ));

  it('keeps the id-based message when the connector of an identifier is not configured', withEnv(NO_JIRA_ENV, async () => {
    const error = await rejectionOf(TicketProvider.resolveProvider({ ticketId: 'ACME-123' }));
    expect(error.name).to.equal('TicketProviderNotConfigured');
    expect(error.message).to.contain('ACME-123');
  }));
});

/** A JiraProvider whose jira.js client is replaced: getJiraClient() returns it as the active client */
function stubbedJira(client: any): JiraProvider {
  const provider = new JiraProvider({});
  (provider as any).jiraClient = client;
  return provider;
}

function jiraHttpError(status: number, data: any = {}): any {
  const error: any = new Error(`Request failed with status code ${status}`);
  error.status = status;
  error.response = { status, data };
  return error;
}

const jiraIssue = (key: string) => ({
  key,
  fields: {
    summary: `Summary of ${key}`,
    issuetype: { name: 'Bug' },
    status: { name: 'Open' },
    priority: { name: 'High' },
    assignee: null,
    created: '2026-09-01T12:12:00.000+0200',
    updated: '2026-09-18T08:03:00.000+0000',
    labels: ['backlog'],
  },
});

describe('JiraProvider.searchTickets', () => {
  it('maps every field of the contract', withEnv(JIRA_ENV, async () => {
    const provider = stubbedJira({
      issueSearch: { searchForIssuesUsingJqlEnhancedSearchPost: async () => ({ issues: [jiraIssue('ACME-1')] }) },
    });
    const result = await provider.searchTickets('project = ACME', { maxResults: 50 });
    expect(result.tickets).to.deep.equal([
      {
        id: 'ACME-1',
        url: 'https://acme.atlassian.net/browse/ACME-1',
        subject: 'Summary of ACME-1',
        type: 'Bug',
        status: 'Open',
        priority: 'High',
        assignee: null,
        created: '2026-09-01T10:12:00.000Z',
        updated: '2026-09-18T08:03:00.000Z',
        labels: ['backlog'],
        assigneeId: null,
        project: 'ACME',
        areaPath: null,
      },
    ]);
    expect(result.nextPageToken).to.equal(null);
    expect(result.truncated).to.equal(false);
  }));

  it('follows the cursor until --max-results, then reports the rest as truncated', withEnv(JIRA_ENV, async () => {
    const calls: any[] = [];
    const pages = [
      { issues: [jiraIssue('ACME-1'), jiraIssue('ACME-2')], nextPageToken: 'cursor-1' },
      { issues: [jiraIssue('ACME-3')], nextPageToken: 'cursor-2' },
    ];
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async (parameters: any) => {
          calls.push(parameters);
          return pages[calls.length - 1];
        },
      },
    });
    const result = await provider.searchTickets('project = ACME', { maxResults: 3 });
    expect(result.tickets.map((ticket) => ticket.id)).to.deep.equal(['ACME-1', 'ACME-2', 'ACME-3']);
    expect(calls.map((call) => call.maxResults)).to.deep.equal([3, 1]);
    expect(calls[1].nextPageToken).to.equal('cursor-1');
    expect(result.nextPageToken).to.equal('cursor-2');
    expect(result.truncated).to.equal(true);
  }));

  it('relays --page-token as is on the first call', withEnv(JIRA_ENV, async () => {
    let received: any;
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async (parameters: any) => {
          received = parameters;
          return { issues: [] };
        },
      },
    });
    await provider.searchTickets('project = ACME', { maxResults: 50, pageToken: 'opaque-token' });
    expect(received.nextPageToken).to.equal('opaque-token');
    expect(received.jql).to.equal('project = ACME');
  }));

  it('searches Jira Server / Data Center with offsets carried by the page token', withEnv({ ...JIRA_ENV, JIRA_HOST: 'https://jira.acme.com' }, async () => {
    const calls: any[] = [];
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlPost: async (parameters: any) => {
          calls.push(parameters);
          return { issues: [jiraIssue('ACME-1'), jiraIssue('ACME-2')], total: 5 };
        },
      },
    });
    const result = await provider.searchTickets('project = ACME', { maxResults: 2, pageToken: '1' });
    expect(calls[0].startAt).to.equal(1);
    expect(result.tickets.map((ticket) => ticket.id)).to.deep.equal(['ACME-1', 'ACME-2']);
    expect(result.nextPageToken).to.equal('3');
    expect(result.truncated).to.equal(true);
  }));

  it('names a rejected query TicketQueryInvalid, keeping the JIRA message', withEnv(JIRA_ENV, async () => {
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async () => {
          throw jiraHttpError(400, { errorMessages: ["Field 'nope' does not exist"] });
        },
      },
    });
    const error = await rejectionOf(provider.searchTickets('nope = 1', { maxResults: 50 }));
    expect(error.name).to.equal('TicketQueryInvalid');
    expect(error.message).to.contain("Field 'nope' does not exist");
  }));

  it('names a 429 TicketRateLimited', withEnv(JIRA_ENV, async () => {
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async () => {
          throw jiraHttpError(429);
        },
      },
    });
    expect((await rejectionOf(provider.searchTickets('project = ACME', { maxResults: 50 }))).name).to.equal('TicketRateLimited');
  }));

  it('names a missing credential TicketProviderNotConfigured', withEnv(NO_JIRA_ENV, async () => {
    const provider = new JiraProvider({});
    expect((await rejectionOf(provider.searchTickets('project = ACME', { maxResults: 50 }))).name).to.equal('TicketProviderNotConfigured');
  }));

  it('refuses a maxResults that is not a positive integer, without calling JIRA', withEnv(JIRA_ENV, async () => {
    let called = false;
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async () => {
          called = true;
          return { issues: [] };
        },
      },
    });
    const error = await rejectionOf(provider.searchTickets('project = ACME', { maxResults: 0 }));
    expect(error.message).to.contain('maxResults must be a positive integer');
    expect(called).to.equal(false);
  }));

  it('stops on an empty page even when it carries a cursor', withEnv(JIRA_ENV, async () => {
    let calls = 0;
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async () => {
          calls++;
          return { issues: [], nextPageToken: 'cursor-that-leads-nowhere' };
        },
      },
    });
    const result = await provider.searchTickets('project = ACME', { maxResults: 50 });
    expect(calls).to.equal(1);
    expect(result.tickets).to.deep.equal([]);
    expect(result.nextPageToken).to.equal(null);
    expect(result.truncated).to.equal(false);
  }));

  it('names a 401 on the last credential TicketProviderNotConfigured', withEnv(JIRA_ENV, async () => {
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async () => {
          throw jiraHttpError(401);
        },
      },
    });
    // No fallback credential: a 401 must never reach a real client and the network
    (provider as any).nextAuths = [];
    expect((await rejectionOf(provider.searchTickets('project = ACME', { maxResults: 50 }))).name).to.equal('TicketProviderNotConfigured');
  }));

  it('skips an issue returned without a key', withEnv(JIRA_ENV, async () => {
    const provider = stubbedJira({
      issueSearch: {
        searchForIssuesUsingJqlEnhancedSearchPost: async () => ({ issues: [{ fields: { summary: 'No key' } }, jiraIssue('ACME-2')] }),
      },
    });
    const result = await provider.searchTickets('project = ACME', { maxResults: 50 });
    expect(result.tickets.map((ticket) => ticket.id)).to.deep.equal(['ACME-2']);
    expect(result.tickets.some((ticket) => ticket.url.endsWith('/browse/undefined'))).to.equal(false);
  }));
});

