#!/usr/bin/env node
// Consistency of the backpromote (Beta) history comments of a repository, after the backpromotes of
// runbook section 6bis. Reads the provider agnostic dump written by `dump_pr_comments` (GitHub,
// GitLab and Azure DevOps libraries) and checks:
//
// - every Pull Request holds at most one history comment (one comment per Pull Request, whatever the
//   number of orgs);
// - every row carries a record that decodes, with an org id, an org name, an ISO date (or none for a
//   record holding actions only), a 40 character merge commit when deployed, and known action statuses;
// - no org appears twice in a comment, and the visible table has exactly one row per record, showing
//   the org name and the short commit of that record;
// - the expectations: which Pull Requests have no history, which orgs each one lists, with which
//   merge commit and which action results.
//
//   node check-backpromote-comments.cjs <dump.json> <expectations.json>
//
// Expectations:
//   { "prs": {
//       "12": { "absent": true },
//       "13": { "orgCount": 2, "orgs": [ { "orgId": "00D...", "orgName": "x", "deployed": true, "commit": "<sha>",
//                                          "actions": { "e2e-pre-13": "success" }, "actionsAbsent": ["e2e-post-13"] } ] }
//   } }
// `{{NAME}}` in the expectations file is replaced by the BP_VAR_NAME environment variable first.
const fs = require('fs');

const MARKER = '<!-- sfdx-hardis backpromote-state -->';
const ROW_REGEX = /^\|\s*<!-- sfdx-hardis-backpromote data:(\S+) -->\s*`([^`]*)`\s*\|\s*([^|]*)\|\s*([^|]*)\|/;
const STATUSES = new Set(['success', 'failed', 'warning', 'manual', 'skipped']);

function readExpectations(file) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('BP_VAR_')) {
      text = text.split(`{{${name.substring('BP_VAR_'.length)}}}`).join(value);
    }
  }
  return JSON.parse(text);
}

const [dumpFile, expectationsFile] = process.argv.slice(2);
if (!dumpFile || !expectationsFile) {
  console.error('Usage: node check-backpromote-comments.cjs <dump.json> <expectations.json>');
  process.exit(2);
}
const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
const expect = readExpectations(expectationsFile);
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
const sameOrg = (a, b) => (a || '').substring(0, 15) === (b || '').substring(0, 15) && (a || '').length >= 15;

const recordsByPr = new Map();
for (const pr of dump.prs || []) {
  const historyComments = (pr.comments || []).filter((comment) => (comment.body || '').includes(MARKER));
  check(`#${pr.number}: at most one history comment`, historyComments.length <= 1, `${historyComments.length} comments`);
  const records = [];
  for (const comment of historyComments) {
    const rows = (comment.body || '').split(/\r?\n/).filter((line) => line.includes('<!-- sfdx-hardis-backpromote data:'));
    for (const row of rows) {
      const match = row.match(ROW_REGEX);
      if (!match) {
        check(`#${pr.number}: row is a table row with the org name`, false, row.substring(0, 120));
        continue;
      }
      let record = null;
      try {
        record = JSON.parse(decodeURIComponent(match[1]));
      } catch (e) {
        check(`#${pr.number}: row data decodes`, false, e.message);
        continue;
      }
      const label = `#${pr.number} ${record.orgName || record.orgId}`;
      const dateOk = record.date === null || (typeof record.date === 'string' && !isNaN(Date.parse(record.date)));
      const commitOk = !record.date || /^[0-9a-f]{40}$/.test(record.commit || '');
      const actionsOk = Array.isArray(record.actions) && record.actions.every((action) => action && typeof action.id === 'string' && STATUSES.has(action.status));
      check(`${label}: record is well formed`, typeof record.orgId === 'string' && record.orgId.length >= 15 && !!record.orgName && dateOk && commitOk && actionsOk,
        JSON.stringify(record).substring(0, 300));
      check(`${label}: visible row shows the org name and the short commit`,
        match[2] === record.orgName && (!record.commit || match[4].includes(record.commit.substring(0, 7))),
        `row: ${row.substring(row.indexOf('-->') + 3, row.indexOf('-->') + 120)}`);
      records.push(record);
    }
  }
  const orgIds = records.map((record) => record.orgId.substring(0, 15));
  check(`#${pr.number}: each org listed once`, new Set(orgIds).size === orgIds.length, orgIds.join(', '));
  recordsByPr.set(Number(pr.number), records);
}

for (const [prNumber, expected] of Object.entries(expect.prs || {})) {
  const records = recordsByPr.get(Number(prNumber));
  if (records === undefined) {
    check(`#${prNumber}: present in the dump`, false, 'not dumped');
    continue;
  }
  if (expected.absent) {
    check(`#${prNumber}: no backpromote history`, records.length === 0, `${records.length} record(s)`);
    continue;
  }
  if (expected.orgCount !== undefined) {
    check(`#${prNumber}: ${expected.orgCount} org(s) listed`, records.length === expected.orgCount, `${records.length}: ${records.map((record) => record.orgName).join(', ')}`);
  }
  for (const org of expected.orgs || []) {
    const record = records.find((item) => sameOrg(item.orgId, org.orgId));
    const label = `#${prNumber} ${org.orgName || org.orgId}`;
    check(`${label}: listed`, !!record, records.map((item) => `${item.orgName} ${item.orgId}`).join(', '));
    if (!record) {
      continue;
    }
    if (org.orgName) {
      check(`${label}: org name`, record.orgName === org.orgName, record.orgName);
    }
    if (org.deployed !== undefined) {
      check(`${label}: ${org.deployed ? 'deployed' : 'not deployed'}`, !!record.date === org.deployed, `date=${record.date}`);
    }
    if (org.commit) {
      check(`${label}: merge commit`, (record.commit || '').startsWith(org.commit) || org.commit.startsWith(record.commit || '-'), record.commit);
    }
    for (const [actionId, status] of Object.entries(org.actions || {})) {
      const action = (record.actions || []).find((item) => item.id === actionId);
      check(`${label}: action ${actionId} ${status}`, !!action && action.status === status, action ? action.status : 'missing');
    }
    for (const actionId of org.actionsAbsent || []) {
      check(`${label}: action ${actionId} not recorded`, !(record.actions || []).some((item) => item.id === actionId));
    }
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
