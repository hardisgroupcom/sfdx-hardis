#!/usr/bin/env node
// Dependency guardrails, run as part of `yarn test`:
// 1. every runtime dependency of package.json must be imported somewhere in src/
//    (an unused dependency is pure supply-chain exposure),
// 2. the number of entries in yarn.lock must stay under a ceiling, so a PR that
//    pulls a large transitive tree is visible at review time.
//
// To raise the ceiling on purpose, update MAX_LOCKFILE_ENTRIES below in the same PR
// and explain why in the PR description.
import fs from 'node:fs';
import path from 'node:path';

const MAX_LOCKFILE_ENTRIES = 1300;

// Runtime dependencies that are not imported from src/ but are still required at runtime.
const ALLOWED_UNUSED = {
  // Loaded by the Node.js script that the coding agent writes for the weekly monitoring
  // PPTX report (see PROMPT_MONITORING_PPTX_REPORT): it must be resolvable from sfdx-hardis.
  pptxgenjs: 'used by the agent-generated monitoring PPTX script at runtime',
};

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
    } else if (full.endsWith('.ts') || full.endsWith('.js') || full.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

const sources = [...listSourceFiles(path.join(root, 'src')), ...listSourceFiles(path.join(root, 'bin'))].map((file) =>
  fs.readFileSync(file, 'utf8')
);

function isImported(dependency) {
  const escaped = dependency.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const regex = new RegExp(`(from\\s*['"]|import\\s*\\(\\s*['"]|require\\s*\\(\\s*['"])${escaped}(['"/])`);
  return sources.some((content) => regex.test(content));
}

const errors = [];

for (const dependency of Object.keys(pkg.dependencies || {})) {
  if (ALLOWED_UNUSED[dependency]) {
    continue;
  }
  if (!isImported(dependency)) {
    errors.push(`Runtime dependency "${dependency}" is never imported from src/ or bin/. Remove it from package.json, or add it to ALLOWED_UNUSED in scripts/check-dependencies.mjs with a reason.`);
  }
}

const lockfile = fs.readFileSync(path.join(root, 'yarn.lock'), 'utf8');
const lockEntries = lockfile.split('\n').filter((line) => /^[^\s#].*:\s*$/.test(line)).length;
if (lockEntries > MAX_LOCKFILE_ENTRIES) {
  errors.push(`yarn.lock has ${lockEntries} entries, above the ceiling of ${MAX_LOCKFILE_ENTRIES}. Avoid adding dependencies with large transitive trees, or raise MAX_LOCKFILE_ENTRIES in scripts/check-dependencies.mjs on purpose.`);
}

console.log(`Dependency check: ${Object.keys(pkg.dependencies || {}).length} runtime dependencies, ${lockEntries} yarn.lock entries (ceiling ${MAX_LOCKFILE_ENTRIES})`);
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exit(1);
}
