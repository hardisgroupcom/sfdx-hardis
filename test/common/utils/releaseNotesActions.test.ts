import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import type { DeploymentActionStateEntry } from '../../../src/common/utils/deploymentActionsStateUtils.js';
import { filterAndDedupeDeploymentActions } from '../../../src/common/utils/releaseNotesUtils.js';

function entry(orgBranch: string, status: string): DeploymentActionStateEntry {
  return {
    actionId: 'email-deliverability',
    actionLabel: 'Set Email Deliverability to All Email',
    orgBranch,
    when: 'pre-deploy',
    executionOrder: 0,
    status,
    jobId: '',
    jobUrl: '',
    date: '',
    prNumber: 7,
  } as DeploymentActionStateEntry;
}

describe('filterAndDedupeDeploymentActions()', () => {
  // The manual step was ticked in integration and is still to do in uat
  const entries = [entry('integration', 'success'), entry('uat', 'manual')];

  it('reports the status in the org of the branch the notes are for', () => {
    const rows = filterAndDedupeDeploymentActions(entries, 'uat');
    expect(rows).to.have.length(1);
    expect(rows[0].status).to.equal('manual');
  });

  it('reads as pending when that branch has no entry yet, as a promotion that has not run', () => {
    const rows = filterAndDedupeDeploymentActions(entries, 'preprod');
    expect(rows[0].status).to.equal('pending');
    expect(rows[0].orgBranch).to.equal('preprod');
  });

  it('keeps the best status across orgs when no branch is given', () => {
    expect(filterAndDedupeDeploymentActions(entries)[0].status).to.equal('success');
  });

  it('matches the branch whatever spaces surround it', () => {
    expect(filterAndDedupeDeploymentActions([entry('uat ', 'manual')], ' uat')[0].status).to.equal('manual');
  });

  it('leaves out an action only skipped in that org, not one skipped after it ran', () => {
    expect(filterAndDedupeDeploymentActions([entry('uat', 'skipped'), entry('integration', 'manual')], 'uat')).to.have.length(0);
    const ranOnce = filterAndDedupeDeploymentActions([entry('uat', 'success'), entry('uat', 'skipped')], 'uat');
    expect(ranOnce.map((row) => row.status)).to.deep.equal(['success']);
  });
});
