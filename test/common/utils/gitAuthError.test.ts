/* eslint-disable @typescript-eslint/no-unused-expressions */
// Git authentication errors: which ones make sfdx-hardis ask for credentials, and what it shows of
// them. A wrong answer here is either a user asked for a token git never wanted, or a token
// displayed in a panel.
import { expect } from 'chai';
import { describeGitError, isGitAuthError } from '../../../src/common/utils/index.js';

describe('isGitAuthError()', () => {
  it('recognizes what git answers when credentials are refused', () => {
    for (const message of [
      "remote: HTTP Basic: Access denied. If a password was provided for Git authentication, the password was incorrect",
      "fatal: Authentication failed for 'https://gitlab.com/acme/crm.git/'",
      'fatal: unable to access \'https://gitlab.com/acme/crm.git/\': The requested URL returned error: 403',
      'error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ]) {
      expect(isGitAuthError(new Error(message)), message).to.be.true;
    }
  });

  it('does not take three digits in a hash or in a branch name for an HTTP status', () => {
    for (const message of [
      "fatal: couldn't find remote ref feature/CRM-4031-new-quote-layout",
      'error: cannot lock ref refs/heads/integration: is at 4f403a1c but expected 9b7401d2',
      "fatal: refusing to fetch into branch 'refs/heads/feature/US-401' checked out at '/work/crm'",
    ]) {
      expect(isGitAuthError(new Error(message)), message).to.be.false;
    }
  });
});

describe('describeGitError()', () => {
  it('removes the credentials a remote URL carries', () => {
    const described = describeGitError(
      new Error("fatal: Authentication failed for 'https://jane.doe:glpat-abcdef123456@gitlab.com/acme/crm.git/'")
    );
    expect(described).to.equal("fatal: Authentication failed for 'https://***@gitlab.com/acme/crm.git/'");
    expect(described).to.not.include('glpat');
  });

  it('keeps a message without credentials as it is', () => {
    expect(describeGitError(new Error('fatal: unable to access: The requested URL returned error: 403'))).to.equal(
      'fatal: unable to access: The requested URL returned error: 403'
    );
  });
});
