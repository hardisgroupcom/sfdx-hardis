import { SfError } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import { getReportDirectory } from '../../config/index.js';
import { GitProvider, type PullRequestData } from '../gitProvider/index.js';
import { testFailuresToMarkdown } from '../gitProvider/utils/utilsMarkdown.js';
import { setPullRequestData } from './gitUtils.js';
import { checkSfdxPlugin, execCommand, findJsonInString, killBoringExitHandlers, uxLog } from './index.js';
import { t } from './i18n.js';

// Who runs the Apex tests of a deployment: the org (default), aer only, or aer then the org
export type ApexTestRunner = 'org' | 'aer' | 'aer+org';

export const APEX_TEST_RUNNERS: ApexTestRunner[] = ['org', 'aer', 'aer+org'];

export const AER_PLUGIN_NAME = '@octoberswimmer/aer-sf-plugin';

// Added to the deployment notification when the deployment ran no Apex test because aer ran them
// during the validation job
export const AER_DEPLOYMENT_NOTIFICATION_MESSAGE = '🧪 Apex tests ran with aer during the validation job.';

export interface AerTestRequest {
  // Whole test classes (--class-names) and single test methods (--tests). Both empty: every test
  // of the repository runs.
  classNames: string[];
  tests: string[];
}

export interface AerFailedTest {
  class: string;
  method: string;
  error: string;
  stack?: string;
}

export interface AerTestRunResult {
  // passed: every test passed. testsFailed: at least one test failed. couldNotRun: aer stopped
  // before reporting any result, for example on a parse or type error.
  outcome: 'passed' | 'testsFailed' | 'couldNotRun';
  testsRan: number;
  failing: number;
  failedTests: AerFailedTest[];
  // Coverage of the Apex code of the repository, null when it holds no Apex line
  coveragePercent: number | null;
  errorMessage?: string;
}

export interface ApexTestPlan {
  // Tests aer runs in this job, null when aer runs none
  aerTests: AerTestRequest | null;
  // Test level and test classes of the org deployment
  orgTestLevel: string;
  orgTestClasses: string;
  // aerSkipOrgValidation: the validation job sends no check-only deployment to the org
  skipOrgValidation: boolean;
}

export type AerPullRequestData = NonNullable<PullRequestData['aerTests']>;

export interface AerCoverageCheck {
  minCoverage: number;
  coverageNotBlocking: boolean;
}

export function getApexTestRunner(configInfo: any): ApexTestRunner {
  const value = process.env.APEX_TEST_RUNNER || configInfo?.apexTestRunner || 'org';
  if (!APEX_TEST_RUNNERS.includes(value)) {
    throw new SfError(t('apexTestRunnerInvalid', { value }));
  }
  return value as ApexTestRunner;
}

export function getAerSkipOrgValidation(configInfo: any): boolean {
  if (process.env.AER_SKIP_ORG_VALIDATION) {
    return process.env.AER_SKIP_ORG_VALIDATION === 'true';
  }
  return configInfo?.aerSkipOrgValidation === true;
}

/**
 * Splits the Apex tests of a deployment between aer and the org. aer only runs in validation jobs.
 * With the aer runner the org deployment runs NoTestRun, in the validation and the deployment jobs,
 * which a production org refuses: that combination throws.
 * aerSkipOrgValidation only applies with the aer runner, in a validation job where aer runs tests:
 * without them, the org validation is the only check left.
 */
export function planApexTests(options: {
  runner: ApexTestRunner;
  checkOnly: boolean;
  isProduction: boolean;
  testLevel: string;
  testClasses: string;
  skipOrgValidation?: boolean;
}): ApexTestPlan {
  const plan: ApexTestPlan = { aerTests: null, orgTestLevel: options.testLevel, orgTestClasses: options.testClasses, skipOrgValidation: false };
  if (options.runner === 'org') {
    return plan;
  }
  if (options.runner === 'aer' && options.isProduction) {
    throw new SfError(t('apexTestRunnerAerRefusedOnProduction'));
  }
  if (options.checkOnly) {
    plan.aerTests = buildAerTestRequest(options.testLevel, options.testClasses);
  }
  if (options.runner === 'aer') {
    plan.orgTestLevel = 'NoTestRun';
    plan.orgTestClasses = '';
    plan.skipOrgValidation = options.checkOnly && options.skipOrgValidation === true && plan.aerTests !== null;
  }
  return plan;
}

