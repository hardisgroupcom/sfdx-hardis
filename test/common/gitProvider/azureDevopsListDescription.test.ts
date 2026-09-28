import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
// (azureDevops -> utils/index -> gitUtils -> ticketProvider/index -> jiraProvider, which extends
// TicketProviderRoot), and entering through a leaf module of it throws.
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';

// Azure DevOps truncates the description of a Pull Request returned by the list API to 400
// characters and says nothing about it. A promotion branch whose description is longer then loses
// its `promotionPullRequests` declaration, and the stories it carries stop being seen as promoted.
describe('AzureDevopsProvider description truncation of the list API', () => {
  const buildProvider = () => {
    const previousCollectionUri = process.env.SYSTEM_COLLECTIONURI;
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme/';
    const provider = new AzureDevopsProvider();
    if (previousCollectionUri === undefined) {
      delete process.env.SYSTEM_COLLECTIONURI;
    } else {
      process.env.SYSTEM_COLLECTIONURI = previousCollectionUri;
    }
    return provider;
  };

  const completeTruncatedDescription = async (api: any, pullRequest: any) =>
    (buildProvider() as any).completeTruncatedDescription(api, pullRequest);

  it('reads the full Pull Request when the listed description is long enough to have been cut', async () => {
    const truncated = 'x'.repeat(400);
    const full = truncated + '\n\n```yaml\npromotionPullRequests: [12, 34]\n```';
    let askedFor: number | null = null;
    const api = {
      getPullRequestById: async (id: number) => {
        askedFor = id;
        return { pullRequestId: id, description: full };
      },
    };

    const completed = await completeTruncatedDescription(api, { pullRequestId: 77, description: truncated });

    expect(askedFor).to.equal(77);
    expect(completed.description).to.equal(full);
  });

  it('keeps every other property of the listed Pull Request', async () => {
    const truncated = 'y'.repeat(420);
    const api = { getPullRequestById: async () => ({ description: truncated + ' and the rest' }) };

    const completed = await completeTruncatedDescription(api, {
      pullRequestId: 5,
      description: truncated,
      sourceRefName: 'refs/heads/promotion/uat/preprod/2026-09-07-1',
      lastMergeCommit: { commitId: 'abc1234' },
    });

    expect(completed.sourceRefName).to.equal('refs/heads/promotion/uat/preprod/2026-09-07-1');
    expect(completed.lastMergeCommit.commitId).to.equal('abc1234');
    expect(completed.description).to.equal(truncated + ' and the rest');
  });

  it('does not call the API for a description short enough to be complete', async () => {
    let called = false;
    const api = {
      getPullRequestById: async () => {
        called = true;
        return { description: 'never read' };
      },
    };

    const completed = await completeTruncatedDescription(api, { pullRequestId: 5, description: 'short one' });

    expect(called).to.equal(false);
    expect(completed.description).to.equal('short one');
  });

  it('keeps the listed description when the API answers with a shorter one', async () => {
    const truncated = 'z'.repeat(405);
    const api = { getPullRequestById: async () => ({ description: 'shorter' }) };

    const completed = await completeTruncatedDescription(api, { pullRequestId: 5, description: truncated });

    expect(completed.description).to.equal(truncated);
  });

  it('keeps the listed description when the API call fails', async () => {
    const truncated = 'w'.repeat(400);
    const api = {
      getPullRequestById: async () => {
        throw new Error('TF401019');
      },
    };

    const completed = await completeTruncatedDescription(api, { pullRequestId: 5, description: truncated });

    expect(completed.description).to.equal(truncated);
  });

  it('handles a Pull Request listed without a description', async () => {
    let called = false;
    const api = {
      getPullRequestById: async () => {
        called = true;
        return {};
      },
    };

    const completed = await completeTruncatedDescription(api, { pullRequestId: 5 });

    expect(called).to.equal(false);
    expect(completed.description).to.equal(undefined);
  });
});
