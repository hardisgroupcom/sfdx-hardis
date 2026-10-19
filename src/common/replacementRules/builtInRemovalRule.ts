// Built-in rules (builtIn/builtInReplacementRules.ts): remove the XML elements the deployment API
// version of the target org does not accept. A built-in rule turned off but marked
// warnWhenDisabled only reports the elements the deployment will fail on.
// Subclasses change what is removed when deleting the matching elements is not enough.

import { t } from '../utils/i18n.js';
import { ReplacementOutcome, ReplacementRuleRoot } from './replacementRuleRoot.js';
import { formatApiVersion } from './utils/apiVersionUtils.js';
import { BuiltInReplacementRule, ReplacementTarget } from './utils/types.js';
import { removeXmlNode, selectXmlPath } from './utils/xmlPath.js';

export class BuiltInRemovalRule extends ReplacementRuleRoot {
  public readonly scope = 'xml' as const;

  public applyToXml(doc: any, value: string | null, target: ReplacementTarget): ReplacementOutcome {
    void value;
    if (!this.rule.enabled) {
      const found = this.builtIn.xmlPaths.reduce((total, xmlPath) => total + selectXmlPath(xmlPath, doc).length, 0);
      return found > 0
        ? { found, changed: 0, status: 'risky-element', detail: this.builtIn.xmlPaths.join(', ') }
        : { found: 0, changed: 0, status: 'not-found' };
    }
    const removed = this.removeElements(doc);
    if (removed === 0) {
      return { found: 0, changed: 0, status: 'not-found' };
    }
    return {
      found: removed,
      changed: removed,
      status: 'changed',
      detail: t('replacementRulesRemovedForApi', { count: removed, apiVersion: formatApiVersion(target.apiVersion) }),
    };
  }

  protected get builtIn(): BuiltInReplacementRule {
    return this.rule.builtIn as BuiltInReplacementRule;
  }

  /** Remove what the target org refuses. Returns the number of elements removed */
  protected removeElements(doc: any): number {
    let removed = 0;
    for (const xmlPath of this.builtIn.xmlPaths) {
      for (const node of selectXmlPath(xmlPath, doc)) {
        removeXmlNode(node);
        removed++;
      }
    }
    return removed;
  }
}
