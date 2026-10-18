// Replacement rules (Beta): change metadata files right before a deployment, for the org it goes to.
//
//   replacementRuleRoot.ts   base class of the rule types, and its subclasses next to it
//   engine/                  applies the rules to the files of a deployment (applyReplacementRules)
//   config/                  where rules are stored (project, branch files, issue) and how they merge
//   builtIn/                 list of the built-in rules, user permissions by API version, doc page
//   command/                 base class and flags of the hardis:project:replacement:* commands
//   utils/                   types, element paths, API version helpers

import { BuiltInRemovalRule } from './builtInRemovalRule.js';
import { FlowEndsBuiltInRule } from './flowEndsBuiltInRule.js';
import { ReplacementRuleRoot } from './replacementRuleRoot.js';
import { TextReplacementRule } from './textReplacementRule.js';
import { UnknownUserPermissionsBuiltInRule } from './unknownUserPermissionsBuiltInRule.js';
import { MergedReplacementRule } from './utils/types.js';
import { XmlRemoveReplacementRule } from './xmlRemoveReplacementRule.js';
import { XmlValueReplacementRule } from './xmlValueReplacementRule.js';

/** The class of a rule: the handler of a built-in rule, else the type of the rule */
export function createReplacementRule(rule: MergedReplacementRule): ReplacementRuleRoot {
  if (rule.builtIn) {
    switch (rule.builtIn.handler) {
      case 'flowEnds':
        return new FlowEndsBuiltInRule(rule);
      case 'unknownUserPermissions':
        return new UnknownUserPermissionsBuiltInRule(rule);
      default:
        return new BuiltInRemovalRule(rule);
    }
  }
  switch (rule.type) {
    case 'text':
      return new TextReplacementRule(rule);
    case 'xml-remove':
      return new XmlRemoveReplacementRule(rule);
    default:
      return new XmlValueReplacementRule(rule);
  }
}
