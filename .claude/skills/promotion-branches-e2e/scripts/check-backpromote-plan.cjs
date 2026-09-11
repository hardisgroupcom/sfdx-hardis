#!/usr/bin/env node
// Assert a `sf hardis:work:backpromote --plan --json` (or `--prepare-merge --json`) document against
// the expectations of a point of the run (runbook section 6bis).
//
//   node check-backpromote-plan.cjs <document.json> <expectations.json>
//
// Expectations (every key optional):
//   exitStatus          sf JSON envelope status (0 on success, 1 on error)
//   errorContains       text of the error message of a failed run
//   status              plan status: ready | blocked | upToDate
//   orgType             sandbox | scratch | production
//   workingBranch       { mode, reason, returnBranch }  where a run works (currentBranch | newBackpromoteBranch)
//   checks              [{ id, ok, messageContains, detailsContain: ["file"], detailsExclude: "folder/" }]
//   groupCount          number of groups listed
//   groups              [{ pullRequests: [1], status, trackable, backpromotedToThisOrg: true, backpromotedToCount: 1,
//                          items: ["Type:Name"], deletions: [...], actionIds: [...] }]
//   olderFromSet        true when the plan offers older Pull Requests through --from
//   absentGroups        [[2], [1, 3]]  groups that must not be listed
//   items               [{ key, orgState, mergeable }]
//   absentItems         ["Type:Name"]
//   deletions           ["Type:Name"]
//   actions             [{ id, when, alreadyDone }]
//   mergeFiles          [{ key, conflictBlocks }]        (--prepare-merge)
//   promptContains      ["text"]                         (--prepare-merge)
//   nextCommandContains ["text"]                         (--prepare-merge)
//   backpromoteBranchPrefix "backpromote/integration/"  (--prepare-merge) branch the merge was written on
//   returnBranch        branch the run brings the user back to (--prepare-merge)
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

