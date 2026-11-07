// Built-in rules (builtIn/builtInReplacementRules.ts): remove the XML elements the deployment API
// version of the target org does not accept. A built-in rule turned off but marked
// warnWhenDisabled only reports the elements the deployment will fail on.
// Subclasses change what is removed when deleting the matching elements is not enough.

import { t } from '../utils/i18n.js';
import { ReplacementOutcome, ReplacementRuleRoot } from './replacementRuleRoot.js';
import { formatApiVersion } from './utils/apiVersionUtils.js';
import { detailWithNames } from './utils/changeNames.js';
import { BuiltInReplacementRule, ReplacementTarget } from './utils/types.js';
import { describeXmlNode, removeXmlNode, selectXmlPath } from './utils/xmlPath.js';

export class BuiltInRemovalRule extends ReplacementRuleRoot {
  public readonly scope = 'xml' as const;
  // Names of the elements removed from the current file (removeNode), for the log and the comment
  private removedNames: string[] = [];

  public applyToXml(doc: any, value: string | null, target: ReplacementTarget): ReplacementOutcome {
    void value;
    if (!this.rule.enabled) {
      const foundNodes = this.builtIn.xmlPaths.flatMap((xmlPath) => selectXmlPath(xmlPath, doc));
      return foundNodes.length > 0
        ? {
          found: foundNodes.length,
          changed: 0,
          status: 'risky-element',
          detail: detailWithNames(this.builtIn.xmlPaths.join(', '), foundNodes.map((node) => describeXmlNode(node))),
        }
        : { found: 0, changed: 0, status: 'not-found' };
    }
    this.removedNames = [];
    const removed = this.removeElements(doc);
    if (removed === 0) {
      return { found: 0, changed: 0, status: 'not-found' };
    }
    return {
      found: removed,
      changed: removed,
      status: 'changed',
      detail: detailWithNames(t('replacementRulesRemovedForApi', { count: removed, apiVersion: formatApiVersion(target.apiVersion) }), this.removedNames),
    };
  }

  protected get builtIn(): BuiltInReplacementRule {
    return this.rule.builtIn as BuiltInReplacementRule;
  }

  /** Remove what the target org refuses, through removeNode. Returns the number of elements removed */
  protected removeElements(doc: any): number {
    let removed = 0;
    for (const xmlPath of this.builtIn.xmlPaths) {
      for (const node of selectXmlPath(xmlPath, doc)) {
        this.removeNode(node);
        removed++;
      }
    }
    return removed;
  }

  /** Remove an element, named first: once removed, it has no parent to name it by */
  protected removeNode(node: any): void {
    this.recordRemoved(node);
    removeXmlNode(node);
  }

  /** Name an element the subclass removes itself (removeFlowEnds) */
  protected recordRemoved(node: any): void {
    this.removedNames.push(describeXmlNode(node));
  }
}
