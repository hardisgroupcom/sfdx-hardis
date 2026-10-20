import { expect } from 'chai';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import {
  aerPreventsQuickDeploy,
  applyAerTestRunResult,
  getAerSkipOrgValidation,
  buildAerTestCommand,
  buildAerTestRequest,
  getApexTestRunner,
  parseAerTestRunOutput,
  planApexTests,
  type AerTestRequest,
} from '../../../src/common/utils/aerUtils.js';
import { getApexTestsMinCoverage } from '../../../src/common/utils/deployUtils.js';

// Output of `sf aer apex run test --code-coverage --json` (aer-sf-plugin 0.0.9) on a project with
// one passing and one failing test
const failedRunOutput = {
  status: 100,
  result: {
    summary: {
      outcome: 'Failed',
      testsRan: 2,
      passing: 1,
      failing: 1,
      skipped: 0,
      passRate: '50%',
      failRate: '50%',
      testRunCoverage: '75%',
    },
    tests: [
      {
        StackTrace: null,
        Message: null,
        MethodName: 'adds',
        Outcome: 'Pass',
        ApexClass: { Id: '', Name: 'FooTest', NamespacePrefix: null },
        FullName: 'FooTest.adds',
      },
      {
        StackTrace: 'Class.FooTest.fails: line 9, column 1 (FooTest.cls)',
        Message: 'AssertException: FooTest.cls:9: Assertion Failed: boom: Expected: 4, Actual: 3',
        MethodName: 'fails',
        Outcome: 'Fail',
        ApexClass: { Id: '', Name: 'FooTest', NamespacePrefix: null },
        FullName: 'FooTest.fails',
      },
    ],
    coverage: {
      coverage: [],
      records: [],
      summary: { totalLines: 4, coveredLines: 3, testRunCoverage: '75%' },
    },
  },
};

const passedRunOutput = {
  status: 0,
  result: {
    summary: { outcome: 'Passed', testsRan: 1, passing: 1, failing: 0, skipped: 0 },
    tests: [
      {
        StackTrace: null,
        Message: null,
        MethodName: 'adds',
        Outcome: 'Pass',
        ApexClass: { Id: '', Name: 'FooTest', NamespacePrefix: 'myns' },
        FullName: 'myns.FooTest.adds',
      },
    ],
    coverage: {
      coverage: [],
      records: [],
      summary: { totalLines: 3, coveredLines: 2, testRunCoverage: '67%' },
    },
  },
};

// Output of the plugin when aer could not parse the source
const couldNotRunOutput = {
  name: 'AerDidNotRunError',
  message:
    'aer exited with status 1 without reporting a test failure, so it could not run the tests.\nBroken.cls:2:31 mismatched input \';\'',
  status: 1,
};

const allTests: AerTestRequest = { classNames: [], tests: [] };

describe('aerUtils - getApexTestRunner', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.APEX_TEST_RUNNER;
    delete process.env.APEX_TEST_RUNNER;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.APEX_TEST_RUNNER;
    } else {
      process.env.APEX_TEST_RUNNER = savedEnv;
    }
  });

  it('defaults to the org', () => {
    expect(getApexTestRunner({})).to.equal('org');
    expect(getApexTestRunner(null)).to.equal('org');
  });

  it('reads apexTestRunner from the config', () => {
    expect(getApexTestRunner({ apexTestRunner: 'aer' })).to.equal('aer');
    expect(getApexTestRunner({ apexTestRunner: 'aer+org' })).to.equal('aer+org');
  });

  it('lets APEX_TEST_RUNNER override the config', () => {
    process.env.APEX_TEST_RUNNER = 'aer+org';
    expect(getApexTestRunner({ apexTestRunner: 'aer' })).to.equal('aer+org');
  });

  it('refuses an unknown runner', () => {
    expect(() => getApexTestRunner({ apexTestRunner: 'aerorg' })).to.throw(/aerorg/);
  });
});

