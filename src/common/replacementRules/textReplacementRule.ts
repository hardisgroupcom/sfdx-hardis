// Rule type text: finds a string or a regular expression in any file (Apex, JavaScript, JSON...)
// and replaces every match with the value of the target org.

import { t } from '../utils/i18n.js';
import { ReplacementRuleRoot, ReplacementTextOutcome } from './replacementRuleRoot.js';

export class TextReplacementRule extends ReplacementRuleRoot {
  public readonly scope = 'text' as const;

  public needsValue(): boolean {
    return true;
  }

  public applyToText(content: string, value: string | null): ReplacementTextOutcome {
    const { content: updated, count } = this.replace(content, value as string);
    const changed = updated !== content;
    return {
      content: updated,
      found: count,
      changed: changed ? count : 0,
      status: changed ? 'changed' : count > 0 ? 'unchanged' : 'not-found',
      detail: count > 0 ? t('replacementRulesTextMatches', { count }) : undefined,
    };
  }

  private replace(content: string, value: string): { content: string; count: number } {
    const find = this.rule.find as string;
    if (this.rule.regex === true) {
      const regex = new RegExp(find, 'g');
      let count = 0;
      // A function replacement keeps "$" in the value literal (a secret can contain one)
      const updated = content.replace(regex, () => {
        count++;
        return value;
      });
      return { content: updated, count };
    }
    const parts = content.split(find);
    return { content: parts.join(value), count: parts.length - 1 };
  }
}