const [documentFile, expectationsFile] = process.argv.slice(2);
if (!documentFile || !expectationsFile) {
  console.error('Usage: node check-backpromote-plan.cjs <document.json> <expectations.json>');
  process.exit(2);
}
const envelope = readSfJson(documentFile);
const doc = envelope.result !== undefined ? envelope.result : envelope;
// `{{NAME}}` in the expectations is replaced by the BP_VAR_NAME environment variable (Pull Request
// numbers differ from one git provider to the other)
let expectationsText = fs.readFileSync(expectationsFile, 'utf8');
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('BP_VAR_')) {
    expectationsText = expectationsText.split(`{{${name.substring('BP_VAR_'.length)}}}`).join(value);
  }
}
const expect = JSON.parse(expectationsText);
const failures = [];
let passed = 0;
function check(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}${detail !== undefined ? `: ${detail}` : ''}`);
  }
}
const groups = (doc && doc.groups) || [];
const findGroup = (ids) => groups.find((group) => ids.every((id) => (group.pullRequests || []).some((pr) => pr.id === id)));
const includesAll = (list, expected) => (expected || []).every((value) => (list || []).includes(value));

if (expect.exitStatus !== undefined) {
  check(`sf status is ${expect.exitStatus}`, envelope.status === expect.exitStatus, `got ${envelope.status}`);
}
if (expect.errorContains) {
  check(`error contains "${expect.errorContains}"`, String(envelope.message || '').includes(expect.errorContains), envelope.message);
}
if (expect.status) {
  check(`plan status is ${expect.status}`, doc.status === expect.status, `got ${doc.status}`);
}
if (expect.orgType) {
  check(`target org type is ${expect.orgType}`, doc.targetOrg && doc.targetOrg.orgType === expect.orgType, `got ${doc.targetOrg && doc.targetOrg.orgType}`);
}
if (expect.workingBranch) {
  const actual = doc.workingBranch || {};
  for (const [field, value] of Object.entries(expect.workingBranch)) {
    check(`working branch ${field} is ${value}`, (actual[field] ?? null) === value, `got ${actual[field]}`);
  }
}
if (expect.backpromoteBranchPrefix) {
  check(`merge written on ${expect.backpromoteBranchPrefix}...`, String(doc.backpromoteBranch || '').startsWith(expect.backpromoteBranchPrefix), `got ${doc.backpromoteBranch}`);
}
if (expect.returnBranch !== undefined) {
  check(`return branch is ${expect.returnBranch}`, (doc.returnBranch ?? null) === expect.returnBranch, `got ${doc.returnBranch}`);
}
for (const expected of expect.checks || []) {
  const found = (doc.checks || []).find((item) => item.id === expected.id);
  check(
    `check ${expected.id} ok=${expected.ok}${expected.messageContains ? ` "${expected.messageContains}"` : ''}`,
    found &&
      found.ok === expected.ok &&
      (!expected.messageContains || String(found.message).includes(expected.messageContains)) &&
      includesAll(found.details, expected.detailsContain) &&
      (!expected.detailsExclude || !(found.details || []).some((detail) => String(detail).includes(expected.detailsExclude))),
    found ? `ok=${found.ok} message=${found.message} details=${JSON.stringify(found.details || [])}` : 'missing',
  );
}
if (expect.olderFromSet !== undefined) {
  check(`olderFrom ${expect.olderFromSet ? 'set' : 'empty'}`, !!doc.olderFrom === expect.olderFromSet, `got ${doc.olderFrom}`);
}
if (expect.groupCount !== undefined) {
  check(`${expect.groupCount} group(s) listed`, groups.length === expect.groupCount, `got ${groups.length}: ${groups.map((group) => group.message).join(' | ')}`);
}
for (const expected of expect.groups || []) {
  const found = findGroup(expected.pullRequests);
  check(
    `group #${expected.pullRequests.join(',')}${expected.status ? ` ${expected.status}` : ''}`,
    found &&
      (!expected.status || found.status === expected.status) &&
      (expected.trackable === undefined || found.trackable === expected.trackable) &&
      (expected.backpromotedToThisOrg === undefined || !!found.backpromotedToThisOrg === expected.backpromotedToThisOrg) &&
      (expected.backpromotedToCount === undefined || (found.backpromotedTo || []).length === expected.backpromotedToCount) &&
      includesAll(found.items, expected.items) &&
      includesAll(found.deletions, expected.deletions) &&
      includesAll(found.actionIds, expected.actionIds),
    found
      ? JSON.stringify({ status: found.status, trackable: found.trackable, backpromotedToThisOrg: found.backpromotedToThisOrg, backpromotedTo: found.backpromotedTo, items: found.items, deletions: found.deletions, actionIds: found.actionIds })
      : 'missing',
  );
}
for (const ids of expect.absentGroups || []) {
  const found = findGroup(ids);
  check(`group #${ids.join(',')} not listed`, !found, found && found.status);
}
for (const expected of expect.items || []) {
  const found = (doc.items || []).find((item) => item.key === expected.key);
  check(
    `item ${expected.key}${expected.orgState ? ` ${expected.orgState}` : ''}${expected.mergeable !== undefined ? ` mergeable=${expected.mergeable}` : ''}`,
    found && (!expected.orgState || found.orgState === expected.orgState) && (expected.mergeable === undefined || found.mergeable === expected.mergeable),
    found ? JSON.stringify({ orgState: found.orgState, mergeable: found.mergeable }) : 'missing',
  );
}
for (const key of expect.absentItems || []) {
  check(`item ${key} not listed`, !(doc.items || []).some((item) => item.key === key));
}
for (const key of expect.deletions || []) {
  check(`deletion ${key}`, (doc.deletions || []).some((item) => item.key === key));
}
for (const expected of expect.actions || []) {
  const found = (doc.actions || []).find((action) => action.id === expected.id);
  check(
    `action ${expected.id}${expected.when ? ` ${expected.when}` : ''}`,
    found && (!expected.when || found.when === expected.when) && (expected.alreadyDone === undefined || !!found.alreadyDone === expected.alreadyDone),
    found ? JSON.stringify(found) : 'missing',
  );
}
for (const expected of expect.mergeFiles || []) {
  const found = (doc.files || []).find((file) => file.key === expected.key);
  check(
    `merge file ${expected.key}${expected.conflictBlocks !== undefined ? ` with ${expected.conflictBlocks} conflict block(s)` : ''}`,
    found && (expected.conflictBlocks === undefined || found.conflictBlocks === expected.conflictBlocks),
    found ? `conflictBlocks=${found.conflictBlocks}` : 'missing',
  );
}
for (const text of expect.promptContains || []) {
  check(`prompt contains "${text}"`, String(doc.prompt || '').includes(text));
}
for (const text of expect.nextCommandContains || []) {
  check(`next command contains "${text}"`, String(doc.nextCommand || '').includes(text), doc.nextCommand);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