describe('aerUtils - planApexTests', () => {
  const base = {
    checkOnly: true,
    isProduction: false,
    testLevel: 'RunSpecifiedTests',
    testClasses: 'FooTest',
  };
  const fooTest: AerTestRequest = { classNames: ['FooTest'], tests: [] };

  it('leaves the org test level unchanged and runs no aer test with the org runner', () => {
    expect(planApexTests({ ...base, runner: 'org' })).to.deep.equal({
      aerTests: null,
      orgTestLevel: 'RunSpecifiedTests',
      orgTestClasses: 'FooTest',
      skipOrgValidation: false,
    });
  });

  it('runs the tests in aer and none in the org with the aer runner', () => {
    expect(planApexTests({ ...base, runner: 'aer' })).to.deep.equal({
      aerTests: fooTest,
      orgTestLevel: 'NoTestRun',
      orgTestClasses: '',
      skipOrgValidation: false,
    });
  });

  it('runs the tests in aer then in the org with the aer+org runner', () => {
    expect(planApexTests({ ...base, runner: 'aer+org', isProduction: true })).to.deep.equal({
      aerTests: fooTest,
      orgTestLevel: 'RunSpecifiedTests',
      orgTestClasses: 'FooTest',
      skipOrgValidation: false,
    });
  });

  it('runs no aer test in the deployment job, which still deploys with NoTestRun for the aer runner', () => {
    expect(planApexTests({ ...base, runner: 'aer', checkOnly: false })).to.deep.equal({
      aerTests: null,
      orgTestLevel: 'NoTestRun',
      orgTestClasses: '',
      skipOrgValidation: false,
    });
  });

  it('refuses the aer runner when the target org is a production org', () => {
    expect(() => planApexTests({ ...base, runner: 'aer', isProduction: true })).to.throw(/aer\+org/);
  });

  it('skips the org validation with aerSkipOrgValidation when aer runs the tests of the validation', () => {
    expect(planApexTests({ ...base, runner: 'aer', skipOrgValidation: true }).skipOrgValidation).to.equal(true);
  });

  it('keeps the org validation when aer runs no test, the aer+org runner or the deployment job', () => {
    expect(planApexTests({ ...base, runner: 'aer', skipOrgValidation: true, testLevel: 'NoTestRun' }).skipOrgValidation).to.equal(false);
    expect(planApexTests({ ...base, runner: 'aer+org', skipOrgValidation: true }).skipOrgValidation).to.equal(false);
    expect(planApexTests({ ...base, runner: 'aer', skipOrgValidation: true, checkOnly: false }).skipOrgValidation).to.equal(false);
  });
});

describe('aerUtils - buildAerTestRequest', () => {
  it('runs no aer test when the test level is NoTestRun', () => {
    expect(buildAerTestRequest('NoTestRun', 'FooTest')).to.equal(null);
  });

  it('runs every test of the repository for the other test levels', () => {
    for (const testLevel of ['RunLocalTests', 'RunRelevantTests', 'RunAllTestsInOrg']) {
      expect(buildAerTestRequest(testLevel, 'FooTest')).to.deep.equal(allTests);
    }
  });

  it('runs the classes and methods of RunSpecifiedTests', () => {
    expect(buildAerTestRequest('RunSpecifiedTests', 'FooTest BarTest.adds,BazTest')).to.deep.equal({
      classNames: ['FooTest', 'BazTest'],
      tests: ['BarTest.adds'],
    });
  });
});

describe('aerUtils - buildAerTestCommand', () => {
  it('asks the plugin for a JSON result with coverage, downloading aer when needed', () => {
    expect(buildAerTestCommand(allTests, '/tmp/report/aer')).to.equal(
      'sf aer apex run test --install-aer --code-coverage --result-format json --output-dir "/tmp/report/aer" --json'
    );
  });

  it('passes the selected classes and methods', () => {
    const command = buildAerTestCommand({ classNames: ['FooTest'], tests: ['BarTest.adds'] }, '/out');
    expect(command).to.contain(' --class-names FooTest');
    expect(command).to.contain(' --tests BarTest.adds');
    expect(command.endsWith(' --json')).to.equal(true);
  });
});

