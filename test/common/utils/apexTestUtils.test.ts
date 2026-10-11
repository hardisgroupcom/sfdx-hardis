import { expect } from 'chai';
import {
  extractErrorSummary,
  extractTestRunId,
  isNoApexError,
  isTransientNetworkError,
  parseWaitMinutes,
  runApexTestsResilient,
} from '../../../src/common/utils/apexTestUtils.js';

describe('apexTestUtils', () => {
  describe('isTransientNetworkError', () => {
    it('detects Node fetch and socket errors', () => {
      expect(isTransientNetworkError('Error (TypeError): fetch failed')).to.equal(true);
      expect(isTransientNetworkError('read ECONNRESET')).to.equal(true);
      expect(isTransientNetworkError('connect ETIMEDOUT 1.2.3.4:443')).to.equal(true);
      expect(isTransientNetworkError('getaddrinfo EAI_AGAIN acme.my.salesforce.com')).to.equal(true);
      expect(isTransientNetworkError('Socket hang up')).to.equal(true);
    });

    it('ignores other errors', () => {
      expect(isTransientNetworkError('INVALID_SESSION_ID: Session expired or invalid')).to.equal(false);
      expect(isTransientNetworkError('')).to.equal(false);
    });
  });

  describe('isNoApexError', () => {
    it('detects no Apex messages in human and JSON output', () => {
      expect(isNoApexError('No tests found for category Apex')).to.equal(true);
      expect(isNoApexError('Error (INVALID_INPUT): something')).to.equal(true);
      expect(isNoApexError('{ "name": "INVALID_INPUT", "message": "..." }')).to.equal(true);
    });

    it('ignores other errors', () => {
      expect(isNoApexError('fetch failed')).to.equal(false);
    });
  });

  describe('parseWaitMinutes', () => {
    it('reads a positive integer', () => {
      expect(parseWaitMinutes('45')).to.equal(45);
      expect(parseWaitMinutes(' 90 ')).to.equal(90);
    });

    it('falls back to 120 minutes for anything else', () => {
      expect(parseWaitMinutes(null)).to.equal(120);
      expect(parseWaitMinutes('')).to.equal(120);
      expect(parseWaitMinutes('2h')).to.equal(120);
      expect(parseWaitMinutes('abc')).to.equal(120);
      expect(parseWaitMinutes('0')).to.equal(120);
      expect(parseWaitMinutes('-5')).to.equal(120);
    });
  });

  describe('extractTestRunId', () => {
    it('finds the id after a CLI warning', () => {
      expect(extractTestRunId('Warning: update available\n{ "status": 0, "result": { "testRunId": "707AW00000abcdEFGH" } }')).to.equal('707AW00000abcdEFGH');
    });

    it('returns null without id', () => {
      expect(extractTestRunId('{ "status": 1, "message": "nope" }')).to.equal(null);
    });
  });

  describe('extractErrorSummary', () => {
    it('reads the message of a JSON error', () => {
      expect(extractErrorSummary('Command failed: sf apex run test\n{ "name": "ALREADY_IN_PROCESS", "message": "A test run is \\"already\\" queued" }')).to.equal('A test run is "already" queued');
    });

    it('reads the Error line of a human output', () => {
      expect(extractErrorSummary('Command failed: sf apex get test\n\nError (INVALID_SESSION_ID): Session expired or invalid')).to.equal('Error (INVALID_SESSION_ID): Session expired or invalid');
    });
  });

  describe('runApexTestsResilient', () => {
    const TEST_RUN_ID = '707AW00000abcdEFGH';
    const HUMAN_RESULT = '=== Test Summary\nNAME                 VALUE\nOutcome              Passed\nTest Run Coverage    82%\nOrg Wide Coverage    80%\n';

    function buildOptions(statuses: Array<string | Error | null>, execCommandFn: any, waitMinutes = 60) {
      const queries: string[] = [];
      const commands: string[] = [];
      const conn: any = {
        tooling: {
          query: async (soql: string) => {
            queries.push(soql);
            const next = statuses.length > 1 ? statuses.shift() : statuses[0];
            if (next instanceof Error) {
              throw next;
            }
            return { records: next ? [{ Status: next }] : [] };
          },
        },
      };
      return {
        queries,
        commands,
        options: {
          testLevel: 'RunLocalTests',
          orgUsername: 'user@acme.com',
          conn,
          reportDir: 'hardis-report',
          waitMinutes,
          debugMode: false,
          commandThis: null,
          execCommandFn: async (command: string, commandThis: any, execOptions: any) => {
            commands.push(command);
            return execCommandFn(command, execOptions);
          },
          sleepFn: async () => undefined,
        },
      };
    }

    const startOk = (command: string) => {
      if (command.startsWith('sf apex run test')) {
        return { status: 0, result: { testRunId: TEST_RUN_ID } };
      }
      return { status: 0, stdout: HUMAN_RESULT, stderr: '' };
    };

    it('asks for code coverage when starting, waits on ApexTestRunResult, then gets the results', async () => {
      const ctx = buildOptions(['Queued', 'Processing', 'Completed'], startOk);
      const res = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('completed');
      expect(res.outputString).to.contain('Outcome              Passed');
      expect(ctx.commands[0]).to.contain('--code-coverage');
      expect(ctx.commands[0]).to.not.contain('--wait');
      expect(ctx.commands[1]).to.contain(`sf apex get test --test-run-id ${TEST_RUN_ID}`);
      expect(ctx.queries).to.have.length(3);
      expect(ctx.queries[0]).to.contain('FROM ApexTestRunResult');
    });

    it('survives network errors while waiting', async () => {
      const ctx = buildOptions(['Processing', new Error('fetch failed'), new Error('read ECONNRESET'), 'Completed'], startOk);
      const res = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('completed');
      expect(ctx.queries).to.have.length(4);
    });

    it('reports a network error after too many failures in a row', async () => {
      const ctx = buildOptions([new Error('fetch failed')], startOk);
      const res: any = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('noResult');
      expect(res.reason).to.equal('networkError');
      expect(res.testRunId).to.equal(TEST_RUN_ID);
      expect(ctx.queries).to.have.length(20);
      expect(ctx.commands).to.have.length(1);
    });

    it('does not call an expired session a network error', async () => {
      const ctx = buildOptions([new Error('INVALID_SESSION_ID: Session expired or invalid')], startOk);
      const res: any = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('noResult');
      expect(res.reason).to.equal('error');
      expect(ctx.queries).to.have.length(1);
    });

    it('reports a timeout with the test run id', async () => {
      const ctx = buildOptions(['Processing'], startOk, 0);
      const res: any = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('noResult');
      expect(res.reason).to.equal('timeout');
      expect(res.testRunId).to.equal(TEST_RUN_ID);
      expect(ctx.commands).to.have.length(1);
    });

    it('does not time out a run that ends at the last check', async () => {
      const ctx = buildOptions(['Completed'], startOk, 0);
      const res = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('completed');
    });

    it('asks sf apex get test when the org never shows the test run', async () => {
      const ctx = buildOptions([null], startOk);
      const res = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('completed');
      expect(ctx.queries).to.have.length(4);
    });

    it('keeps the test run id of an output that is not a single JSON document', async () => {
      const ctx = buildOptions(['Completed'], (command: string) => {
        if (command.startsWith('sf apex run test')) {
          return { status: 0, stdout: `Warning\n{ "result": { "testRunId": "${TEST_RUN_ID}" } }`, stderr: '', jsonParseError: 'Unexpected token' };
        }
        return { status: 0, stdout: HUMAN_RESULT, stderr: '' };
      });
      const res = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('completed');
      expect(ctx.commands[1]).to.contain(TEST_RUN_ID);
    });

    it('detects an org without Apex', async () => {
      const ctx = buildOptions(['Completed'], () => {
        throw new Error('Command failed\n{ "name": "INVALID_INPUT", "message": "Always provide a classes, suites, tests, or testLevel property" }');
      });
      const res = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('noApex');
    });

    it('reports a start failure as an error, not as failed tests', async () => {
      const ctx = buildOptions(['Completed'], () => {
        throw new Error('Command failed\n{ "name": "ALREADY_IN_PROCESS", "message": "This org is already running tests" }');
      });
      const res: any = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('noResult');
      expect(res.reason).to.equal('error');
      expect(res.testRunId).to.equal(null);
    });

    it('keeps the results of failing tests, which make sf apex get test exit with an error', async () => {
      const ctx = buildOptions(['Completed'], (command: string) => {
        if (command.startsWith('sf apex run test')) {
          return { status: 0, result: { testRunId: TEST_RUN_ID } };
        }
        throw new Error('Command failed\nOutcome              Failed\nMyTest.test1 Fail System.AssertException: read ETIMEDOUT');
      });
      const res: any = await runApexTestsResilient(ctx.options);
      expect(res.status).to.equal('completed');
      expect(res.commandFailed).to.equal(true);
    });

    it('only retries sf apex get test when it gave no test results', async () => {
      let getRetry: any = null;
      const ctx = buildOptions(['Completed'], (command: string, execOptions: any) => {
        if (command.startsWith('sf apex get test')) {
          getRetry = execOptions.retry;
        }
        return startOk(command);
      });
      await runApexTestsResilient(ctx.options);
      expect(getRetry.retryIf('Error (TypeError): fetch failed')).to.equal(true);
      expect(getRetry.retryIf('Outcome   Failed\nfetch failed')).to.equal(false);
      expect(getRetry.retryIf('Error (1): invalid cross reference id')).to.equal(true);
    });
  });
});
