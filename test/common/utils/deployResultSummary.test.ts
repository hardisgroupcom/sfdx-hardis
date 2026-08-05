import { expect } from 'chai';
import {
  buildDeployResultSummaryLines,
  summarizeDeployErrorMessage,
} from '../../../src/common/utils/deployResultSummary.js';

// Minimal successful deploy-check result, similar to what `sf project deploy start --json` returns
function buildResultJson(overrides: any = {}) {
  return {
    status: 0,
    result: Object.assign(
      {
        checkOnly: true,
        id: '0AfG500000PCMG6KAP',
        status: 'Succeeded',
        success: true,
        numberComponentsDeployed: 26,
        numberComponentsTotal: 26,
        numberComponentErrors: 0,
        numberTestsCompleted: 465,
        numberTestsTotal: 465,
        numberTestErrors: 0,
        startDate: '2026-07-28T10:00:00.000Z',
        completedDate: '2026-07-28T10:39:24.000Z',
      },
      overrides
    ),
  };
}

describe('Deploy result summary', () => {
  const previousNoTruncate = process.env.NO_TRUNCATE_LOGS;

  beforeEach(() => {
    delete process.env.NO_TRUNCATE_LOGS;
  });

  after(() => {
    if (previousNoTruncate === undefined) {
      delete process.env.NO_TRUNCATE_LOGS;
    } else {
      process.env.NO_TRUNCATE_LOGS = previousNoTruncate;
    }
  });

  it('Summarizes a successful deployment check without dumping the JSON', () => {
    const lines = buildDeployResultSummaryLines(buildResultJson(), {
      check: true,
      label: 'calculated-package-xml',
      orgCoveragePercent: '86.82',
      reportFile: 'hardis-report/deploy-result-calculated-package-xml.json',
    });
    const output = lines.join('\n');

    expect(output).to.include('calculated-package-xml');
    expect(output).to.include('Succeeded');
    expect(output).to.include('0AfG500000PCMG6KAP');
    expect(output).to.include('26');
    expect(output).to.include('465');
    expect(output).to.include('86.82');
    // Duration computed from startDate/completedDate: 39 minutes 24 seconds
    expect(output).to.include('0:39:24');
    // The raw JSON must never appear
    expect(output).to.not.include('numberComponentsDeployed');
    expect(output).to.not.include('"result"');
  });

  it('Displays component and test failures', () => {
    const lines = buildDeployResultSummaryLines(
      buildResultJson({
        status: 'Failed',
        success: false,
        numberComponentErrors: 3,
        numberTestErrors: 7,
      }),
      { check: true, label: 'calculated-package-xml' }
    );
    const output = lines.join('\n');

    expect(output).to.include('Failed');
    expect(output).to.include('3');
    expect(output).to.include('7');
  });

  it('Mentions the report file and how to get the full JSON back', () => {
    const lines = buildDeployResultSummaryLines(buildResultJson(), {
      check: true,
      reportFile: 'hardis-report/deploy-result-calculated-package-xml.json',
    });
    const output = lines.join('\n');

    expect(output).to.include('hardis-report/deploy-result-calculated-package-xml.json');
    expect(output).to.include('hardis-report');
    expect(output).to.include('NO_TRUNCATE_LOGS=true');
  });

  it('Does not display the NO_TRUNCATE_LOGS hint when it is already set', () => {
    process.env.NO_TRUNCATE_LOGS = 'true';
    const output = buildDeployResultSummaryLines(buildResultJson(), { check: true }).join('\n');
    expect(output).to.not.include('NO_TRUNCATE_LOGS=true');
  });

  it('Omits the report file line when no report file has been written', () => {
    const output = buildDeployResultSummaryLines(buildResultJson(), { check: true, reportFile: null }).join('\n');
    expect(output).to.not.include('deploy-result-');
  });

  it('Omits the coverage line when org coverage is unknown', () => {
    const output = buildDeployResultSummaryLines(buildResultJson(), {
      check: true,
      orgCoveragePercent: null,
    }).join('\n');
    expect(output).to.not.include('%');
  });

  it('Handles a deployment without Apex tests', () => {
    const output = buildDeployResultSummaryLines(
      buildResultJson({ numberTestsCompleted: 0, numberTestsTotal: 0, numberTestErrors: 0 }),
      { check: false }
    ).join('\n');
    expect(output).to.include('Apex tests');
    expect(output).to.not.include('NaN');
  });

  it('Displays DELTA and Quick Deploy in the deployment mode', () => {
    const output = buildDeployResultSummaryLines(buildResultJson(), {
      check: false,
      delta: true,
      quickDeploy: true,
    }).join('\n');
    expect(output).to.include('DELTA');
    expect(output).to.include('Quick Deploy');
  });

  it('Displays FULL when the deployment is not a delta one', () => {
    const output = buildDeployResultSummaryLines(buildResultJson(), { check: false, delta: false }).join('\n');
    expect(output).to.include('FULL');
    expect(output).to.not.include('DELTA');
  });

  it('Falls back on the measured duration when Metadata API dates are missing', () => {
    const resultJson = buildResultJson();
    delete resultJson.result.startDate;
    delete resultJson.result.completedDate;
    const output = buildDeployResultSummaryLines(resultJson, { check: true, durationMs: 65000 }).join('\n');
    expect(output).to.include('0:01:05');
  });

  it('Does not throw when there is no deployment result', () => {
    expect(() => buildDeployResultSummaryLines(null, { check: true })).to.not.throw();
    expect(() => buildDeployResultSummaryLines({}, { check: true })).to.not.throw();
    expect(buildDeployResultSummaryLines({}, { check: true }).length).to.equal(1);
  });
});

describe('Deploy error message summarization', () => {
  const previousNoTruncate = process.env.NO_TRUNCATE_LOGS;

  beforeEach(() => {
    delete process.env.NO_TRUNCATE_LOGS;
  });

  after(() => {
    if (previousNoTruncate === undefined) {
      delete process.env.NO_TRUNCATE_LOGS;
    } else {
      process.env.NO_TRUNCATE_LOGS = previousNoTruncate;
    }
  });

  it('Keeps only the error message when the output embeds a deployment JSON', () => {
    const raw = JSON.stringify({
      status: 1,
      result: {
        errorStatusCode: 'INVALID_ID_FIELD',
        errorMessage: 'The job-id is not valid',
        details: { componentSuccesses: new Array(5000).fill({ fullName: 'Whatever' }) },
      },
    });
    const summarized = summarizeDeployErrorMessage(raw);

    expect(summarized).to.include('INVALID_ID_FIELD');
    expect(summarized).to.include('The job-id is not valid');
    expect(summarized).to.not.include('componentSuccesses');
    expect(summarized.length).to.be.lessThan(raw.length);
  });

  it('Returns the input unchanged when no deployment JSON is found', () => {
    const raw = 'Plain error output without any JSON';
    expect(summarizeDeployErrorMessage(raw)).to.equal(raw);
  });

  it('Returns the input unchanged when NO_TRUNCATE_LOGS is true', () => {
    process.env.NO_TRUNCATE_LOGS = 'true';
    const raw = JSON.stringify({ status: 1, result: { errorMessage: 'Boom' } });
    expect(summarizeDeployErrorMessage(raw)).to.equal(raw);
  });
});
