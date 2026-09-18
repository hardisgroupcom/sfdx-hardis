import { expect } from 'chai';
import fs from 'fs';
import { addOrgToGithubMonitoringWorkflow } from '../../../src/common/utils/monitoringWorkflowUtils.js';

const template = fs.readFileSync('defaults/monitoring/.github/workflows/org-monitoring.yml', 'utf8').replace(/\r/g, '');
const branch = 'monitoring_orgfarm_c77e7e1127_dev_ed_develop';
const suffix = branch.toUpperCase();

describe('addOrgToGithubMonitoringWorkflow()', () => {
  it('replaces the example branches and secrets of the template with the monitored org, in every job', () => {
    const updated = addOrgToGithubMonitoringWorkflow(template, branch);
    expect(updated).not.to.match(/MYCLIENT/i);
    const matrixItems = updated.split('\n').filter((line) => line.trim() === `- ${branch}`);
    expect(matrixItems.length).to.equal(template.split('\n').filter((line) => line.trim() === 'branch:').length);
    expect(updated).to.include(`SFDX_CLIENT_ID_${suffix}: \${{ secrets.SFDX_CLIENT_ID_${suffix} }}`);
    expect(updated).to.include(`SFDX_CLIENT_KEY_${suffix}: \${{ secrets.SFDX_CLIENT_KEY_${suffix} }}`);
  });

  it('keeps the orgs already monitored when another one is added', () => {
    const first = addOrgToGithubMonitoringWorkflow(template, branch);
    const second = addOrgToGithubMonitoringWorkflow(first, 'monitoring_acme__uat_sandbox');
    const lines = second.split('\n').map((line) => line.trim());
    const at = lines.indexOf(`- ${branch}`);
    expect(lines[at + 1]).to.equal('- monitoring_acme__uat_sandbox');
    expect(second).to.include('SFDX_CLIENT_ID_MONITORING_ACME__UAT_SANDBOX');
    expect(second).to.include(`SFDX_CLIENT_ID_${suffix}`);
  });

  it('changes nothing when the org is already there', () => {
    const once = addOrgToGithubMonitoringWorkflow(template, branch);
    expect(addOrgToGithubMonitoringWorkflow(once, branch)).to.equal(once);
  });

  it('keeps CI_COMMIT_REF_NAME out of a comment', () => {
    expect(template.split('\n').some((line) => /#.*CI_COMMIT_REF_NAME/.test(line))).to.equal(false);
  });
});
