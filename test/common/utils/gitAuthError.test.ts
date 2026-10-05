/* eslint-disable @typescript-eslint/no-unused-expressions */
// Git authentication errors: which ones make sfdx-hardis ask for credentials, what it shows of
// them, and how often it asks. A wrong answer here is either a user asked for a token git never
// wanted, the same questions at every fetch, or a token displayed in a panel.
import { expect } from 'chai';
import {
  describeGitError,
  isGitAuthError,
  redactUrlCredentials,
  resetGitCredentialsStateForTests,
  retryGitAfterAuthError,
} from '../../../src/common/utils/index.js';

describe('isGitAuthError()', () => {
  it('recognizes what git and the git providers answer when credentials are refused', () => {
    for (const message of [
      'remote: HTTP Basic: Access denied. If a password was provided for Git authentication, the password was incorrect',
      "fatal: Authentication failed for 'https://gitlab.com/acme/crm.git/'",
      "fatal: unable to access 'https://gitlab.com/acme/crm.git/': The requested URL returned error: 403",
      'error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'remote: Permission to acme/crm.git denied to jane.',
      'git@github.com: Permission denied (publickey).',
      'remote: 403 Forbidden',
      'HTTP/2 403',
      'Response status code does not indicate success: 403 (Forbidden).',
      'remote: TF401019: The Git repository with name or identifier crm does not exist or you do not have permissions',
      'remote: TF401027: You need the Git GenericContribute permission to perform this action',
      'remote: Unauthorized',
      'fatal: unable to access the repository: 401 Unauthorized',
    ]) {
      expect(isGitAuthError(new Error(message)), message).to.be.true;
    }
  });

  it('does not take digits or words of a hash or of a branch name for a refusal', () => {
    for (const message of [
      "fatal: couldn't find remote ref feature/CRM-4031-new-quote-layout",
      "fatal: couldn't find remote ref fix/error-403",
      "fatal: couldn't find remote ref fix/unauthorized-endpoint",
      'error: cannot lock ref refs/heads/integration: is at 4f403a1c but expected 9b7401d2',
      "fatal: refusing to fetch into branch 'refs/heads/feature/http-401-retry' checked out at '/work/crm'",
      ' ! [rejected]        fix/unauthorized-endpoint -> fix/unauthorized-endpoint (non-fast-forward)',
      ' ! [remote rejected] feature/rotate-publickey -> feature/rotate-publickey (pre-receive hook declined)',
      'error: failed to push some refs to fix/unauthorized-endpoint',
    ]) {
      expect(isGitAuthError(new Error(message)), message).to.be.false;
    }
  });

  it('does not take a locked local file for a refusal', () => {
    for (const message of [
      'error: unable to create file force-app/main/default/classes/Foo.cls: Permission denied',
      "error: cannot open '.git/FETCH_HEAD': Permission denied",
    ]) {
      expect(isGitAuthError(new Error(message)), message).to.be.false;
    }
  });
});

describe('describeGitError() and redactUrlCredentials()', () => {
  it('removes the credentials a remote URL carries', () => {
    const described = describeGitError(
      new Error("fatal: Authentication failed for 'https://jane.doe:glpat-abcdef123456@gitlab.com/acme/crm.git/'")
    );
    expect(described).to.equal("fatal: Authentication failed for 'https://***@gitlab.com/acme/crm.git/'");
  });

  it('removes a user alone, and a password holding an @ or a slash', () => {
    expect(redactUrlCredentials('https://acme@dev.azure.com/acme/CRM/_git/crm')).to.equal(
      'https://***@dev.azure.com/acme/CRM/_git/crm'
    );
    expect(redactUrlCredentials('https://jane:p@ssSECRET@host/crm.git')).to.equal('https://***@host/crm.git');
    expect(redactUrlCredentials('https://jane:pa/ssSECRET@host/crm.git')).to.equal('https://***@host/crm.git');
  });

  it('removes them from a failed set-url, which names the whole URL', () => {
    expect(
      describeGitError(new Error("fatal: could not set 'remote.origin.url' to 'https://jane:TOKEN@gitlab.com/acme/crm.git'"))
    ).to.not.include('TOKEN');
  });

  it('keeps a message without credentials as it is', () => {
    expect(describeGitError(new Error('fatal: unable to access: The requested URL returned error: 403'))).to.equal(
      'fatal: unable to access: The requested URL returned error: 403'
    );
  });
});

describe('retryGitAfterAuthError()', () => {
  const refused = () => new Error("fatal: Authentication failed for 'https://jane:TOKEN@gitlab.com/acme/crm.git/'");
  let asked: number;
  let restored: number;
  const deps = (answer: boolean) => ({
    askCredentials: async () => {
      asked++;
      return answer;
    },
    forgetCredentials: async () => {
      restored++;
    },
  });
  const failure = async (promise: Promise<unknown>): Promise<Error> => {
    try {
      await promise;
    } catch (e) {
      return e as Error;
    }
    throw new Error('the git operation should have failed');
  };

  beforeEach(() => {
    asked = 0;
    restored = 0;
    resetGitCredentialsStateForTests();
  });

  after(() => {
    resetGitCredentialsStateForTests();
  });

  it('does not ask for credentials when the error is not about them', async () => {
    const error = new Error("fatal: couldn't find remote ref integration");
    const thrown = await failure(retryGitAfterAuthError('fetch', 'retryingGitFetchWithUpdatedCredentials', error, async () => 'ok', deps(true)));
    expect(thrown).to.equal(error);
    expect(asked).to.equal(0);
  });

  it('runs the operation again once credentials were given', async () => {
    const result = await retryGitAfterAuthError('fetch', 'retryingGitFetchWithUpdatedCredentials', refused(), async () => 'fetched', deps(true));
    expect(result).to.equal('fetched');
    expect(asked).to.equal(1);
    expect(restored).to.equal(0);
  });

  it('takes the credentials back from the helper and stops asking once they are refused too', async () => {
    const run = async () => {
      throw refused();
    };
    await failure(retryGitAfterAuthError('fetch', 'retryingGitFetchWithUpdatedCredentials', refused(), run, deps(true)));
    expect(asked).to.equal(1);
    expect(restored).to.equal(1);
    // The pull and the push that follow in the same command
    await failure(retryGitAfterAuthError('pull', 'retryingGitPullWithUpdatedCredentials', refused(), run, deps(true)));
    await failure(retryGitAfterAuthError('push', 'retryingGitPushWithUpdatedCredentials', refused(), run, deps(true)));
    expect(asked).to.equal(1);
  });

  it('stops asking when credentials could not be asked or used (SSH remote, agent run, no answer)', async () => {
    const run = async () => 'never';
    await failure(retryGitAfterAuthError('fetch', 'retryingGitFetchWithUpdatedCredentials', refused(), run, deps(false)));
    await failure(retryGitAfterAuthError('push', 'retryingGitPushWithUpdatedCredentials', refused(), run, deps(false)));
    expect(asked).to.equal(1);
    expect(restored).to.equal(0);
  });

  it('never lets the token leave in the error it throws', async () => {
    const run = async () => {
      throw refused();
    };
    const first = await failure(retryGitAfterAuthError('fetch', 'retryingGitFetchWithUpdatedCredentials', refused(), run, deps(true)));
    const second = await failure(retryGitAfterAuthError('fetch', 'retryingGitFetchWithUpdatedCredentials', refused(), run, deps(true)));
    for (const error of [first, second]) {
      expect(error.message).to.not.include('TOKEN');
      expect(error.message).to.include('https://***@gitlab.com');
    }
  });
});
