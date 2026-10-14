#!/usr/bin/env node
/*
 * Fast i18n key upsert for sfdx-hardis locale files.
 *
 * Adds or updates one or more keys across all 9 locale files in a single run,
 * instead of dozens of individual edits. Insertion is line-based so existing
 * key order and formatting are preserved; only the affected lines change.
 *
 * Usage:
 *   node scripts/i18n-upsert.mjs <translations.json>
 *
 * <translations.json> shape (every key MUST provide all 9 locales):
 * {
 *   "myNewKey": {
 *     "en": "English text with {{var}}",
 *     "de": "...", "es": "...", "fr": "...", "it": "...",
 *     "ja": "...", "nl": "...", "pl": "...", "pt-BR": "..."
 *   },
 *   "anotherKey": { ... }
 * }
 *
 * Notes:
 * - If a key already exists in a file, its value is replaced in place.
 * - Otherwise the key is inserted at the correct alphabetical position.
 * - pt-BR uses case-insensitive ordering; the other locales use case-sensitive.
 * - Each locale file is re-parsed after writing to guarantee valid JSON.
 */
import fs from 'fs';
import path from 'path';

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt-BR'];

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/i18n-upsert.mjs <translations.json>');
  process.exit(1);
}

const i18nDir = path.join('src', 'i18n');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Extract the key name from a JSON line like `  "myKey": "value",`
function keyOfLine(line) {
  const m = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/);
  if (!m) return null;
  try {
    return JSON.parse('"' + m[1] + '"');
  } catch {
    return null;
  }
}

let totalChanged = 0;
const report = {};

for (const locale of LOCALES) {
  const file = path.join(i18nDir, `${locale}.json`);
  let lines = fs.readFileSync(file, 'utf8').split('\n');
  const caseInsensitive = locale === 'pt-BR';
  const norm = (s) => (caseInsensitive ? s.toLowerCase() : s);
  const cmp = (a, b) => {
    const x = norm(a);
    const y = norm(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };

  const added = [];
  const updated = [];

  for (const [key, trans] of Object.entries(data)) {
    const value = trans[locale];
    if (value === undefined) {
      console.error(`ERROR: missing "${locale}" translation for key "${key}"`);
      process.exit(1);
    }
    const core = `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;

    // Existing key? Replace value in place, preserving trailing comma.
    let existingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (keyOfLine(lines[i]) === key) {
        existingIdx = i;
        break;
      }
    }
    if (existingIdx >= 0) {
      const hadComma = lines[existingIdx].trimEnd().endsWith(',');
      lines[existingIdx] = core + (hadComma ? ',' : '');
      updated.push(key);
      continue;
    }

    // Find the first existing key that sorts after the new key.
    let insertIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const k = keyOfLine(lines[i]);
      if (k !== null && cmp(k, key) > 0) {
        insertIdx = i;
        break;
      }
    }

    if (insertIdx === -1) {
      // Insert as the last entry, just before the closing brace.
      let braceIdx = lines.length - 1;
      while (braceIdx > 0 && !lines[braceIdx].includes('}')) braceIdx--;
      let prev = braceIdx - 1;
      // Skip blank lines back to the previous entry.
      while (prev > 0 && lines[prev].trim() === '') prev--;
      lines[prev] = lines[prev].replace(/\s*$/, '');
      if (!lines[prev].endsWith(',')) lines[prev] += ',';
      lines.splice(braceIdx, 0, core); // last entry: no trailing comma
    } else {
      lines.splice(insertIdx, 0, core + ',');
    }
    added.push(key);
  }

  fs.writeFileSync(file, lines.join('\n'));
  // Validate the result is parseable JSON.
  JSON.parse(fs.readFileSync(file, 'utf8'));
  report[locale] = { added: added.length, updated: updated.length };
  totalChanged += added.length + updated.length;
}

console.log('i18n upsert done:');
for (const locale of LOCALES) {
  console.log(`  ${locale}: +${report[locale].added} added, ${report[locale].updated} updated`);
}
console.log(`Total operations: ${totalChanged}`);
