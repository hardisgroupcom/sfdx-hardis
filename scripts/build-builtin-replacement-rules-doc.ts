// Writes the documentation page of the built-in replacement rules from the code.
// Run: node --import tsx scripts/build-builtin-replacement-rules-doc.ts
import fs from 'fs';
import { BUILT_IN_RULES_DOC_FILE, buildBuiltInRulesDocMarkdown } from '../src/common/replacementRules/builtIn/builtInRulesDoc.js';

fs.writeFileSync(BUILT_IN_RULES_DOC_FILE, buildBuiltInRulesDocMarkdown());
console.log(`Written ${BUILT_IN_RULES_DOC_FILE}`);