describe('aerUtils - parseAerTestRunOutput', () => {
  it('reports the failed tests of a run with failures', () => {
    expect(parseAerTestRunOutput(failedRunOutput, '')).to.deep.equal({
      outcome: 'testsFailed',
      testsRan: 2,
      failing: 1,
      failedTests: [
        {
          class: 'FooTest',
          method: 'fails',
          error: 'AssertException: FooTest.cls:9: Assertion Failed: boom: Expected: 4, Actual: 3',
          stack: 'Class.FooTest.fails: line 9, column 1 (FooTest.cls)',
        },
      ],
      coveragePercent: 75,
    });
  });

  it('computes the coverage from the covered lines, with two decimals', () => {
    const result = parseAerTestRunOutput(passedRunOutput, '');
    expect(result.outcome).to.equal('passed');
    expect(result.testsRan).to.equal(1);
    expect(result.coveragePercent).to.equal(66.67);
  });

  it('reports no coverage when the repository holds no Apex line', () => {
    const output = { result: { summary: { testsRan: 0 }, tests: [], coverage: { summary: { totalLines: 0, coveredLines: 0 } } } };
    expect(parseAerTestRunOutput(output, '').coveragePercent).to.equal(null);
  });

  it('reports that aer could not run when the plugin returned an error', () => {
    const result = parseAerTestRunOutput(couldNotRunOutput, 'fallback');
    expect(result.outcome).to.equal('couldNotRun');
    expect(result.errorMessage).to.contain('mismatched input');
  });

  it('uses the command error when the plugin printed no JSON', () => {
    const result = parseAerTestRunOutput(null, 'sf: command not found');
    expect(result.outcome).to.equal('couldNotRun');
    expect(result.errorMessage).to.equal('sf: command not found');
  });
});

describe('aerUtils - getApexTestsMinCoverage', () => {
  const coverageVars = ['APEX_TESTS_MIN_COVERAGE_ORG_WIDE', 'APEX_TESTS_MIN_COVERAGE'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of coverageVars) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of coverageVars) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  });

  it('defaults to 75%', () => {
    expect(getApexTestsMinCoverage({}, 'code coverage')).to.equal(75);
  });

  it('reads the org wide setting before the generic one', () => {
    expect(getApexTestsMinCoverage({ apexTestsMinCoverageOrgWide: 85, apexTestsMinCoverage: 80 }, 'code coverage')).to.equal(85);
  });

  it('refuses a target under 75%', () => {
    expect(() => getApexTestsMinCoverage({ apexTestsMinCoverage: 50 }, 'code coverage')).to.throw(/can't be less than 75%/);
  });
});

