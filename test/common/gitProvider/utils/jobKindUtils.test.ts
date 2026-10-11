import { expect } from 'chai';
import { CiRunCandidate, classifyJobKind, selectCiRuns } from '../../../../src/common/gitProvider/utils/jobKindUtils.js';

const candidate = (id: string, name: string, trigger: 'push' | 'pullRequest', branch: string): CiRunCandidate => ({
  id,
  name,
  trigger,
  branch,
  status: 'succeeded',
  queuedAt: '2026-09-01T10:00:00Z',
  startedAt: '2026-09-01T10:01:00Z',
  finishedAt: '2026-09-01T10:10:00Z',
  commitSha: `sha-${id}`,
  triggeredBy: 'Mariia',
  webUrl: `https://ci.example.com/${id}`,
});

describe('jobKindUtils', () => {
  it('names the jobs of the CI files sfdx-hardis installs', () => {
    for (const name of ['Process Deployment (sfdx-hardis)', 'deploy_to_org', 'Deployment', 'Deploy to major org']) {
      expect(classifyJobKind(name), name).to.equal('deployment');
    }
    for (const name of ['Simulate Deployment (sfdx-hardis)', 'check_deploy_to_target_branch_org', 'DeploymentCheck', 'Simulate SFDX deployment']) {
      expect(classifyJobKind(name), name).to.equal('validation');
    }
    for (const name of ['Mega-Linter', 'check_quality', 'MegaLinter', 'Run MegaLinter']) {
      expect(classifyJobKind(name), name).to.equal('codeQuality');
    }
    expect(classifyJobKind('Unit tests')).to.equal('other');
    expect(classifyJobKind(null)).to.equal('other');
  });

  it('keeps the push runs named as a deployment, and the Pull Request runs named as a check', () => {
    const runs = selectCiRuns(
      [
        candidate('1', 'deploy_to_org', 'push', 'main'),
        candidate('2', 'check_quality', 'push', 'main'),
        candidate('3', 'check_deploy_to_target_branch_org', 'pullRequest', ''),
        candidate('4', 'check_quality', 'pullRequest', ''),
        // A job named as a deployment on a Pull Request deploys nothing to a major org
        candidate('5', 'deploy_to_org', 'pullRequest', ''),
      ],
      ['deployment', 'validation'],
    );
    expect(runs.map((run) => [run.id, run.kind])).to.deep.equal([
      ['1', 'deployment'],
      ['3', 'validation'],
    ]);
    expect(runs[0]).to.not.have.property('trigger');
  });

  it('counts every unexplained push run of a branch whose jobs were renamed', () => {
    const runs = selectCiRuns(
      [
        candidate('1', 'Release to org', 'push', 'uat'),
        candidate('2', 'Mega-Linter', 'push', 'uat'),
        // main has a run named as a deployment: its other runs are another CI of the project
        candidate('3', 'Process Deployment (sfdx-hardis)', 'push', 'main'),
        candidate('4', 'Security scan', 'push', 'main'),
      ],
      ['deployment'],
    );
    expect(runs.map((run) => run.id)).to.deep.equal(['1', '3']);
  });

  it('returns only the kinds asked for', () => {
    const candidates = [candidate('1', 'deploy_to_org', 'push', 'main'), candidate('2', 'DeploymentCheck', 'pullRequest', 'main')];
    expect(selectCiRuns(candidates, ['validation']).map((run) => run.id)).to.deep.equal(['2']);
    expect(selectCiRuns(candidates, ['deployment']).map((run) => run.id)).to.deep.equal(['1']);
  });
});
