import { strict as assert } from 'assert';
import { computeHealthScore } from '../../../src/common/monitoring/healthScore.js';

const notif = (type: string, metrics: any = {}, severity = 'log') => ({ type, severity, metrics, data: {} });

describe('computeHealthScore', () => {
  it('returns null when there are no notifications', () => {
    assert.equal(computeHealthScore([]), null);
    assert.equal(computeHealthScore(null as any), null);
  });

  it('returns null when no known indicator is present', () => {
    assert.equal(computeHealthScore([notif('ORG_INFO')]), null);
  });

  it('gives a perfect score for a clean org', () => {
    const result = computeHealthScore([
      notif('APEX_ERROR', { ApexErrors: 0 }),
      notif('FLOW_ERROR', { FlowErrors: 0 }),
      notif('ORG_LIMITS', { DailyApiRequests: { value: 100, max: 10000, percent: 1 } }),
      notif('ORG_HEALTH_CHECK', { Score: 100 }),
      notif('APEX_TESTS', { ApexTestsCodeCoverage: 90, ApexTestsFailingClasses: 0 }),
      notif('UNUSED_METADATAS', { MetadatasNotUsed: 0 }),
    ]);
    assert.ok(result);
    assert.equal(result!.score, 100);
    assert.equal(result!.subScores.reliability, 100);
    assert.equal(result!.subScores.limits, 100);
    assert.equal(result!.subScores.security, 100);
    assert.equal(result!.subScores.tests, 100);
    assert.equal(result!.subScores.debt, 100);
  });

  it('omits sub-scores whose source notification is missing', () => {
    const result = computeHealthScore([notif('APEX_ERROR', { ApexErrors: 0 }), notif('FLOW_ERROR', { FlowErrors: 0 })]);
    assert.ok(result);
    assert.equal(result!.subScores.reliability, 100);
    assert.equal(result!.subScores.limits, undefined);
    assert.equal(result!.subScores.security, undefined);
    assert.equal(result!.score, 100);
  });

  it('penalizes errors stepwise', () => {
    const scoreFor = (apex: number, flow: number) =>
      computeHealthScore([notif('APEX_ERROR', { ApexErrors: apex }), notif('FLOW_ERROR', { FlowErrors: flow })])!
        .subScores.reliability;
    assert.equal(scoreFor(0, 0), 100);
    assert.equal(scoreFor(2, 1), 80);
    assert.equal(scoreFor(10, 5), 60);
    assert.equal(scoreFor(80, 10), 40);
    assert.equal(scoreFor(400, 50), 20);
    assert.equal(scoreFor(1000, 0), 0);
  });

  it('scores limits from the worst percent', () => {
    const result = computeHealthScore([
      notif('ORG_LIMITS', {
        DailyApiRequests: { value: 10, max: 100, percent: 10 },
        DataStorageMB: { value: 75, max: 100, percent: 75 },
      }),
    ]);
    assert.equal(result!.subScores.limits, 50); // 100 - (75-50)*2
  });

  it('uses the Salesforce health check score as security base and subtracts findings', () => {
    const result = computeHealthScore([
      notif('ORG_HEALTH_CHECK', { Score: 80 }),
      notif('UNSECURED_CONNECTED_APPS', { UnsecuredConnectedApps: 2 }),
      notif('LEGACY_API', { LegacyApiCalls: 100 }),
    ]);
    // 80 - 10 (2 unsecured apps * 5) - 10 (legacy api)
    assert.equal(result!.subScores.security, 60);
  });

  it('penalizes low coverage and failing tests', () => {
    const result = computeHealthScore([notif('APEX_TESTS', { ApexTestsCodeCoverage: 65, ApexTestsFailingClasses: 2 })]);
    // 100 - (75-65)*2 - 20
    assert.equal(result!.subScores.tests, 60);
  });

  it('caps the global score at 50 when a backup failed', () => {
    const result = computeHealthScore([
      notif('APEX_ERROR', { ApexErrors: 0 }),
      notif('FLOW_ERROR', { FlowErrors: 0 }),
      notif('BACKUP', {}, 'error'),
    ]);
    assert.equal(result!.score, 50);
    assert.ok(result!.details.some((d) => d.includes('capped')));
  });

  it('does not cap when backup succeeded', () => {
    const result = computeHealthScore([
      notif('APEX_ERROR', { ApexErrors: 0 }),
      notif('FLOW_ERROR', { FlowErrors: 0 }),
      notif('BACKUP', {}, 'success'),
    ]);
    assert.equal(result!.score, 100);
  });

  it('weights sub-scores in the global score', () => {
    const result = computeHealthScore([
      notif('APEX_ERROR', { ApexErrors: 1000 }), // reliability 0, weight 30
      notif('ORG_LIMITS', { DailyApiRequests: { value: 1, max: 100, percent: 1 } }), // limits 100, weight 20
    ]);
    // (0*30 + 100*20) / 50 = 40
    assert.equal(result!.score, 40);
  });

  it('accepts object-form metric values', () => {
    const result = computeHealthScore([notif('APEX_ERROR', { ApexErrors: { value: 3 } }), notif('FLOW_ERROR', {})]);
    assert.equal(result!.subScores.reliability, 80);
  });
});
