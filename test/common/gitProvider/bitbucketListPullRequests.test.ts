import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
import '../../../src/common/gitProvider/index.js';
import { BitbucketProvider } from '../../../src/common/gitProvider/bitbucket.js';

// Bitbucket Cloud answers a Pull Request listing one page at a time, and it silently DROPS the
// `state` parameter as soon as a `q` expression is present. Both cost real correctness: a truncated
// listing hides the older Pull Requests from the already-promoted check, and a dropped state hands
// back merged promotions when the caller asked for the open ones.
describe('BitbucketProvider.listPullRequests', () => {
  const withEnv = async (run: () => Promise<void>) => {
    const previous = {
      workspace: process.env.BITBUCKET_WORKSPACE,
      repo: process.env.BITBUCKET_REPO_SLUG,
    };
    process.env.BITBUCKET_WORKSPACE = 'acme';
    process.env.BITBUCKET_REPO_SLUG = 'sfdx-project';
    try {
      await run();
    } finally {
      if (previous.workspace === undefined) delete process.env.BITBUCKET_WORKSPACE;
      else process.env.BITBUCKET_WORKSPACE = previous.workspace;
      if (previous.repo === undefined) delete process.env.BITBUCKET_REPO_SLUG;
      else process.env.BITBUCKET_REPO_SLUG = previous.repo;
    }
  };

  // One Pull Request as Bitbucket returns it
  const rawPr = (id: number, state: string, destination: string) => ({
    id,
    state,
    title: `PR ${id}`,
    description: '',
    source: { branch: { name: `feature/${id}` } },
    destination: { branch: { name: destination } },
    links: { html: { href: `https://bitbucket.org/acme/sfdx-project/pull-requests/${id}` } },
  });

  // Replaces the Bitbucket client with one that records the parameters and serves fixed pages
  const stubClient = (provider: any, pages: any[][]) => {
    const calls: any[] = [];
    provider.bitbucket = {
      repositories: {
        listPullRequests: async (params: any) => {
          calls.push(params);
          const page = pages[(params.page || 1) - 1] || [];
          const hasNext = (params.page || 1) < pages.length;
          return { data: { values: page, next: hasNext ? 'https://api.bitbucket.org/next' : undefined } };
        },
      },
    };
    return calls;
  };

  it('follows every page instead of stopping at the first', async () => {
    await withEnv(async () => {
      const provider = new BitbucketProvider();
      const calls = stubClient(provider as any, [
        [rawPr(1, 'MERGED', 'uat'), rawPr(2, 'MERGED', 'uat')],
        [rawPr(3, 'MERGED', 'uat')],
      ]);

      const result = await provider.listPullRequests({ status: 'merged' });

      expect(result?.map((pr) => pr.idNumber)).to.deep.equal([1, 2, 3]);
      expect(calls.length).to.equal(2);
      expect(calls[0].pagelen).to.equal(50);
    });
  });

  it('puts the state inside the q expression, never in the state parameter', async () => {
    await withEnv(async () => {
      const provider = new BitbucketProvider();
      const calls = stubClient(provider as any, [[]]);

      await provider.listPullRequests({ status: 'open', targetBranch: 'preprod' });

      expect(calls[0].state, 'passing state next to q makes Bitbucket ignore it').to.equal(undefined);
      expect(calls[0].q).to.equal('state = "OPEN" AND destination.branch.name = "preprod"');
    });
  });

  it('filters on the target branch, so another step is never counted as this one', async () => {
    await withEnv(async () => {
      const provider = new BitbucketProvider();
      // A Bitbucket answer that ignored the query: the defensive filter has to catch it
      stubClient(provider as any, [[rawPr(1, 'MERGED', 'preprod'), rawPr(2, 'MERGED', 'main')]]);

      const result = await provider.listPullRequests({ status: 'merged', targetBranch: 'preprod' });

      expect(result?.map((pr) => pr.idNumber)).to.deep.equal([1]);
    });
  });

  it('drops a Pull Request whose state is not the one asked for', async () => {
    await withEnv(async () => {
      const provider = new BitbucketProvider();
      stubClient(provider as any, [[rawPr(1, 'OPEN', 'uat'), rawPr(2, 'MERGED', 'uat')]]);

      const result = await provider.listPullRequests({ status: 'open' });

      expect(result?.map((pr) => pr.idNumber)).to.deep.equal([1]);
    });
  });

  it('maps the abandoned status to DECLINED', async () => {
    await withEnv(async () => {
      const provider = new BitbucketProvider();
      const calls = stubClient(provider as any, [[]]);

      await provider.listPullRequests({ pullRequestStatus: 'abandoned' });

      expect(calls[0].q).to.equal('state = "DECLINED"');
    });
  });

  it('asks for everything when no filter is given', async () => {
    await withEnv(async () => {
      const provider = new BitbucketProvider();
      const calls = stubClient(provider as any, [[rawPr(1, 'MERGED', 'uat')]]);

      const result = await provider.listPullRequests({});

      expect(calls[0].q).to.equal(undefined);
      expect(calls[0].state).to.equal(undefined);
      expect(result?.length).to.equal(1);
    });
  });
});