/**
 * aer runs the tests the org would run: the classes of RunSpecifiedTests, otherwise every test of
 * the repository. NoTestRun (for example decided by Smart Deployment Tests) runs no aer test either.
 */
export function buildAerTestRequest(testLevel: string, testClasses: string): AerTestRequest | null {
  if (testLevel === 'NoTestRun') {
    return null;
  }
  const request: AerTestRequest = { classNames: [], tests: [] };
  if (testLevel !== 'RunSpecifiedTests') {
    return request;
  }
  for (const entry of (testClasses || '').split(/[\s,]+/).filter(Boolean)) {
    // aer matches a bare name as a substring, so a class goes through --class-names, which
    // anchors it: "FooTest" must not also run "FooTestBar"
    if (entry.includes('.')) {
      request.tests.push(entry);
    } else {
      request.classNames.push(entry);
    }
  }
  return request;
}

export async function runAerTests(request: AerTestRequest, options: { debugMode: boolean; commandThis: any }): Promise<AerTestRunResult> {
  const scope = [...request.classNames, ...request.tests].join(', ') || t('aerTestsScopeAll');
  uxLog("action", options.commandThis, c.cyan('[aer] ' + t('aerTestsRunning', { scope })));
  await checkSfdxPlugin(AER_PLUGIN_NAME);
  const outputDir = path.join(await getReportDirectory(), 'aer');
  const command = buildAerTestCommand(request, outputDir);
  // output: false, because stdout is the JSON result of every test (thousands of lines): the
  // summary lines below and test-result.json in the output dir replace it
  const commandRes = await execCommand(command, options.commandThis, {
    fail: false,
    output: false,
    debug: options.debugMode,
  });
  // The plugin exits 100 when a test failed and 1 when aer could not run: execCommand then returns
  // the error, whose stdout still holds the JSON result
  const resultJson = commandRes?.error ? findJsonInString(commandRes.error.stdout || '') : commandRes;
  const errorText = `${resultJson?.message || ''}`;
  if (errorText.includes('Nonexistent flag') && errorText.includes('--install-aer')) {
    throw new SfError(t('aerPluginOutdated', { plugin: AER_PLUGIN_NAME }));
  }
  return parseAerTestRunOutput(resultJson, commandRes?.errorMessage || '');
}

export function buildAerTestCommand(request: AerTestRequest, outputDir: string): string {
  return (
    'sf aer apex run test' +
    ' --install-aer' +
    ' --code-coverage' +
    ' --result-format json' +
    ` --output-dir "${outputDir}"` +
    request.classNames.map((className) => ` --class-names ${className}`).join('') +
    request.tests.map((test) => ` --tests ${test}`).join('') +
    ' --json'
  );
}

/**
 * Reads the output of `sf aer apex run test --json`: the same result as `sf apex run test --json`
 * when aer ran the tests, an sf error document when it could not.
 */
export function parseAerTestRunOutput(resultJson: any, fallbackErrorMessage: string): AerTestRunResult {
  const summary = resultJson?.result?.summary;
  if (!summary) {
    return {
      outcome: 'couldNotRun',
      testsRan: 0,
      failing: 0,
      failedTests: [],
      coveragePercent: null,
      errorMessage: resultJson?.message || fallbackErrorMessage,
    };
  }
  const failedTests: AerFailedTest[] = (resultJson.result.tests || [])
    .filter((test: any) => test.Outcome !== 'Pass')
    .map((test: any) => {
      const failedTest: AerFailedTest = {
        class: (test.ApexClass?.NamespacePrefix ? test.ApexClass.NamespacePrefix + '.' : '') + test.ApexClass?.Name,
        method: test.MethodName,
        error: test.Message || '',
      };
      if (test.StackTrace) {
        failedTest.stack = test.StackTrace;
      }
      return failedTest;
    });
  const coverageSummary = resultJson.result.coverage?.summary;
  const totalLines = Number(coverageSummary?.totalLines || 0);
  const coveredLines = Number(coverageSummary?.coveredLines || 0);
  return {
    outcome: failedTests.length > 0 ? 'testsFailed' : 'passed',
    testsRan: Number(summary.testsRan || 0),
    failing: failedTests.length,
    failedTests,
    coveragePercent: totalLines > 0 ? Math.round((coveredLines * 10000) / totalLines) / 100 : null,
  };
}

/**
 * Records the aer result for the Pull Request comment and stops the job when the tests failed,
 * could not run, or do not reach the coverage target. The comment is posted before stopping,
 * because no later step of the job posts it.
 */
