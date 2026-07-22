import c from 'chalk';
import { execCommand, uxLog } from './index.js';
import { getEnvVar } from '../../config/index.js';
import { t } from './i18n.js';

// One assertion (expectation) result inside an agent test case, e.g. topic_assertion / actions_assertion / output_validation.
export interface AgentTestAssertionResult {
  Definition: string;
  TestCaseNumber: string | number;
  Utterance: string;
  Expectation: string;
  Result: 'PASS' | 'FAILURE';
  Score: number | string;
  ExpectedValue: string;
  ActualValue: string;
}

// An AiEvaluationDefinition available in the org (output of `sf agent test list`).
export interface AgentTestDefinition {
  apiName: string;
  id?: string;
  type?: string;
}

// Aggregated result of running a single agent test definition.
export interface AgentTestRunSummary {
  definition: string;
  runStatus: string;
  outcome: 'Passed' | 'Failed' | 'Error';
  totalCases: number;
  passedCases: number;
  failedCases: number;
  totalAssertions: number;
  failedAssertions: number;
  assertions: AgentTestAssertionResult[];
  failures: AgentTestAssertionResult[];
  parseError?: boolean;
  rawError?: string;
}

// Sentinel thrown when the @salesforce/plugin-agent CLI plugin is not installed.
export class AgentPluginMissingError extends Error { }

// Run statuses that indicate the agent test completed and its results can be trusted.
const COMPLETED_RUN_STATUSES = ['COMPLETED', 'COMPLETE'];

function isPluginMissing(rawError: string): boolean {
  const lower = (rawError || '').toLowerCase();
  return (
    lower.includes('is not a sf command') ||
    lower.includes('is not a valid command') ||
    lower.includes('command agent:test:list not found') ||
    lower.includes('command agent:test:run not found') ||
    (lower.includes('agent') && lower.includes('not found') && lower.includes('command'))
  );
}

// List all agent test definitions (AiEvaluationDefinition) available in the org.
export async function listAgentTestDefinitions(
  orgUsername: string | null,
  commandThis: any,
  debugMode = false
): Promise<AgentTestDefinition[]> {
  const listCommand = 'sf agent test list' + (orgUsername ? ` --target-org ${orgUsername}` : '') + ' --json';
  const listRes = await execCommand(listCommand, commandThis, { fail: false, output: false, debug: debugMode });
  if (listRes.status !== 0) {
    const rawError = listRes.errorMessage || (listRes.error as Error)?.message || JSON.stringify(listRes);
    if (isPluginMissing(rawError)) {
      throw new AgentPluginMissingError(t('agentTestPluginMissing'));
    }
    throw new Error(rawError);
  }
  const records = Array.isArray(listRes.result) ? listRes.result : [];
  return records
    .map((rec: any) => ({
      apiName: rec.fullName || rec.name || rec.apiName,
      id: rec.id,
      type: rec.type,
    }))
    .filter((def: AgentTestDefinition) => !!def.apiName);
}

// Get the number of minutes to wait for an agent test run (shared with apex tests via SFDX_TEST_WAIT_MINUTES).
export function getAgentTestWaitMinutes(): string {
  return getEnvVar('SFDX_TEST_WAIT_MINUTES') || '60';
}

// Run a single agent test definition and aggregate its results.
export async function runAgentTest(
  apiName: string,
  orgUsername: string | null,
  commandThis: any,
  debugMode = false
): Promise<AgentTestRunSummary> {
  uxLog('action', commandThis, c.cyan(t('runningAgentTestDefinition', { definition: apiName })));
  const runCommand =
    'sf agent test run' +
    ` --api-name ${apiName}` +
    ` --wait ${getAgentTestWaitMinutes()}` +
    (orgUsername ? ` --target-org ${orgUsername}` : '') +
    ' --json';
  const runRes = await execCommand(runCommand, commandThis, { fail: false, output: false, debug: debugMode });
  if (runRes.status !== 0) {
    const rawError = runRes.errorMessage || (runRes.error as Error)?.message || JSON.stringify(runRes);
    if (isPluginMissing(rawError)) {
      throw new AgentPluginMissingError(t('agentTestPluginMissing'));
    }
    return buildErrorSummary(apiName, rawError);
  }
  return parseAgentTestRunResult(runRes.result, apiName);
}

// Pure parser for the `result` object returned by `sf agent test run --json`. Kept separate so it is unit-testable.
export function parseAgentTestRunResult(result: any, apiName: string): AgentTestRunSummary {
  const definition = result?.subjectName || apiName;
  const runStatus = String(result?.status || 'UNKNOWN');
  const testCases = Array.isArray(result?.testCases) ? result.testCases : null;
  if (!testCases) {
    return buildErrorSummary(definition, JSON.stringify(result || {}));
  }
  const assertions: AgentTestAssertionResult[] = [];
  let passedCases = 0;
  let failedCases = 0;
  for (const testCase of testCases) {
    const utterance = testCase?.inputs?.utterance || '';
    const testResults = Array.isArray(testCase?.testResults) ? testCase.testResults : [];
    let caseHasFailure = testResults.length === 0;
    for (const testResult of testResults) {
      const passed = String(testResult?.result || '').toUpperCase() === 'PASS';
      if (!passed) {
        caseHasFailure = true;
      }
      assertions.push({
        Definition: definition,
        TestCaseNumber: testCase?.testNumber ?? '',
        Utterance: utterance,
        Expectation: testResult?.name || testResult?.metricLabel || '',
        Result: passed ? 'PASS' : 'FAILURE',
        Score: testResult?.score ?? '',
        ExpectedValue: testResult?.expectedValue ?? '',
        ActualValue: testResult?.actualValue ?? '',
      });
    }
    if (caseHasFailure) {
      failedCases++;
    } else {
      passedCases++;
    }
  }
  const failures = assertions.filter((a) => a.Result !== 'PASS');
  const runCompleted = COMPLETED_RUN_STATUSES.includes(runStatus.toUpperCase());
  let outcome: AgentTestRunSummary['outcome'];
  if (!runCompleted) {
    outcome = 'Error';
  } else if (failedCases > 0) {
    outcome = 'Failed';
  } else {
    outcome = 'Passed';
  }
  return {
    definition,
    runStatus,
    outcome,
    totalCases: testCases.length,
    passedCases,
    failedCases,
    totalAssertions: assertions.length,
    failedAssertions: failures.length,
    assertions,
    failures,
  };
}

function buildErrorSummary(definition: string, rawError: string): AgentTestRunSummary {
  return {
    definition,
    runStatus: 'ERROR',
    outcome: 'Error',
    totalCases: 0,
    passedCases: 0,
    failedCases: 0,
    totalAssertions: 0,
    failedAssertions: 0,
    assertions: [],
    failures: [],
    parseError: true,
    rawError,
  };
}
