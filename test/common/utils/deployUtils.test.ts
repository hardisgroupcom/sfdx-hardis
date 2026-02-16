import { expect } from 'chai';
import { TestContext } from '@salesforce/core/testSetup';
import { isDeployCheckCoverageOnlyFailure } from '../../../src/common/utils/deployUtils.js';

describe('Deploy Utils - Coverage not blocking', () => {
  const $$ = new TestContext();
  const silentCommandThis = { ux: { log: () => null } };

  afterEach(() => {
    $$.restore();
  });

  it('Returns false when deploy-check has test errors (example payload)', () => {
    const jsonResult = {
      status: 1,
      result: {
        checkOnly: true,
        details: {
          componentSuccesses: [{ fullName: 'ApexClass.Foo', type: 'ApexClass' }],
          componentFailures: [],
        },
        done: true,
        id: '0AfG500000PCMG6KAP',
        ignoreWarnings: true,
        numberComponentErrors: 0,
        numberComponentsDeployed: 8050,
        numberComponentsTotal: 8050,
        numberFiles: '4205',
        numberTestErrors: 1,
        numberTestsCompleted: 967,
        numberTestsTotal: 968,
        rollbackOnError: true,
        runTestsEnabled: true,
        status: 'Failed',
        success: false,
        warnings: ["GlobalValueSet, Produit__gvs, returned from org, but not found in the local project"],
        truncatedBySfdxHardis: 'Result truncated by sfdx-hardis. Define NO_TRUNCATE_LOGS=true to have full JSON logs',
      },
    };

    expect(isDeployCheckCoverageOnlyFailure(jsonResult, silentCommandThis)).to.equal(false);
  });

  it('Does not ignore failures when there are component failures', () => {
    const jsonResult = {
      status: 1,
      result: {
        checkOnly: true,
        numberComponentErrors: 1,
        numberTestErrors: 1,
        numberTestsCompleted: 0,
        numberTestsTotal: 1,
        details: {
          componentFailures: [{ fullName: 'SomeMetadata', type: 'CustomObject', problem: 'Boom' }],
        },
      },
    };

    expect(isDeployCheckCoverageOnlyFailure(jsonResult, silentCommandThis)).to.equal(false);
  });

  it('Returns true when there are no test errors and counters are consistent', () => {
    const jsonResult = {
      status: 1,
      result: {
        checkOnly: true,
        numberComponentErrors: 0,
        numberTestErrors: 0,
        numberTestsCompleted: 1,
        numberTestsTotal: 1,
        details: {
          componentFailures: [],
        },
      },
    };

    expect(isDeployCheckCoverageOnlyFailure(jsonResult, silentCommandThis)).to.equal(true);
  });

  it('Does not ignore when test counters are inconsistent', () => {
    const jsonResult = {
      status: 1,
      result: {
        checkOnly: true,
        numberComponentErrors: 0,
        numberTestErrors: 2,
        numberTestsCompleted: 967,
        numberTestsTotal: 968,
        details: {
          componentFailures: [],
        },
      },
    };

    expect(isDeployCheckCoverageOnlyFailure(jsonResult, silentCommandThis)).to.equal(false);
  });
});
