// Types of the replacement rules: what .sfdx-hardis.yml, the branch files and the issue hold,
// and what the engine reports after applying them.

export const REPLACEMENT_RULE_TYPES = ['xml-value', 'xml-remove', 'text'] as const;
export type ReplacementRuleType = (typeof REPLACEMENT_RULE_TYPES)[number];

// Where a rule is stored. 'builtin' is the list shipped with sfdx-hardis
export const REPLACEMENT_RULE_LAYERS = ['project', 'branch', 'issue'] as const;
export type ReplacementRuleLayer = (typeof REPLACEMENT_RULE_LAYERS)[number];
export type ReplacementRuleOrigin = ReplacementRuleLayer | 'builtin';

/** A place where rules are written: the project file, one branch file, or the issue */
export interface RulePlace {
  layer: ReplacementRuleLayer;
  branch?: string;
}

// Key of a values map that applies to any target without its own value
export const DEFAULT_VALUE_KEY = 'default';

/** A rule as written in a config file or in the issue. An override only holds the fields it changes. */
export interface ReplacementRule {
  id: string;
  description?: string;
  enabled?: boolean;
  type?: ReplacementRuleType;
  files?: string | string[];
  xmlPath?: string;
  find?: string;
  regex?: boolean;
  value?: string;
  values?: Record<string, string>;
  secret?: string;
  includeTargetBranches?: string[];
  excludeTargetBranches?: string[];
  required?: boolean;
}

/** A built-in rule: removes XML elements the deployment API version of the target org does not accept */
export interface BuiltInReplacementRule {
  id: string;
  description: string;
  files: string[];
  xmlPaths: string[];
  // The element exists from this API version: removed when the deployment version is lower
  introducedIn?: number;
  // The element is refused from this API version: removed when the deployment version is equal or higher
  removedIn?: number;
  defaultEnabled: boolean;
  // When disabled and the element is found, warn that the deployment will fail
  warnWhenDisabled?: boolean;
  // Custom processing instead of a plain removal
  handler?: 'flowEnds';
  source: string;
}

/** A rule after the layers were merged */
export interface MergedReplacementRule extends ReplacementRule {
  enabled: boolean;
  // Layers that defined or changed this rule, lowest first
  origins: ReplacementRuleOrigin[];
  builtIn?: BuiltInReplacementRule;
}

export interface ReplacementRulesLayers {
  project: { file: string; rules: ReplacementRule[] };
  branch: { branch: string; file: string; rules: ReplacementRule[] } | null;
  issue: IssueRulesState;
}

export interface IssueRulesState {
  available: boolean;
  number?: number;
  url?: string;
  rules: ReplacementRule[];
  error?: string;
}

/** Context of one application of the rules */
export interface ReplacementTarget {
  // Major branch of the target org, or null for a dev sandbox / scratch org
  targetBranch: string | null;
  // Name used in logs and comments ("uat", "a dev sandbox")
  label: string;
  // Deployment API version, null when unknown (built-in rules are then skipped)
  apiVersion: number | null;
}

export type ReplacementResultStatus =
  | 'changed'
  | 'unchanged'
  | 'not-found'
  | 'secret-missing'
  | 'no-value'
  | 'disabled'
  | 'risky-element';

export interface ReplacementFileResult {
  file: string;
  ruleId: string;
  origins: ReplacementRuleOrigin[];
  status: ReplacementResultStatus;
  // Number of elements or text occurrences changed or found
  count: number;
  detail?: string;
}

export type ReplacementWarningKind =
  | 'secret-missing'
  | 'required-no-match'
  | 'invalid-rule'
  | 'unknown-override'
  | 'issue-unreadable'
  | 'api-version-unknown'
  | 'risky-element'
  | 'file-error';

export interface ReplacementWarning {
  kind: ReplacementWarningKind;
  ruleId?: string;
  message: string;
}

export interface ReplacementRulesReport {
  target: ReplacementTarget;
  skipped?: 'env' | 'no-rules';
  results: ReplacementFileResult[];
  warnings: ReplacementWarning[];
  // Rules that applied, with the number of files they changed
  appliedRules: { id: string; origins: ReplacementRuleOrigin[]; files: number }[];
  issue?: { number?: number; url?: string };
}

/** Secret lookup described without its value */
export interface SecretLookupDescription {
  target: string;
  variables: string[];
}
