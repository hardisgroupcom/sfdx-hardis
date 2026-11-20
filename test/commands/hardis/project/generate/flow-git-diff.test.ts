import { expect } from 'chai';
import { getBranchRefs } from '../../../../../src/commands/hardis/project/generate/flow-git-diff.js';

describe('hardis:project:generate:flow-git-diff', () => {
  describe('getBranchRefs', () => {
    it('keeps local branches and removes the remotes/ prefix of remote branches', () => {
      expect(getBranchRefs(['main', 'feature/my-flow', 'remotes/origin/main', 'remotes/origin/integration'])).to.deep.equal([
        'main',
        'feature/my-flow',
        'origin/main',
        'origin/integration',
      ]);
    });

    it('skips HEAD pointers and detached HEAD entries', () => {
      expect(getBranchRefs(['(HEAD detached at 1a2b3c4)', 'HEAD', 'remotes/origin/HEAD', 'main'])).to.deep.equal(['main']);
    });

    it('lists a branch once', () => {
      expect(getBranchRefs(['remotes/origin/main', 'remotes/origin/main', 'main'])).to.deep.equal(['origin/main', 'main']);
    });
  });
});
