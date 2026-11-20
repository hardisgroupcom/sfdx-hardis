import { expect } from 'chai';
import { isContainerMode } from '../../../src/common/utils/orgUtils.js';
import { restoreProcessEnv } from './envTestHelper.js';

// Container mode (Agentforce Vibes, dev containers): the Salesforce CLI prints the login link
// instead of opening a browser. The accepted values are the ones the CLI accepts.
describe('orgUtils isContainerMode', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SF_CONTAINER_MODE;
    delete process.env.SFDX_CONTAINER_MODE;
  });

  afterEach(() => {
    restoreProcessEnv(previousEnv);
  });

  it('is off when no variable is set', () => {
    expect(isContainerMode()).to.equal(false);
  });

  it('accepts true and 1, in any case, like the Salesforce CLI', () => {
    for (const value of ['true', 'TRUE', 'True', '1']) {
      process.env.SF_CONTAINER_MODE = value;
      expect(isContainerMode(), value).to.equal(true);
    }
  });

  it('rejects every other value', () => {
    for (const value of ['false', '0', 'yes', 'on', '', ' true']) {
      process.env.SF_CONTAINER_MODE = value;
      expect(isContainerMode(), JSON.stringify(value)).to.equal(false);
    }
  });

  it('reads the former SFDX_CONTAINER_MODE name too', () => {
    process.env.SFDX_CONTAINER_MODE = 'true';
    expect(isContainerMode()).to.equal(true);
  });

  it('ignores an Azure Pipelines expression left unresolved', () => {
    process.env.SF_CONTAINER_MODE = '$(SF_CONTAINER_MODE)';
    expect(isContainerMode()).to.equal(false);
  });
});
