#!/usr/bin/env node
// Dependency guardrails, run as part of `yarn test`:
// 1. every runtime dependency of package.json must be imported somewhere in src/
//    (an unused dependency is pure supply-chain exposure),
// 2. the number of entries in yarn.lock must stay under a ceiling, so a PR that
//    pulls a large transitive tree is visible at review time,
// 3. in CI only, every package that lib/ or bin/ imports at runtime must be in
//    "dependencies": a package that only comes with another one works in this clone
//    and fails once the plugin is installed (issue #2403). lib/ is read, not src/,
//    because TypeScript removes the imports used only for types.
//
// To raise the ceiling on purpose, update MAX_LOCKFILE_ENTRIES below in the same PR
// and explain why in the PR description.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const MAX_LOCKFILE_ENTRIES = 1300;

// Runtime dependencies that are not imported from src/ but are still required at runtime.
const ALLOWED_UNUSED = {
  // Loaded by the Node.js script that the coding agent writes for the weekly monitoring
  // PPTX report (see PROMPT_MONITORING_PPTX_REPORT): it must be resolvable from sfdx-hardis.
  pptxgenjs: 'used by the agent-generated monitoring PPTX script at runtime',
};

// Build tooling that the Salesforce reusable CI workflows install with `yarn add <pkg>` right
// before running the tests, which lands it in "dependencies" of the checkout even though the
// committed package.json declares it nowhere. Never imported from src/, so it is skipped here.
const CI_INJECTED = new Set(['wireit']);

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
    } else if (full.endsWith('.ts') || full.endsWith('.js') || full.endsWith('.mjs') || full.endsWith('.cjs')) {
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
  if (ALLOWED_UNUSED[dependency] || CI_INJECTED.has(dependency)) {
    continue;
  }
  if (!isImported(dependency)) {
    errors.push(`Runtime dependency "${dependency}" is never imported from src/ or bin/. Remove it from package.json, or add it to ALLOWED_UNUSED in scripts/check-dependencies.mjs with a reason.`);
  }
}

const runtimeImportsChecked = Boolean(process.env.CI);
if (runtimeImportsChecked) {
  errors.push(...listUndeclaredRuntimeImports());
}

const lockfile = fs.readFileSync(path.join(root, 'yarn.lock'), 'utf8');
const lockEntries = lockfile.split('\n').filter((line) => /^[^\s#].*:\s*$/.test(line)).length;
if (lockEntries > MAX_LOCKFILE_ENTRIES) {
  errors.push(`yarn.lock has ${lockEntries} entries, above the ceiling of ${MAX_LOCKFILE_ENTRIES}. Avoid adding dependencies with large transitive trees, or raise MAX_LOCKFILE_ENTRIES in scripts/check-dependencies.mjs on purpose.`);
}

console.log(
  `Dependency check: ${Object.keys(pkg.dependencies || {}).length} runtime dependencies, ${lockEntries} yarn.lock entries (ceiling ${MAX_LOCKFILE_ENTRIES})` +
    (runtimeImportsChecked ? ', runtime imports of lib/ and bin/ checked' : '')
);
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exit(1);
}

// Packages imported by the compiled code but missing from "dependencies", one error per package.
function listUndeclaredRuntimeImports() {
  const libDir = path.join(root, 'lib');
  if (!fs.existsSync(libDir)) {
    return ['lib/ not found: run yarn build before the dependency check.'];
  }
  const declared = new Set(Object.keys(pkg.dependencies || {}));
  const builtins = new Set(builtinModules);
  // Only real import sites: a line-anchored static import or re-export, a side-effect import,
  // a dynamic import or a require. Words in prompt texts and comments do not match.
  const importPatterns = [
    /^\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  // A bare npm package specifier, with an optional subpath. Rejects relative paths and template literals.
  const packageSpecifier = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/.*)?$/;
  const importers = new Map();
  // JavaScript only: the .d.ts files of lib/ keep the imports used for types.
  const runtimeFiles = [...listSourceFiles(libDir), ...listSourceFiles(path.join(root, 'bin'))].filter((file) => !file.endsWith('.ts'));
  for (const file of runtimeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of importPatterns) {
      for (const match of content.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier.startsWith('node:') || !packageSpecifier.test(specifier)) {
          continue;
        }
        const parts = specifier.split('/');
        const packageName = specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
        if (declared.has(packageName) || builtins.has(packageName) || packageName === pkg.name) {
          continue;
        }
        const files = importers.get(packageName) || new Set();
        files.add(path.relative(root, file).replace(/\\/g, '/'));
        importers.set(packageName, files);
      }
    }
  }
  return [...importers].map(([packageName, files]) => {
    const shown = [...files].slice(0, 3).join(', ') + (files.size > 3 ? ` and ${files.size - 3} more` : '');
    return `Package "${packageName}" is imported at runtime by ${shown} but is not in "dependencies" of package.json. It only works in this clone because another package installs it: add it to "dependencies".`;
  });
}
