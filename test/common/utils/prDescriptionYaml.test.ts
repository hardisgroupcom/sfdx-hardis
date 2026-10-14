/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import { mergePrDescriptionYamlBlocks } from '../../../src/common/utils/pullRequestUtils.js';

describe('mergePrDescriptionYamlBlocks()', () => {
  it('a second block adds to the list of the first instead of replacing it', () => {
    // Someone appending a block to name one more Apex test class is adding it: replacing the whole
    // list would silently drop the classes declared above, and the deployment would not run them
    const merged = mergePrDescriptionYamlBlocks(
      { deploymentApexTestClasses: ['AlphaTest'] },
      { deploymentApexTestClasses: ['BetaTest'] },
    );
    expect(merged.deploymentApexTestClasses).to.deep.equal(['AlphaTest', 'BetaTest']);
  });

  it('the same entry twice is kept once', () => {
    const merged = mergePrDescriptionYamlBlocks(
      { deploymentApexTestClasses: ['AlphaTest', 'BetaTest'] },
      { deploymentApexTestClasses: ['BetaTest'] },
    );
    expect(merged.deploymentApexTestClasses).to.deep.equal(['AlphaTest', 'BetaTest']);
  });

  it('deep entries are compared by content, not by reference', () => {
    const merged = mergePrDescriptionYamlBlocks(
      { commandsPreDeploy: [{ id: 'a', type: 'command' }] },
      { commandsPreDeploy: [{ id: 'a', type: 'command' }, { id: 'b', type: 'command' }] },
    );
    expect(merged.commandsPreDeploy.map((command: any) => command.id)).to.deep.equal(['a', 'b']);
  });

  it('anything that is not a list keeps the value of the last block', () => {
    expect(mergePrDescriptionYamlBlocks({ testLevel: 'NoTestRun' }, { testLevel: 'RunLocalTests' }).testLevel)
      .to.equal('RunLocalTests');
    // A list replacing a value, or the other way round, is not a merge either
    expect(mergePrDescriptionYamlBlocks({ x: 'one' }, { x: ['two'] }).x).to.deep.equal(['two']);
  });

  it('the first block is taken as it is', () => {
    expect(mergePrDescriptionYamlBlocks(null, { promotionPullRequests: [1, 3] })).to.deep.equal({
      promotionPullRequests: [1, 3],
    });
  });
});
