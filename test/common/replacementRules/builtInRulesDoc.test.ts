import { expect } from 'chai';
import * as fs from 'fs';
import { BUILT_IN_RULES_DOC_FILE, buildBuiltInRulesDocMarkdown } from '../../../src/common/replacementRules/builtInRulesDoc.js';
import { BUILT_IN_REPLACEMENT_RULES } from '../../../src/common/replacementRules/builtInReplacementRules.js';

describe('replacement rules - built-in rules documentation', () => {
  it('is up to date with the code', () => {
    const page = fs.readFileSync(BUILT_IN_RULES_DOC_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(page, 'run: node --import tsx scripts/build-builtin-replacement-rules-doc.ts').to.equal(buildBuiltInRulesDocMarkdown());
  });

  it('lists every built-in rule', () => {
    const page = buildBuiltInRulesDocMarkdown();
    for (const rule of BUILT_IN_REPLACEMENT_RULES) {
      expect(page, rule.id).to.include(`\`${rule.id}\``);
    }
  });
});
