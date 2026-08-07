import { expect } from 'chai';
// Load the provider barrel first: gitProviderRoot.js and index.js import each other, and evaluating
// gitProviderRoot.js first would hit the GitProviderRoot class before its initialization (TDZ).
import '../../../src/common/gitProvider/index.js';
import { hasAffirmativeFlowInterviewDeletionDirective } from '../../../src/common/gitProvider/gitProviderRoot.js';

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
