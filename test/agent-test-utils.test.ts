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
});
