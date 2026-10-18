// Flags of hardis:project:replacement:create and update, and how they become a rule.
// Agents and the VS Code panel pass either a whole rule (--rule-file / --rule) or field flags.

import { Flags } from '@salesforce/sf-plugins-core';
import { SfError } from '@salesforce/core';
import fs from '../../utils/fsUtils.js';
import { t } from '../../utils/i18n.js';
import { normalizeRuleList } from '../config/ruleConfig.js';
import { REPLACEMENT_RULE_LAYERS, REPLACEMENT_RULE_TYPES, ReplacementRule } from './types.js';

// i18n keys of the rule types, for prompts
export const RULE_TYPE_LABEL_KEYS: Record<string, string> = {
  'xml-value': 'replacementRulesTypeXmlValue',
  'xml-remove': 'replacementRulesTypeXmlRemove',
  text: 'replacementRulesTypeText',
};

export const RULE_FIELD_KEYS = [
  'description', 'enabled', 'type', 'files', 'xmlPath', 'find', 'regex',
  'value', 'values', 'secret', 'includeTargetBranches', 'excludeTargetBranches', 'required',
] as const;

/** Flags that choose where a rule is stored */
export function replacementRuleLayerFlags(): any {
  return {
    layer: Flags.string({
      options: [...REPLACEMENT_RULE_LAYERS],
      description: 'Where the rule is stored: project (config/.sfdx-hardis.yml), branch (config/branches/.sfdx-hardis.<branch>.yml) or issue (git provider issue, no commit needed)',
    }),
    branch: Flags.string({
      description: 'Major branch of the branch config file, with --layer branch',
    }),
  };
}

/** Flags describing a rule, field by field */
export function replacementRuleFieldFlags(): any {
  return {
    rule: Flags.string({
      description: 'Whole rule as JSON, instead of the field flags',
    }),
    'rule-file': Flags.string({
      description: 'Path of a JSON file holding the whole rule, instead of the field flags',
    }),
    description: Flags.string({ description: 'Description shown in logs and Pull Request comments' }),
    type: Flags.string({
      options: [...REPLACEMENT_RULE_TYPES],
      description: 'xml-value (set an XML element), xml-remove (remove an XML element) or text (find and replace)',
    }),
    files: Flags.string({ multiple: true, description: 'Glob of the files the rule applies to, from the repository root (can be repeated)' }),
    'xml-path': Flags.string({ description: 'Element path, for example NamedCredential/endpoint, Workflow/alerts[fullName=MyAlert]/senderAddress, or Profile/userPermissions[name=ViewSetup] to remove one user permission' }),
    find: Flags.string({ description: 'Text or regular expression to find, with --type text' }),
    regex: Flags.boolean({ allowNo: true, description: '--find is a regular expression' }),
    value: Flags.string({ description: 'Same value for every org' }),
    'value-for': Flags.string({
      multiple: true,
      description: 'Value for one target, as <branch>=<value> or default=<value> (can be repeated). An empty value removes it',
    }),
    secret: Flags.string({ description: 'Name of the CI/CD variable holding the value (NAME_<BRANCH> is read first, then NAME). Never a value' }),
    'include-branches': Flags.string({ description: 'Comma-separated target branches the rule applies to (dev-sandboxes for any other org). Empty value removes the filter' }),
    'exclude-branches': Flags.string({ description: 'Comma-separated target branches the rule does not apply to. Empty value removes the filter' }),
    required: Flags.boolean({ allowNo: true, description: 'Warn in the Pull Request comment when the files are deployed but nothing matches' }),
    enabled: Flags.string({ options: ['true', 'false'], description: 'Turn the rule on or off (also works for a built-in rule)' }),
  };
}

