import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';

// getPullRequestCommits of azure-devops-node-api returns the first page only, and the listing cuts
// long messages: a release Pull Request of 180 cherry-picks lost most of its trailers both ways.
describe('AzureDevopsProvider.listPullRequestCommits', () => {
  const previousEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['SYSTEM_COLLECTIONURI', 'BUILD_REPOSITORY_ID', 'SYSTEM_TEAMPROJECT']) {
      previousEnv[key] = process.env[key];
    }
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme/';
    process.env.BUILD_REPOSITORY_ID = 'repo-id';
    process.env.SYSTEM_TEAMPROJECT = 'project';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const commitRef = (index: number, truncated = false) => ({
    commitId: `c${index}`,
    comment: truncated ? 'story (cut' : `story ${index}`,
    commentTruncated: truncated,
    parents: [`p${index}`],
  });

  const providerWith = (gitApi: any) => {
    const provider = new AzureDevopsProvider();
    (provider as any).azureApi = { getGitApi: async () => gitApi };
    return provider;
  };

  it('reads every page with the continuation token, and the full message of a cut one', async () => {
    const requested: any[] = [];
    const pages = [
      { items: [commitRef(1), commitRef(2, true)], token: 'next-1' },
      { items: [commitRef(3)], token: undefined },
    ];
    const gitApi = {
      vsoClient: {
        getVersioningData: async (_version: string, _area: string, _location: string, routeValues: any, queryParams: any) => {
          requested.push({ routeValues, queryParams });
          return { requestUrl: `page-${requested.length}`, apiVersion: '7.1' };
        },
      },
      createRequestOptions: () => ({}),
      rest: {
        get: async (url: string) => {
          const page = pages[Number(url.split('-')[1]) - 1];
          return { result: { count: page.items.length, value: page.items }, headers: page.token ? { 'x-ms-continuationtoken': page.token } : {} };
        },
      },
      getCommit: async (commitId: string) => ({ commitId, comment: 'story 2\n\n(cherry picked from commit abcdef1)', parents: ['p2'] }),
      getPullRequestCommits: async () => {
        throw new Error('the first-page call must not be used');
      },
    };

    const commits = await providerWith(gitApi).listPullRequestCommits(42);

    expect(commits!.map((commit) => commit.sha)).to.deep.equal(['c1', 'c2', 'c3']);
    expect(commits![1].message).to.equal('story 2\n\n(cherry picked from commit abcdef1)');
    expect(requested[0].routeValues).to.deep.equal({ project: 'project', repositoryId: 'repo-id', pullRequestId: 42 });
    expect(requested[0].queryParams.continuationToken).to.equal(undefined);
    expect(requested[1].queryParams.continuationToken).to.equal('next-1');
  });

  it('falls back to the first page when the paged call fails', async () => {
    const gitApi = {
      vsoClient: {
        getVersioningData: async () => {
          throw new Error('unknown location');
        },
      },
      getPullRequestCommits: async () => [commitRef(1)],
      getCommit: async () => null,
    };

    const commits = await providerWith(gitApi).listPullRequestCommits(42);

    expect(commits).to.deep.equal([{ sha: 'c1', message: 'story 1', parentShas: ['p1'] }]);
  });
});
