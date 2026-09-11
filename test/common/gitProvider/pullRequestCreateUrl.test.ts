/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';
import { BitbucketProvider } from '../../../src/common/gitProvider/bitbucket.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { GitlabProvider } from '../../../src/common/gitProvider/gitlab.js';

const request = {
  title: 'Promotion uat to preprod',
  body: 'Carries #482 and #487',
  sourceBranch: 'promotion/uat/preprod/2026-09-08-2',
  targetBranch: 'preprod',
};

describe('getPullRequestCreateUrl()', () => {
  it('GitHub compares the two refs in the path and fills the form', () => {
    const res = GithubProvider.getPullRequestCreateUrl('https://github.com/hardisgroupcom/sfdx-hardis.git', request);
    expect(res).to.not.equal(null);
    expect(res?.bodyIncluded).to.equal(true);
    expect(res?.url).to.contain('https://github.com/hardisgroupcom/sfdx-hardis/compare/preprod...promotion/uat/preprod/2026-09-08-2?');
    expect(res?.url).to.contain('expand=1');
    expect(res?.url).to.contain('title=Promotion+uat+to+preprod');
    expect(res?.url).to.contain('body=Carries+%23482+and+%23487');
  });

  it('GitLab fills the merge_request form fields, nested groups included', () => {
    const res = GitlabProvider.getPullRequestCreateUrl('https://gitlab.example.com/group/subgroup/repo.git', request);
    expect(res?.url).to.contain('https://gitlab.example.com/group/subgroup/repo/-/merge_requests/new?');
    expect(res?.url).to.contain('merge_request%5Bsource_branch%5D=promotion%2Fuat%2Fpreprod%2F2026-09-08-2');
    expect(res?.url).to.contain('merge_request%5Btarget_branch%5D=preprod');
    expect(res?.url).to.contain('merge_request%5Bdescription%5D=Carries');
    expect(res?.bodyIncluded).to.equal(true);
  });

  it('Azure DevOps fills the pullrequestcreate form', () => {
    const res = AzureDevopsProvider.getPullRequestCreateUrl('https://dev.azure.com/myorg/myproject/_git/myrepo', request);
    expect(res?.url).to.contain('https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequestcreate?');
    expect(res?.url).to.contain('sourceRef=promotion%2Fuat%2Fpreprod%2F2026-09-08-2');
    expect(res?.url).to.contain('targetRef=preprod');
    expect(res?.url).to.contain('description=Carries');
  });

  it('Bitbucket fills the branches and the title, never the description', () => {
    const res = BitbucketProvider.getPullRequestCreateUrl('git@bitbucket.org:myworkspace/myrepo.git', request);
    expect(res?.url).to.contain('https://bitbucket.org/myworkspace/myrepo/pull-requests/new?');
    expect(res?.url).to.contain('source=promotion%2Fuat%2Fpreprod%2F2026-09-08-2');
    expect(res?.url).to.contain('dest=preprod');
    expect(res?.url).to.not.contain('description');
    expect(res?.bodyIncluded).to.equal(false);
  });

  it('a description too long for a URL is left out, the link still opens the form', () => {
    const longBody = 'x'.repeat(20000);
    const res = GithubProvider.getPullRequestCreateUrl('https://github.com/owner/repo', { ...request, body: longBody });
    expect(res?.bodyIncluded).to.equal(false);
    expect(res?.url).to.not.contain('body=');
    expect(res?.url).to.contain('title=Promotion+uat+to+preprod');
  });

  it('a remote URL of another provider builds nothing', () => {
    expect(AzureDevopsProvider.getPullRequestCreateUrl('https://github.com/owner/repo', request)).to.equal(null);
  });
});
