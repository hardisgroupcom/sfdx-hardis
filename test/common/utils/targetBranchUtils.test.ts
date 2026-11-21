import { expect } from 'chai';
import { buildAvailableTargetBranches } from '../../../src/common/utils/gitUtils.js';
import { getTargetBranchName, listAvailableTargetBranchNames } from '../../../src/common/utils/targetBranchUtils.js';

// availableTargetBranches entries can be "branch,label" (issue #2505)
describe('targetBranchUtils', () => {
  describe('getTargetBranchName', () => {
    it('keeps a bare branch name and cuts the label of a "branch,label" entry', () => {
      expect(getTargetBranchName('preprod')).to.equal('preprod');
      expect(getTargetBranchName('preprod,Choose this branch for HOTFIX tickets')).to.equal('preprod');
      expect(getTargetBranchName('preprod,HOTFIX, then production')).to.equal('preprod');
      expect(getTargetBranchName(' preprod , HOTFIX')).to.equal('preprod');
    });

    it('returns an empty name for what is not a branch', () => {
      expect(getTargetBranchName('')).to.equal('');
      expect(getTargetBranchName(undefined)).to.equal('');
      expect(getTargetBranchName(null)).to.equal('');
      expect(getTargetBranchName(42)).to.equal('');
    });
  });

  describe('listAvailableTargetBranchNames', () => {
    it('lists the bare names in config order, once each', () => {
      expect(
        listAvailableTargetBranchNames({
          availableTargetBranches: ['integration,BUILD tickets', 'preprod', 'integration', ' ', 'uat,UAT'],
        })
      ).to.deep.equal(['integration', 'preprod', 'uat']);
    });

    it('returns an empty list when availableTargetBranches is missing or not a list', () => {
      expect(listAvailableTargetBranchNames({})).to.deep.equal([]);
      expect(listAvailableTargetBranchNames(null)).to.deep.equal([]);
      expect(listAvailableTargetBranchNames({ availableTargetBranches: 'preprod' })).to.deep.equal([]);
    });
  });

  describe('buildAvailableTargetBranches', () => {
    it('returns branch names, not raw "branch,label" entries, and lists developmentBranch once', () => {
      const result = buildAvailableTargetBranches({
        availableTargetBranches: ['integration,Choose this branch for BUILD tickets', 'preprod,Choose this branch for HOTFIX tickets'],
        developmentBranch: 'integration',
      });
      expect(result.branches).to.deep.equal(['integration', 'preprod']);
      expect(result.branches.includes('preprod')).to.equal(true);
      expect(result.display).to.deep.equal([
        'integration (Choose this branch for BUILD tickets)',
        'preprod (Choose this branch for HOTFIX tickets)',
      ]);
    });

    it('prefers availableTargetBranchesLabels over the embedded label', () => {
      const result = buildAvailableTargetBranches({
        availableTargetBranches: ['preprod,Embedded label', 'integration'],
        availableTargetBranchesLabels: ['Pre-Production'],
      });
      expect(result.branches).to.deep.equal(['preprod', 'integration']);
      expect(result.display[0]).to.equal('preprod (Pre-Production)');
      expect(result.display[1]).to.match(/^integration \(BUILD Stream/);
    });

    it('adds developmentBranch after the configured branches, and alone when none is configured', () => {
      expect(buildAvailableTargetBranches({ availableTargetBranches: ['preprod'], developmentBranch: 'dev' }).branches).to.deep.equal([
        'preprod',
        'dev',
      ]);
      expect(buildAvailableTargetBranches({ developmentBranch: 'dev' })).to.deep.equal({ branches: ['dev'], display: ['dev'] });
      expect(buildAvailableTargetBranches({})).to.deep.equal({ branches: [], display: [] });
    });
  });
});
