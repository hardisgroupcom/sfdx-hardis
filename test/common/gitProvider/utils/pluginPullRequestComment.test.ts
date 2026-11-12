/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { GitProvider } from '../../../../src/common/gitProvider/index.js';
import { buildPluginMessageKey, postPullRequestComment } from '../../../../src/common/gitProvider/utils/pluginPullRequestComment.js';
import { getPrCommentKind, getPrCommentKindFromMessageKey } from '../../../../src/common/gitProvider/utils/prCommentNav.js';
import { enableMajorBranchCheckMode, resetMajorBranchCheckMode } from '../../../../src/common/utils/majorBranchCheckUtils.js';

describe('postPullRequestComment() for plugins', () => {
  const originalGetInstance = GitProvider.getInstance;
  let posted: any[] = [];

  function fakeProvider(postedResult: boolean) {
    return {
      tryPostPullRequestMessage: async (message: any) => {
        posted.push(message);
        return { posted: postedResult, providerResult: {} };
      },
    };
  }

  beforeEach(() => {
    posted = [];
    resetMajorBranchCheckMode();
  });

  afterEach(() => {
    GitProvider.getInstance = originalGetInstance;
    resetMajorBranchCheckMode();
  });

  it('prefixes the message key with the plugin name', () => {
    expect(buildPluginMessageKey('apex-code-coverage-transformer', 'coverage')).to.equal('plugin-apex-code-coverage-transformer-coverage');
    expect(buildPluginMessageKey('@scope/My_Plugin', 'Least covered')).to.equal('plugin-scope-my-plugin-least-covered');
  });

  it('keeps plugin comments out of the sfdx-hardis comment navigation', () => {
    const key = buildPluginMessageKey('my-plugin', 'deployment');
    expect(getPrCommentKindFromMessageKey(key)).to.be.null;
    expect(getPrCommentKind(`<!-- sfdx-hardis message-key ${key}-job-42 -->`)).to.be.null;
  });

  it('posts through the git provider with the prefixed key', async () => {
    GitProvider.getInstance = (async () => fakeProvider(true)) as any;
    const result = await postPullRequestComment({ pluginName: 'my-plugin', messageKey: 'coverage', title: 'Coverage', markdown: 'body' });
    expect(result).to.deep.equal({ posted: true });
    expect(posted).to.have.length(1);
    expect(posted[0]).to.deep.include({ title: 'Coverage', message: 'body', status: 'valid', messageKey: 'plugin-my-plugin-coverage' });
    expect(posted[0].bannerKey).to.be.undefined;
    expect(posted[0].navBlock).to.be.undefined;
  });

  it('says when the provider did not post it', async () => {
    GitProvider.getInstance = (async () => fakeProvider(false)) as any;
    const result = await postPullRequestComment({ pluginName: 'my-plugin', messageKey: 'coverage', title: 'Coverage', markdown: 'body', status: 'invalid' });
    expect(result).to.deep.equal({ posted: false, reason: 'not-posted' });
    expect(posted[0].status).to.equal('invalid');
  });

  it('refuses a request without plugin name or message key', async () => {
    GitProvider.getInstance = (async () => fakeProvider(true)) as any;
    expect(await postPullRequestComment({ pluginName: '', messageKey: 'coverage', title: 't', markdown: 'm' })).to.deep.equal({ posted: false, reason: 'invalid-request' });
    expect(await postPullRequestComment({ pluginName: 'my-plugin', messageKey: '  ', title: 't', markdown: 'm' })).to.deep.equal({ posted: false, reason: 'invalid-request' });
    expect(posted).to.be.empty;
  });

  it('does not post without a git provider', async () => {
    GitProvider.getInstance = (async () => null) as any;
    expect(await postPullRequestComment({ pluginName: 'my-plugin', messageKey: 'coverage', title: 't', markdown: 'm' })).to.deep.equal({ posted: false, reason: 'no-git-provider' });
  });

  it('does not post during a major branch check', async () => {
    enableMajorBranchCheckMode();
    GitProvider.getInstance = (async () => fakeProvider(true)) as any;
    expect(await postPullRequestComment({ pluginName: 'my-plugin', messageKey: 'coverage', title: 't', markdown: 'm' })).to.deep.equal({ posted: false, reason: 'major-branch-check' });
    expect(posted).to.be.empty;
  });

  it('never throws when the provider crashes', async () => {
    GitProvider.getInstance = (async () => {
      throw new Error('boom');
    }) as any;
    expect(await postPullRequestComment({ pluginName: 'my-plugin', messageKey: 'coverage', title: 't', markdown: 'm' })).to.deep.equal({ posted: false, reason: 'not-posted' });
  });
});
