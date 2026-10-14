import { expect } from 'chai';
import { resolveTargetUsername } from '../../../src/common/utils/targetOrgUtils.js';

describe('resolveTargetUsername', () => {
  it('uses the --target-org typed on the command line over the branch config', () => {
    for (const argv of [
      ['--check', '--target-org', 'uat-alias'],
      ['--target-org=uat-alias'],
      ['-o', 'uat-alias'],
      ['--targetusername', 'uat-alias'],
      ['-u', 'uat-alias'],
    ]) {
      expect(
        resolveTargetUsername({
          argv,
          branchConfigTargetUsername: 'deploy@acme.com.integration',
          flagUsername: 'deploy@acme.com.uat',
        })
      ).to.deep.equal({ username: 'deploy@acme.com.uat', source: 'commandLine' });
    }
  });

  it('uses the branch config targetUsername when --target-org is not typed', () => {
    expect(
      resolveTargetUsername({
        argv: ['--check', '--target-branch', 'integration'],
        branchConfigTargetUsername: 'deploy@acme.com.integration',
        flagUsername: 'me@acme.com.dev',
      })
    ).to.deep.equal({ username: 'deploy@acme.com.integration', source: 'branchConfig' });
  });

  it('falls back to the default org when there is no branch config targetUsername', () => {
    expect(
      resolveTargetUsername({
        argv: ['--check'],
        branchConfigTargetUsername: undefined,
        flagUsername: 'me@acme.com.dev',
      })
    ).to.deep.equal({ username: 'me@acme.com.dev', source: 'defaultOrg' });
    expect(
      resolveTargetUsername({ argv: undefined, branchConfigTargetUsername: '', flagUsername: 'me@acme.com.dev' })
    ).to.deep.equal({ username: 'me@acme.com.dev', source: 'defaultOrg' });
  });

  it('uses the branch config when the typed org could not be resolved', () => {
    expect(
      resolveTargetUsername({
        argv: ['--target-org', 'unknown'],
        branchConfigTargetUsername: 'deploy@acme.com.integration',
        flagUsername: undefined,
      })
    ).to.deep.equal({ username: 'deploy@acme.com.integration', source: 'branchConfig' });
  });
});
