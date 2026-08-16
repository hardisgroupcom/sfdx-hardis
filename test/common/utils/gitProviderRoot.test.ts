import { expect } from 'chai';
// Load the provider barrel first: gitProviderRoot.js and index.js import each other, and evaluating
// gitProviderRoot.js first would hit the GitProviderRoot class before its initialization (TDZ).
import '../../../src/common/gitProvider/index.js';
import { GitProviderRoot, hasAffirmativeFlowInterviewDeletionDirective } from '../../../src/common/gitProvider/gitProviderRoot.js';
import type { PullRequestMessageRequest } from '../../../src/common/gitProvider/index.js';

class TestGitProvider extends GitProviderRoot {
  public getLabel(): string {
    return 'TestGitProvider';
  }
  public header(prMessage: PullRequestMessageRequest): string {
    return this.buildPrCommentBodyHeader(prMessage);
  }
}

describe('GitProviderRoot Pull Request comment header', () => {
  const provider = new TestGitProvider();
  const navBlock = '<!-- sfdx-hardis nav-start -->\n**🔍 Validation**\n<!-- sfdx-hardis nav-end -->\n\n';

  afterEach(() => {
    delete process.env.SFDX_HARDIS_PR_COMMENT_BANNERS;
  });

  it('puts the navigation on top and replaces the title heading with the banner', () => {
    const header = provider.header({
      title: '🚀 Deployment Results\n\n✅ Deployment success',
      message: 'body',
      messageKey: 'deployment',
      status: 'valid',
      bannerKey: 'deployment-success',
      navBlock: navBlock,
    });
    expect(header.startsWith(navBlock)).to.be.true;
    // The title survives as the banner alt text, not as a heading
    expect(header).to.contain('![🚀 Deployment Results](');
    expect(header).to.not.contain('## 🚀 Deployment Results');
    // The outcome line following the title stays displayed
    expect(header).to.contain('✅ Deployment success');
    expect(header.indexOf('![')).to.be.lessThan(header.indexOf('✅ Deployment success'));
  });

  it('keeps the title heading when there is no banner', () => {
    const header = provider.header({
      title: 'Differences for Flow MyFlow',
      message: 'diff',
      messageKey: 'sfdx-hardis-flow-diff-MyFlow',
      status: 'valid',
    });
    expect(header).to.contain('## Differences for Flow MyFlow');
  });

  it('keeps the title heading when banners are disabled', () => {
    process.env.SFDX_HARDIS_PR_COMMENT_BANNERS = 'false';
    const header = provider.header({
      title: '🔍 Validation Results (deployment simulation)\n\n✅ Deployment check success',
      message: 'body',
      messageKey: 'deployment-check',
      status: 'valid',
      bannerKey: 'validation-success',
      navBlock: navBlock,
    });
    expect(header).to.contain('## 🔍 Validation Results (deployment simulation)');
    expect(header).to.not.contain('![');
    expect(header).to.contain('✅ Deployment check success');
  });
});

describe('GitProviderRoot Flow Interview deletion directive', () => {
  it('accepts only affirmative standalone forms', () => {
    expect(hasAffirmativeFlowInterviewDeletionDirective('FLOW_DELETE_INTERVIEWS')).to.be.true;
    expect(hasAffirmativeFlowInterviewDeletionDirective('FLOW_DELETE_INTERVIEWS=true')).to.be.true;
    expect(hasAffirmativeFlowInterviewDeletionDirective('- FLOW_DELETE_INTERVIEWS')).to.be.true;
    expect(hasAffirmativeFlowInterviewDeletionDirective('- [x] FLOW_DELETE_INTERVIEWS')).to.be.true;
    expect(hasAffirmativeFlowInterviewDeletionDirective('* [X] FLOW_DELETE_INTERVIEWS=true')).to.be.true;
  });

  it('does not authorize mentions, negations, or unchecked boxes', () => {
    expect(hasAffirmativeFlowInterviewDeletionDirective('Do not enable FLOW_DELETE_INTERVIEWS')).to.be.false;
    expect(hasAffirmativeFlowInterviewDeletionDirective('- [ ] FLOW_DELETE_INTERVIEWS')).to.be.false;
    expect(hasAffirmativeFlowInterviewDeletionDirective('`FLOW_DELETE_INTERVIEWS` deletes interviews')).to.be.false;
    expect(hasAffirmativeFlowInterviewDeletionDirective('| FLOW_DELETE_INTERVIEWS | dangerous |')).to.be.false;
    expect(hasAffirmativeFlowInterviewDeletionDirective('FLOW_DELETE_INTERVIEWS=false')).to.be.false;
  });

  it('does not authorize directives inside code blocks or HTML comments', () => {
    expect(
      hasAffirmativeFlowInterviewDeletionDirective('Example:\n```\nFLOW_DELETE_INTERVIEWS\n```\nEnd.')
    ).to.be.false;
    expect(
      hasAffirmativeFlowInterviewDeletionDirective('Example:\n~~~\nFLOW_DELETE_INTERVIEWS=true\n~~~')
    ).to.be.false;
    expect(
      hasAffirmativeFlowInterviewDeletionDirective('Example:\n\n    FLOW_DELETE_INTERVIEWS\n\nEnd.')
    ).to.be.false;
    expect(
      hasAffirmativeFlowInterviewDeletionDirective('<!-- PR template:\nFLOW_DELETE_INTERVIEWS\n-->')
    ).to.be.false;
    // An unclosed fence or comment neutralizes everything after it instead of authorizing.
    expect(hasAffirmativeFlowInterviewDeletionDirective('```\nFLOW_DELETE_INTERVIEWS')).to.be.false;
    expect(hasAffirmativeFlowInterviewDeletionDirective('<!--\nFLOW_DELETE_INTERVIEWS')).to.be.false;
    // A real directive still counts when the description also contains an example block.
    expect(
      hasAffirmativeFlowInterviewDeletionDirective('```\nsome example\n```\nFLOW_DELETE_INTERVIEWS')
    ).to.be.true;
  });
});
