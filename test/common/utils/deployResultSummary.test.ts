import { expect } from 'chai';
import { buildDeployedComponentsMarkdown } from '../../../src/common/utils/deployUtils.js';
import {
  buildDeployResultSummaryLines,
  countDeployComponentChanges,
  isComponentChangeDetailComplete,
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

describe('countDeployComponentChanges()', () => {
  it('splits the Metadata API detail rows by outcome', () => {
    const changes = countDeployComponentChanges({
      details: {
        componentSuccesses: [
          { componentType: 'ApexClass', fullName: 'New', created: true, changed: true, deleted: false },
          { componentType: 'ApexClass', fullName: 'Touched', created: false, changed: true, deleted: false },
          { componentType: 'Flow', fullName: 'Same', created: false, changed: false, deleted: false },
          { componentType: 'Layout', fullName: 'Gone', created: false, changed: false, deleted: true },
        ],
      },
    });
    expect(changes).to.deep.equal({ created: 1, updated: 1, deleted: 1, unchanged: 1, total: 4, detailed: true });
  });

  it('ignores the package.xml manifest row Salesforce adds to the successes', () => {
    const changes = countDeployComponentChanges({
      details: {
        componentSuccesses: [
          { componentType: '', fullName: 'package.xml', created: false, changed: true, deleted: false },
          { componentType: 'ApexClass', fullName: 'Touched', created: false, changed: true, deleted: false },
        ],
      },
    });
    expect(changes.total).to.equal(1);
    expect(changes.updated).to.equal(1);
  });

  it('ignores the destructive changes manifest rows too', () => {
    // Counting them would put one phantom entry per manifest in `unchanged`, and the split would
    // stop matching numberComponentsDeployed on every deployment with destructive changes
    const changes = countDeployComponentChanges({
      details: {
        componentSuccesses: [
          { componentType: '', fullName: 'package.xml', created: false, changed: false, deleted: false },
          { componentType: '', fullName: 'destructiveChangesPre.xml', created: false, changed: false, deleted: false },
          { componentType: '', fullName: 'destructiveChangesPost.xml', created: false, changed: false, deleted: false },
          { componentType: 'Layout', fullName: 'Gone', created: false, changed: false, deleted: true },
        ],
      },
    });
    expect(changes).to.deep.equal({ created: 0, updated: 0, deleted: 1, unchanged: 0, total: 1, detailed: true });
  });

  it('counts a component reported on several rows only once, keeping its strongest outcome', () => {
    // A real deployment result returned the same Flow three times: twice unchanged, once changed
    const changes = countDeployComponentChanges({
      details: {
        componentSuccesses: [
          { componentType: 'Flow', fullName: 'Dup', created: false, changed: false, deleted: false },
          { componentType: 'Flow', fullName: 'Dup', created: false, changed: false, deleted: false },
          { componentType: 'Flow', fullName: 'Dup', created: false, changed: true, deleted: false },
        ],
      },
    });
    expect(changes).to.deep.equal({ created: 0, updated: 1, deleted: 0, unchanged: 0, total: 1, detailed: true });
  });

  it('accepts the string booleans returned by raw XML clients', () => {
    const changes = countDeployComponentChanges({
      details: {
        componentSuccesses: [
          { componentType: 'ApexClass', fullName: 'Touched', created: 'false', changed: 'true', deleted: 'false' },
        ],
      },
    });
    expect(changes.updated).to.equal(1);
  });

  it('falls back on the source-tracking files[] shape', () => {
    const changes = countDeployComponentChanges({
      files: [
        { type: 'ApexClass', fullName: 'New', state: 'Created' },
        { type: 'ApexClass', fullName: 'Touched', state: 'Changed' },
        { type: 'Flow', fullName: 'Same', state: 'Unchanged' },
        { type: 'Layout', fullName: 'Gone', state: 'Deleted' },
      ],
    });
    expect(changes).to.deep.equal({ created: 1, updated: 1, deleted: 1, unchanged: 1, total: 4, detailed: true });
  });

  it('never counts a failed file row as an unchanged component', () => {
    // `Failed` is the fifth ComponentStatus value: mapped through the created/changed/deleted
    // tests it would land in `unchanged`, reporting failures as untouched components
    const changes = countDeployComponentChanges({
      files: [
        { type: 'ApexClass', fullName: 'Ok', state: 'Changed' },
        { type: 'ApexClass', fullName: 'Broken', state: 'Failed' },
        { type: 'ApexClass', state: 'Failed' },
      ],
    });
    expect(changes).to.deep.equal({ created: 0, updated: 1, deleted: 0, unchanged: 0, total: 1, detailed: true });
  });

  it('reports no detail when a failed deployment only carries failed file rows', () => {
    const changes = countDeployComponentChanges({
      details: { componentSuccesses: [] },
      files: [{ type: 'ApexClass', fullName: 'Broken', state: 'Failed' }],
    });
    expect(changes.detailed).to.equal(false);
  });

  it('falls back on files[] when componentSuccesses held only manifest rows', () => {
    const changes = countDeployComponentChanges({
      details: { componentSuccesses: [{ componentType: '', fullName: 'package.xml', changed: true }] },
      files: [{ type: 'ApexClass', fullName: 'Touched', state: 'Changed' }],
    });
    expect(changes.detailed).to.equal(true);
    expect(changes.updated).to.equal(1);
  });

  it('reports no detail rather than all-zeros when the result carries none', () => {
    // The synthetic destructive-changes-only result has an empty componentSuccesses array
    expect(countDeployComponentChanges({ details: { componentSuccesses: [] } }).detailed).to.equal(false);
    expect(countDeployComponentChanges({}).detailed).to.equal(false);
    expect(countDeployComponentChanges(null).detailed).to.equal(false);
  });
});

describe('buildDeployedComponentsMarkdown()', () => {
  function metrics(overrides: any = {}) {
    return Object.assign(
      {
        componentsDeployed: 3027,
        componentsDeleted: 2,
        componentsCreated: 45,
        componentsUpdated: 83,
        componentsUnchanged: 2897,
        componentsChangeTotal: 3027,
        componentsChangeDetail: true,
        componentsTotal: 3027,
        componentsFailed: 0,
        testsRun: 0,
        testsFailed: 0,
        testsTotal: 0,
        codeCoveragePercent: null,
        quickDeploy: false,
        delta: false,
        success: true,
        durationSeconds: 12,
      },
      overrides
    );
  }

  it('keeps the whole split on a single line', () => {
    const markdown = buildDeployedComponentsMarkdown(metrics(), false);
    expect(markdown).to.equal(
      '**Deployed components:** 3027 sent to the org, 130 changed (45 created, 83 updated, 2 deleted, 2897 unchanged)'
    );
    expect(markdown.split('\n').length).to.equal(1);
  });

  it('uses the conditional wording on a validation, which changed nothing yet', () => {
    expect(buildDeployedComponentsMarkdown(metrics(), true)).to.contain('130 would change');
  });

  it('returns nothing when no deploy result carried per-component detail', () => {
    expect(buildDeployedComponentsMarkdown(metrics({ componentsChangeDetail: false }), false)).to.equal('');
  });

  it('returns nothing when the detail covered only part of the deployment', () => {
    expect(buildDeployedComponentsMarkdown(metrics({ componentsChangeTotal: 100 }), false)).to.equal('');
  });
});

describe('Deploy result summary changes line', () => {
  const CHANGED_ROWS = {
    componentSuccesses: [
      { componentType: 'ApexClass', fullName: 'New', created: true, changed: true, deleted: false },
      { componentType: 'ApexClass', fullName: 'Touched', created: false, changed: true, deleted: false },
    ],
  };

  it('reports the split of a successful deployment', () => {
    const lines = buildDeployResultSummaryLines(buildResultJson({ success: true, details: CHANGED_ROWS }), {
      check: false,
    });
    expect(lines.join('\n')).to.include('Changes: 1 created, 1 updated, 0 deleted, 0 unchanged');
  });

  it('stays conditional on a validation, which deployed nothing', () => {
    const lines = buildDeployResultSummaryLines(buildResultJson({ success: true, details: CHANGED_ROWS }), {
      check: true,
    });
    expect(lines.join('\n')).to.include('Changes if deployed: 1 created, 1 updated');
  });

  it('reports no split for a failed deployment, whose successes were rolled back', () => {
    // componentSuccesses lists what got deployed before the error, which rollbackOnError reverted:
    // reporting it would describe changes the org never kept
    const lines = buildDeployResultSummaryLines(
      buildResultJson({ success: false, status: 'Failed', details: CHANGED_ROWS }),
      { check: false }
    );
    expect(lines.join('\n')).to.not.include('Changes');
  });
});

describe('isComponentChangeDetailComplete()', () => {
  it('accepts detail covering every deployed component', () => {
    expect(
      isComponentChangeDetailComplete({
        componentsChangeDetail: true,
        componentsChangeTotal: 3027,
        componentsDeployed: 3027,
      })
    ).to.equal(true);
  });

  it('rejects detail covering only part of a multi-package deployment', () => {
    // One package.xml of the plan reported detail, another did not: adding up the split would
    // not land on the deployed total
    expect(
      isComponentChangeDetailComplete({
        componentsChangeDetail: true,
        componentsChangeTotal: 100,
        componentsDeployed: 150,
      })
    ).to.equal(false);
  });

  it('rejects a deployment with no detail at all', () => {
    expect(
      isComponentChangeDetailComplete({
        componentsChangeDetail: false,
        componentsChangeTotal: 0,
        componentsDeployed: 150,
      })
    ).to.equal(false);
    expect(isComponentChangeDetailComplete(null)).to.equal(false);
  });
});
