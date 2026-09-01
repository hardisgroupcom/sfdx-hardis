import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import { runAuthHook } from '../../../src/common/utils/authUtils.js';

// oclif Config.runHook() does not throw the errors raised by hooks: it collects them in
// result.failures. runAuthHook re-throws them, so a failed authentication can not be reported
// as a command success.
describe('runAuthHook', () => {
  const buildCommandThis = (hookResult: any, calls: any[] = []) => {
    return {
      config: {
        runHook: async (event: string, options: any) => {
          calls.push({ event, options });
          return hookResult;
        },
      },
    };
  };

  afterEach(() => {
    globalThis.justConnectedOrg = null;
  });

  it('resets the previously connected org before calling the hook', async () => {
    globalThis.justConnectedOrg = { username: 'previous@org.com' };
    await runAuthHook(buildCommandThis({ successes: [{ result: true }], failures: [] }), { checkAuth: true });
    expect(globalThis.justConnectedOrg).to.equal(null);
  });

  it('calls the auth hook with the provided options', async () => {
    const calls: any[] = [];
    await runAuthHook(buildCommandThis({ successes: [], failures: [] }, calls), { checkAuth: true, devHub: true });
    expect(calls.length).to.equal(1);
    expect(calls[0].event).to.equal('auth');
    expect(calls[0].options).to.deep.equal({ checkAuth: true, devHub: true });
  });

  it('throws the error collected by the hook', async () => {
    const hookError = new SfError('You must be logged to an org to perform this action');
    const commandThis = buildCommandThis({ successes: [], failures: [{ error: hookError, plugin: {} }] });
    let caught: any = null;
    try {
      await runAuthHook(commandThis, { checkAuth: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).to.equal(hookError);
  });

  it('wraps a non Error failure into a SfError', async () => {
    const commandThis = buildCommandThis({ successes: [], failures: [{ error: 'auth kaboom', plugin: {} }] });
    let caught: any = null;
    try {
      await runAuthHook(commandThis, { checkAuth: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(SfError);
    expect(caught.message).to.equal('auth kaboom');
  });
});
