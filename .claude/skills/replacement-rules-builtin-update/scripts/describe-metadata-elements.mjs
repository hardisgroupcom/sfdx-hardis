// Lists the XML elements a Metadata API type accepts at two API versions, and prints the ones
// added or removed between them: the candidates of new built-in replacement rules.
//
//   node describe-metadata-elements.mjs --org DevHub --from 67 --to 68 [--types Flow,Profile] [--out dir]
//
// Uses describeValueType (Metadata API), which returns the element tree of a type for the API
// version of the connection. Paths use the replacement rules syntax (Flow/screens/fields/...).
// Run it from the sfdx-hardis working copy (it imports @salesforce/core from its node_modules).
import fs from 'fs';
import path from 'path';
import { Org } from '@salesforce/core';

const DEFAULT_TYPES = [
  'Flow',
  'Profile',
  'PermissionSet',
  'PermissionSetGroup',
  'CustomObject',
  'CustomField',
  'Layout',
  'FlexiPage',
  'CustomApplication',
  'LightningExperienceSettings',
  'AnalyticsSettings',
  'UserEngagementSettings',
  'SiteSettings',
  'SecuritySettings',
  'OrgSettings',
  'ExperienceBundle',
  'Bot',
  'GenAiPlannerBundle',
];
const MAX_DEPTH = 6;

const args = parseArgs(process.argv.slice(2));
const from = Number(args.from);
const to = Number(args.to);
if (!args.org || !from || !to) {
  console.error('Usage: node describe-metadata-elements.mjs --org <alias> --from <old API> --to <new API> [--types A,B] [--out dir]');
  process.exit(1);
}
const types = args.types ? args.types.split(',') : DEFAULT_TYPES;
const outDir = args.out || null;
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
}

const org = await Org.create({ aliasOrUsername: args.org });
let total = 0;
for (const type of types) {
  const [oldPaths, newPaths] = await Promise.all([describeType(org, type, from), describeType(org, type, to)]);
  if (oldPaths == null || newPaths == null) {
    console.log(`## ${type}: not described at one of the versions (unknown type or no access), skipped`);
    continue;
  }
  if (outDir) {
    fs.writeFileSync(path.join(outDir, `${type}_${from}.txt`), [...oldPaths].sort().join('\n'));
    fs.writeFileSync(path.join(outDir, `${type}_${to}.txt`), [...newPaths].sort().join('\n'));
  }
  const added = collapse([...newPaths].filter((p) => !oldPaths.has(p)).sort());
  const removed = collapse([...oldPaths].filter((p) => !newPaths.has(p)).sort());
  if (added.length === 0 && removed.length === 0) {
    continue;
  }
  total += added.length + removed.length;
  console.log(`## ${type}`);
  for (const p of added) {
    console.log(`  + ${p}   (introducedIn: ${to})`);
  }
  for (const p of removed) {
    console.log(`  - ${p}   (removedIn: ${to})`);
  }
}
console.log(total === 0 ? `No element changed between API ${from}.0 and ${to}.0` : `${total} elements added or removed`);

async function describeType(orgInstance, type, version) {
  const conn = orgInstance.getConnection(`${version}.0`);
  try {
    // jsforce v2 has no describeValueType method: call the SOAP operation directly
    const result = await conn.metadata._invoke('describeValueType', {
      type: `{http://soap.sforce.com/2006/04/metadata}${type}`,
    });
    const paths = new Set();
    walk(result.valueTypeFields, type, 0, paths);
    return paths;
  } catch (e) {
    console.error(`${type} at ${version}.0: ${String(e?.message || e).slice(0, 200)}`);
    return null;
  }
}

function walk(fields, parent, depth, paths) {
  for (const field of [].concat(fields || [])) {
    const current = `${parent}/${field.name}`;
    paths.add(current);
    if (depth < MAX_DEPTH && field.fields) {
      walk(field.fields, current, depth + 1, paths);
    }
  }
}

// A new complex element brings all its children: print the element only
function collapse(paths) {
  return paths.filter((p) => !paths.some((other) => other !== p && p.startsWith(`${other}/`)));
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      result[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return result;
}
