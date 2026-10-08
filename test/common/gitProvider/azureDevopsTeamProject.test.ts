import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
// (azureDevops -> utils/index -> gitUtils -> ticketProvider/index -> jiraProvider, which extends
// TicketProviderRoot), and entering through a leaf module of it throws.
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';

// Outside an Azure Pipelines job (VS Code, a terminal), BUILD_REPOSITORY_ID is the repository name
// read from the git remote, not a GUID. Azure DevOps then refuses a call that does not name the
// team project: "A project name is required in order to reference a Git repository by name".
describe('AzureDevopsProvider calls made with a repository name', () => {
  const saved: Record<string, string | undefined> = {};
  const names = ['SYSTEM_COLLECTIONURI', 'SYSTEM_TEAMPROJECT', 'BUILD_REPOSITORY_ID', 'SYSTEM_PULLREQUEST_PULLREQUESTID'];

  beforeEach(() => {
    for (const name of names) {
      saved[name] = process.env[name];
    }
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme/';
    process.env.SYSTEM_TEAMPROJECT = 'acme-project';
    process.env.BUILD_REPOSITORY_ID = 'acme-repository';
    delete process.env.SYSTEM_PULLREQUEST_PULLREQUESTID;
  });

  afterEach(() => {
    for (const name of names) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  });

  const buildProvider = (gitApi: any) => {
    const provider = new AzureDevopsProvider() as any;
    provider.azureApi = { getGitApi: async () => gitApi };
    return provider;
  };

  it('reads the comment of a Pull Request with the team project', async () => {
    const calls: any[][] = [];
    const provider = buildProvider({
      getThreads: async (...args: any[]) => {
        calls.push(args);
        return [{ comments: [{ content: 'before <!-- marker --> after' }] }];
      },
    });

    const comment = await provider.getPullRequestCommentByMarker('<!-- marker -->', 12);

    expect(comment).to.equal('before <!-- marker --> after');
    expect(calls).to.deep.equal([['acme-repository', 12, 'acme-project']]);
  });

  it('creates the comment of a Pull Request with the team project', async () => {
    const threadCalls: any[][] = [];
    const createCalls: any[][] = [];
    const provider = buildProvider({
      getThreads: async (...args: any[]) => {
        threadCalls.push(args);
        return [];
      },
      createThread: async (...args: any[]) => {
        createCalls.push(args);
        return { id: 1 };
      },
    });

    await provider.upsertPullRequestCommentByMarker('<!-- marker -->', 'body <!-- marker -->', 12);

    expect(threadCalls[0][2]).to.equal('acme-project');
    expect(createCalls).to.have.length(1);
    expect(createCalls[0].slice(1)).to.deep.equal(['acme-repository', 12, 'acme-project']);
  });

  it('takes a Pull Request of the repository named in the git remote as its own', async () => {
    const provider = buildProvider({
      getPullRequestById: async (id: number) => ({
        pullRequestId: id,
        status: 1,
        sourceRefName: 'refs/heads/feature/one',
        targetRefName: 'refs/heads/integration',
        repository: { id: '0f0e0d0c-1111-2222-3333-444455556666', name: 'Acme-Repository' },
      }),
      getPullRequestWorkItemRefs: async () => [],
    });

    const pullRequest = await provider.getPullRequestById(12);

    expect(pullRequest).to.not.equal(null);
    expect(pullRequest.targetBranch).to.equal('integration');
  });

  it('still ignores a Pull Request of another repository of the organization', async () => {
    const provider = buildProvider({
      getPullRequestById: async (id: number) => ({
        pullRequestId: id,
        status: 1,
        targetRefName: 'refs/heads/integration',
        repository: { id: '0f0e0d0c-1111-2222-3333-444455556666', name: 'another-repository' },
      }),
    });

    expect(await provider.getPullRequestById(12)).to.equal(null);
  });

  it('updates an existing comment with the team project', async () => {
    const updateCalls: any[][] = [];
    const provider = buildProvider({
      getThreads: async () => [{ id: 7, comments: [{ id: 3, content: 'old <!-- marker -->' }] }],
      updateComment: async (...args: any[]) => {
        updateCalls.push(args);
        return {};
      },
    });

    await provider.upsertPullRequestCommentByMarker('<!-- marker -->', 'new <!-- marker -->', 12);

    expect(updateCalls).to.have.length(1);
    expect(updateCalls[0].slice(1)).to.deep.equal(['acme-repository', 12, 7, 3, 'acme-project']);
  });
});
