// Org health score computation.
//
// Pure functions: inputs are the sanitized notification objects collected from
// MONITORING_NOTIF_OUTPUT_DIR after a monitoring run (see monitoringNotifWriter.ts).
// No Salesforce API call, no command re-run.
//
// The score is meant to be computed on weekly monitoring runs only, when the weekly
// command batch provides the full input set. Sub-scores whose source notification is
// missing from the run are omitted (not counted as zero), and the global score is the
// weighted mean of available sub-scores.

import { t } from '../utils/i18n.js';

export interface HealthSubScores {
  reliability?: number;
  limits?: number;
  security?: number;
  tests?: number;
  debt?: number;
}

export interface HealthScoreResult {
  score: number;
  subScores: HealthSubScores;
  details: string[];
}

const SUB_SCORE_WEIGHTS: Record<keyof HealthSubScores, number> = {
  reliability: 30,
  security: 25,
  limits: 20,
  tests: 15,
  debt: 10,
};

// Any backup failure caps the global score: monitoring data is only trustworthy
// when the metadata backup pipeline works
const BACKUP_FAILURE_SCORE_CAP = 50;

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

// Metric values are either plain numbers or objects like { value, min, max, percent }
function metricNumber(metrics: any, key: string): number | null {
  if (metrics == null || typeof metrics !== 'object' || !(key in metrics)) {
    return null;
  }
  const raw = metrics[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (raw != null && typeof raw === 'object' && typeof raw.value === 'number' && Number.isFinite(raw.value)) {
    return raw.value;
  }
  return null;
}

function findNotifs(notifications: any[], type: string): any[] {
  return (notifications || []).filter((notif) => notif?.type === type);
}

// Stepwise scale shared by count-based penalties: transparent and easy to unit test
function scoreFromErrorCount(count: number): number {
  if (count <= 0) return 100;
  if (count <= 5) return 80;
  if (count <= 20) return 60;
  if (count <= 100) return 40;
  if (count <= 500) return 20;
  return 0;
}

function computeReliabilityScore(notifications: any[], details: string[]): number | undefined {
  const apexNotifs = findNotifs(notifications, 'APEX_ERROR');
  const flowNotifs = findNotifs(notifications, 'FLOW_ERROR');
  if (apexNotifs.length === 0 && flowNotifs.length === 0) {
    return undefined;
  }
  const apexErrors = metricNumber(apexNotifs[0]?.metrics, 'ApexErrors') ?? 0;
  const flowErrors = metricNumber(flowNotifs[0]?.metrics, 'FlowErrors') ?? 0;
  const score = scoreFromErrorCount(apexErrors + flowErrors);
  details.push(t('healthScoreDetailReliability', { apexErrors: apexErrors, flowErrors: flowErrors }));
  return score;
}

function computeLimitsScore(notifications: any[], details: string[]): number | undefined {
  const limitNotifs = findNotifs(notifications, 'ORG_LIMITS');
  if (limitNotifs.length === 0) {
    return undefined;
  }
  let worstPercent = 0;
  let worstName = '';
  const metrics = limitNotifs[0]?.metrics || {};
  for (const key of Object.keys(metrics)) {
    const raw = metrics[key];
    if (raw != null && typeof raw === 'object' && typeof raw.percent === 'number' && raw.percent > worstPercent) {
      worstPercent = raw.percent;
      worstName = key;
    }
  }
  // 100 while below 50% usage, then linear down to 0 at 100% usage
  const score = worstPercent <= 50 ? 100 : clamp(100 - (worstPercent - 50) * 2);
  details.push(t('healthScoreDetailLimits', { name: worstName || t('healthScoreDetailNone'), percent: worstPercent }));
  return score;
}

function computeSecurityScore(notifications: any[], details: string[]): number | undefined {
  const healthCheckNotifs = findNotifs(notifications, 'ORG_HEALTH_CHECK');
  const unsecuredAppsNotifs = findNotifs(notifications, 'UNSECURED_CONNECTED_APPS');
  const auditTrailNotifs = findNotifs(notifications, 'AUDIT_TRAIL');
  const legacyApiNotifs = findNotifs(notifications, 'LEGACY_API');
  if (
    healthCheckNotifs.length === 0 &&
    unsecuredAppsNotifs.length === 0 &&
    auditTrailNotifs.length === 0 &&
    legacyApiNotifs.length === 0
  ) {
    return undefined;
  }
  // Salesforce Security Health Check score is the base when available
  const healthCheckScore = metricNumber(healthCheckNotifs[0]?.metrics, 'Score');
  let score = healthCheckScore ?? 100;
  const parts: string[] = [];
  if (healthCheckScore != null) {
    parts.push(t('healthScoreDetailPartHealthCheck', { score: healthCheckScore }));
  }
  const unsecuredApps = metricNumber(unsecuredAppsNotifs[0]?.metrics, 'UnsecuredConnectedApps');
  if (unsecuredApps != null && unsecuredApps > 0) {
    score -= Math.min(20, unsecuredApps * 5);
    parts.push(t('healthScoreDetailPartUnsecuredApps', { nb: unsecuredApps }));
  }
  const suspectUpdates = metricNumber(auditTrailNotifs[0]?.metrics, 'SuspectMetadataUpdates');
  if (suspectUpdates != null && suspectUpdates > 0) {
    score -= Math.min(20, suspectUpdates * 2);
    parts.push(t('healthScoreDetailPartSuspectActions', { nb: suspectUpdates }));
  }
  const legacyApiCalls = metricNumber(legacyApiNotifs[0]?.metrics, 'LegacyApiCalls');
  if (legacyApiCalls != null && legacyApiCalls > 0) {
    score -= 10;
    parts.push(t('healthScoreDetailPartLegacyApi', { nb: legacyApiCalls }));
  }
  // NOTE: no DANGEROUS_PERMISSIONS penalty yet: hardis:org:diagnose:unsecure-permissions
  // does not send a notification for now. Add a penalty here the day it does.
  details.push(t('healthScoreDetailSecurity', { parts: parts.length > 0 ? parts.join(', ') : t('healthScoreDetailNoFindings') }));
  return clamp(score);
}

function computeTestsScore(notifications: any[], details: string[]): number | undefined {
  const apexTestsNotifs = findNotifs(notifications, 'APEX_TESTS');
  if (apexTestsNotifs.length === 0) {
    return undefined;
  }
  const metrics = apexTestsNotifs[0]?.metrics || {};
  const coverage = metricNumber(metrics, 'ApexTestsCodeCoverage');
  const failingClasses = metricNumber(metrics, 'ApexTestsFailingClasses') ?? 0;
  let score = 100;
  const parts: string[] = [];
  if (coverage != null) {
    parts.push(t('healthScoreDetailPartCoverage', { percent: coverage }));
    if (coverage < 75) {
      score -= (75 - coverage) * 2;
    }
  }
  if (failingClasses > 0) {
    score -= Math.min(40, failingClasses * 10);
    parts.push(t('healthScoreDetailPartFailingClasses', { nb: failingClasses }));
  }
  details.push(t('healthScoreDetailTests', { parts: parts.length > 0 ? parts.join(', ') : t('healthScoreDetailNoData') }));
  return clamp(score);
}

interface DebtPenaltyRule {
  type: string;
  metricKey: string;
  factor: number;
  cap: number;
  labelKey: string;
}

const DEBT_PENALTY_RULES: DebtPenaltyRule[] = [
  { type: 'UNUSED_METADATAS', metricKey: 'MetadatasNotUsed', factor: 0.5, cap: 30, labelKey: 'healthScoreDetailDebtUnusedMetadata' },
  { type: 'UNUSED_APEX_CLASSES', metricKey: 'unusedApexClasses', factor: 1, cap: 25, labelKey: 'healthScoreDetailDebtUnusedApex' },
  { type: 'METADATA_STATUS', metricKey: 'InactiveMetadatas', factor: 1, cap: 20, labelKey: 'healthScoreDetailDebtInactiveMetadata' },
  { type: 'MISSING_ATTRIBUTES', metricKey: 'MetadatasWithoutDescription', factor: 0.1, cap: 15, labelKey: 'healthScoreDetailDebtNoDescription' },
  { type: 'LINT_ACCESS', metricKey: 'ElementsWithNoProfileOrPermissionSetAccess', factor: 0.2, cap: 10, labelKey: 'healthScoreDetailDebtNoAccess' },
];

function computeDebtScore(notifications: any[], details: string[]): number | undefined {
  let found = false;
  let totalPenalty = 0;
  const parts: string[] = [];
  for (const rule of DEBT_PENALTY_RULES) {
    const notifs = findNotifs(notifications, rule.type);
    if (notifs.length === 0) {
      continue;
    }
    found = true;
    const count = metricNumber(notifs[0]?.metrics, rule.metricKey) ?? 0;
    if (count > 0) {
      totalPenalty += Math.min(rule.cap, count * rule.factor);
      parts.push(`${count} ${t(rule.labelKey)}`);
    }
  }
  if (!found) {
    return undefined;
  }
  details.push(t('healthScoreDetailDebt', { parts: parts.length > 0 ? parts.join(', ') : t('healthScoreDetailNoFindings') }));
  return clamp(100 - totalPenalty);
}

export function computeHealthScore(notifications: any[]): HealthScoreResult | null {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return null;
  }
  const details: string[] = [];
  const subScores: HealthSubScores = {};
  const reliability = computeReliabilityScore(notifications, details);
  if (reliability != null) subScores.reliability = reliability;
  const limits = computeLimitsScore(notifications, details);
  if (limits != null) subScores.limits = limits;
  const security = computeSecurityScore(notifications, details);
  if (security != null) subScores.security = security;
  const tests = computeTestsScore(notifications, details);
  if (tests != null) subScores.tests = tests;
  const debt = computeDebtScore(notifications, details);
  if (debt != null) subScores.debt = debt;

  const availableKeys = Object.keys(subScores) as (keyof HealthSubScores)[];
  if (availableKeys.length === 0) {
    return null;
  }
  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of availableKeys) {
    weightedSum += (subScores[key] as number) * SUB_SCORE_WEIGHTS[key];
    weightTotal += SUB_SCORE_WEIGHTS[key];
  }
  let score = Math.round(weightedSum / weightTotal);

  // Backup failure caps the global score
  const backupFailed = findNotifs(notifications, 'BACKUP').some((notif) =>
    ['error', 'critical'].includes(notif?.severity)
  );
  if (backupFailed && score > BACKUP_FAILURE_SCORE_CAP) {
    score = BACKUP_FAILURE_SCORE_CAP;
    details.push(t('healthScoreDetailBackupCap', { cap: BACKUP_FAILURE_SCORE_CAP }));
  }

  return { score, subScores, details };
}
