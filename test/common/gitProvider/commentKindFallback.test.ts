import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import '../../../src/common/gitProvider/index.js';
import { getPrCommentKind, getPrCommentKindFromMessageKey } from '../../../src/common/gitProvider/prCommentNav.js';

// An sfdx-hardis comment is found again by the message key written inside it, and that key carries
// the name of the CI job. Matching on the key alone means that renaming the CI job - or running
// once inside CI and once outside it - leaves the old comment untouched and adds a second one next
// to it. Every provider that puts the job name in the key must therefore also match on the comment
// KIND, which is what Azure DevOps already did and what GitHub and GitLab now do too.
describe('Pull Request comment lookup falls back on the comment kind', () => {
  const providerSource = (name: string) =>
    fs.readFileSync(path.join('src', 'common', 'gitProvider', name), 'utf8');

  for (const provider of ['gitlab.ts', 'github.ts', 'azureDevops.ts']) {
    it(`${provider} matches an existing comment by kind, not only by message key`, () => {
      const source = providerSource(provider);
      expect(source, `${provider} does not read the kind of the message it is posting`).to.include(
        'getPrCommentKindFromMessageKey(prMessage.messageKey)',
      );
      expect(source, `${provider} does not compare it with the kind of the existing comment`).to.match(
        /getPrCommentKind\([A-Za-z]+\) === currentCommentKind/,
      );
    });
  }

  it('bitbucket.ts needs no fallback: its key holds no job name', () => {
    expect(providerSource('bitbucket.ts')).to.include('const messageKey = `${prMessage.messageKey}-${pullRequestId}`;');
  });

  // The fallback is only correct if the two functions agree on what a kind is
  it('the kind of a message key and the kind of the comment it produces agree', () => {
    const cases: { messageKey: string; body: string; kind: string }[] = [
      {
        messageKey: 'deployment-check',
        body: 'anything\n<!-- sfdx-hardis message-key deployment-check-job-12 -->',
        kind: 'validation',
      },
      {
        messageKey: 'deployment',
        body: 'anything\n<!-- sfdx-hardis message-key deployment-job-12 -->',
        kind: 'deployment',
      },
    ];
    for (const testCase of cases) {
      expect(getPrCommentKindFromMessageKey(testCase.messageKey)).to.equal(testCase.kind);
      expect(getPrCommentKind(testCase.body)).to.equal(testCase.kind);
    }
  });

  it('a comment of another kind is never mistaken for this one', () => {
    const deploymentActions = 'x\n<!-- sfdx-hardis deployment-actions-state -->';
    expect(getPrCommentKind(deploymentActions)).to.equal('actions');
    expect(getPrCommentKindFromMessageKey('deployment-check')).to.equal('validation');
  });
});
