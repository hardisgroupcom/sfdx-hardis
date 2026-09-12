#!/usr/bin/env node
// Assert a `sf hardis:work:backpromote ... --json` document (plan version 3) against the
// expectations of a point of the run (runbook section 6bis).
//
//   node check-backpromote-plan.cjs <document.json> <expectations.json>
//
// The document is the sf JSON envelope: `result` on success, `data` (the same plan) on a refusal.
// `{{S1}}` in a value is replaced by the BP_VAR_S1 environment variable, so the Pull Request
// numbers, the sandbox name and the file paths of the run do not have to be edited into the files.
//
// Expectations (every key optional):
//   exitStatus              sf envelope status (0 on success, 1 on a refusal)
//   errorContains           text of the error message of a refused run
//   status                  ok | blocked | nothingToDo | waitingForMerges | conflictsRemaining | refused | pushRejected | deployFailed
//   mode                    plan | prepare | run | reset | confirm
//   orgType                 sandbox | scratch | production
//   sandboxName             the sandbox name of the plan
//   checks                  [{ id, ok, messageContains }]
//   pullRequests            [numbers that must be listed]
//   absentPullRequests      [numbers that must not be listed]
//   backpromoted            [numbers whose backpromote row is set]
//   notBackpromoted         [numbers whose backpromote row is null]
//   beforeRefresh           [numbers flagged beforeRefresh]
//   selected                the start Pull Request number (0: none selected)
//   scanFound, scanRead, scanHasMore
//   windowNull              true when no window is computed
//   windowStart             the start Pull Request of the window
//   items, absentItems      ["Type:Name"]
//   excludedLastTime        ["Type:Name"] items flagged excludedLastTime
//   deletions               ["Type:Name"]
//   actions                 [{ id, phase, alreadyRun }]
//   comparison              [{ fileContains, status | statusIn, threeWay, prepared, markersRemainingMin, markersRemaining, decision, hasVersions }]
//   checkoutClean, onBackpromoteBranch, currentBranch, originalBranch, stashed
//   branchExistsOnOrigin, pendingMergesContain ["path part"]
//   promptFile              true when a prompt file must be returned
//   result                  { deployed, deleted, pushed, actionsRun, actionsPending, actionsSkipped, excludedKeys, conflictPending, commentedPullRequests }
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
const doc = envelope.result && envelope.result.version === 3 ? envelope.result : envelope.data && envelope.data.version === 3 ? envelope.data : envelope.result || {};
let failures = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!condition) failures++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (expect.exitStatus !== undefined) {
  check(`exit status ${expect.exitStatus}`, envelope.status === expect.exitStatus, `got ${envelope.status}`);
}
if (expect.errorContains !== undefined) {
  const message = String(envelope.message || envelope.name || doc.message || '');
  check(`error contains "${expect.errorContains}"`, message.includes(expect.errorContains), message.substring(0, 160));
}
check('plan version 3', doc.version === 3, `got ${doc.version}`);
if (expect.status !== undefined) {
  check(`status ${expect.status}`, doc.status === expect.status, `got ${doc.status}: ${String(doc.message || '').substring(0, 120)}`);
}
if (expect.mode !== undefined) {
  check(`mode ${expect.mode}`, doc.mode === expect.mode, `got ${doc.mode}`);
}
if (expect.orgType !== undefined) {
  check(`org type ${expect.orgType}`, doc.targetOrg?.orgType === expect.orgType, `got ${doc.targetOrg?.orgType}`);
}
if (expect.sandboxName !== undefined) {
  check(`sandbox name ${expect.sandboxName}`, doc.targetOrg?.sandboxName === expect.sandboxName, `got ${doc.targetOrg?.sandboxName}`);
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
const prs = doc.pullRequests || [];
const listed = prs.map((pr) => pr.number);
for (const number of expect.pullRequests || []) {
  check(`Pull Request #${number} listed`, listed.includes(number), `listed: ${listed.join(', ')}`);
}
for (const number of expect.absentPullRequests || []) {
  check(`Pull Request #${number} absent`, !listed.includes(number), `listed: ${listed.join(', ')}`);
}
for (const number of expect.backpromoted || []) {
  const pr = prs.find((entry) => entry.number === number);
  check(`Pull Request #${number} backpromoted`, !!pr && pr.backpromote !== null, pr ? JSON.stringify(pr.backpromote) : 'not listed');
}
for (const number of expect.notBackpromoted || []) {
  const pr = prs.find((entry) => entry.number === number);
  check(`Pull Request #${number} not backpromoted`, !!pr && pr.backpromote === null, pr ? JSON.stringify(pr.backpromote) : 'not listed');
}
for (const number of expect.beforeRefresh || []) {
  const pr = prs.find((entry) => entry.number === number);
  check(`Pull Request #${number} before refresh`, !!pr && pr.beforeRefresh === true, pr ? `beforeRefresh=${pr.beforeRefresh}` : 'not listed');
}
if (expect.selected !== undefined) {
  const selected = prs.filter((pr) => pr.selected).map((pr) => pr.number);
  check(`selected start ${expect.selected}`, expect.selected === 0 ? selected.length === 0 : selected.includes(expect.selected), `selected: ${selected.join(', ')}`);
}
if (expect.scanFound !== undefined) {
  check(`scan found ${expect.scanFound}`, doc.scan?.found === expect.scanFound, JSON.stringify(doc.scan));
}
if (expect.scanRead !== undefined) {
  check(`scan read ${expect.scanRead}`, doc.scan?.read === expect.scanRead, JSON.stringify(doc.scan));
}
if (expect.scanHasMore !== undefined) {
  check(`scan has more ${expect.scanHasMore}`, doc.scan?.hasMore === expect.scanHasMore, JSON.stringify(doc.scan));
}
if (expect.windowNull !== undefined) {
  check(`window null ${expect.windowNull}`, (doc.window === null) === expect.windowNull, JSON.stringify(doc.window));
}
if (expect.windowStart !== undefined) {
  check(`window starts at #${expect.windowStart}`, doc.window?.startPullRequest === expect.windowStart, JSON.stringify(doc.window));
}
const itemKeys = (doc.items || []).map((item) => item.key);
for (const key of expect.items || []) {
  check(`item ${key}`, itemKeys.includes(key), `items: ${itemKeys.join(', ')}`);
}
for (const key of expect.absentItems || []) {
  check(`item ${key} absent`, !itemKeys.includes(key), `items: ${itemKeys.join(', ')}`);
}
for (const key of expect.excludedLastTime || []) {
  const item = (doc.items || []).find((entry) => entry.key === key);
  check(`item ${key} left out last time`, !!item && item.excludedLastTime === true, item ? `excludedLastTime=${item.excludedLastTime}` : 'not listed');
}
const deletionKeys = (doc.deletions || []).map((item) => item.key);
for (const key of expect.deletions || []) {
  check(`deletion ${key}`, deletionKeys.includes(key), `deletions: ${deletionKeys.join(', ')}`);
}
for (const expected of expect.actions || []) {
  const found = (doc.actions || []).find((action) => action.id === expected.id);
  check(`action ${expected.id} listed`, !!found, `actions: ${(doc.actions || []).map((action) => action.id).join(', ')}`);
  if (found && expected.phase) {
    check(`  ${expected.id} runs ${expected.phase} deployment`, found.phase === expected.phase, `got ${found.phase}`);
  }
  if (found && expected.alreadyRun !== undefined) {
    check(`  ${expected.id} already run ${expected.alreadyRun}`, (found.alreadyRunOn !== null) === expected.alreadyRun, `alreadyRunOn=${found.alreadyRunOn}`);
  }
}
for (const expected of expect.comparison || []) {
  const found = (doc.comparison || []).find((entry) => entry.file.includes(expected.fileContains));
  check(`comparison of ${expected.fileContains}`, !!found, `files: ${(doc.comparison || []).map((entry) => `${entry.file}=${entry.status}`).join(', ')}`);
  if (!found) continue;
  if (expected.status !== undefined) {
    check(`  status ${expected.status}`, found.status === expected.status, `got ${found.status}`);
  }
  if (expected.statusIn !== undefined) {
    check(`  status in ${expected.statusIn.join('|')}`, expected.statusIn.includes(found.status), `got ${found.status}`);
  }
  if (expected.threeWay !== undefined) {
    check(`  three-way ${expected.threeWay}`, found.threeWay === expected.threeWay, `got ${found.threeWay}`);
  }
  if (expected.prepared !== undefined) {
    check(`  prepared ${expected.prepared}`, found.prepared === expected.prepared, `got ${found.prepared}`);
  }
  if (expected.markersRemainingMin !== undefined) {
    check(`  at least ${expected.markersRemainingMin} marker(s)`, found.markersRemaining >= expected.markersRemainingMin, `got ${found.markersRemaining}`);
  }
  if (expected.markersRemaining !== undefined) {
    check(`  ${expected.markersRemaining} marker(s)`, found.markersRemaining === expected.markersRemaining, `got ${found.markersRemaining}`);
  }
  if (expected.decision !== undefined) {
    check(`  decision ${expected.decision}`, found.decision === expected.decision, `got ${found.decision}`);
  }
  if (expected.hasVersions) {
    const versions = found.versions || {};
    const present = ['sandbox', 'parentHead'].every((key) => versions[key] && fs.existsSync(versions[key]));
    check('  sandbox and parent head versions exist in the cache', present, JSON.stringify(versions));
    if (expected.threeWay) {
      check('  base version exists in the cache', !!versions.base && fs.existsSync(versions.base), String(versions.base));
    }
  }
}
if (expect.checkoutClean !== undefined) {
  check(`checkout clean ${expect.checkoutClean}`, doc.checkout?.clean === expect.checkoutClean, JSON.stringify(doc.checkout?.dirtyFiles));
}
if (expect.dirtyFilesContain !== undefined) {
  for (const file of expect.dirtyFilesContain) {
    check(`dirty file ${file}`, (doc.checkout?.dirtyFiles || []).some((entry) => entry.includes(file)), JSON.stringify(doc.checkout?.dirtyFiles));
  }
}
if (expect.onBackpromoteBranch !== undefined) {
  check(`on backpromote branch ${expect.onBackpromoteBranch}`, doc.checkout?.onBackpromoteBranch === expect.onBackpromoteBranch, `current: ${doc.checkout?.currentBranch}`);
}
if (expect.currentBranch !== undefined) {
  check(`current branch ${expect.currentBranch}`, doc.checkout?.currentBranch === expect.currentBranch, `got ${doc.checkout?.currentBranch}`);
}
if (expect.originalBranch !== undefined) {
  check(`original branch ${expect.originalBranch}`, doc.checkout?.originalBranch === expect.originalBranch, `got ${doc.checkout?.originalBranch}`);
}
if (expect.stashed !== undefined) {
  check(`stashed ${expect.stashed}`, doc.checkout?.stashed === expect.stashed, `stash: ${doc.checkout?.stashMessage}`);
}
if (expect.branchExistsOnOrigin !== undefined) {
  check(`backpromote branch on origin ${expect.branchExistsOnOrigin}`, doc.backpromoteBranch?.existsOnOrigin === expect.branchExistsOnOrigin, JSON.stringify(doc.backpromoteBranch));
}
for (const part of expect.pendingMergesContain || []) {
  check(`pending merge ${part}`, (doc.backpromoteBranch?.pendingMerges || []).some((file) => file.includes(part)), JSON.stringify(doc.backpromoteBranch?.pendingMerges));
}
if (expect.promptFile !== undefined) {
  const has = typeof doc.promptFile === 'string' && doc.promptFile !== '' && fs.existsSync(doc.promptFile);
  check(`prompt file ${expect.promptFile}`, has === expect.promptFile, String(doc.promptFile));
}
if (expect.result) {
  const result = doc.result || {};
  const r = expect.result;
  check('result present', !!doc.result);
  if (r.deployed !== undefined) check(`  deployed ${r.deployed}`, result.deployed === r.deployed, `got ${result.deployed}`);
  if (r.deleted !== undefined) check(`  deleted ${r.deleted}`, result.deleted === r.deleted, `got ${result.deleted}`);
  if (r.pushed !== undefined) check(`  pushed ${r.pushed}`, result.pushed === r.pushed, `got ${result.pushed}`);
  for (const id of r.actionsRun || []) check(`  action ${id} run`, (result.actions?.run || []).includes(id), JSON.stringify(result.actions));
  for (const id of r.actionsPending || []) check(`  action ${id} pending`, (result.actions?.pending || []).includes(id), JSON.stringify(result.actions));
  for (const id of r.actionsSkipped || []) check(`  action ${id} skipped`, (result.actions?.skipped || []).includes(id), JSON.stringify(result.actions));
  for (const id of r.actionsNotRun || []) check(`  action ${id} not run`, !(result.actions?.run || []).includes(id), JSON.stringify(result.actions));
  for (const key of r.excludedKeys || []) check(`  excluded ${key}`, (result.excluded || []).some((item) => item.key === key), JSON.stringify(result.excluded));
  if (r.excludedReasons) {
    for (const [key, reason] of Object.entries(r.excludedReasons)) {
      check(`  ${key} left out because ${reason}`, (result.excluded || []).some((item) => item.key === key && item.reason === reason), JSON.stringify(result.excluded));
    }
  }
  if (r.noExclusion) check('  nothing excluded', (result.excluded || []).length === 0, JSON.stringify(result.excluded));
  for (const key of r.conflictPending || []) check(`  conflict pending ${key}`, (result.conflictPending || []).includes(key), JSON.stringify(result.conflictPending));
  for (const number of r.commentedPullRequests || []) check(`  comment written on #${number}`, (result.commentedPullRequests || []).includes(number), JSON.stringify(result.commentedPullRequests));
  if (r.commentedCount !== undefined) check(`  ${r.commentedCount} comment(s) written`, same((result.commentedPullRequests || []).length, r.commentedCount), JSON.stringify(result.commentedPullRequests));
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
