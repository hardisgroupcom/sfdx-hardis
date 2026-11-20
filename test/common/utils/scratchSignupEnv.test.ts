import { expect } from 'chai';
import { getScratchSignupEnv } from '../../../src/common/utils/orgUtils.js';

describe('getScratchSignupEnv', () => {
  it('uses the CLI built-in app and its callback by default', () => {
    expect(getScratchSignupEnv({})).to.deep.equal({
      SF_SCRATCH_SIGNUP_CONNECTED_APP: 'PlatformCLI',
      SF_SCRATCH_SIGNUP_CALLBACK_URL: 'http://localhost:1717/OauthRedirect',
    });
  });

  it('keeps a callback URL the user already set', () => {
    expect(getScratchSignupEnv({ SF_SCRATCH_SIGNUP_CALLBACK_URL: 'http://localhost:1718/OauthRedirect' })).to.deep.equal({
      SF_SCRATCH_SIGNUP_CONNECTED_APP: 'PlatformCLI',
      SF_SCRATCH_SIGNUP_CALLBACK_URL: 'http://localhost:1718/OauthRedirect',
    });
  });

  it('adds nothing when the user chose a signup app', () => {
    expect(getScratchSignupEnv({ SF_SCRATCH_SIGNUP_CONNECTED_APP: '3MVG9xyz' })).to.deep.equal({});
  });

  it('adds nothing when SFDX_CLIENT_SECRET is set, as the CLI would send it with the built-in app', () => {
    expect(getScratchSignupEnv({ SFDX_CLIENT_SECRET: 'secret' })).to.deep.equal({});
  });
});
