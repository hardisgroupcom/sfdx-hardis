// Checks of hardis:project:replacement:update: a full rule must be valid, an override must change
// a rule that exists somewhere else, and a built-in rule can only be turned on or off.

import { BUILT_IN_REPLACEMENT_RULES, findBuiltInReplacementRule } from '../builtIn/builtInReplacementRules.js';
import { readIssueRules } from './issueRulesStore.js';
import { readAllBranchReplacementRules, readRulesFromFile, resolveProjectConfigFile, validateReplacementRule } from './ruleConfig.js';
import { ReplacementRule, RulePlace } from '../utils/types.js';
import { t } from '../../utils/i18n.js';

/** Why a rule cannot be stored in this place whatever it holds, or null */
export function checkRulePlace(rule: ReplacementRule, place: RulePlace): string | null {
  // Rules of the issue reach the deployments without review: they never read a secret
  if (place.layer === 'issue' && rule.secret !== undefined) {
    return t('replacementRulesReasonSecretInIssue');
  }
  return null;
}

/** Why the rule cannot be stored in this place, or null */
export async function checkRuleUpdate(rule: ReplacementRule, place: RulePlace): Promise<string | null> {
  const placeProblem = checkRulePlace(rule, place);
  if (placeProblem) {
    return placeProblem;
  }
  if (findBuiltInReplacementRule(rule.id)) {
    const otherFields = Object.keys(rule).filter((key) => key !== 'id' && key !== 'enabled');
    return otherFields.length > 0 ? t('replacementRulesReasonBuiltInOnlyEnabled', { fields: otherFields.join(', ') }) : null;
  }
  if (rule.type) {
    return validateReplacementRule(rule);
  }
  const definedElsewhere = (await listRuleIdsByPlace()).some(
    (entry) => entry.ids.has(rule.id) && !(entry.place.layer === place.layer && (entry.place.branch || '') === (place.branch || ''))
  );
  return definedElsewhere ? null : t('replacementRulesReasonOverrideUnknown');
}

/** Ids of every rule defined somewhere, built-in ones included, for prompts */
export async function listKnownRuleIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const entry of await listRuleIdsByPlace()) {
    entry.ids.forEach((id) => ids.add(id));
  }
  BUILT_IN_REPLACEMENT_RULES.forEach((rule) => ids.add(rule.id));
  return [...ids].sort();
}

async function listRuleIdsByPlace(): Promise<{ place: RulePlace; ids: Set<string> }[]> {
  const entries: { place: RulePlace; ids: Set<string> }[] = [
    { place: { layer: 'project' }, ids: new Set(readRulesFromFile(resolveProjectConfigFile()).map((rule) => rule.id)) },
  ];
  for (const layer of await readAllBranchReplacementRules()) {
    entries.push({ place: { layer: 'branch', branch: layer.branch }, ids: new Set(layer.rules.map((rule) => rule.id)) });
  }
  const issue = await readIssueRules({ useCache: false });
  entries.push({ place: { layer: 'issue' }, ids: new Set(issue.rules.map((rule) => rule.id)) });
  return entries;
}
