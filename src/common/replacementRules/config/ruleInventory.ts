// Everything `sf hardis:project:replacement:list --json` returns: the rules of every place, the
// effective rules of every target, the built-in rules. Read by agents and the VS Code panel.
// Never holds a secret value: only variable names.

import { listMajorOrgs } from '../../utils/orgConfigUtils.js';
import { t } from '../../utils/i18n.js';
import { buildActionTargetBranchCandidates, evaluateActionBranchFilter } from '../../utils/actionUtils.js';
import { getSecretsProvider } from '../../secretsProvider/index.js';
import { BUILT_IN_REPLACEMENT_RULES } from '../builtIn/builtInReplacementRules.js';
import { readIssueRules } from './issueRulesStore.js';
import { resolveRuleValue } from '../engine/ruleEngine.js';
import {
  mergeReplacementRules,
  readAllBranchReplacementRules,
  readProjectReplacementRules,
  readRulesFromFile,
  ReplacementRulesSource,
  resolveProjectConfigFile,
  validateReplacementRule,
} from './ruleConfig.js';
import { DEFAULT_VALUE_KEY, MergedReplacementRule, ReplacementRule, ReplacementRuleLayer, ReplacementRuleOrigin } from '../utils/types.js';

export interface RuleDefinition {
  layer: ReplacementRuleLayer;
  branch?: string;
  file?: string;
  rule: ReplacementRule;
  overrides: ReplacementRuleOrigin[];
  inherited?: boolean;
}

export interface EffectiveRule extends MergedReplacementRule {
  builtIn: any;
  applies: boolean;
  // Why the merged rule is skipped by the deployments, when it is invalid
  invalid?: string;
  resolved: { source: 'value' | 'branch' | 'default' | 'secret' | 'none'; value?: string; variables?: string[] };
}

/** One table row per stored rule, for the console. Secrets show their variable name only. */
export function summarizeRuleDefinitions(definitions: RuleDefinition[]): any[] {
  return definitions.map((definition) => {
    const rule = definition.rule;
    const value = rule.secret
      ? `secret ${rule.secret}`
      : rule.values
        ? Object.keys(rule.values).join(', ')
        : rule.value !== undefined
          ? rule.value
          : '';
    return {
      id: rule.id,
      place: definition.layer === 'branch' ? `branch ${definition.branch}` : definition.layer,
      type: rule.type || (definition.overrides.length > 0 ? `override of ${definition.overrides.join(', ')}` : ''),
      files: Array.isArray(rule.files) ? rule.files.join(', ') : rule.files || '',
      value,
      enabled: rule.enabled === false ? 'no' : 'yes',
    };
  });
}

