import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
// (azureDevops -> utils/index -> gitUtils -> ticketProvider/index -> jiraProvider, which extends
// TicketProviderRoot), and entering through a leaf module of it throws.
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';

// Azure DevOps lets only the author of a comment, or a project administrator, edit it. The comments
// are written by the pipeline: anyone else answers in the thread with an update, and every reader
// takes the newest version.
describe('AzureDevopsProvider comment written by another identity', () => {
  const MARKER = '<!-- sfdx-hardis deployment-actions-state -->';
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

  const notTheAuthor = () => Object.assign(new Error('Cannot update comment. Only the comment author and project admins can edit a comment.'), { statusCode: 403 });

  // A thread store close to what Azure DevOps keeps: comments of a thread, each with its owner
  const buildStore = (threads: any[]) => {
    let clock = Date.parse('2026-10-09T10:00:00Z');
    const calls: string[] = [];
    const api = (identity: string) => ({
      getThreads: async () => JSON.parse(JSON.stringify(threads)),
      createThread: async (thread: any) => {
        calls.push(`${identity} createThread`);
        clock += 60000;
        threads.push({ id: threads.length + 10, comments: [{ id: 1, content: thread.comments[0].content, owner: identity, publishedDate: new Date(clock).toISOString() }] });
        return { id: threads.length + 9 };
      },
      updateComment: async (comment: any, _repo: string, _pr: number, threadId: number, commentId: number) => {
        const target = threads.find((thread) => thread.id === threadId).comments.find((item: any) => item.id === commentId);
        if (target.owner !== identity) {
          calls.push(`${identity} refused on ${threadId}/${commentId}`);
          throw notTheAuthor();
        }
        calls.push(`${identity} updateComment ${threadId}/${commentId}`);
        clock += 60000;
        target.content = comment.content;
        target.lastUpdatedDate = new Date(clock).toISOString();
        return target;
      },
      createComment: async (comment: any, _repo: string, _pr: number, threadId: number) => {
        calls.push(`${identity} createComment in ${threadId}`);
        clock += 60000;
        const thread = threads.find((item) => item.id === threadId);
        const created = { id: thread.comments.length + 1, content: comment.content, owner: identity, publishedDate: new Date(clock).toISOString() };
        thread.comments.push(created);
        return created;
      },
    });
    return { api, calls, threads };
  };

  const providerOf = (gitApi: any) => {
    const provider = new AzureDevopsProvider() as any;
    provider.azureApi = { getGitApi: async () => gitApi };
    return provider;
  };

  it('answers in the thread when the comment belongs to another identity, and reads that update back', async () => {
    const store = buildStore([{ id: 7, comments: [{ id: 1, content: `state one\n${MARKER}`, owner: 'pipeline', publishedDate: '2026-10-09T09:00:00Z' }] }]);
    const person = providerOf(store.api('person'));

    const written = await person.upsertPullRequestCommentByMarker(MARKER, `state two\n${MARKER}`, 12);

    expect(written).to.equal(true);
    expect(store.calls).to.deep.equal(['person refused on 7/1', 'person createComment in 7']);
    const reply = store.threads[0].comments[1].content;
    expect(reply).to.contain('Updated outside the pipeline');
    expect(reply).to.not.contain('state two');
    expect(reply).to.not.contain('<!-- sfdx-hardis');
    expect(await person.getPullRequestCommentByMarker(MARKER, 12)).to.equal(`state two\n${MARKER}`);
    expect(await providerOf(store.api('pipeline')).getPullRequestCommentByMarker(MARKER, 12)).to.equal(`state two\n${MARKER}`);
  });

  it('lets the pipeline bring its own comment up to date afterwards, which is then the newest', async () => {
    const store = buildStore([{ id: 7, comments: [{ id: 1, content: `state one\n${MARKER}`, owner: 'pipeline', publishedDate: '2026-10-09T09:00:00Z' }] }]);
    await providerOf(store.api('person')).upsertPullRequestCommentByMarker(MARKER, `state two\n${MARKER}`, 12);
    store.calls.length = 0;
    const pipeline = providerOf(store.api('pipeline'));

    await pipeline.upsertPullRequestCommentByMarker(MARKER, `state three\n${MARKER}`, 12);

    expect(store.calls).to.deep.equal(['pipeline refused on 7/2', 'pipeline updateComment 7/1']);
    expect(store.threads[0].comments).to.have.length(2);
    expect(store.threads[0].comments[0].content).to.equal(`state three\n${MARKER}`);
    expect(await pipeline.getPullRequestCommentByMarker(MARKER, 12)).to.equal(`state three\n${MARKER}`);
  });

  it('updates the answer it already wrote instead of adding one at each change', async () => {
    const store = buildStore([{ id: 7, comments: [{ id: 1, content: `state one\n${MARKER}`, owner: 'pipeline', publishedDate: '2026-10-09T09:00:00Z' }] }]);
    const person = providerOf(store.api('person'));
    await person.upsertPullRequestCommentByMarker(MARKER, `state two\n${MARKER}`, 12);
    await providerOf(store.api('pipeline')).upsertPullRequestCommentByMarker(MARKER, `state three\n${MARKER}`, 12);
    store.calls.length = 0;

    await person.upsertPullRequestCommentByMarker(MARKER, `state four\n${MARKER}`, 12);

    expect(store.calls).to.deep.equal(['person refused on 7/1', 'person updateComment 7/2']);
    expect(store.threads[0].comments).to.have.length(2);
    expect(await person.getPullRequestCommentByMarker(MARKER, 12)).to.equal(`state four\n${MARKER}`);
  });

  it('updates in place, with no answer, when the comment is its own', async () => {
    const store = buildStore([{ id: 7, comments: [{ id: 1, content: `state one\n${MARKER}`, owner: 'pipeline', publishedDate: '2026-10-09T09:00:00Z' }] }]);

    await providerOf(store.api('pipeline')).upsertPullRequestCommentByMarker(MARKER, `state two\n${MARKER}`, 12);

    expect(store.calls).to.deep.equal(['pipeline updateComment 7/1']);
    expect(store.threads[0].comments).to.have.length(1);
  });

  it('never lists an update as a comment of the Pull Request', async () => {
    const store = buildStore([{ id: 7, comments: [{ id: 1, content: `state one\n${MARKER}`, owner: 'pipeline', publishedDate: '2026-10-09T09:00:00Z' }] }]);
    const person = providerOf(store.api('person'));
    await person.upsertPullRequestCommentByMarker(MARKER, `- [x] <!-- sfdx-hardis-manual-action id:a org:uat pr:12 when:pre-deploy --> done\n${MARKER}`, 12);

    const listed = await person.listPullRequestCommentsByMarker('<!-- ', 12);

    expect(listed.map((comment: any) => comment.ref.commentId)).to.deep.equal([1]);
    expect(await person.listPullRequestCommentsByMarker('<!-- sfdx-hardis-', 12)).to.deep.equal([]);
  });

  it('does not hide an error that is not about the author of the comment', async () => {
    const provider = providerOf({
      getThreads: async () => [{ id: 7, comments: [{ id: 1, content: MARKER, publishedDate: '2026-10-09T09:00:00Z' }] }],
      updateComment: async () => {
        throw Object.assign(new Error('The service is unavailable'), { statusCode: 503 });
      },
    });

    let message = '';
    try {
      await provider.upsertPullRequestCommentByMarker(MARKER, `new\n${MARKER}`, 12);
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).to.equal('The service is unavailable');
  });
});