/** A whole rule from --rule-file or --rule, or null when neither is given */
export async function readRuleFromFlags(flags: any): Promise<ReplacementRule | null> {
  let raw: any = null;
  if (flags['rule-file']) {
    try {
      raw = JSON.parse(await fs.readFile(flags['rule-file'], 'utf8'));
    } catch (e: any) {
      throw new SfError(t('replacementRulesBadRuleJson', { message: e.message }));
    }
  } else if (flags.rule) {
    try {
      raw = JSON.parse(flags.rule);
    } catch (e: any) {
      throw new SfError(t('replacementRulesBadRuleJson', { message: e.message }));
    }
  }
  if (raw == null) {
    return null;
  }
  const [rule] = normalizeRuleList([raw]);
  if (!rule) {
    throw new SfError(t('replacementRulesBadRuleJson', { message: 'not an object' }));
  }
  return rule;
}

/**
 * The fields set by the field flags. `removedValueKeys` lists the targets given an empty
 * --value-for, to remove from the stored values.
 */
export function buildRuleFieldsFromFlags(flags: any): { fields: Partial<ReplacementRule>; removedValueKeys: string[]; hasFields: boolean } {
  const fields: Partial<ReplacementRule> = {};
  const removedValueKeys: string[] = [];
  if (flags.description !== undefined) fields.description = flags.description;
  if (flags.type !== undefined) fields.type = flags.type;
  if (flags.files !== undefined) fields.files = flags.files.length === 1 ? flags.files[0] : flags.files;
  if (flags['xml-path'] !== undefined) fields.xmlPath = flags['xml-path'];
  if (flags.find !== undefined) fields.find = flags.find;
  if (flags.regex !== undefined) fields.regex = flags.regex;
  if (flags.value !== undefined) fields.value = flags.value;
  if (flags.secret !== undefined) fields.secret = flags.secret;
  if (flags.required !== undefined) fields.required = flags.required;
  if (flags.enabled !== undefined) fields.enabled = flags.enabled === 'true';
  if (flags['include-branches'] !== undefined) fields.includeTargetBranches = splitList(flags['include-branches']);
  if (flags['exclude-branches'] !== undefined) fields.excludeTargetBranches = splitList(flags['exclude-branches']);
  if (flags['value-for'] !== undefined) {
    const values: Record<string, string> = {};
    for (const entry of flags['value-for'] as string[]) {
      const equal = entry.indexOf('=');
      if (equal <= 0) {
        throw new SfError(t('replacementRulesBadValueFor', { entry }));
      }
      const key = entry.substring(0, equal).trim();
      const value = entry.substring(equal + 1);
      if (value === '') {
        removedValueKeys.push(key);
      } else {
        values[key] = value;
      }
    }
    if (Object.keys(values).length > 0) {
      fields.values = values;
    }
  }
  const hasFields = Object.keys(fields).length > 0 || removedValueKeys.length > 0;
  return { fields, removedValueKeys, hasFields };
}

/** Apply field flags to a stored rule. Setting one value source clears the other ones. */
export function applyRuleFields(rule: ReplacementRule, fields: Partial<ReplacementRule>, removedValueKeys: string[], unset: string[] = []): ReplacementRule {
  const updated: any = { ...rule };
  if (fields.value !== undefined) {
    delete updated.values;
    delete updated.secret;
  }
  if (fields.secret !== undefined) {
    delete updated.values;
    delete updated.value;
  }
  if (fields.values !== undefined) {
    delete updated.value;
    delete updated.secret;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'values') {
      updated.values = { ...(updated.values || {}), ...(value as any) };
    } else {
      updated[key] = value;
    }
  }
  for (const key of removedValueKeys) {
    if (updated.values) {
      delete updated.values[key];
    }
  }
  for (const key of unset) {
    if (!(RULE_FIELD_KEYS as readonly string[]).includes(key)) {
      throw new SfError(t('replacementRulesBadUnset', { field: key, fields: RULE_FIELD_KEYS.join(', ') }));
    }
    delete updated[key];
  }
  return updated;
}

function splitList(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
