import c from 'chalk';
import { Connection } from '@salesforce/core';
import { execCommand, uxLog } from './index.js';
import { t } from './i18n.js';

// Errors raised by Node fetch / sockets when the connection with the org is lost for a moment
const TRANSIENT_NETWORK_ERROR_PATTERNS = [
  'fetch failed',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_',
  'socket hang up',
  'network timeout',
];

const APEX_TEST_RUN_FINAL_STATUSES = ['Completed', 'Failed', 'Aborted'];
const POLL_INTERVAL_SECONDS = 30;
const MAX_CONSECUTIVE_NETWORK_ERRORS = 20;
const MAX_COMMAND_ATTEMPTS = 5;
const COMMAND_RETRY_DELAY_SECONDS = 30;

export type ApexTestRunResult =
  | { status: 'completed'; outputString: string; commandFailed: boolean }
  | { status: 'noApex'; outputString: string }
  | { status: 'timeout'; outputString: string; testRunId: string }
  | { status: 'networkError'; outputString: string; testRunId: string | null };

export function isTransientNetworkError(message: string): boolean {
  const lowerMessage = (message || '').toLowerCase();
  return TRANSIENT_NETWORK_ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern.toLowerCase()));
}

export function isNoApexError(message: string): boolean {
  return (
    message.includes('Toujours fournir une propriété classes, suites, tests ou testLevel') ||
    message.includes('Always provide a classes, suites, tests, or testLevel property') ||
    message.includes('No tests found for category') ||
    message.includes('Aucun test trouvé pour category') ||
    message.includes('Error (INVALID_INPUT)') ||
    /"name":\s*"INVALID_INPUT"/.test(message)
  );
}

async function sleep(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function logNetworkRetry(commandThis: any, attempt: number, maxAttempts: number, message: string) {
  const firstLine = (message || '').split('\n').find((line) => line.trim() !== '') || message;
  uxLog("warning", commandThis, c.yellow(t('apexTestsNetworkErrorRetrying', { attempt, maxAttempts, message: firstLine.trim() })));
}

// Run Apex tests asynchronously, then poll the org until the run is over, then download results.
// Each call to the org is retried when the network fails, so a long test run survives a short outage.
export async function runApexTestsResilient(options: {
  testLevel: string;
  orgUsername: string | null;
  conn: Connection;
  reportDir: string;
  waitMinutes: number;
  debugMode: boolean;
  commandThis: any;
}): Promise<ApexTestRunResult> {
  const { testLevel, orgUsername, conn, reportDir, waitMinutes, debugMode, commandThis } = options;
  const targetOrgArg = orgUsername ? ` --target-org ${orgUsername}` : '';

  // Start the test run
  const startCommand = 'sf apex run test' + ` --test-level ${testLevel}` + targetOrgArg + ' --json';
  let testRunId: string | null = null;
  for (let attempt = 1; attempt <= MAX_COMMAND_ATTEMPTS && testRunId === null; attempt++) {
    const startRes = await execCommand(startCommand, commandThis, { fail: false, output: true, debug: debugMode });
    if (startRes?.result?.testRunId) {
      testRunId = startRes.result.testRunId;
      break;
    }
    const errorMessage = startRes?.errorMessage || startRes?.message || JSON.stringify(startRes);
    if (isNoApexError(errorMessage)) {
      return { status: 'noApex', outputString: errorMessage };
    }
    if (!isTransientNetworkError(errorMessage)) {
      return { status: 'completed', outputString: errorMessage, commandFailed: true };
    }
    if (attempt === MAX_COMMAND_ATTEMPTS) {
      return { status: 'networkError', outputString: errorMessage, testRunId: null };
    }
    logNetworkRetry(commandThis, attempt, MAX_COMMAND_ATTEMPTS, errorMessage);
    await sleep(COMMAND_RETRY_DELAY_SECONDS);
  }
  uxLog("log", commandThis, c.grey(t('apexTestRunStartedWaiting', { testRunId, waitMinutes })));

  // Wait for the test run to be over
  const deadline = Date.now() + waitMinutes * 60 * 1000;
  let consecutiveNetworkErrors = 0;
  let lastStatus = '';
  let isOver = false;
  while (!isOver) {
    if (Date.now() > deadline) {
      return {
        status: 'timeout',
        outputString: t('apexTestRunTimeout', { testRunId, waitMinutes }),
        testRunId: testRunId as string,
      };
    }
    try {
      const jobRes = await conn.query(`SELECT Status FROM AsyncApexJob WHERE Id = '${testRunId}'`);
      consecutiveNetworkErrors = 0;
      const status = (jobRes.records[0] as any)?.Status || 'Unknown';
      if (status !== lastStatus) {
        uxLog("log", commandThis, c.grey(t('apexTestRunStatus', { testRunId, status })));
        lastStatus = status;
      }
      isOver = APEX_TEST_RUN_FINAL_STATUSES.includes(status);
    } catch (e) {
      const errorMessage = (e as Error).message || String(e);
      consecutiveNetworkErrors++;
      if (!isTransientNetworkError(errorMessage) || consecutiveNetworkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
        return { status: 'networkError', outputString: errorMessage, testRunId };
      }
      logNetworkRetry(commandThis, consecutiveNetworkErrors, MAX_CONSECUTIVE_NETWORK_ERRORS, errorMessage);
    }
    if (!isOver) {
      await sleep(POLL_INTERVAL_SECONDS);
    }
  }

  // Get test results (same output as sf apex run test with --wait)
  const getCommand =
    'sf apex get test' +
    ` --test-run-id ${testRunId}` +
    ' --code-coverage' +
    ' --result-format human' +
    ` --output-dir "${reportDir}"` +
    targetOrgArg;
  for (let attempt = 1; attempt <= MAX_COMMAND_ATTEMPTS; attempt++) {
    try {
      const getRes = await execCommand(getCommand, commandThis, { fail: true, output: true, debug: debugMode });
      return { status: 'completed', outputString: getRes.stdout + getRes.stderr, commandFailed: false };
    } catch (e) {
      const errorMessage = (e as Error).message || String(e);
      // Failed tests make the command exit with an error code, but the output contains the test results
      if (/Outcome\s+\S/.test(errorMessage) || !isTransientNetworkError(errorMessage)) {
        return { status: 'completed', outputString: errorMessage, commandFailed: true };
      }
      if (attempt === MAX_COMMAND_ATTEMPTS) {
        return { status: 'networkError', outputString: errorMessage, testRunId };
      }
      logNetworkRetry(commandThis, attempt, MAX_COMMAND_ATTEMPTS, errorMessage);
      await sleep(COMMAND_RETRY_DELAY_SECONDS);
    }
  }
  return { status: 'networkError', outputString: '', testRunId };
}
