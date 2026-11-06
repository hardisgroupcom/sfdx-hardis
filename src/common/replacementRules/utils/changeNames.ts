// What a replacement rule changed in a file, as logs and Pull Request comments say it: the names of
// the elements (describeXmlNode), never a value.

import { t } from '../../utils/i18n.js';

// A profile can lose dozens of user permissions: past this, the line says how many more
export const MAX_NAMES_PER_FILE = 20;

/** "a, b, c", or "a, b, ... and 12 more" past `max` names */
export function formatChangedNames(names: string[], max: number = MAX_NAMES_PER_FILE): string {
  const list = (names || []).filter((name) => name);
  if (list.length <= max) {
    return list.join(', ');
  }
  return `${list.slice(0, max).join(', ')}, ${t('replacementRulesAndMore', { count: list.length - max })}`;
}

/** The detail of a rule result followed by the names of what it changed, when there are some */
export function detailWithNames(detail: string, names: string[]): string {
  const formatted = formatChangedNames(names);
  return formatted ? `${detail}: ${formatted}` : detail;
}
