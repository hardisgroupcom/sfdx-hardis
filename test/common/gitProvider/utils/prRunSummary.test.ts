/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  decodeRunSummaryMarker,
  encodeRunSummaryMarker,
  markdownFirstLineAsText,
  parseWorkflowRunFromComment,
  parseWorkflowRunsFromComments,
} from '../../../../src/common/gitProvider/utils/prRunSummary.js';
import { PR_NAV_END, PR_NAV_START } from '../../../../src/common/gitProvider/utils/prCommentNav.js';

const VALIDATION_KEY = '<!-- sfdx-hardis message-key deployment-check-check-deployment-128 -->';
const DEPLOYMENT_KEY = '<!-- sfdx-hardis message-key deployment-process-deployment-128 -->';

function forgedMarker(payload: any): string {
  return `<!-- sfdx-hardis run-summary ${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')} -->`;
}

describe('Pull Request run summary', () => {
  it('round trips a summary through its marker', () => {
    const marker = encodeRunSummaryMarker({
      kind: 'validation',
      status: 'invalid',
      targetBranch: 'integration',
      jobUrl: 'https://ci.example.com/jobs/12',
      date: '2026-10-04T09:12:00.000Z',
      testLevel: 'RunSpecifiedTests',
      errorCount: 3,
      failedTestsCount: 1,
      coverageText: 'Your code coverage is ok 91%',
    });
    const summary = decodeRunSummaryMarker(`Some text\n\n${marker}\n`);
    expect(summary).to.deep.include({
      v: 1,
      kind: 'validation',
      status: 'invalid',
      targetBranch: 'integration',
      jobUrl: 'https://ci.example.com/jobs/12',
      date: '2026-10-04T09:12:00.000Z',
      quickDeploy: false,
      errorCount: 3,
      failedTestsCount: 1,
    });
  });

  it('returns null without a marker, or with one that is not readable', () => {
    expect(decodeRunSummaryMarker('No marker here')).to.be.null;
    const notJson = Buffer.from('not json', 'utf8').toString('base64');
    expect(decodeRunSummaryMarker(`<!-- sfdx-hardis run-summary ${notJson} -->`)).to.be.null;
    expect(decodeRunSummaryMarker(forgedMarker(['a']))).to.be.null;
  });

  it('refuses a kind or a status it does not know', () => {
    expect(decodeRunSummaryMarker(forgedMarker({ kind: 'other', status: 'valid' }))).to.be.null;
    expect(decodeRunSummaryMarker(forgedMarker({ kind: 'validation', status: '<b>ok</b>' }))).to.be.null;
  });

  it('drops the fields of a forged marker that do not hold what they should', () => {
    const summary = decodeRunSummaryMarker(
      forgedMarker({
        kind: 'deployment',
        status: 'valid',
        jobUrl: 'javascript:alert(1)',
        date: 'not a date',
        errorCount: -4,
        failedTestsCount: '12',
        targetBranch: 'uat\nmain',
      })
    );
    expect(summary?.jobUrl).to.be.undefined;
    expect(summary?.date).to.be.undefined;
    expect(summary?.errorCount).to.be.undefined;
    expect(summary?.failedTestsCount).to.be.undefined;
    expect(summary?.targetBranch).to.equal('uat main');
  });

  it('reduces the first line of a markdown section to plain text', () => {
    expect(markdownFirstLineAsText('\n✅ Your code coverage is ok **91%**, while target is **75%**\n\n<details>...')).to.equal(
      '✅ Your code coverage is ok 91%, while target is 75%'
    );
    expect(markdownFirstLineAsText(undefined)).to.equal('');
  });

  it('reads a run from a comment carrying a summary, without its hidden parts', () => {
    const marker = encodeRunSummaryMarker({ kind: 'deployment', status: 'valid', targetBranch: 'uat', quickDeploy: true });
    const body = `${PR_NAV_START}\n[Validation](https://x) | **Deployment**\n${PR_NAV_END}\n\n## Deployment Results\n\nAll good\n\n${marker}\n\n${DEPLOYMENT_KEY}\n`;
    const run = parseWorkflowRunFromComment({ body, url: 'https://git.example.com/pr/128#c2', updatedAt: '2026-10-04T10:00:00Z' });
    expect(run).to.deep.include({
      kind: 'deployment',
      status: 'valid',
      targetBranch: 'uat',
      quickDeploy: true,
      legacy: false,
      commentUrl: 'https://git.example.com/pr/128#c2',
      date: '2026-10-04T10:00:00.000Z',
    });
    expect(run?.body).to.equal('## Deployment Results\n\nAll good');
  });

  it('reads a comment posted before the marker existed from its banner', () => {
    const success = parseWorkflowRunFromComment({
      body: `[![x](https://sfdx-hardis.cloudity.com/assets/images/pr-banner-validation-success.png)](https://x)\n\n${VALIDATION_KEY}`,
    });
    expect(success).to.deep.include({ kind: 'validation', status: 'valid', legacy: true, errorCount: null, failedTestsCount: null });
    const failure = parseWorkflowRunFromComment({
      body: `![x](https://sfdx-hardis.cloudity.com/assets/images/pr-banner-deployment-failure.png)\n\n${DEPLOYMENT_KEY}`,
    });
    expect(failure).to.deep.include({ kind: 'deployment', status: 'invalid', legacy: true });
  });

  it('reads a comment without marker and without banner from the mark of its title', () => {
    const success = parseWorkflowRunFromComment({ body: `## 🔍 Validation Results\n\n✅ Deployment check success\n\n${VALIDATION_KEY}` });
    expect(success?.status).to.equal('valid');
    // A failed run still prints a success mark next to a coverage that is fine
    const failure = parseWorkflowRunFromComment({
      body: `## 🚀 Deployment Results\n\n❌ Deployment failure\n\n✅ Your code coverage is ok\n\n${DEPLOYMENT_KEY}`,
    });
    expect(failure?.status).to.equal('invalid');
    // A run that passed, with a failure mark in a detail further down, did pass
    const successWithDetail = parseWorkflowRunFromComment({
      body: `## 🔍 Validation Results\n\n✅ Deployment check success\n\n> Tip: a test marked ❌ in an earlier run was fixed\n\n${VALIDATION_KEY}`,
    });
    expect(successWithDetail?.status).to.equal('valid');
  });

  it('keeps the links of a provider served over http, and nothing but web addresses', () => {
    const marker = encodeRunSummaryMarker({ kind: 'deployment', status: 'valid', jobUrl: 'http://git.intranet/acme/sf/-/jobs/12' });
    const run = parseWorkflowRunFromComment({ body: `Done\n\n${marker}\n${DEPLOYMENT_KEY}`, url: 'data:text/html,x' });
    expect(run?.jobUrl).to.equal('http://git.intranet/acme/sf/-/jobs/12');
    expect(run?.commentUrl).to.equal('');
  });

  it('reads the comment of MegaLinter as a third kind, with the outcome of its title', () => {
    const success = parseWorkflowRunFromComment({
      body: '## ⚠️ [MegaLinter](https://megalinter.io/9.0.1) analysis: Success with warnings\n\n| Descriptor | Linter |\n\n<!-- megalinter: github-comment-reporter workflow=MegaLinter -->',
      url: 'https://git.example.com/pr/128#c3',
      updatedAt: '2026-10-04T10:00:00Z',
    });
    expect(success).to.deep.include({ kind: 'megalinter', status: 'valid', commentUrl: 'https://git.example.com/pr/128#c3' });
    expect(success?.body).to.not.include('<!--');
    const failure = parseWorkflowRunFromComment({ body: '## ❌ [MegaLinter](https://megalinter.io/9.0.1) analysis: Error\n\nDetails' });
    expect(failure).to.deep.include({ kind: 'megalinter', status: 'invalid' });
    // Recent versions link the outcome, and put no mark of their own in front of an error
    const linked = parseWorkflowRunFromComment({ body: '## [MegaLinter](https://megalinter.io/10.1.0) analysis: [Error](https://ci.example.com/jobs/1)\n\nDetails' });
    expect(linked).to.deep.include({ kind: 'megalinter', status: 'invalid' });
  });

  it('gives the MegaLinter analysis the job its reports link to', () => {
    const run = parseWorkflowRunFromComment({
      body: '## [MegaLinter](https://megalinter.io/9.0.1) analysis: Success\n\nSee detailed reports in [MegaLinter artifacts](https://github.com/acme/my-repo/actions/runs/555)\n\n<!-- megalinter: github-comment-reporter -->',
    });
    expect(run).to.deep.include({ kind: 'megalinter', jobUrl: 'https://github.com/acme/my-repo/actions/runs/555' });
    const withoutLink = parseWorkflowRunFromComment({ body: '## [MegaLinter](https://megalinter.io/9.0.1) analysis: Success\n\n<!-- megalinter: github-comment-reporter -->' });
    expect(withoutLink).to.deep.include({ kind: 'megalinter', jobUrl: '' });
  });

  it('lists the MegaLinter analysis after the runs of sfdx-hardis, and ignores any other comment', () => {
    const runs = parseWorkflowRunsFromComments([
      { body: 'Analysis\n\n<!-- megalinter: gitlab-comment-reporter -->' },
      { body: 'A reviewer comment with a hidden <!-- note -->' },
      { body: `Checked\n\n${VALIDATION_KEY}` },
    ]);
    expect(runs.map((run) => run.kind)).to.deep.equal(['validation', 'megalinter']);
  });

  // The comments of a GitHub Actions job carry its name, spaces included, in their message key
  it('lists the runs of a GitHub Actions job whose name has spaces', () => {
    const runs = parseWorkflowRunsFromComments([
      {
        body: `Checked

${encodeRunSummaryMarker({ kind: 'validation', status: 'valid' })}
<!-- sfdx-hardis message-key deployment-check-Simulate Deployment (sfdx-hardis)-1 -->`,
      },
      {
        body: `Deployed

${encodeRunSummaryMarker({ kind: 'deployment', status: 'invalid' })}
<!-- sfdx-hardis message-key deployment-Process Deployment (sfdx-hardis)-1 -->`,
      },
    ]);
    expect(runs.map((run) => `${run.kind}:${run.status}`)).to.deep.equal(['validation:valid', 'deployment:invalid']);
  });

  it('reads the placeholder deployment comment as pending', () => {
    const run = parseWorkflowRunFromComment({ body: `## Deployment Results\n\nWaiting for the merge\n\n${DEPLOYMENT_KEY}` });
    expect(run?.status).to.equal('pending');
  });

  it('ignores a summary whose kind is not the kind of the comment', () => {
    const marker = forgedMarker({ kind: 'deployment', status: 'valid' });
    const run = parseWorkflowRunFromComment({ body: `Text\n\n${marker}\n\n${VALIDATION_KEY}` });
    expect(run).to.deep.include({ kind: 'validation', status: 'pending', legacy: true });
  });

  it('ignores the comments that report no run, and lists validations first', () => {
    const runs = parseWorkflowRunsFromComments([
      { body: `Deployed\n\n${encodeRunSummaryMarker({ kind: 'deployment', status: 'valid', date: '2026-10-03T08:00:00Z' })}\n${DEPLOYMENT_KEY}` },
      { body: 'Actions\n\n<!-- sfdx-hardis deployment-actions-state -->' },
      { body: '<!-- sfdx-hardis message-key sfdx-hardis-flow-diff-MyFlow-128 -->' },
      { body: `Checked\n\n${encodeRunSummaryMarker({ kind: 'validation', status: 'valid', date: '2026-10-04T08:00:00Z' })}\n${VALIDATION_KEY}` },
    ]);
    expect(runs.map((run) => run.kind)).to.deep.equal(['validation', 'deployment']);
  });
});
