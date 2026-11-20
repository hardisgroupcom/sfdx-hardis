import { expect } from 'chai';
import {
  cleanMetadataValue,
  nextReleaseLabel,
  parseShapeFeatures,
  toSettingsMetadataType,
} from '../../../src/common/utils/scratchOrgDefOrgUtils.js';

describe('scratchOrgDefOrgUtils', () => {
  it('names the release after the current one', () => {
    expect(nextReleaseLabel("Winter '27")).to.equal("Spring '27");
    expect(nextReleaseLabel("Spring '27")).to.equal("Summer '27");
    expect(nextReleaseLabel("Summer '26")).to.equal("Winter '27");
    expect(nextReleaseLabel("Summer '99")).to.equal("Winter '00");
    expect(nextReleaseLabel('Latest Release')).to.equal(null);
  });

  it('maps a settings name of the definition to its metadata type', () => {
    expect(toSettingsMetadataType('accountSettings')).to.equal('AccountSettings');
    expect(toSettingsMetadataType('LightningExperienceSettings')).to.equal('LightningExperienceSettings');
    expect(toSettingsMetadataType('account')).to.equal(null);
    expect(toSettingsMetadataType('bad name Settings')).to.equal(null);
  });

  it('turns Metadata API strings back into booleans and numbers', () => {
    const cleaned = cleanMetadataValue(
      {
        fullName: 'Security',
        enableA: 'true',
        enableB: 'false',
        passwordPolicies: { minimumPasswordLength: '8', complexity: 'AlphaNumeric', fullName: 'kept' },
        ranges: [{ start: '1.2.3.4' }],
      },
      true
    );
    expect(cleaned).to.deep.equal({
      enableA: true,
      enableB: false,
      passwordPolicies: { minimumPasswordLength: 8, complexity: 'AlphaNumeric', fullName: 'kept' },
      ranges: [{ start: '1.2.3.4' }],
    });
  });

  it('reads the features of an org shape', () => {
    expect(parseShapeFeatures('Communities;ServiceCloud; AddCustomApps:30')).to.deep.equal(['Communities', 'ServiceCloud', 'AddCustomApps:30']);
    expect(parseShapeFeatures('["A","B"]')).to.deep.equal(['A', 'B']);
    expect(parseShapeFeatures('A,A\nB')).to.deep.equal(['A', 'B']);
    expect(parseShapeFeatures(null)).to.deep.equal([]);
  });
});
