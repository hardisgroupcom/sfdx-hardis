#!/usr/bin/env node
// Assert the "Backpromotes" comments of the dumped Pull Requests (runbook section 6bis, checks C1 to C4).
//
//   node check-backpromote-comments.cjs <dump.json> <expectations.json>
//
// The dump is the provider agnostic shape of dump_pr_comments. On every dumped Pull Request:
//   - at most one comment carries the `<!-- sfdx-hardis backpromotes -->` marker;
//   - its hidden data block decodes, and every row has a sandbox name, an org id and an ISO date.
// Then the expectations, keyed by Pull Request number (`{{S1}}` substituted from BP_VAR_S1):
//   "{{S1}}": {
//     "comment": true | false,                           the comment must exist (or not)
//     "sandboxRowCount": 2,                              rows of the sandbox table
//     "sandboxes": [{ "name", "status", "leftOut": ["Type:Name"], "leftOutReasons": {"Type:Name": "keptOrg"} }],
//     "actions": [{ "id", "status", "sandbox" }]
//   }
const fs = require('fs');

const MARKER = '<!-- sfdx-hardis backpromotes -->';
const DATA_START = '<!-- sfdx-hardis backpromotes-data ';

function substitute(value) {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => process.env[`BP_VAR_${name}`] ?? `{{${name}}}`);
  }
  if (Array.isArray(value)) {
    return value.map(substitute);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [substitute(key), substitute(entry)]));
  }
  return value;
}

function parseData(body) {
  const start = body.indexOf(DATA_START);
  if (start === -1) return null;
  const end = body.indexOf(' -->', start + DATA_START.length);
  if (end === -1) return null;
  try {
    return JSON.parse(body.substring(start + DATA_START.length, end));
  } catch {
    return null;
  }
}

const [dumpFile, expectationsFile] = process.argv.slice(2);
if (!dumpFile || !expectationsFile) {
  console.error('Usage: node check-backpromote-comments.cjs <dump.json> <expectations.json>');
  process.exit(2);
}
const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
const expect = substitute(JSON.parse(fs.readFileSync(expectationsFile, 'utf8')));
let failures = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!condition) failures++;
}

const byNumber = new Map();
for (const pr of dump.prs || []) {
  const comments = (pr.comments || []).filter((comment) => String(comment.body || '').includes(MARKER));
  check(`#${pr.number}: at most one Backpromotes comment`, comments.length <= 1, `${comments.length} found`);
  const data = comments.length > 0 ? parseData(comments[0].body) : null;
  if (comments.length > 0) {
    check(`#${pr.number}: the data block decodes`, !!data);
    for (const row of data?.sandboxRows || []) {
      check(`#${pr.number}: sandbox row ${row.sandboxName} is complete`, !!row.sandboxName && !!row.orgId && /^\d{4}-\d{2}-\d{2}T/.test(row.date || ''), JSON.stringify(row));
    }
    check(`#${pr.number}: the visible table names every sandbox`, (data?.sandboxRows || []).every((row) => comments[0].body.includes(`| ${row.sandboxName} <sub>${row.orgId}</sub> |`)));
  }
  byNumber.set(String(pr.number), { comment: comments[0] || null, data });
}

for (const [number, expected] of Object.entries(expect)) {
  const found = byNumber.get(number);
  if (!found) {
    check(`#${number} dumped`, false);
    continue;
  }
  if (expected.comment !== undefined) {
    check(`#${number}: comment present ${expected.comment}`, (found.comment !== null) === expected.comment);
  }
  const data = found.data || { sandboxRows: [], actionRows: [] };
  if (expected.sandboxRowCount !== undefined) {
    check(`#${number}: ${expected.sandboxRowCount} sandbox row(s)`, data.sandboxRows.length === expected.sandboxRowCount, `got ${data.sandboxRows.length}`);
  }
  for (const sandbox of expected.sandboxes || []) {
    const rows = data.sandboxRows.filter((row) => row.sandboxName === sandbox.name);
    check(`#${number}: a row for ${sandbox.name}`, rows.length > 0, `rows: ${data.sandboxRows.map((row) => row.sandboxName).join(', ')}`);
    const row = rows[rows.length - 1];
    if (!row) continue;
    if (sandbox.status) check(`#${number}: ${sandbox.name} is ${sandbox.status}`, row.status === sandbox.status, `got ${row.status}`);
    for (const key of sandbox.leftOut || []) {
      check(`#${number}: ${sandbox.name} left out ${key}`, (row.leftOut || []).some((item) => item.key === key), JSON.stringify(row.leftOut));
    }
    for (const [key, reason] of Object.entries(sandbox.leftOutReasons || {})) {
      check(`#${number}: ${sandbox.name} left out ${key} because ${reason}`, (row.leftOut || []).some((item) => item.key === key && item.reason === reason), JSON.stringify(row.leftOut));
    }
    if (sandbox.noLeftOut) check(`#${number}: ${sandbox.name} left nothing out`, (row.leftOut || []).length === 0, JSON.stringify(row.leftOut));
  }
  for (const action of expected.actions || []) {
    const rows = data.actionRows.filter((row) => row.actionId === action.id && (!action.sandbox || row.sandboxName === action.sandbox));
    check(`#${number}: action ${action.id} recorded`, rows.length > 0, `actions: ${data.actionRows.map((row) => `${row.actionId}=${row.status}`).join(', ')}`);
    if (rows.length > 0 && action.status) {
      check(`#${number}: action ${action.id} is ${action.status}`, rows.some((row) => row.status === action.status), rows.map((row) => row.status).join(', '));
    }
    if (action.count !== undefined) {
      check(`#${number}: action ${action.id} has ${action.count} row(s)`, rows.length === action.count, `got ${rows.length}`);
    }
  }
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
