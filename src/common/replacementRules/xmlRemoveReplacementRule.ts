// Rule type xml-remove: removes every element matching xmlPath (a user permission of a Profile,
// an element the target org does not accept).

import { t } from '../utils/i18n.js';
import { ReplacementOutcome, ReplacementRuleRoot } from './replacementRuleRoot.js';
import { removeXmlNode, selectXmlPath } from './utils/xmlPath.js';

export class XmlRemoveReplacementRule extends ReplacementRuleRoot {
  public readonly scope = 'xml' as const;

  public applyToXml(doc: any): ReplacementOutcome {
    const nodes = selectXmlPath(this.rule.xmlPath as string, doc);
    if (nodes.length === 0) {
      return { found: 0, changed: 0, status: 'not-found' };
    }
    for (const node of nodes) {
      removeXmlNode(node);
    }
    return { found: nodes.length, changed: nodes.length, status: 'changed', detail: t('replacementRulesRemovedElements', { count: nodes.length }) };
  }
}
