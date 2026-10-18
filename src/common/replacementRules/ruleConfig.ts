// Where replacement rules are stored, how the layers merge, and how a rule is validated.
//
// Layers, lowest first: built-in rules, project config, branch file of the target, git provider issue.
// The same id in a higher layer changes the fields it sets (values are merged org by org), so
// `{ id: builtin-x, enabled: false }` turns a built-in rule off and `{ id: x, values: { uat: y } }`
// changes the value of one org.

import * as path from 'path';
import fs from '../utils/fsUtils.js';
import yaml from 'js-yaml';
import { glob } from 'glob';
import { getConfig } from '../../config/index.js';
import { dumpRepositoryYaml } from '../utils/yamlUtils.js';
import { clearListMajorOrgsCache } from '../utils/orgConfigUtils.js';
import { BUILT_IN_REPLACEMENT_RULES } from './builtInReplacementRules.js';
import { validateXmlPath } from './xmlPath.js';
import { t } from '../utils/i18n.js';
import {
  BuiltInReplacementRule,
  DEFAULT_VALUE_KEY,
  MergedReplacementRule,
  REPLACEMENT_RULE_TYPES,
  ReplacementRule,
  ReplacementRuleOrigin,
  ReplacementWarning,
} from './types.js';

export const REPLACEMENT_RULES_CONFIG_KEY = 'replacementRules';
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PROJECT_CONFIG_CANDIDATES = ['.sfdx-hardis.yml', '.sfdx-hardis.yaml', 'config/.sfdx-hardis.yaml', 'config/.sfdx-hardis.yml'];

export interface ReplacementRulesSource {
  origin: ReplacementRuleOrigin;
  branch?: string;
  rules: ReplacementRule[];
}

