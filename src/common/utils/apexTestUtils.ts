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

// Same list as the Salesforce CLI, which reads ApexTestRunResult to know when a test run is over
const APEX_TEST_RUN_FINAL_STATUSES = ['Completed', 'Failed', 'Aborted', 'Passed', 'Skipped'];
const DEFAULT_WAIT_MINUTES = 120;
const POLL_INTERVAL_SECONDS = 30;
const MAX_CONSECUTIVE_NETWORK_ERRORS = 20;
// Polls without any ApexTestRunResult row before asking sf apex get test what happened to the run
const MAX_CONSECUTIVE_MISSING_STATUS = 4;
const COMMAND_RETRIES = 4;
const COMMAND_RETRY_DELAY_SECONDS = 30;
const ERROR_SUMMARY_MAX_LENGTH = 300;

export type ApexTestNoResultReason = 'networkError' | 'timeout' | 'error';

export type ApexTestRunResult =
  | { status: 'completed'; outputString: string; commandFailed: boolean }
  | { status: 'noApex'; outputString: string }
  | { status: 'noResult'; reason: ApexTestNoResultReason; outputString: string; testRunId: string | null };

export interface ApexTestRunOptions {
  testLevel: string;
  orgUsername: string | null;
  conn: Connection;
  reportDir: string;
  waitMinutes: number;
  debugMode: boolean;
  commandThis: any;
  // For unit tests
  execCommandFn?: typeof execCommand;
  sleepFn?: (seconds: number) => Promise<void>;
}

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

// Minutes to wait for the test run: a value that is not a positive integer gives the default
export function parseWaitMinutes(value: string | null | undefined): number {
  const trimmedValue = (value || '').trim();
  if (!/^\d+$/.test(trimmedValue) || parseInt(trimmedValue, 10) === 0) {
    return DEFAULT_WAIT_MINUTES;
  }
  return parseInt(trimmedValue, 10);
}

// Finds the test run id in an output that could not be parsed as a single JSON document
export function extractTestRunId(output: string): string | null {
  const match = /"testRunId":\s*"(707[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)"/.exec(output || '');
  return match ? match[1] : null;
}

