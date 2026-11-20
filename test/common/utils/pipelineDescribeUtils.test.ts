import { expect } from 'chai';
import { buildPipelineBranchRows, buildPipelineDescription } from '../../../src/common/utils/pipelineDescribeUtils.js';

describe('pipelineDescribeUtils', () => {
  describe('buildPipelineDescription', () => {
    it('describes the default pipeline from declared merge targets', () => {
      const description = buildPipelineDescription(
        [
          { branchName: 'main', level: 100, instanceUrl: 'https://prod.my.salesforce.com', targetUsername: 'ci@prod.com', mergeTargets: [] },
          { branchName: 'preprod', level: 90, mergeTargets: ['main'] },
          { branchName: 'uat', level: 70, mergeTargets: ['preprod'] },
          { branchName: 'integration', level: 50, mergeTargets: ['uat'] },
        ],
        { developmentBranch: 'integration', availableTargetBranches: ['integration', 'preprod'] },
      );
      expect(description.steps).to.deep.equal([
        { source: 'preprod', target: 'main', promotionBranchAllowed: false },
        { source: 'uat', target: 'preprod', promotionBranchAllowed: false },
        { source: 'integration', target: 'uat', promotionBranchAllowed: false },
      ]);
      expect(description.entryBranches).to.deep.equal(['integration']);
      expect(description.finalBranches).to.deep.equal(['main']);
      expect(description.developmentBranch).to.equal('integration');
      expect(description.availableTargetBranches).to.deep.equal(['integration', 'preprod']);
      expect(description.warnings).to.deep.equal([]);
      expect(description.mergeTargetsRecommendation).to.equal(null);
      const main = description.branches.find((branch) => branch.name === 'main');
      expect(main).to.deep.equal({
        name: 'main',
        level: 100,
        instanceUrl: 'https://prod.my.salesforce.com',
        targetUsername: 'ci@prod.com',
        mergeTargets: [],
        mergeTargetsGuessed: false,
        mergeSources: ['preprod'],
      });
    });

    it('describes a core branch feeding several production orgs', () => {
      const description = buildPipelineDescription(
        [
          { branchName: 'prod_fr', level: 100, mergeTargets: [] },
          { branchName: 'prod_us', level: 100, mergeTargets: [] },
          { branchName: 'uat_fr', level: 70, mergeTargets: ['prod_fr'] },
          { branchName: 'uat_us', level: 70, mergeTargets: ['prod_us'] },
          { branchName: 'core', level: 40, mergeTargets: ['uat_fr', 'uat_us'] },
          { branchName: 'hotfix_us', level: 40, mergeTargets: ['prod_us'] },
        ],
        { developmentBranch: 'core' },
      );
      expect(description.entryBranches).to.deep.equal(['core', 'hotfix_us']);
      expect(description.finalBranches).to.deep.equal(['prod_fr', 'prod_us']);
      expect(description.steps.map((step) => `${step.source}>${step.target}`)).to.deep.equal([
        'uat_fr>prod_fr',
        'uat_us>prod_us',
        'core>uat_fr',
        'core>uat_us',
        'hotfix_us>prod_us',
      ]);
      expect(description.branches.find((branch) => branch.name === 'prod_us')?.mergeSources).to.deep.equal(['uat_us', 'hotfix_us']);
      expect(description.developmentBranch).to.equal('core');
      expect(description.availableTargetBranches).to.deep.equal([]);
    });

    it('marks the steps a promotion branch may be assembled on', () => {
      const majorOrgs = [
        { branchName: 'main', level: 100, mergeTargets: [] },
        { branchName: 'preprod', level: 90, mergeTargets: ['main'] },
        { branchName: 'uat', level: 70, mergeTargets: ['preprod'] },
      ];
      const enabled = buildPipelineDescription(majorOrgs, {
        enablePromotionBranches: true,
        allowedPromotionSteps: [{ source: 'uat', target: 'preprod' }],
      });
      expect(enabled.promotionBranches).to.deep.equal({ enabled: true, allowedSteps: [{ source: 'uat', target: 'preprod' }] });
      expect(enabled.steps).to.deep.equal([
        { source: 'preprod', target: 'main', promotionBranchAllowed: false },
        { source: 'uat', target: 'preprod', promotionBranchAllowed: true },
      ]);

      // The commands refuse to run without allowedPromotionSteps, so no step is open without it
      const withoutSteps = buildPipelineDescription(majorOrgs, { enablePromotionBranches: true });
      expect(withoutSteps.steps.some((step) => step.promotionBranchAllowed)).to.equal(false);

      const disabled = buildPipelineDescription(majorOrgs, { allowedPromotionSteps: [{ source: 'uat', target: 'preprod' }] });
      expect(disabled.promotionBranches.enabled).to.equal(false);
      expect(disabled.steps.some((step) => step.promotionBranchAllowed)).to.equal(false);
    });

    it('warns about guessed merge targets and merge targets without a config file', () => {
      const description = buildPipelineDescription(
        [
          { branchName: 'main', level: 100, mergeTargets: [], mergeTargetsGuessed: true },
          { branchName: 'uat', level: 70, mergeTargets: ['main'], mergeTargetsGuessed: true },
          { branchName: 'integration', level: 50, mergeTargets: ['uat', 'ghost'] },
        ],
        {},
      );
      expect(description.branches.map((branch) => branch.mergeTargetsGuessed)).to.deep.equal([true, true, false]);
      expect(description.warnings).to.have.length(3);
      expect(description.steps.map((step) => step.target)).to.include('ghost');
      // The sentence an agent relays to the user names the branches and the files to complete
      expect(description.mergeTargetsRecommendation).to.be.a('string');
      expect(description.mergeTargetsRecommendation).to.include('main, uat');
      expect(description.mergeTargetsRecommendation).to.include('config/branches/.sfdx-hardis.uat.yml');
      expect(description.mergeTargetsRecommendation).to.not.include('.sfdx-hardis.integration.yml');
      expect(description.developmentBranch).to.equal('integration');
    });

    it('returns an empty description when the project has no major branch', () => {
      const description = buildPipelineDescription([], {});
      expect(description.branches).to.deep.equal([]);
      expect(description.steps).to.deep.equal([]);
      expect(description.entryBranches).to.deep.equal([]);
      expect(description.finalBranches).to.deep.equal([]);
    });
  });

  describe('buildPipelineBranchRows', () => {
    it('orders the rows from the entry branches to the final ones', () => {
      const description = buildPipelineDescription(
        [
          { branchName: 'main', level: 100, instanceUrl: 'https://prod.my.salesforce.com', mergeTargets: [] },
          { branchName: 'uat', level: 70, targetUsername: 'ci@uat.com', mergeTargets: ['main'], mergeTargetsGuessed: true },
          { branchName: 'integration', level: 50, mergeTargets: ['uat'] },
        ],
        {},
      );
      expect(buildPipelineBranchRows(description)).to.deep.equal([
        { Branch: 'integration', Org: '', 'Merged into': 'uat', 'Receives from': '' },
        { Branch: 'uat', Org: 'ci@uat.com', 'Merged into': 'main (guessed)', 'Receives from': 'integration' },
        { Branch: 'main', Org: 'https://prod.my.salesforce.com', 'Merged into': '', 'Receives from': 'uat' },
      ]);
    });
  });
});