describe('aerUtils - applyAerTestRunResult', () => {
  const providerVars = [
    'SYSTEM_ACCESSTOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'AZURE_DEVOPS_EXT_PAT',
    'CI_JOB_TOKEN', 'CI_SFDX_HARDIS_GITLAB_TOKEN',
    'GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN',
    'BITBUCKET_WORKSPACE', 'CI_SFDX_HARDIS_BITBUCKET_TOKEN',
  ];
  const saved: Record<string, string | undefined> = {};
  const commandThis = null;
  const coverage = { minCoverage: 75, coverageNotBlocking: false };

  before(() => {
    for (const name of providerVars) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    GitProvider.resetInstance();
  });

  after(() => {
    for (const name of providerVars) {
      if (saved[name] !== undefined) {
        process.env[name] = saved[name];
      }
    }
    GitProvider.resetInstance();
  });

  beforeEach(() => {
    globalThis.pullRequestData = undefined;
  });

  async function applyAndCatch(output: any, coverageCheck = coverage, request: AerTestRequest = allTests, replacesOrgTests = false): Promise<any> {
    try {
      await applyAerTestRunResult(parseAerTestRunOutput(output, ''), request, { check: true, replacesOrgTests, coverage: coverageCheck, commandThis });
    } catch (e) {
      return e;
    }
    return null;
  }

  it('records the aer section and continues when the tests pass and the coverage is reached', async () => {
    const output = { ...passedRunOutput, result: { ...passedRunOutput.result, coverage: { summary: { totalLines: 4, coveredLines: 4 } } } };
    expect(await applyAndCatch(output)).to.equal(null);
    expect(globalThis.pullRequestData?.aerTests).to.deep.equal({
      outcome: 'passed',
      testsRan: 1,
      failing: 0,
      replacesOrgTests: false,
      coverage: { value: 100, target: 75, status: 'valid' },
    });
    expect(globalThis.pullRequestData?.status).to.equal(undefined);
    expect(globalThis.pullRequestData?.testClasses).to.equal(undefined);
  });

  it('lists the classes aer ran when the org runs no test (aer runner)', async () => {
    const output = { ...passedRunOutput, result: { ...passedRunOutput.result, coverage: { summary: { totalLines: 4, coveredLines: 4 } } } };
    const request: AerTestRequest = { classNames: ['FooTest'], tests: ['BarTest.adds'] };
    expect(await applyAndCatch(output, coverage, request, true)).to.equal(null);
    expect(globalThis.pullRequestData?.aerTests?.replacesOrgTests).to.equal(true);
    expect(globalThis.pullRequestData?.testClasses).to.deep.equal(['FooTest', 'BarTest.adds']);
  });

  it('stops the job and marks the Pull Request invalid when a test fails', async () => {
    const error = await applyAndCatch(failedRunOutput);
    expect(error?.message).to.contain('1');
    expect(globalThis.pullRequestData?.status).to.equal('invalid');
    expect(globalThis.pullRequestData?.failedTestsCount).to.equal(1);
    expect(globalThis.pullRequestData?.aerTests?.outcome).to.equal('testsFailed');
    expect(globalThis.pullRequestData?.deployErrorsMarkdownBody).to.match(/^## Apex test failures in aer\n/);
    expect(globalThis.pullRequestData?.deployErrorsMarkdownBody).to.contain('FooTest.fails');
  });

  it('stops the job when aer could not run the tests', async () => {
    const error = await applyAndCatch(couldNotRunOutput);
    expect(error).to.not.equal(null);
    expect(globalThis.pullRequestData?.status).to.equal('invalid');
    expect(globalThis.pullRequestData?.aerTests?.outcome).to.equal('couldNotRun');
    expect(globalThis.pullRequestData?.deployErrorsMarkdownBody).to.match(/^## aer could not run the Apex tests\n/);
    expect(globalThis.pullRequestData?.deployErrorsMarkdownBody).to.contain('mismatched input');
  });

  it('stops the job when the coverage is under the target', async () => {
    const error = await applyAndCatch(passedRunOutput);
    expect(error).to.not.equal(null);
    expect(globalThis.pullRequestData?.status).to.equal('invalid');
    expect(globalThis.pullRequestData?.aerTests?.coverage).to.deep.equal({ value: 66.67, target: 75, status: 'invalid' });
  });

  it('continues when the coverage is under the target and testCoverageNotBlocking is set', async () => {
    const error = await applyAndCatch(passedRunOutput, { minCoverage: 75, coverageNotBlocking: true });
    expect(error).to.equal(null);
    expect(globalThis.pullRequestData?.status).to.equal(undefined);
    expect(globalThis.pullRequestData?.aerTests?.coverage?.status).to.equal('invalid_ignored');
  });
});

describe('aerUtils - aerPreventsQuickDeploy', () => {
  it('skips Quick Deploy in the deployment job when aer replaced the org tests of the validation', () => {
    expect(aerPreventsQuickDeploy(false, 'aer')).to.equal(true);
  });

  it('keeps Quick Deploy when the org ran the tests of the validation', () => {
    expect(aerPreventsQuickDeploy(false, 'aer+org')).to.equal(false);
    expect(aerPreventsQuickDeploy(false, 'org')).to.equal(false);
    expect(aerPreventsQuickDeploy(false, undefined)).to.equal(false);
  });

  it('never applies to the validation job', () => {
    expect(aerPreventsQuickDeploy(true, 'aer')).to.equal(false);
  });
});

describe('aerUtils - getAerSkipOrgValidation', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.AER_SKIP_ORG_VALIDATION;
    delete process.env.AER_SKIP_ORG_VALIDATION;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.AER_SKIP_ORG_VALIDATION;
    } else {
      process.env.AER_SKIP_ORG_VALIDATION = saved;
    }
  });

  it('reads aerSkipOrgValidation from the config, false by default', () => {
    expect(getAerSkipOrgValidation({ aerSkipOrgValidation: true })).to.equal(true);
    expect(getAerSkipOrgValidation({})).to.equal(false);
  });

  it('lets AER_SKIP_ORG_VALIDATION override the config', () => {
    process.env.AER_SKIP_ORG_VALIDATION = 'false';
    expect(getAerSkipOrgValidation({ aerSkipOrgValidation: true })).to.equal(false);
    process.env.AER_SKIP_ORG_VALIDATION = 'true';
    expect(getAerSkipOrgValidation({})).to.equal(true);
  });
});
