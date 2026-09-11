#!/usr/bin/env node
// Assert a `sf hardis:work:backpromote --plan --json` document (plan version 2) against the
// expectations of a point of the run (runbook section 6bis).
//
//   node check-backpromote-plan.cjs <document.json> <expectations.json>
//
// Expectations (every key optional). `{{S1}}` in a value is replaced by the BP_VAR_S1 environment
// variable, so the Pull Request numbers of the run do not have to be edited into the files.
//   exitStatus        sf JSON envelope status (0 on success, 1 on error)
//   errorContains     text of the error message of a failed run
//   status            ready | blocked | upToDate | mergeInProgress
//   orgType           sandbox | scratch | production
//   orgTracksSource   true | false
//   checks            [{ id, ok, messageContains }]
//   pullRequests      [482, 485]      numbers that must be listed, in any order
//   absentPullRequests [1]            numbers that must not be listed
//   commitCount       number of first-parent commits the merge brings in
//   items             ["Type:Name"]   items that must be deployed
//   absentItems       ["Type:Name"]
//   deletions         ["Type:Name"]
//   actions           [{ id, when }]
//   conflicts         [{ pathContains, changedInBranch, changedInOrg, conflictBlocks }]
//   noConflict        true when the merge must not stop on any file
//   orgChangesContain ["path"]        pending changes of the org that must be listed
const fs = require('fs');

function readSfJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    // Anything printed before the JSON document: start at the first line that opens it
  }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() === '{') {
      try {
        return JSON.parse(lines.slice(index).join('\n'));
      } catch {
        // not the document, keep looking
      }
    }
  }
  throw new Error(`No JSON document in ${file}`);
}

function substitute(value) {
  if (typeof value === 'string') {
    const replaced = value.replace(/\{\{(\w+)\}\}/g, (_, name) => process.env[`BP_VAR_${name}`] ?? `{{${name}}}`);
    return /^\d+$/.test(replaced) && value !== replaced ? Number(replaced) : replaced;
  }
  if (Array.isArray(value)) {
    return value.map(substitute);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry)]));
  }
  return value;
}

const [documentFile, expectationsFile] = process.argv.slice(2);
if (!documentFile || !expectationsFile) {
  console.error('Usage: node check-backpromote-plan.cjs <document.json> <expectations.json>');
  process.exit(2);
}
const envelope = readSfJson(documentFile);
const expect = substitute(JSON.parse(fs.readFileSync(expectationsFile, 'utf8')));
const doc = envelope.result || {};
let failures = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!condition) failures++;
}

if (expect.exitStatus !== undefined) {
  check(`exit status ${expect.exitStatus}`, envelope.status === expect.exitStatus, `got ${envelope.status}`);
}
if (expect.errorContains !== undefined) {
  const message = String(envelope.message || envelope.name || '');
  check(`error contains "${expect.errorContains}"`, message.includes(expect.errorContains), message.substring(0, 120));
}
if (expect.status !== undefined) {
  check(`status ${expect.status}`, doc.status === expect.status, `got ${doc.status}`);
}
if (expect.orgType !== undefined) {
  check(`org type ${expect.orgType}`, doc.targetOrg?.orgType === expect.orgType, `got ${doc.targetOrg?.orgType}`);
}
if (expect.orgTracksSource !== undefined) {
  check(`org tracks source ${expect.orgTracksSource}`, doc.targetOrg?.tracksSource === expect.orgTracksSource, `got ${doc.targetOrg?.tracksSource}`);
}
for (const expected of expect.checks || []) {
  const found = (doc.checks || []).find((item) => item.id === expected.id);
  check(`check ${expected.id} present`, !!found);
  if (found && expected.ok !== undefined) {
    check(`check ${expected.id} ok=${expected.ok}`, found.ok === expected.ok, found.message);
  }
  if (found && expected.messageContains) {
    check(`check ${expected.id} says "${expected.messageContains}"`, String(found.message).includes(expected.messageContains), found.message);
  }
}
const listedPullRequests = (doc.pullRequests || []).map((pr) => pr.id);
for (const number of expect.pullRequests || []) {
  check(`Pull Request #${number} listed`, listedPullRequests.includes(number), `listed: ${listedPullRequests.join(', ')}`);
}
for (const number of expect.absentPullRequests || []) {
  check(`Pull Request #${number} absent`, !listedPullRequests.includes(number), `listed: ${listedPullRequests.join(', ')}`);
}
if (expect.commitCount !== undefined) {
  check(`${expect.commitCount} commit(s) brought in`, doc.commitCount === expect.commitCount, `got ${doc.commitCount}`);
}
const itemKeys = (doc.items || []).map((item) => item.key);
for (const key of expect.items || []) {
  check(`item ${key} deployed`, itemKeys.includes(key), `items: ${itemKeys.join(', ')}`);
}
for (const key of expect.absentItems || []) {
  check(`item ${key} absent`, !itemKeys.includes(key), `items: ${itemKeys.join(', ')}`);
}
const deletionKeys = (doc.deletions || []).map((item) => item.key);
for (const key of expect.deletions || []) {
  check(`deletion ${key}`, deletionKeys.includes(key), `deletions: ${deletionKeys.join(', ')}`);
}
for (const expected of expect.actions || []) {
  const found = (doc.actions || []).find((action) => action.id === expected.id);
  check(`action ${expected.id} listed`, !!found, `actions: ${(doc.actions || []).map((action) => action.id).join(', ')}`);
  if (found && expected.when) {
    check(`action ${expected.id} runs ${expected.when} deployment`, found.when === expected.when, `got ${found.when}`);
  }
}
if (expect.noConflict) {
  check('no file the merge may stop on', (doc.conflicts || []).length === 0, `conflicts: ${(doc.conflicts || []).map((c) => c.path).join(', ')}`);
}
for (const expected of expect.conflicts || []) {
  const found = (doc.conflicts || []).find((conflict) => conflict.path.includes(expected.pathContains));
  check(`conflict on ${expected.pathContains}`, !!found, `conflicts: ${(doc.conflicts || []).map((c) => c.path).join(', ')}`);
  if (found && expected.changedInBranch !== undefined) {
    check(`  changed in branch ${expected.changedInBranch}`, found.changedInBranch === expected.changedInBranch);
  }
  if (found && expected.changedInOrg !== undefined) {
    check(`  changed in org ${expected.changedInOrg}`, found.changedInOrg === expected.changedInOrg);
  }
  if (found && expected.conflictBlocks !== undefined) {
    check(`  ${expected.conflictBlocks} conflict block(s) left`, found.conflictBlocks === expected.conflictBlocks, `got ${found.conflictBlocks}`);
  }
}
for (const file of expect.orgChangesContain || []) {
  const files = doc.orgChanges?.files || [];
  check(`org change ${file} listed`, files.some((entry) => entry.includes(file)), `org changes: ${files.join(', ')}`);
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
