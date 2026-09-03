import { expect } from 'chai';
// Load the barrel first, exactly as the CLI does. There is a pre-existing import cycle
// (ticketProviderRoot -> utils/index -> gitUtils -> ticketProvider/index -> jiraProvider, which
// extends TicketProviderRoot). Entering through the barrel resolves it in the order the app proves
// to work; entering through a provider module would throw "Cannot access 'TicketProviderRoot'
// before initialization".
import '../../../src/common/ticketProvider/index.js';
import { AzureBoardsProvider } from '../../../src/common/ticketProvider/azureBoardsProvider.js';
import { JiraProvider } from '../../../src/common/ticketProvider/jiraProvider.js';
import { ServiceNowProvider } from '../../../src/common/ticketProvider/serviceNowProvider.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

/** Sets env vars for the duration of one test, and restores whatever was there before */
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

const AZURE_ENV = {
  SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme',
  SYSTEM_TEAMPROJECT: 'Salesforce',
  CI_SFDX_HARDIS_AZURE_TOKEN: 'token',
};

const SERVICENOW_ENV = {
  SERVICENOW_URL: 'https://acme.service-now.com',
  SERVICENOW_USERNAME: 'integration',
  SERVICENOW_PASSWORD: 'secret',
};

describe('ticket providers', () => {
  describe('identifier routing', () => {
    it('routes a JIRA key to JIRA only', () => {
      expect(JiraProvider.matchesTicketId('ACME-4567')).to.equal(true);
      expect(AzureBoardsProvider.matchesTicketId('ACME-4567')).to.equal(false);
      expect(ServiceNowProvider.matchesTicketId('ACME-4567')).to.equal(false);
    });

    it('routes AB- and bare numbers to Azure Boards only', () => {
      for (const id of ['AB-4567', '4567']) {
        expect(AzureBoardsProvider.matchesTicketId(id), id).to.equal(true);
        expect(JiraProvider.matchesTicketId(id), id).to.equal(false);
        expect(ServiceNowProvider.matchesTicketId(id), id).to.equal(false);
      }
    });

    it('does not claim GitHub / GitLab issue prefixes for JIRA', () => {
      expect(JiraProvider.matchesTicketId('GH-123')).to.equal(false);
      expect(JiraProvider.matchesTicketId('GL-123')).to.equal(false);
    });

    it('routes ServiceNow record numbers to ServiceNow only', () => {
      for (const id of ['INC0012345', 'CHG0030307', 'DMND0001231', 'RITM0099887']) {
        expect(ServiceNowProvider.matchesTicketId(id), id).to.equal(true);
        expect(JiraProvider.matchesTicketId(id), id).to.equal(false);
        expect(AzureBoardsProvider.matchesTicketId(id), id).to.equal(false);
      }
    });

    it('maps a ServiceNow prefix to its table, and rejects an unknown one', () => {
      expect(ServiceNowProvider.tableOfTicketId('INC0012345')).to.equal('incident');
      expect(ServiceNowProvider.tableOfTicketId('DMND0001231')).to.equal('dmn_demand');
      expect(ServiceNowProvider.tableOfTicketId('CHG0030307')).to.equal('change_request');
      expect(ServiceNowProvider.tableOfTicketId('ZZZ0001234')).to.equal(null);
    });
  });

  describe('AzureBoardsProvider.getTicketDetails', () => {
    // The Azure Boards mapping cannot be exercised against a live org in CI, so the work item
    // payload is fed in directly through a stubbed WorkItemTracking API.
    const workItem = {
      id: 4567,
      _links: { html: { href: 'https://dev.azure.com/acme/Salesforce/_workitems/edit/4567' } },
      fields: {
        'System.Title': 'Block a past close date',
        'System.WorkItemType': 'User Story',
        'System.State': 'Active',
        'System.Reason': 'Implementation started',
        'System.AssignedTo': { displayName: 'Alice Martin' },
        'System.CreatedBy': 'Bob Durand <bob@acme.com>',
        'System.CreatedDate': '2026-08-01T09:00:00Z',
        'System.ChangedDate': '2026-08-12T15:30:00Z',
        'System.Tags': 'salesforce; opportunity',
        'System.AreaPath': 'Salesforce\\CRM',
        'System.IterationPath': 'Salesforce\\Sprint 12',
        'Microsoft.VSTS.Common.Priority': 2,
        'Microsoft.VSTS.Scheduling.StoryPoints': 5,
        'System.Description': '<p>The rule must block a past date.</p><p>Assign the permission set manually after deploy.</p>',
        'Microsoft.VSTS.Common.AcceptanceCriteria': '<ul><li>Past date rejected</li><li>Today accepted</li></ul>',
      },
      relations: [
        { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/acme/_apis/wit/workItems/4000', attributes: { name: 'Parent' } },
        { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev.azure.com/acme/_apis/wit/workItems/4568', attributes: { name: 'Child' } },
        { rel: 'AttachedFile', url: 'https://dev.azure.com/acme/_apis/wit/attachments/abc', attributes: { name: 'wireframe.png', resourceSize: 1234 } },
      ],
    };

    const comments = {
      comments: [{ createdBy: { displayName: 'Alice Martin' }, createdDate: '2026-08-02T10:00:00Z', text: '<p>Reproduced on UAT.</p>' }],
    };

    function stubbedProvider(): AzureBoardsProvider {
      const provider = new AzureBoardsProvider({});
      (provider as any).azureApi = {
        getWorkItemTrackingApi: async () => ({
          getWorkItem: async () => workItem,
          getComments: async () => comments,
        }),
      };
      return provider;
    }

    it('maps every header field, converting the HTML to text', withEnv(AZURE_ENV, async () => {
      const details = await stubbedProvider().getTicketDetails('AB-4567', { downloadAttachments: false });
      expect(details).to.not.equal(null);
      expect(details!.id).to.equal('AB-4567');
      expect(details!.provider).to.equal('AZURE');
      expect(details!.subject).to.equal('Block a past close date');
      expect(details!.type).to.equal('User Story');
      expect(details!.status).to.equal('Active');
      expect(details!.priority).to.equal('2');
      expect(details!.storyPoints).to.equal('5');
      expect(details!.sprint).to.equal('Salesforce\\Sprint 12');
      expect(details!.assignee).to.equal('Alice Martin');
      // A "Display Name <mail>" identity string keeps only the name
      expect(details!.reporter).to.equal('Bob Durand');
      expect(details!.labels).to.deep.equal(['salesforce', 'opportunity']);
      expect(details!.description).to.equal('The rule must block a past date.\n\nAssign the permission set manually after deploy.');
      expect(details!.acceptanceCriteria).to.contain('Past date rejected');
      expect(details!.url).to.equal('https://dev.azure.com/acme/Salesforce/_workitems/edit/4567');
      expect(details!.extra.areaPath).to.equal('Salesforce\\CRM');
    }));

    it('splits relations into parent, subtasks and attachments', withEnv(AZURE_ENV, async () => {
      const details = await stubbedProvider().getTicketDetails('AB-4567', { downloadAttachments: false });
      expect(details!.parent).to.equal('AB-4000');
      expect(details!.links.map((link) => link.relation)).to.deep.equal(['parent']);
      expect(details!.subtasks.map((subtask) => subtask.id)).to.deep.equal(['AB-4568']);
      expect(details!.attachments).to.have.lengthOf(1);
      expect(details!.attachments[0].filename).to.equal('wireframe.png');
      expect(details!.attachments[0].kind).to.equal('image');
      // downloadAttachments: false leaves the metadata but downloads nothing
      expect(details!.attachments[0].localPath).to.equal(null);
    }));

    it('maps the comments and flags the manual action', withEnv(AZURE_ENV, async () => {
      const details = await stubbedProvider().getTicketDetails('AB-4567', { downloadAttachments: false });
      expect(details!.comments).to.have.lengthOf(1);
      expect(details!.comments[0].author).to.equal('Alice Martin');
      expect(details!.comments[0].body).to.equal('Reproduced on UAT.');
      expect(details!.manualActions.join(' ')).to.contain('permission set');
    }));

    it('accepts a bare id and a work item URL', withEnv(AZURE_ENV, async () => {
      for (const id of ['4567', 'AB-4567', 'https://dev.azure.com/acme/Salesforce/_workitems/edit/4567']) {
        const details = await stubbedProvider().getTicketDetails(id, { downloadAttachments: false });
        expect(details!.id, id).to.equal('AB-4567');
      }
    }));
  });

  describe('ServiceNowProvider.getTicketDetails', () => {
    afterEach(() => setFetchForTests(null));

    /** Answers the three Table API calls the provider makes, in whatever order they come */
    function stubServiceNow(record: any, journals: any[], attachments: any[] = []): void {
      setFetchForTests(async (url: string) => {
        const body = url.includes('sys_journal_field')
          ? { result: journals }
          : url.includes('/api/now/attachment')
            ? { result: attachments }
            : { result: [record] };
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => JSON.stringify(body),
        } as any;
      });
    }

    const record = {
      sys_id: { display_value: 'abc123' },
      short_description: { display_value: 'Account merge loses the owner' },
      description: { display_value: '<p>The owner is reset.</p>' },
      state: { display_value: 'In Progress' },
      priority: { display_value: '1 - Critical' },
      assigned_to: { display_value: 'Alice Martin' },
      opened_by: { display_value: 'Bob Durand' },
      category: { display_value: 'Software' },
      close_notes: { display_value: 'Closed, demand DMND0003387 created.' },
    };

    it('maps the record and reads the journal entries', withEnv(SERVICENOW_ENV, async () => {
      stubServiceNow(record, [
        {
          sys_created_by: { display_value: 'Alice Martin' },
          sys_created_on: { display_value: '2026-08-02 10:00:00' },
          element: { display_value: 'work_notes' },
          value: { display_value: 'Assign the permission set manually.' },
        },
      ]);
      const details = await new ServiceNowProvider({}).getTicketDetails('INC0012345', { downloadAttachments: false });
      expect(details!.provider).to.equal('SERVICENOW');
      expect(details!.type).to.equal('incident');
      expect(details!.subject).to.equal('Account merge loses the owner');
      expect(details!.description).to.equal('The owner is reset.');
      expect(details!.extra.category).to.equal('Software');
      expect(details!.comments).to.have.lengthOf(1);
      expect(details!.comments[0].author).to.equal('Alice Martin');
      expect(details!.comments[0].body).to.equal('[work_notes] Assign the permission set manually.');
      expect(details!.manualActions.join(' ')).to.contain('permission set');
    }));

    it('falls back to the record journal fields when sys_journal_field is ACL-restricted', withEnv(SERVICENOW_ENV, async () => {
      // A denied read of sys_journal_field comes back as an empty result, not as a 403
      stubServiceNow(record, []);
      const details = await new ServiceNowProvider({}).getTicketDetails('INC0012345', { downloadAttachments: false });
      expect(details!.comments).to.have.lengthOf(1);
      expect(details!.comments[0].body).to.equal('[close_notes] Closed, demand DMND0003387 created.');
      expect(details!.comments[0].author).to.equal('');
    }));

    it('returns no comment when the record carries none either', withEnv(SERVICENOW_ENV, async () => {
      const bare = { ...record, close_notes: { display_value: '' } };
      stubServiceNow(bare, []);
      const details = await new ServiceNowProvider({}).getTicketDetails('INC0012345', { downloadAttachments: false });
      expect(details!.comments).to.deep.equal([]);
    }));

    it('classifies the attachments it lists', withEnv(SERVICENOW_ENV, async () => {
      stubServiceNow(record, [], [
        { sys_id: 'a1', file_name: 'shot.png', content_type: 'image/png', size_bytes: '10', download_link: 'https://acme.service-now.com/api/now/attachment/a1/file' },
        { sys_id: 'a2', file_name: 'spec.pdf', content_type: 'application/pdf', size_bytes: '20', download_link: 'https://acme.service-now.com/api/now/attachment/a2/file' },
      ]);
      const details = await new ServiceNowProvider({}).getTicketDetails('INC0012345', { downloadAttachments: false });
      expect(details!.attachments.map((attachment) => attachment.kind)).to.deep.equal(['image', 'document']);
    }));

    it('returns null for a prefix that maps to no table', withEnv(SERVICENOW_ENV, async () => {
      const details = await new ServiceNowProvider({}).getTicketDetails('ZZZ0001234', { downloadAttachments: false });
      expect(details).to.equal(null);
    }));
  });
});
