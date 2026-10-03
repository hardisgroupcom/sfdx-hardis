#!/usr/bin/env node
/*
 * Asserts a `sf hardis:project:action:list --with-status [--forecast <branch>] [--with-backpromotes] --json`
 * document (runbook section 6quater). Prints one line per expectation and exits 1 on the first
 * mismatch report.
 *
 *   node check-action-status.cjs <list.json> <expectation>...
 *
 * Expectations:
 *   S:<pr>:<actionId>:<orgBranch>=<status>          status recorded in the Deployment Actions comment
 *   S:<pr>:<actionId>:<orgBranch>=none              no entry for that org branch
 *   N:<pr>:<actionId>:<orgBranch>~<regex>           its note matches the regex
 *   F:<pr>:<actionId>=<forecast>[/<reason>]         forecast of the next promotion
 *   P=<number>|none                                  open promotion Pull Request of the forecast
 *   C:<pr>=yes|no                                    the promotion carries that Pull Request
 *   B:<pr>:<actionId>=<status>                       a Backpromotes row with that status exists
 *   G=<true|false>                                   gitProvider flag of the result
 */
const fs = require('fs');

const [file, ...expectations] = process.argv.slice(2);
if (!file) {
  console.error('usage: check-action-status.cjs <list.json> <expectation>...');
  process.exit(2);
}
let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}
const result = doc.result || doc;
const statuses = result.statuses || {};
const forecast = result.forecast || null;
const backpromotes = result.backpromotes || {};
let failures = 0;
const report = (ok, expectation, actual) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${expectation}${ok ? '' : `  (got ${actual})`}`);
  if (!ok) {
    failures++;
  }
};

for (const expectation of expectations) {
  let match;
  if ((match = expectation.match(/^S:(\d+|draft):([^:]+):([^=]+)=(.+)$/))) {
    const [, pr, actionId, orgBranch, want] = match;
    const entry = (statuses[pr] || []).find((e) => e.actionId === actionId && e.orgBranch === orgBranch);
    const got = entry ? entry.status : 'none';
    report(got === want, expectation, got);
  } else if ((match = expectation.match(/^N:(\d+):([^:]+):([^~]+)~(.+)$/))) {
    const [, pr, actionId, orgBranch, pattern] = match;
    const entry = (statuses[pr] || []).find((e) => e.actionId === actionId && e.orgBranch === orgBranch);
    const note = entry?.note || '';
    report(new RegExp(pattern).test(note), expectation, JSON.stringify(note));
  } else if ((match = expectation.match(/^F:(\d+):([^=]+)=([^/]+)(?:\/(.+))?$/))) {
    const [, pr, actionId, want, wantReason] = match;
    const item = (forecast?.actions?.[pr] || []).find((a) => a.actionId === actionId);
    const got = item ? `${item.forecast}/${item.reason}` : 'no forecast';
    report(!!item && item.forecast === want && (!wantReason || item.reason === wantReason), expectation, got);
  } else if ((match = expectation.match(/^P=(.+)$/))) {
    const got = forecast?.promotionPullRequest ? String(forecast.promotionPullRequest.number) : 'none';
    report(got === match[1], expectation, got);
  } else if ((match = expectation.match(/^C:(\d+)=(yes|no)$/))) {
    const carried = forecast?.promotionPullRequest?.carriedPrIds;
    const got = carried === null || carried === undefined ? 'yes' : carried.includes(Number(match[1])) ? 'yes' : 'no';
    report(got === match[2], expectation, `${got} (carried: ${JSON.stringify(carried)})`);
  } else if ((match = expectation.match(/^B:(\d+):([^=]+)=(.+)$/))) {
    const [, pr, actionId, want] = match;
    const rows = (backpromotes[pr] || []).filter((r) => r.actionId === actionId);
    report(rows.some((r) => r.status === want), expectation, JSON.stringify(rows.map((r) => `${r.sandboxName}/${r.status}`)));
  } else if ((match = expectation.match(/^G=(true|false)$/))) {
    const got = String(result.gitProvider !== false);
    report(got === match[1], expectation, got);
  } else {
    report(false, expectation, 'unknown expectation');
  }
}
process.exit(failures > 0 ? 1 : 0);
