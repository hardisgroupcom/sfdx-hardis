// Markdown of the documentation page listing the built-in replacement rules, generated from the
// rules themselves so the page cannot drift from the code. Regenerate it with:
//   node --import tsx scripts/build-builtin-replacement-rules-doc.ts
// test/common/replacementRules/builtInRulesDoc.test.ts fails when the page is not up to date.

import { BUILT_IN_REPLACEMENT_RULES } from './builtInReplacementRules.js';
import { USER_PERMISSIONS_INTRODUCED_IN, USER_PERMISSIONS_REMOVED_IN } from './userPermissionsByApiVersion.js';
import { BuiltInReplacementRule } from './types.js';

export const BUILT_IN_RULES_DOC_FILE = 'docs/salesforce-devops-config-replacement-rules-builtin.md';

export function buildBuiltInRulesDocMarkdown(): string {
  const NL = '\n';
  const onRules = BUILT_IN_REPLACEMENT_RULES.filter((rule) => rule.defaultEnabled);
  const offRules = BUILT_IN_REPLACEMENT_RULES.filter((rule) => !rule.defaultEnabled);
  const lines: string[] = [
    '---',
    'title: Built-in replacement rules (Beta)',
    'description: The XML elements and user permissions sfdx-hardis removes before deploying, when the target org does not accept them',
    '---',
    '',
    '<!-- markdownlint-disable MD013 -->',
    '<!-- Generated from src/common/replacementRules: run node --import tsx scripts/build-builtin-replacement-rules-doc.ts -->',
    '',
    '## Built-in replacement rules (Beta)',
    '',
    'Built-in [replacement rules](salesforce-devops-config-replacement-rules.md) ship with sfdx-hardis. Before each deployment, they remove what the target org would refuse: XML elements its API version does not know yet or does not accept anymore, and user permissions it does not have.',
    '',
    'The deployment API version is the lowest of the connection version (the `org-api-version` sf config or `SF_ORG_API_VERSION` when set, otherwise the maximum API version of the target org), the `sourceApiVersion` of `sfdx-project.json` and the version of the deployed package.xml.',
    '',
    'Turn a rule on or off in `config/.sfdx-hardis.yml`, a branch config file or the replacement rules issue, or from the **Built-in rules** tab of the VS Code panel:',
    '',
    '```yaml',
    'replacementRules:',
    '  - id: builtin-flow-get-records-limit',
    '    enabled: true',
    '  - id: builtin-unknown-user-permissions',
    '    enabled: false',
    '```',
    '',
    '### Rules on by default',
    '',
    ...rulesTable(onRules),
    '',
    '### Rules off by default',
    '',
    'These elements change what a component does: without `limit`, a Get Records element returns every record. They are not removed unless you turn the rule on. When one is found in a deployed file, the Pull Request comment says the deployment will fail and names the rule that removes it.',
    '',
    ...rulesTable(offRules),
    '',
    '### User permissions',
    '',
    'The rule `builtin-unknown-user-permissions` removes each `userPermissions` entry of a Profile or a Permission Set that the target org does not have.',
    '',
    '- **With a connection to the target org** (deployments, scratch orgs, backpromote): sfdx-hardis reads the `Permissions<Name>` fields of the `PermissionSet` object of the org. That list follows the API version of the org, and also its licenses and enabled features: a permission of a cloud the org does not have is removed too.',
    '- **Without a connection** (`hardis:project:replacement:preview` without `--target-org`): sfdx-hardis uses the list below, by deployment API version. It comes from the describe of an Enterprise Edition sandbox and a Developer Edition org, so it cannot hold the permissions of every cloud.',
    '',
    ...userPermissionsSection(),
    '',
  ];
  return lines.join(NL);
}

function rulesTable(rules: BuiltInReplacementRule[]): string[] {
  const rows = rules.map((rule) => [
    `\`${rule.id}\``,
    rule.description,
    rule.xmlPaths.map((xmlPath) => `\`${xmlPath}\``).join(', '),
    removedWhen(rule),
  ]);
  return markdownTable(['Rule', 'What it removes', 'Elements', 'Removed when the API is'], rows);
}

function removedWhen(rule: BuiltInReplacementRule): string {
  if (rule.anyApiVersion) {
    return 'any version (the org decides)';
  }
  if (rule.introducedIn != null) {
    return `below ${rule.introducedIn.toFixed(1)}`;
  }
  return `${(rule.removedIn as number).toFixed(1)} or above`;
}

function userPermissionsSection(): string[] {
  // Salesforce permission names are full of abbreviations: the spell checker skips the list
  const lines: string[] = ['<!-- cspell:disable -->', ''];
  const versions = Object.keys(USER_PERMISSIONS_INTRODUCED_IN).map(Number).sort((a, b) => a - b);
  for (const version of versions) {
    const names = [...USER_PERMISSIONS_INTRODUCED_IN[version]].sort();
    lines.push(
      `<details><summary>New in API ${version.toFixed(1)}: removed when the API is below ${version.toFixed(1)} (${names.length})</summary>`,
      '',
      names.map((name) => `\`${name}\``).join(', '),
      '',
      '</details>',
      ''
    );
  }
  const removedVersions = Object.keys(USER_PERMISSIONS_REMOVED_IN).map(Number).sort((a, b) => a - b);
  if (removedVersions.length > 0) {
    lines.push('Removed by Salesforce, so removed when the API is at that version or above:', '');
    for (const version of removedVersions) {
      lines.push(`- API ${version.toFixed(1)}: ${[...USER_PERMISSIONS_REMOVED_IN[version]].sort().map((name) => `\`${name}\``).join(', ')}`);
    }
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  lines.push('', '<!-- cspell:enable -->');
  return lines;
}

// A table padded the way markdown-table-formatter (MegaLinter) writes it, so the linter keeps it as is
function markdownTable(headers: string[], rows: string[][]): string[] {
  const cells = [headers, ...rows].map((row) => row.map((cell) => String(cell).replace(/\|/g, '\\|')));
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  const line = (row: string[]) => `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  return [line(cells[0]), `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`, ...cells.slice(1).map(line)];
}