export async function applyAerTestRunResult(
  result: AerTestRunResult,
  request: AerTestRequest,
  options: { check: boolean; replacesOrgTests: boolean; coverage: AerCoverageCheck; commandThis: any }
): Promise<void> {
  const commandThis = options.commandThis;
  const aerTests: AerPullRequestData = {
    outcome: result.outcome,
    testsRan: result.testsRan,
    failing: result.failing,
    replacesOrgTests: options.replacesOrgTests,
  };
  const testClasses = [...request.classNames, ...request.tests];
  // The org deployment of the aer runner runs no test: the classes aer ran are the ones to list
  const testClassesData = testClasses.length > 0 && options.replacesOrgTests ? { testClasses } : {};
  if (result.outcome === 'couldNotRun') {
    uxLog("error", commandThis, c.red('[aer] ' + t('aerTestsCouldNotRun', { message: result.errorMessage || '' })));
    await failWithAerResult(
      {
        aerTests,
        deployErrorsMarkdownBody: aerCouldNotRunToMarkdown(result.errorMessage || ''),
      },
      options.check,
      t('aerTestsCouldNotRun', { message: result.errorMessage || '' })
    );
  }
  if (result.outcome === 'testsFailed') {
    uxLog("error", commandThis, c.red('[aer] ' + t('aerTestsFailed', { count: result.testsRan, failed: result.failing })));
    for (const failedTest of result.failedTests) {
      uxLog("error", commandThis, c.red(`- ${failedTest.class}.${failedTest.method}: ${failedTest.error}`));
    }
    await failWithAerResult(
      {
        aerTests,
        ...testClassesData,
        // Read by the run summary of the comment, like the org test failures
        failedTestsCount: result.failing,
        deployErrorsMarkdownBody: testFailuresToMarkdown(result.failedTests).replace(/^## .*\n/, '## Apex test failures in aer\n'),
      },
      options.check,
      t('aerTestsFailed', { count: result.testsRan, failed: result.failing })
    );
  }
  uxLog("success", commandThis, c.green('[aer] ' + t('aerTestsPassed', { count: result.testsRan })));
  if (result.coveragePercent === null) {
    setPullRequestData({ aerTests, ...testClassesData });
    return;
  }
  const coverageArgs = { coverage: result.coveragePercent, target: options.coverage.minCoverage };
  const coverage = (status: 'valid' | 'invalid' | 'invalid_ignored') => ({ value: result.coveragePercent as number, target: options.coverage.minCoverage, status });
  if (result.coveragePercent >= options.coverage.minCoverage) {
    uxLog("success", commandThis, c.green('[aer] ' + t('aerCoverageValid', coverageArgs)));
    setPullRequestData({ aerTests: { ...aerTests, coverage: coverage('valid') }, ...testClassesData });
    return;
  }
  if (options.coverage.coverageNotBlocking) {
    uxLog("warning", commandThis, c.yellow('[aer] ' + t('aerCoverageInsufficient', coverageArgs)));
    setPullRequestData({ aerTests: { ...aerTests, coverage: coverage('invalid_ignored') }, ...testClassesData });
    return;
  }
  uxLog("error", commandThis, c.red('[aer] ' + t('aerCoverageInsufficient', coverageArgs)));
  await failWithAerResult(
    { aerTests: { ...aerTests, coverage: coverage('invalid') }, ...testClassesData },
    options.check,
    t('aerCoverageInsufficient', coverageArgs)
  );
}

// With apexTestRunner aer, the validation job ran with NoTestRun, and Salesforce quick deploys only
// validations that ran Apex tests: the deployment job deploys with NoTestRun instead of trying
export function aerPreventsQuickDeploy(check: boolean, runner: ApexTestRunner | undefined): boolean {
  return !check && runner === 'aer';
}

function aerCouldNotRunToMarkdown(errorMessage: string): string {
  return [
    '## aer could not run the Apex tests',
    '',
    'aer stopped before running the tests, for example because of a parse or type error. Fix the source.',
    ...(errorMessage.trim() ? ['', '```', errorMessage.trim(), '```'] : []),
  ].join('\n');
}

async function failWithAerResult(prData: Record<string, any>, check: boolean, errorMessage: string): Promise<never> {
  setPullRequestData({
    messageKey: 'deployment',
    title: check ? '❌ Deployment check failure' : '❌ Deployment failure',
    status: 'invalid',
    deployStatus: 'invalid',
    ...prData,
  });
  await GitProvider.managePostPullRequestComment(check);
  killBoringExitHandlers();
  throw new SfError(errorMessage);
}
