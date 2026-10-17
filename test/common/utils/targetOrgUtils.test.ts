import { expect } from 'chai';
import { Flags, Parser } from '@oclif/core';
import { Org } from '@salesforce/core';
import { getTargetOrg, isFlagTyped, resolveTargetUsername } from '../../../src/common/utils/targetOrgUtils.js';

// Same shape as the --target-org flag of sf-plugins-core: short char, deprecated aliases and a default
// value (the default org) when it is not typed
const targetOrgFlags = {
  'target-org': Flags.string({
    char: 'o',
    aliases: ['targetusername', 'u'],
    default: async () => 'me@acme.com.dev',
  }),
  'target-branch': Flags.string({}),
  check: Flags.boolean({ char: 'c', default: false }),
};

describe('isFlagTyped', () => {
  it('sees --target-org typed in every command line form', async () => {
    for (const argv of [
      ['--check', '--target-org', 'uat-alias'],
      ['--target-org=uat-alias'],
      ['-o', 'uat-alias'],
      ['-ouat-alias'],
      ['--targetusername', 'uat-alias'],
      ['-u', 'uat-alias'],
    ]) {
      const parseOutput = await Parser.parse(argv, { flags: targetOrgFlags });
      expect(parseOutput.flags['target-org'], argv.join(' ')).to.equal('uat-alias');
      expect(isFlagTyped(parseOutput, 'target-org'), argv.join(' ')).to.equal(true);
    }
  });

  it('does not see --target-org when its value comes from the default org', async () => {
    for (const argv of [['--check'], ['--target-branch', 'integration'], []]) {
      const parseOutput = await Parser.parse(argv, { flags: targetOrgFlags });
      expect(parseOutput.flags['target-org'], argv.join(' ')).to.equal('me@acme.com.dev');
      expect(isFlagTyped(parseOutput, 'target-org'), argv.join(' ')).to.equal(false);
    }
  });

  it('does not see a flag that has no value at all', () => {
    expect(isFlagTyped({ flags: {}, metadata: { flags: {} } }, 'target-org')).to.equal(false);
  });
});

describe('resolveTargetUsername', () => {
  it('uses the --target-org typed on the command line over the branch config', () => {
    expect(
      resolveTargetUsername({
        targetOrgTyped: true,
        branchConfigTargetUsername: 'deploy@acme.com.integration',
        flagUsername: 'deploy@acme.com.uat',
      })
    ).to.deep.equal({ username: 'deploy@acme.com.uat', source: 'commandLine' });
  });

  it('uses the branch config targetUsername when --target-org is not typed', () => {
    expect(
      resolveTargetUsername({
        targetOrgTyped: false,
        branchConfigTargetUsername: 'deploy@acme.com.integration',
        flagUsername: 'me@acme.com.dev',
      })
    ).to.deep.equal({ username: 'deploy@acme.com.integration', source: 'branchConfig' });
  });

  it('falls back to the default org when there is no branch config targetUsername', () => {
    expect(
      resolveTargetUsername({
        targetOrgTyped: false,
        branchConfigTargetUsername: undefined,
        flagUsername: 'me@acme.com.dev',
      })
    ).to.deep.equal({ username: 'me@acme.com.dev', source: 'defaultOrg' });
    expect(
      resolveTargetUsername({ targetOrgTyped: false, branchConfigTargetUsername: '', flagUsername: 'me@acme.com.dev' })
    ).to.deep.equal({ username: 'me@acme.com.dev', source: 'defaultOrg' });
  });
});

describe('getTargetOrg', () => {
  const originalCreate = Org.create;
  let createdFor: string[] = [];

  beforeEach(() => {
    createdFor = [];
    (Org as any).create = async (options: { aliasOrUsername: string }) => {
      createdFor.push(options.aliasOrUsername);
      return { getUsername: () => options.aliasOrUsername } as unknown as Org;
    };
  });

  afterEach(() => {
    (Org as any).create = originalCreate;
  });

  it('reuses the org of the flag when it is the selected one', async () => {
    const flagOrg = { getUsername: () => 'deploy@acme.com.uat' } as unknown as Org;
    const targetOrg = await getTargetOrg('deploy@acme.com.uat', flagOrg);
    expect(targetOrg).to.equal(flagOrg);
    expect(createdFor).to.deep.equal([]);
  });

  it('creates the selected org when it differs from the org of the flag', async () => {
    const flagOrg = { getUsername: () => 'me@acme.com.dev' } as unknown as Org;
    const targetOrg = await getTargetOrg('deploy@acme.com.integration', flagOrg);
    expect(targetOrg.getUsername()).to.equal('deploy@acme.com.integration');
    expect(createdFor).to.deep.equal(['deploy@acme.com.integration']);
  });

  it('creates the selected org when there is no flag org', async () => {
    const targetOrg = await getTargetOrg('deploy@acme.com.integration', undefined);
    expect(targetOrg.getUsername()).to.equal('deploy@acme.com.integration');
    expect(createdFor).to.deep.equal(['deploy@acme.com.integration']);
  });
});