export async function buildReplacementRulesInventory(options: { targetBranch?: string | null; skipIssue?: boolean }): Promise<any> {
  const projectFile = resolveProjectConfigFile();
  // What deployments read (with the rules of a remote `extends` config), and what the file holds
  const projectRules = await readProjectReplacementRules();
  const projectFileIds = new Set(readRulesFromFile(projectFile).map((rule) => rule.id));
  const branchLayers = await readAllBranchReplacementRules();
  const issue = options.skipIssue ? { available: false, rules: [] as ReplacementRule[] } : await readIssueRules({ useCache: false });
  const majorOrgs = [...(await listMajorOrgs())].sort((a: any, b: any) => (a.level || 0) - (b.level || 0));
  const majorBranches = majorOrgs.map((org: any) => ({ branchName: org.branchName, level: org.level }));
  const majorBranchNames = majorBranches.map((branch) => branch.branchName);
  const builtInIds = new Set(BUILT_IN_REPLACEMENT_RULES.map((rule) => rule.id));
  const secretsProvider = await getSecretsProvider();

  // Definitions, with the lower places they change
  const definitions: RuleDefinition[] = [];
  const projectIds = new Set(projectRules.map((rule) => rule.id));
  const branchIds = new Set(branchLayers.flatMap((layer) => layer.rules.map((rule) => rule.id)));
  for (const rule of projectRules) {
    definitions.push({
      layer: 'project',
      file: projectFile,
      rule,
      overrides: builtInIds.has(rule.id) ? ['builtin'] : [],
      // Comes from the remote config of `extends`: an update writes an override in the project file
      inherited: !projectFileIds.has(rule.id) || undefined,
    });
  }
  for (const layer of branchLayers) {
    for (const rule of layer.rules) {
      const overrides: ReplacementRuleOrigin[] = [];
      if (builtInIds.has(rule.id)) overrides.push('builtin');
      if (projectIds.has(rule.id)) overrides.push('project');
      definitions.push({ layer: 'branch', branch: layer.branch, file: layer.file, rule, overrides });
    }
  }
  for (const rule of issue.rules) {
    const overrides: ReplacementRuleOrigin[] = [];
    if (builtInIds.has(rule.id)) overrides.push('builtin');
    if (projectIds.has(rule.id)) overrides.push('project');
    if (branchIds.has(rule.id)) overrides.push('branch');
    definitions.push({ layer: 'issue', rule, overrides });
  }

  // Invalid definitions
  const issues: { ruleId?: string; layer: string; branch?: string; message: string }[] = [];
  for (const definition of definitions) {
    if (definition.layer === 'issue' && definition.rule.secret !== undefined) {
      issues.push({ ruleId: definition.rule.id, layer: definition.layer, message: t('replacementRulesReasonSecretInIssue') });
      continue;
    }
    if (definition.rule.type) {
      const error = validateReplacementRule(definition.rule);
      if (error) {
        issues.push({ ruleId: definition.rule.id, layer: definition.layer, branch: definition.branch, message: error });
      }
    } else if (definition.overrides.length === 0) {
      issues.push({ ruleId: definition.rule.id, layer: definition.layer, branch: definition.branch, message: t('replacementRulesReasonOverrideUnknown') });
    }
  }

  // Effective rules of each target
  const targets = options.targetBranch !== undefined ? [options.targetBranch || DEFAULT_VALUE_KEY] : [...majorBranchNames, DEFAULT_VALUE_KEY];
  const effective: Record<string, EffectiveRule[]> = {};
  for (const target of targets) {
    const targetBranch = target === DEFAULT_VALUE_KEY ? null : target;
    const sources: ReplacementRulesSource[] = [{ origin: 'project', rules: projectRules }];
    const branchLayer = targetBranch ? branchLayers.find((layer) => layer.branch === targetBranch.replace(/\//g, '__')) : null;
    if (branchLayer) {
      sources.push({ origin: 'branch', branch: targetBranch as string, rules: branchLayer.rules });
    }
    sources.push({ origin: 'issue', rules: issue.rules });
    const { rules } = mergeReplacementRules(sources);
    const candidates = buildActionTargetBranchCandidates(targetBranch || '', majorBranchNames);
    effective[target] = rules.map((rule) => {
      // Same check as the deployments, which skip an invalid merged rule
      const invalid = !rule.builtIn && rule.enabled ? validateReplacementRule(rule) || undefined : undefined;
      const applies = rule.enabled && !invalid && (rule.builtIn ? true : evaluateActionBranchFilter(rule, candidates).run);
      let resolved: EffectiveRule['resolved'] = { source: 'none' };
      if (!rule.builtIn && rule.type !== 'xml-remove') {
        if (rule.secret) {
          resolved = { source: 'secret', variables: secretsProvider.describeLookup(rule.secret, targetBranch) };
        } else if (rule.values && Object.keys(rule.values).length > 0) {
          const value = resolveRuleValue(rule, targetBranch);
          const ownKey = targetBranch && Object.keys(rule.values).some((key) => key.replace(/\//g, '__').toLowerCase() === targetBranch.replace(/\//g, '__').toLowerCase());
          resolved = value == null ? { source: 'none' } : { source: ownKey ? 'branch' : 'default', value };
        } else if (rule.value !== undefined) {
          resolved = { source: 'value', value: rule.value };
        }
      }
      const { builtIn, ...rest } = rule;
      return { ...rest, builtIn: !!builtIn, applies, invalid, resolved } as EffectiveRule;
    });
  }

  // Built-in rules, with their state for the whole project (project + issue places)
  const globalMerge = mergeReplacementRules([{ origin: 'project', rules: projectRules }, { origin: 'issue', rules: issue.rules }]).rules;
  const builtInRules = BUILT_IN_REPLACEMENT_RULES.map((builtIn) => {
    const merged = globalMerge.find((rule) => rule.id === builtIn.id);
    const overriddenIn = definitions
      .filter((definition) => definition.rule.id === builtIn.id)
      .map((definition) => (definition.branch ? { layer: definition.layer, branch: definition.branch } : { layer: definition.layer }));
    return { ...builtIn, enabled: merged ? merged.enabled : builtIn.defaultEnabled, overriddenIn };
  });

  // Secret variable names of every target
  const secretLookups: Record<string, { target: string; variables: string[] }[]> = {};
  for (const secretName of new Set(definitions.map((definition) => definition.rule.secret).filter(Boolean) as string[])) {
    secretLookups[secretName] = [...majorBranchNames, DEFAULT_VALUE_KEY].map((target) => ({
      target,
      variables: secretsProvider.describeLookup(secretName, target === DEFAULT_VALUE_KEY ? null : target),
    }));
  }

  return {
    definitions,
    effective,
    builtInRules,
    layers: {
      project: { file: projectFile, count: projectRules.length },
      branches: branchLayers.map((layer) => ({ branch: layer.branch, file: layer.file, count: layer.rules.length })),
      issue: { available: issue.available, number: (issue as any).number, url: (issue as any).url, error: (issue as any).error, count: issue.rules.length },
    },
    majorBranches,
    secretsProvider: secretsProvider.getKey(),
    secretLookups,
    issues,
  };
}