/** File holding the project configuration: the existing one, config/.sfdx-hardis.yml otherwise */
export function resolveProjectConfigFile(): string {
  for (const candidate of PROJECT_CONFIG_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join('config', '.sfdx-hardis.yml');
}

/** Branch config file, named the way the config loader reads it (release/uat -> release__uat) */
export function resolveBranchConfigFile(branch: string): string {
  const formatted = branch.replace(/\//g, '__');
  const yamlFile = path.join('config', 'branches', `.sfdx-hardis.${formatted}.yaml`);
  if (fs.existsSync(yamlFile)) {
    return yamlFile;
  }
  return path.join('config', 'branches', `.sfdx-hardis.${formatted}.yml`);
}

/** Rules of the project configuration, including a remote `extends` configuration */
export async function readProjectReplacementRules(): Promise<ReplacementRule[]> {
  const config = await getConfig('project');
  return normalizeRuleList(config?.[REPLACEMENT_RULES_CONFIG_KEY]);
}

export function readBranchReplacementRules(branch: string): ReplacementRule[] {
  return normalizeRuleList(readYamlFile(resolveBranchConfigFile(branch))[REPLACEMENT_RULES_CONFIG_KEY]);
}

/** Every branch config file with its rules, for the list command */
export async function readAllBranchReplacementRules(): Promise<{ branch: string; file: string; rules: ReplacementRule[] }[]> {
  const files = await glob('config/branches/.sfdx-hardis.*.{yml,yaml}', { cwd: process.cwd(), dot: true, posix: true });
  return files
    .sort()
    .map((file) => {
      const branch = path.basename(file).replace(/^\.sfdx-hardis\./, '').replace(/\.ya?ml$/, '');
      return { branch, file, rules: normalizeRuleList(readYamlFile(file)[REPLACEMENT_RULES_CONFIG_KEY]) };
    });
}

/** Rules stored directly in a config file (project or branch), for the write commands */
export function readRulesFromFile(file: string): ReplacementRule[] {
  return normalizeRuleList(readYamlFile(file)[REPLACEMENT_RULES_CONFIG_KEY]);
}

/** Write the rules of a config file, keeping every other key */
export async function writeRulesToFile(file: string, rules: ReplacementRule[]): Promise<void> {
  const doc: any = readYamlFile(file);
  if (rules.length > 0) {
    doc[REPLACEMENT_RULES_CONFIG_KEY] = rules.map((rule) => cleanRuleForStorage(rule));
  } else {
    delete doc[REPLACEMENT_RULES_CONFIG_KEY];
  }
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, dumpRepositoryYaml(doc));
  if (file.includes(`${path.sep}branches${path.sep}`) || file.includes('/branches/')) {
    clearListMajorOrgsCache();
  }
}

/**
 * Merge the layers. Pure function: the sources are passed already read.
 * Built-in rules always come first; their `enabled` is their default until a layer changes it.
 */
export function mergeReplacementRules(
  sources: ReplacementRulesSource[],
  builtIns: BuiltInReplacementRule[] = BUILT_IN_REPLACEMENT_RULES
): { rules: MergedReplacementRule[]; warnings: ReplacementWarning[] } {
  const warnings: ReplacementWarning[] = [];
  const merged = new Map<string, MergedReplacementRule>();
  for (const builtIn of builtIns) {
    merged.set(builtIn.id, {
      id: builtIn.id,
      description: builtIn.description,
      type: 'xml-remove',
      files: builtIn.files,
      enabled: builtIn.defaultEnabled,
      origins: ['builtin'],
      builtIn,
    });
  }
  for (const source of sources) {
    for (const rule of source.rules) {
      if (!rule?.id) {
        warnings.push({ kind: 'invalid-rule', message: t('replacementRulesRuleWithoutId', { place: source.origin }) });
        continue;
      }
      // Rules of the issue reach the deployments without review: they never read a secret
      if (source.origin === 'issue' && rule.secret !== undefined) {
        warnings.push({ kind: 'invalid-rule', ruleId: rule.id, message: t('replacementRulesSecretInIssue', { id: rule.id }) });
        continue;
      }
      const existing = merged.get(rule.id);
      if (existing) {
        if (existing.builtIn) {
          // A built-in rule can only be turned on or off
          if (rule.enabled !== undefined) {
            existing.enabled = rule.enabled !== false;
          }
        } else {
          mergeRuleInto(existing, rule);
        }
        if (!existing.origins.includes(source.origin)) {
          existing.origins.push(source.origin);
        }
        continue;
      }
      if (!rule.type) {
        warnings.push({ kind: 'unknown-override', ruleId: rule.id, message: t('replacementRulesUnknownOverride', { id: rule.id, place: source.origin }) });
        continue;
      }
      merged.set(rule.id, { ...stripUndefined(rule), id: rule.id, enabled: rule.enabled !== false, origins: [source.origin] });
    }
  }
  return { rules: [...merged.values()], warnings };
}

/** Why a merged rule cannot be applied, or null when it is valid */
export function validateReplacementRule(rule: ReplacementRule): string | null {
  if (!rule.id || !RULE_ID_PATTERN.test(rule.id)) {
    return t('replacementRulesReasonId', { id: rule.id || '' });
  }
  if (!rule.type || !REPLACEMENT_RULE_TYPES.includes(rule.type)) {
    return t('replacementRulesReasonType', { types: REPLACEMENT_RULE_TYPES.join(', ') });
  }
  const files = toFileList(rule.files);
  if (files.length === 0) {
    return t('replacementRulesReasonFiles');
  }
  if (rule.type === 'xml-value' || rule.type === 'xml-remove') {
    if (!rule.xmlPath) {
      return t('replacementRulesReasonXmlPath');
    }
    const pathError = validateXmlPath(rule.xmlPath);
    if (pathError) {
      return t('replacementRulesReasonXmlPathInvalid', { error: pathError });
    }
  }
  if (rule.type === 'text') {
    if (!rule.find) {
      return t('replacementRulesReasonFind');
    }
    if (rule.regex === true) {
      try {
        new RegExp(rule.find, 'g');
      } catch (e: any) {
        return t('replacementRulesReasonRegex', { error: e.message });
      }
    }
  }
  const valueSources = [rule.value !== undefined, rule.values !== undefined && Object.keys(rule.values).length > 0, !!rule.secret].filter(Boolean).length;
  if (rule.type === 'xml-remove' && valueSources > 0) {
    return t('replacementRulesReasonRemoveNoValue');
  }
  if (rule.type !== 'xml-remove' && valueSources !== 1) {
    return t('replacementRulesReasonOneValue');
  }
  if (rule.secret && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(rule.secret)) {
    return t('replacementRulesReasonSecretName', { secret: rule.secret });
  }
  if ((rule.includeTargetBranches || []).length > 0 && (rule.excludeTargetBranches || []).length > 0) {
    return t('replacementRulesReasonBranchFilters');
  }
  return null;
}

export function toFileList(files: string | string[] | undefined): string[] {
  if (!files) {
    return [];
  }
  return (Array.isArray(files) ? files : [files]).map((file) => String(file).trim()).filter((file) => file !== '');
}

/** Replace (or add) a rule in a list, or merge the given fields into it */
export function upsertRuleInList(rules: ReplacementRule[], rule: ReplacementRule, mode: 'replace' | 'merge'): ReplacementRule[] {
  const index = rules.findIndex((existing) => existing.id === rule.id);
  if (index === -1) {
    return [...rules, rule];
  }
  const updated = [...rules];
  if (mode === 'replace') {
    updated[index] = rule;
  } else {
    const values = rule.values ? { ...(updated[index].values || {}), ...rule.values } : updated[index].values;
    updated[index] = { ...updated[index], ...stripUndefined(rule) };
    if (values) {
      updated[index].values = values;
    }
  }
  return updated;
}

/** Keep only what a rule really sets, in a stable key order */
export function cleanRuleForStorage(rule: ReplacementRule): ReplacementRule {
  const order: (keyof ReplacementRule)[] = [
    'id', 'description', 'enabled', 'type', 'files', 'xmlPath', 'find', 'regex',
    'value', 'values', 'secret', 'includeTargetBranches', 'excludeTargetBranches', 'required',
  ];
  const cleaned: any = {};
  for (const key of order) {
    const value: any = (rule as any)[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (key === 'values' && typeof value === 'object' && Object.keys(value).length === 0) {
      continue;
    }
    cleaned[key] = key === 'files' && Array.isArray(value) && value.length === 1 ? value[0] : value;
  }
  return cleaned;
}

export function normalizeRuleList(value: any): ReplacementRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule) => {
      const normalized: any = { ...rule, id: rule.id != null ? String(rule.id) : rule.id };
      if (normalized.values && typeof normalized.values === 'object') {
        // YAML can turn a value into a number or a boolean: rules write text
        normalized.values = Object.fromEntries(Object.entries(normalized.values).map(([key, item]) => [String(key), item == null ? '' : String(item)]));
      }
      if (normalized.value != null && typeof normalized.value !== 'string') {
        normalized.value = String(normalized.value);
      }
      return normalized as ReplacementRule;
    });
}

/**
 * Change a merged rule with the fields of a higher place. Setting one value source replaces the
 * other ones; values over a single value keep it as the default of the other orgs.
 */
function mergeRuleInto(existing: MergedReplacementRule, rule: ReplacementRule): void {
  let values = existing.values;
  if (rule.secret !== undefined) {
    delete existing.value;
    values = undefined;
  } else if (rule.value !== undefined) {
    delete existing.secret;
    values = undefined;
  } else if (rule.values !== undefined) {
    if (existing.secret !== undefined) {
      delete existing.secret;
      values = { ...rule.values };
    } else if (existing.value !== undefined) {
      values = { [DEFAULT_VALUE_KEY]: existing.value, ...(existing.values || {}), ...rule.values };
      delete existing.value;
    } else {
      values = { ...(existing.values || {}), ...rule.values };
    }
  }
  Object.assign(existing, stripUndefined(rule));
  if (values) {
    existing.values = values;
  } else {
    delete existing.values;
  }
  if (rule.enabled !== undefined) {
    existing.enabled = rule.enabled !== false;
  }
}

function readYamlFile(file: string): any {
  if (!fs.existsSync(file)) {
    return {};
  }
  return (yaml.load(fs.readFileSync(file, 'utf-8')) as any) || {};
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
