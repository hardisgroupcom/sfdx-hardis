import { expect } from 'chai';
import { buildSnapshotScratchDef } from '../../../src/common/utils/orgUtils.js';

describe('buildSnapshotScratchDef', () => {
  const projectScratchDef = {
    orgName: 'CI-scratch',
    edition: 'Developer',
    features: ['EnableSetPasswordInApi', 'DeferSharingCalc'],
    sourceOrg: '00D000000000001',
    release: 'Preview',
    hasSampleData: true,
    settings: { lightningExperienceSettings: { enableS1DesktopEnabled: true } },
  };

  it('sets the snapshot and leaves out the keys a snapshot rejects', () => {
    const { scratchDef, droppedKeys } = buildSnapshotScratchDef(projectScratchDef, 'Base362b4b6');
    expect(scratchDef).to.deep.equal({
      orgName: 'CI-scratch',
      settings: { lightningExperienceSettings: { enableS1DesktopEnabled: true } },
      snapshot: 'Base362b4b6',
    });
    expect(droppedKeys).to.deep.equal(['features', 'edition', 'sourceOrg', 'release', 'hasSampleData']);
  });

  it('leaves the project definition untouched, as initOrgMetadatas still reads its features', () => {
    buildSnapshotScratchDef(projectScratchDef, 'Base362b4b6');
    expect(projectScratchDef.features).to.deep.equal(['EnableSetPasswordInApi', 'DeferSharingCalc']);
    expect(projectScratchDef).to.not.have.property('snapshot');
  });

  it('drops nothing from a definition that has none of those keys', () => {
    expect(buildSnapshotScratchDef({ orgName: 'CI-scratch' }, 'Base362b4b6')).to.deep.equal({
      scratchDef: { orgName: 'CI-scratch', snapshot: 'Base362b4b6' },
      droppedKeys: [],
    });
  });
});
