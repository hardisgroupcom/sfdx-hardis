import { strict as assert } from 'assert';
import { parseAgentTestRunResult } from '../src/common/utils/agentTestUtils.js';

// Minimal shape mirroring `sf agent test run --json` -> result
function buildResult(testCases: any[], status = 'COMPLETED') {
  return { status, subjectName: 'My_Agent_Eval', testCases };
}

const passingCase = {
  testNumber: 1,
  status: 'COMPLETED',
  inputs: { utterance: 'Refer Helios to Germany' },
  testResults: [
    { name: 'topic_assertion', result: 'PASS', score: 1, expectedValue: 'topic_selector', actualValue: 'topic_selector' },
    { name: 'output_validation', result: 'PASS', score: 5, expectedValue: 'ok', actualValue: 'ok' },
  ],
};

const failingCase = {
  testNumber: 2,
  status: 'COMPLETED',
  inputs: { utterance: 'What is the capital of France?' },
  testResults: [
    { name: 'topic_assertion', result: 'PASS', score: 1, expectedValue: 'off_topic', actualValue: 'off_topic' },
    { name: 'output_validation', result: 'FAILURE', score: 0, expectedValue: 'redirect', actualValue: 'Paris' },
  ],
};

describe('parseAgentTestRunResult', () => {
  it('marks a run with only passing assertions as Passed', () => {
    const summary = parseAgentTestRunResult(buildResult([passingCase]), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Passed');
    assert.equal(summary.totalCases, 1);
    assert.equal(summary.passedCases, 1);
    assert.equal(summary.failedCases, 0);
    assert.equal(summary.totalAssertions, 2);
    assert.equal(summary.failedAssertions, 0);
    assert.equal(summary.failures.length, 0);
    assert.equal(summary.definition, 'My_Agent_Eval');
  });

  it('fails the whole test case when any of its assertions is FAILURE', () => {
    const summary = parseAgentTestRunResult(buildResult([passingCase, failingCase]), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Failed');
    assert.equal(summary.totalCases, 2);
    assert.equal(summary.passedCases, 1);
    assert.equal(summary.failedCases, 1);
    assert.equal(summary.totalAssertions, 4);
    assert.equal(summary.failedAssertions, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].Expectation, 'output_validation');
    assert.equal(summary.failures[0].ActualValue, 'Paris');
  });

  it('treats a non-completed run status as an Error even when assertions pass', () => {
    const summary = parseAgentTestRunResult(buildResult([passingCase], 'TERMINATED'), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Error');
  });

  it('reports a parse error when testCases are missing', () => {
    const summary = parseAgentTestRunResult({ status: 'COMPLETED' }, 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Error');
    assert.equal(summary.parseError, true);
  });

  it('counts a test case with no assertions as a failure', () => {
    const emptyCase = { testNumber: 3, status: 'COMPLETED', inputs: { utterance: 'hi' }, testResults: [] };
    const summary = parseAgentTestRunResult(buildResult([emptyCase]), 'My_Agent_Eval');
    assert.equal(summary.failedCases, 1);
    assert.equal(summary.outcome, 'Failed');
  });

  it('does not fail a test case on output latency, which has no result', () => {
    const latencyCase = buildCaseWithMetric({
      name: 'output_latency_milliseconds',
      metricLabel: 'output_latency_milliseconds',
      score: 3200,
      status: 'COMPLETED',
      errorCode: 0,
      metricExplainability: '',
      actualValue: '',
      expectedValue: '',
    });
    const summary = parseAgentTestRunResult(buildResult([latencyCase]), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Passed');
    assert.equal(summary.failedCases, 0);
    assert.equal(summary.failedAssertions, 0);
    const latency = summary.assertions.find((a) => a.Expectation === 'output_latency_milliseconds');
    assert.equal(latency?.Result, 'INFO');
    assert.equal(latency?.SalesforceResult, '');
    assert.equal(latency?.Score, 3200);
  });

  it('passes instruction adherence rated HIGH and keeps the Salesforce result and explanation', () => {
    const highCase = buildCaseWithMetric(instructionAdherence('HIGH'));
    const summary = parseAgentTestRunResult(buildResult([highCase]), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Passed');
    assert.equal(summary.passedCases, 1);
    const adherence = summary.assertions.find((a) => a.Expectation === 'instruction_adherence');
    assert.equal(adherence?.Result, 'PASS');
    assert.equal(adherence?.SalesforceResult, 'HIGH');
    assert.equal(adherence?.Status, 'COMPLETED');
    assert.equal(adherence?.Explanation, 'This response adheres to the assigned instructions.');
  });

  it('fails a test case on instruction adherence rated LOW', () => {
    const lowCase = buildCaseWithMetric(instructionAdherence('LOW'));
    const summary = parseAgentTestRunResult(buildResult([lowCase]), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Failed');
    assert.equal(summary.failedCases, 1);
    assert.equal(summary.failedAssertions, 1);
    assert.equal(summary.failures[0].Expectation, 'instruction_adherence');
    assert.equal(summary.failures[0].SalesforceResult, 'LOW');
  });

  it('reports instruction adherence rated UNCERTAIN as a warning without failing the test case', () => {
    const uncertainCase = buildCaseWithMetric(instructionAdherence('UNCERTAIN'));
    const summary = parseAgentTestRunResult(buildResult([uncertainCase]), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Passed');
    assert.equal(summary.failedAssertions, 0);
    const adherence = summary.assertions.find((a) => a.Expectation === 'instruction_adherence');
    assert.equal(adherence?.Result, 'WARNING');
  });

  it('fails a test case when the evaluation of an assertion ended in error', () => {
    const errorCase = buildCaseWithMetric({
      name: 'completeness',
      metricLabel: 'completeness',
      status: 'ERROR',
      errorCode: 500,
      errorMessage: 'Evaluation timed out',
    });
    const summary = parseAgentTestRunResult(buildResult([errorCase]), 'My_Agent_Eval');
    assert.equal(summary.outcome, 'Failed');
    assert.equal(summary.failures[0].Expectation, 'completeness');
    assert.equal(summary.failures[0].ErrorMessage, 'Evaluation timed out');
  });
});

// Passing test case with one extra metric assertion, as returned by `sf agent test run --json`
function buildCaseWithMetric(metric: any) {
  return { ...passingCase, testResults: [...passingCase.testResults, metric] };
}

function instructionAdherence(result: string) {
  return {
    name: 'instruction_adherence',
    metricLabel: 'instruction_adherence',
    result,
    status: 'COMPLETED',
    errorCode: 0,
    metricExplainability: 'This response adheres to the assigned instructions.',
    actualValue: '',
    expectedValue: '',
  };
}