// One line telling why a sf command failed, for the notification
export function extractErrorSummary(output: string): string {
  const lines = (output || '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const jsonMessage = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(output || '');
  const summary = jsonMessage
    ? jsonMessage[1].replace(/\\"/g, '"').replace(/\\n/g, ' ')
    : lines.find((line) => line.startsWith('Error')) || lines[0] || '';
  return summary.length > ERROR_SUMMARY_MAX_LENGTH ? summary.substring(0, ERROR_SUMMARY_MAX_LENGTH) + '...' : summary;
}

// Run Apex tests asynchronously, then poll the org until the run is over, then download results.
// Each call to the org is retried when the network fails, so a long test run survives a short outage.
export async function runApexTestsResilient(options: ApexTestRunOptions): Promise<ApexTestRunResult> {
  const { testLevel, orgUsername, reportDir, debugMode, commandThis } = options;
  const exec = options.execCommandFn || execCommand;
  const targetOrgArg = orgUsername ? ` --target-org ${orgUsername}` : '';

  // Start the test run. Without --code-coverage, the org does not collect coverage for the run
  const startCommand = 'sf apex run test' + ` --test-level ${testLevel}` + ' --code-coverage' + targetOrgArg + ' --json';
  let testRunId: string | null = null;
  let startOutput = '';
  try {
    const startRes = await exec(startCommand, commandThis, {
      fail: true,
      output: true,
      debug: debugMode,
      retry: buildCommandRetry(isTransientNetworkError),
    });
    startOutput = startRes?.stdout || JSON.stringify(startRes);
    // A CLI warning printed before the JSON makes it unparseable, but the test run is started
    testRunId = startRes?.result?.testRunId || extractTestRunId(startOutput);
  } catch (e) {
    startOutput = (e as Error).message || String(e);
  }
  if (testRunId === null) {
    if (isNoApexError(startOutput)) {
      return { status: 'noApex', outputString: startOutput };
    }
    return buildNoResult(startOutput, null);
  }
  uxLog("log", commandThis, c.grey(t('apexTestRunStartedWaiting', { testRunId, waitMinutes: options.waitMinutes })));

  const waitRes = await waitForTestRunEnd(testRunId, options);
  if (waitRes !== null) {
    return waitRes;
  }

  // Get test results (same output as sf apex run test with --wait)
  const getCommand =
    'sf apex get test' +
    ` --test-run-id ${testRunId}` +
    ' --code-coverage' +
    ' --result-format human' +
    ` --output-dir "${reportDir}"` +
    targetOrgArg;
  try {
    const getRes = await exec(getCommand, commandThis, {
      fail: true,
      output: true,
      debug: debugMode,
      // Not only on network errors: just after the end of a run, the org can refuse to give its results for a moment
      // (seen: "invalid cross reference id" while another test run was starting)
      retry: buildCommandRetry((output) => !hasTestRunOutcome(output)),
    });
    return { status: 'completed', outputString: getRes.stdout + getRes.stderr, commandFailed: false };
  } catch (e) {
    const errorMessage = (e as Error).message || String(e);
    // Failed tests make the command exit with an error code, but the output contains the test results
    if (hasTestRunOutcome(errorMessage)) {
      return { status: 'completed', outputString: errorMessage, commandFailed: true };
    }
    return buildNoResult(errorMessage, testRunId);
  }
}

// Returns null when the test run is over, or the reason why its end could not be observed
async function waitForTestRunEnd(testRunId: string, options: ApexTestRunOptions): Promise<ApexTestRunResult | null> {
  const { conn, waitMinutes, commandThis } = options;
  const sleep = options.sleepFn || defaultSleep;
  const deadline = Date.now() + waitMinutes * 60 * 1000;
  let consecutiveNetworkErrors = 0;
  let consecutiveMissingStatus = 0;
  let lastStatus = '';
  for (; ;) {
    try {
      const runRes = await conn.tooling.query(`SELECT Status FROM ApexTestRunResult WHERE AsyncApexJobId = '${testRunId}'`);
      consecutiveNetworkErrors = 0;
      const status: string = (runRes.records[0] as any)?.Status || '';
      if (status === '') {
        consecutiveMissingStatus++;
        if (consecutiveMissingStatus >= MAX_CONSECUTIVE_MISSING_STATUS) {
          return null;
        }
      } else {
        consecutiveMissingStatus = 0;
        if (status !== lastStatus) {
          uxLog("log", commandThis, c.grey(t('apexTestRunStatus', { testRunId, status })));
          lastStatus = status;
        }
        if (APEX_TEST_RUN_FINAL_STATUSES.includes(status)) {
          return null;
        }
      }
    } catch (e) {
      const errorMessage = (e as Error).message || String(e);
      consecutiveNetworkErrors++;
      if (!isTransientNetworkError(errorMessage) || consecutiveNetworkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
        return buildNoResult(errorMessage, testRunId);
      }
      logNetworkRetry(commandThis, consecutiveNetworkErrors, errorMessage);
    }
    // Checked after the query, so a run that ends during the last wait is not reported as a timeout
    const remainingSeconds = Math.ceil((deadline - Date.now()) / 1000);
    if (remainingSeconds <= 0) {
      return {
        status: 'noResult',
        reason: 'timeout',
        outputString: t('apexTestRunTimeout', { testRunId, waitMinutes }),
        testRunId,
      };
    }
    await sleep(Math.min(POLL_INTERVAL_SECONDS, remainingSeconds));
  }
}

function buildCommandRetry(retryIf: (output: string) => boolean) {
  return { retryMaxAttempts: COMMAND_RETRIES, retryDelay: COMMAND_RETRY_DELAY_SECONDS, retryIf };
}

function buildNoResult(outputString: string, testRunId: string | null): ApexTestRunResult {
  return {
    status: 'noResult',
    reason: isTransientNetworkError(outputString) ? 'networkError' : 'error',
    outputString,
    testRunId,
  };
}

function hasTestRunOutcome(output: string): boolean {
  return /Outcome\s+\S/.test(output);
}

function logNetworkRetry(commandThis: any, attempt: number, message: string) {
  const firstLine = (message || '').split('\n').find((line) => line.trim() !== '') || message;
  uxLog("warning", commandThis, c.yellow(t('apexTestsNetworkErrorRetrying', { attempt, maxAttempts: MAX_CONSECUTIVE_NETWORK_ERRORS, message: firstLine.trim() })));
}

async function defaultSleep(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
