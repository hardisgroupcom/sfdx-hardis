#!/usr/bin/env node
/*
 * Asserts the identical actions of a `sf hardis:work:backpromote --plan --json` document, or of a
 * run result (runbook section 6sexies). Prints one line per expectation and exits 1 when one fails.
 *
 *   node check-backpromote-identical.cjs <backpromote.json> <expectation>...
 *
 * Expectations:
 *   I:<pr>:<actionId>=<pr>:<actionId>|none   the plan action it runs once with (identicalTo)
 *   K:<key>                                   a plan action has that key (<pr>:<pre|post>:<id>)
 *   U                                         every plan action has a key, and no key is repeated
 *   R:<key>=<outcome>                         run result: actions.byKey[<key>] (run, skipped, failed,
 *                                             pending, identical)
 */
const fs = require('fs');

const [file, ...expectations] = process.argv.slice(2);
if (!file) {
  console.error('usage: check-backpromote-identical.cjs <backpromote.json> <expectation>...');
  process.exit(2);
}
let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}
// A refused or interrupted run is a JSON error whose data holds the plan
const plan = doc.result || doc.data || doc;
const actions = plan.actions || [];
const byKey = plan.result?.actions?.byKey || {};
let failures = 0;
const report = (ok, expectation, actual) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${expectation}${ok ? '' : `  (got ${actual})`}`);
  if (!ok) {
    failures++;
  }
};

for (const expectation of expectations) {
  let match;
  if ((match = expectation.match(/^I:(\d+):([^=]+)=(.+)$/))) {
    const [, pr, actionId, want] = match;
    const action = actions.find((a) => String(a.pullRequest) === pr && a.id === actionId);
    const got = !action ? 'no plan action' : action.identicalTo ? `${action.identicalTo.pullRequest}:${action.identicalTo.id}` : 'none';
    report(got === want, expectation, got);
  } else if ((match = expectation.match(/^K:(.+)$/))) {
    report(actions.some((a) => a.key === match[1]), expectation, JSON.stringify(actions.map((a) => a.key)));
  } else if (expectation === 'U') {
    const keys = actions.map((a) => a.key);
    const unique = keys.every((key) => typeof key === 'string' && key !== '') && new Set(keys).size === keys.length;
    report(unique, expectation, JSON.stringify(keys));
  } else if ((match = expectation.match(/^R:([^=]+)=(.+)$/))) {
    const got = byKey[match[1]] || 'none';
    report(got === match[2], expectation, got);
  } else {
    report(false, expectation, 'unknown expectation');
  }
}
process.exit(failures > 0 ? 1 : 0);
