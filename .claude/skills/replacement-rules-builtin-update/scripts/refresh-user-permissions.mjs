// Refreshes src/common/replacementRules/userPermissionsByApiVersion.ts from the PermissionSet
// describe of one or more orgs, at every API version from --from to --to.
//
//   node refresh-user-permissions.mjs --org DevHub --org MySandbox --to 69 [--from 50] [--min-intro 58] [--dry-run]
//
// A user permission is a Permissions<Name> field of PermissionSet. The first version where an org
// shows it is its introducedIn; the version after the last one where every org stops showing it
// is its removedIn. Entries already in the file are kept (an org with other licenses may have
// found them); a name the describes place at another version is moved there.
// Run it from the sfdx-hardis working copy (it imports @salesforce/core from its node_modules).
import fs from 'fs';
import { Org } from '@salesforce/core';

const TARGET_FILE = 'src/common/replacementRules/userPermissionsByApiVersion.ts';

const args = parseArgs(process.argv.slice(2));
const orgs = args.org || [];
const from = Number(args.from?.[0] || 50);
const to = Number(args.to?.[0]);
// Permissions introduced before this version are older than any org still running: not listed
const minIntro = Number(args['min-intro']?.[0] || 58);
const dryRun = 'dry-run' in args;
if (orgs.length === 0 || !to) {
  console.error('Usage: node refresh-user-permissions.mjs --org <alias> [--org <alias>] --to <API> [--from 50] [--min-intro 58] [--dry-run]');
  process.exit(1);
}

// name -> org -> versions where the org shows it
const seen = {};
for (const alias of orgs) {
  const org = await Org.create({ aliasOrUsername: alias });
  const versions = [];
  for (let v = from; v <= to; v++) {
    versions.push(v);
  }
  await Promise.all(
    versions.map(async (version) => {
      const conn = org.getConnection(`${version}.0`);
      const describe = await conn.request(`/services/data/v${version}.0/sobjects/PermissionSet/describe`);
      const names = describe.fields.map((field) => field.name).filter((name) => name.startsWith('Permissions'));
      for (const field of names) {
        const name = field.replace(/^Permissions/, '');
        ((seen[name] ??= {})[alias] ??= []).push(version);
      }
      console.log(`${alias} API ${version}.0: ${names.length} user permissions`);
    })
  );
}
const maxSeen = Math.max(...Object.values(seen).flatMap((byOrg) => Object.values(byOrg).flat()));
if (maxSeen < to) {
  console.error(`No org answered at API ${to}.0 (highest: ${maxSeen}.0): use an org already on that release (preview sandbox)`);
  process.exit(1);
}

const existing = readExisting(fs.readFileSync(TARGET_FILE, 'utf8'));
const introduced = { ...existing.introduced };
const removed = { ...existing.removed };
const changes = [];
const warnings = [];
for (const [name, byOrg] of Object.entries(seen)) {
  const firsts = Object.values(byOrg).map((versions) => Math.min(...versions));
  const lasts = Object.values(byOrg).map((versions) => Math.max(...versions));
  const intro = Math.min(...firsts);
  const last = Math.max(...lasts);
  if (new Set(firsts).size > 1) {
    warnings.push(`${name}: first seen at different versions per org ${JSON.stringify(byOrg)}, kept the lowest (${intro})`);
  }
  for (const versions of Object.values(byOrg)) {
    const sorted = [...versions].sort((a, b) => a - b);
    if (sorted.some((v, i) => i > 0 && v !== sorted[i - 1] + 1)) {
      warnings.push(`${name}: gap in the versions ${sorted.join(',')} (feature switched on or off?), check it`);
    }
  }
  if (intro > from && intro >= minIntro && introduced[name] !== intro) {
    changes.push(introduced[name] ? `moved ${name}: introducedIn ${introduced[name]} -> ${intro}` : `new ${name}: introducedIn ${intro}`);
    introduced[name] = intro;
  }
  if (last < to && removed[name] !== last + 1) {
    changes.push(`REMOVED ${name}: removedIn ${last + 1} (check the release notes, see SKILL.md)`);
    removed[name] = last + 1;
  }
}

console.log(`\n${changes.length} changes`);
for (const change of changes.sort()) {
  console.log(`  ${change}`);
}
for (const warning of warnings) {
  console.log(`  WARNING ${warning}`);
}
if (dryRun) {
  console.log('Dry run: file not written');
  process.exit(0);
}
fs.writeFileSync(TARGET_FILE, writeFile(existing.header, introduced, removed, to));
console.log(`Written ${TARGET_FILE}`);

function readExisting(text) {
  const header = text.slice(0, text.indexOf('export const'));
  return {
    header,
    introduced: readBlock(text, 'USER_PERMISSIONS_INTRODUCED_IN'),
    removed: readBlock(text, 'USER_PERMISSIONS_REMOVED_IN'),
  };
}

function readBlock(text, constName) {
  const start = text.indexOf(`export const ${constName}`);
  const end = text.indexOf('\n};', start);
  const result = {};
  let version = null;
  for (const line of text.slice(start, end).split(/\r?\n/)) {
    const versionMatch = line.match(/^\s+(\d+): \[/);
    if (versionMatch) {
      version = Number(versionMatch[1]);
      continue;
    }
    const nameMatch = line.match(/^\s+'([^']+)',/);
    if (nameMatch && version != null) {
      result[nameMatch[1]] = version;
    }
  }
  return result;
}

function writeFile(header, introducedMap, removedMap, maxVersion) {
  const newHeader = header.replace(/at API (\d+) to \d+/, `at API $1 to ${maxVersion}`);
  return `${newHeader}${block('USER_PERMISSIONS_INTRODUCED_IN', introducedMap)}\n\n${block('USER_PERMISSIONS_REMOVED_IN', removedMap)}\n`;
}

function block(constName, map) {
  const byVersion = {};
  for (const [name, version] of Object.entries(map)) {
    (byVersion[version] ??= []).push(name);
  }
  const lines = [`export const ${constName}: Record<number, string[]> = {`];
  for (const version of Object.keys(byVersion).map(Number).sort((a, b) => a - b)) {
    lines.push(`  ${version}: [`);
    for (const name of byVersion[version].sort()) {
      lines.push(`    '${name}',`);
    }
    lines.push('  ],');
  }
  lines.push('};');
  return lines.join('\n');
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) {
      continue;
    }
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    (result[key] ??= []).push(value);
  }
  return result;
}
