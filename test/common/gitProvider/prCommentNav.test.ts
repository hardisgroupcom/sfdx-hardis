/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  getPrCommentKind,
  PR_NAV_END,
  PR_NAV_START,
  renderPrCommentNav,
  replacePrCommentNavBlock,
  upsertNavInDescription,
  wrapPrCommentNav,
} from '../../../src/common/gitProvider/prCommentNav.js';

const LINKS = {
  validation: 'https://git.example.com/pr/42#comment-1',
  deployment: 'https://git.example.com/pr/42#comment-2',
  actions: 'https://git.example.com/pr/42#comment-3',
};

describe('Pull Request comments navigation', () => {
  it('links to the other comments and keeps the current one as plain text', () => {
    const nav = renderPrCommentNav(LINKS, 'deployment');
    expect(nav).to.equal(
      `[🔍 Validation](${LINKS.validation}) | **🚀 Deployment** | [🛠️ Actions](${LINKS.actions})`,
    );
  });

  it('lists only the comments that exist', () => {
    const nav = renderPrCommentNav({ validation: LINKS.validation }, 'actions');
    expect(nav).to.equal(`[🔍 Validation](${LINKS.validation}) | **🛠️ Actions**`);
  });

  it('renders nothing when there is nowhere to navigate to', () => {
    expect(renderPrCommentNav({}, 'validation')).to.equal('');
    expect(renderPrCommentNav({}, null)).to.equal('');
  });

  it('links every comment when rendering for the Pull Request description', () => {
    const nav = renderPrCommentNav(LINKS, null);
    expect(nav).to.not.contain('**');
    expect(nav).to.contain(`[🚀 Deployment](${LINKS.deployment})`);
  });
});

describe('Navigation block replacement', () => {
  it('replaces the block of a comment that carries the markers', () => {
    const body = `## Title\n\n${wrapPrCommentNav('')}\n\nSome content`;
    const updated = replacePrCommentNavBlock(body, renderPrCommentNav(LINKS, 'validation'));
    expect(updated).to.contain(`[🚀 Deployment](${LINKS.deployment})`);
    expect(updated).to.contain('Some content');
  });

  it('replaces an outdated navigation instead of stacking a new one', () => {
    const body = `## Title\n\n${wrapPrCommentNav('**🔍 Validation**')}\n\nContent`;
    const updated = replacePrCommentNavBlock(body, renderPrCommentNav(LINKS, 'validation'));
    expect(updated.match(new RegExp(PR_NAV_START, 'g'))).to.have.length(1);
    expect(updated).to.contain(`[🛠️ Actions](${LINKS.actions})`);
  });

  it('never touches a comment without the navigation markers', () => {
    const body = '## Differences for Flow MyFlow\n\nsome diff';
    expect(replacePrCommentNavBlock(body, renderPrCommentNav(LINKS, null))).to.equal(body);
  });
});

describe('Navigation in the Pull Request description', () => {
  it('adds the navigation at the very beginning and keeps the description', () => {
    const updated = upsertNavInDescription('My change\n\nFixes #12', renderPrCommentNav(LINKS, null));
    expect(updated.startsWith(PR_NAV_START)).to.be.true;
    expect(updated).to.contain('My change\n\nFixes #12');
    expect(updated).to.contain(PR_NAV_END);
  });

  it('replaces the previous navigation without duplicating it', () => {
    const first = upsertNavInDescription('My change', renderPrCommentNav({ validation: LINKS.validation, actions: LINKS.actions }, null));
    const second = upsertNavInDescription(first, renderPrCommentNav(LINKS, null));
    expect(second.match(new RegExp(PR_NAV_START, 'g'))).to.have.length(1);
    expect(second).to.contain(`[🚀 Deployment](${LINKS.deployment})`);
    expect(second).to.contain('My change');
  });

  it('removes the navigation when there is nothing to link anymore', () => {
    const withNav = upsertNavInDescription('My change', renderPrCommentNav(LINKS, null));
    expect(upsertNavInDescription(withNav, '')).to.equal('My change');
  });

  it('leaves a description without navigation untouched when there is nothing to add', () => {
    expect(upsertNavInDescription('My change', '')).to.equal('My change');
  });

  it('handles an empty description', () => {
    const updated = upsertNavInDescription('', renderPrCommentNav(LINKS, null));
    expect(updated.startsWith(PR_NAV_START)).to.be.true;
    expect(updated.endsWith(PR_NAV_END)).to.be.true;
  });
});

describe('Pull Request comment kind detection', () => {
  it('recognizes the validation comment from its message key', () => {
    expect(getPrCommentKind('<!-- sfdx-hardis message-key deployment-check-check_deploy_to_uat-42 -->')).to.equal('validation');
  });

  it('recognizes the deployment comment from its message key', () => {
    expect(getPrCommentKind('<!-- sfdx-hardis message-key deployment-deploy_to_uat-42 -->')).to.equal('deployment');
  });

  it('recognizes the deployment actions comment from its state marker', () => {
    expect(getPrCommentKind('<!-- sfdx-hardis deployment-actions-state -->\n## Deployment Actions')).to.equal('actions');
  });

  it('keeps the Flow diff comments out of the navigation', () => {
    expect(getPrCommentKind('<!-- sfdx-hardis message-key sfdx-hardis-flow-diff-MyFlow-job-42 -->')).to.be.null;
    expect(getPrCommentKind('A comment written by a user')).to.be.null;
  });
});
