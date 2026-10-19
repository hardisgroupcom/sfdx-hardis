// Rule type xml-value: writes the value of the target org in every element matching xmlPath,
// whatever git holds.

import { ReplacementOutcome, ReplacementRuleRoot } from './replacementRuleRoot.js';
import { selectXmlPath } from './utils/xmlPath.js';

export class XmlValueReplacementRule extends ReplacementRuleRoot {
  public readonly scope = 'xml' as const;

  public needsValue(): boolean {
    return true;
  }

  public applyToXml(doc: any, value: string | null): ReplacementOutcome {
    const nodes = selectXmlPath(this.rule.xmlPath as string, doc);
    if (nodes.length === 0) {
      return { found: 0, changed: 0, status: 'not-found' };
    }
    let changed = 0;
    for (const node of nodes) {
      if ((node.textContent ?? '') !== value) {
        node.textContent = value;
        changed++;
      }
    }
    return { found: nodes.length, changed, status: changed > 0 ? 'changed' : 'unchanged' };
  }
}
