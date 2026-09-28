// Audit the sfdx-hardis comments posted on the Pull Requests of an end to end test repository.
//
//   node audit-pr-comments.cjs <dump.json> [expectations.json]
//
// The dump is provider agnostic and is produced by `dump_pr_comments` of each e2e-lib-*.sh:
//
//   { "provider": "github",
//     "prs": [ { "number": 1, "title": "...", "sourceBranch": "...", "targetBranch": "...",
//                "state": "merged", "description": "...",
//                "comments": [ { "id": "...", "body": "...", "url": "..." } ] } ] }
//
// The expectations file is optional and says what each Pull Request should have reached:
//
//   { "1": { "kind": "story", "orgBranches": ["integration", "uat"], "manualActions": ["e2e-manual-1"] },
//     "7": { "kind": "promotion", "carries": [1, 3] } }
//
// Everything else is checked without being told: a Pull Request that received a validation job must
// carry exactly one validation comment, the navigation must point at comments of the same Pull
// Request, no comment may leak an unresolved value, and a promotion comment must name the Pull
// Requests the promotion declares.
//
// Exits non-zero as soon as one check fails, and prints every finding.

const fs = require("fs");

const DUMP_PATH = process.argv[2];
const EXPECTATIONS_PATH = process.argv[3];
if (!DUMP_PATH) {
  console.error("Usage: node audit-pr-comments.cjs <dump.json> [expectations.json]");
  process.exit(2);
}
const dump = JSON.parse(fs.readFileSync(DUMP_PATH, "utf8"));
const expectations = EXPECTATIONS_PATH ? JSON.parse(fs.readFileSync(EXPECTATIONS_PATH, "utf8")) : {};

const DEPLOYMENT_ACTIONS_MARKER = "<!-- sfdx-hardis deployment-actions-state -->";
const NAV_START = "<!-- sfdx-hardis nav-start -->";
const NAV_END = "<!-- sfdx-hardis nav-end -->";
const MESSAGE_KEY_REGEX = /<!-- sfdx-hardis message-key (\S+) -->/;

// Same rule as getPrCommentKind in src/common/gitProvider/prCommentNav.ts
function commentKind(body) {
  if (body.includes(DEPLOYMENT_ACTIONS_MARKER)) return "actions";
  const messageKey = (body.match(MESSAGE_KEY_REGEX) || [])[1] || "";
  if (messageKey.startsWith("deployment-check-")) return "validation";
  if (messageKey.startsWith("deployment-")) return "deployment";
  return null;
}

const findings = [];
const fail = (pr, what) => findings.push(`#${pr}: ${what}`);
let checks = 0;
const check = (condition, pr, what) => {
  checks++;
  if (!condition) fail(pr, what);
};

// A value that leaked into user facing markdown because something upstream was undefined. Matched
// on word boundaries so "undefined" inside a code block of a real message is not reported.
const LEAKED_VALUES = [
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
  /\{\{[a-zA-Z0-9_.]+\}\}/, // an i18n placeholder that was never interpolated
];

const allPrNumbers = new Set(dump.prs.map((pr) => pr.number));

for (const pr of dump.prs) {
  const sfdxComments = (pr.comments || []).filter((c) => c.body.includes("<!-- sfdx-hardis "));
  const byKind = { validation: [], deployment: [], actions: [], other: [] };
  for (const comment of sfdxComments) {
    const kind = commentKind(comment.body);
    byKind[kind || "other"].push(comment);
  }

  // 1. At most one comment of each kind: a job must update its comment in place, never add a second
  for (const kind of ["validation", "deployment", "actions"]) {
    check(
      byKind[kind].length <= 1,
      pr.number,
      `${byKind[kind].length} ${kind} comments, expected at most 1 (a re-run must update in place)`,
    );
  }

  // 2. A Pull Request that was deployed must carry a deployment comment, and one that was
  //    validated must carry a validation comment. Both jobs ran for every Pull Request of the run.
  const expected = expectations[String(pr.number)] || {};
  if (expected.kind === "story" || expected.kind === "promotion") {
    check(byKind.validation.length === 1, pr.number, "no validation comment");
    check(byKind.deployment.length === 1, pr.number, "no deployment comment");
  }

  // 3. Nothing leaked into any sfdx-hardis comment
  for (const comment of sfdxComments) {
    for (const pattern of LEAKED_VALUES) {
      check(!pattern.test(comment.body), pr.number, `comment ${comment.id} contains ${pattern}`);
    }
  }

  // 4. The navigation block is well formed and points at comments of THIS Pull Request
  const present = ["validation", "deployment", "actions"].filter((k) => byKind[k].length === 1);
  for (const comment of sfdxComments) {
    const kind = commentKind(comment.body);
    if (!kind) continue;
    const hasNav = comment.body.includes(NAV_START);
    if (present.length < 2) {
      // A lonely comment renders no navigation at all, by design
      continue;
    }
    check(hasNav, pr.number, `${kind} comment has no navigation block though ${present.length} comments exist`);
    if (!hasNav) continue;
    check(comment.body.includes(NAV_END), pr.number, `${kind} comment navigation block is not closed`);
    const nav = comment.body.slice(
      comment.body.indexOf(NAV_START) + NAV_START.length,
      comment.body.indexOf(NAV_END),
    );
    // The current comment is bold text, the others are links
    check(
      nav.includes("**"),
      pr.number,
      `${kind} comment navigation does not mark the current entry in bold`,
    );
    for (const other of present) {
      if (other === kind) continue;
      const label = { validation: "Validation", deployment: "Deployment", actions: "Actions" }[other];
      check(nav.includes(label), pr.number, `${kind} comment navigation does not link to ${other}`);
    }
    // Every link of the navigation must address this Pull Request, never another one
    const links = [...nav.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
    check(links.length >= 1, pr.number, `${kind} comment navigation has no link`);
    for (const link of links) {
      check(
        new RegExp(`(pull-requests?|pullrequest|merge_requests|pull)/${pr.number}(\\b|[/?#])`).test(link),
        pr.number,
        `${kind} comment navigation links to another Pull Request: ${link}`,
      );
    }
  }

  // 5. The Deployment Actions comment: one column per org branch reached, one pending manual
  //    checkbox per org branch, and no duplicated action row
  if (byKind.actions.length === 1) {
    const body = byKind.actions[0].body;
    const statusHeader = (body.match(/^\| Action \| When \|(.+)\|\s*$/m) || [])[1] || "";
    const columns = statusHeader
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const branch of expected.orgBranches || []) {
      check(columns.includes(branch), pr.number, `Deployment Actions has no column for org branch ${branch}`);
    }
    if ((expected.orgBranches || []).length > 0) {
      check(
        columns.length === expected.orgBranches.length,
        pr.number,
        `Deployment Actions has columns ${JSON.stringify(columns)}, expected ${JSON.stringify(expected.orgBranches)}`,
      );
    }
    for (const actionId of expected.manualActions || []) {
      for (const branch of expected.orgBranches || []) {
        const marker = `<!-- sfdx-hardis-manual-action id:${actionId} org:${branch} pr:${pr.number} when:`;
        check(
          body.includes(marker),
          pr.number,
          `Deployment Actions has no pending manual checkbox for ${actionId} on ${branch}`,
        );
      }
    }
    // Which actions are manual, read from the details fold: a manual action is the only kind a
    // human has to complete, and the only kind whose state can be left unreachable
    const manualActionIds = new Set();
    for (const block of body.split('<!-- actionId:').slice(1)) {
      const actionId = (block.match(/^(\S+) order:/) || [])[1];
      if (actionId && /\| Type \| manual \|/.test(block)) {
        manualActionIds.add(actionId);
      }
    }

    // Every org branch still waiting for a manual action must offer a checkbox to tick, and every
    // checkbox must correspond to a branch that is really waiting. And a manual action must never
    // end up "skipped" in a branch it reached: a skip drops it from the pending list, so nobody can
    // ever mark it done, and the branch displays a skip for a step nobody performed.
    const statusRows = body.split('\n').filter((line) => /^\| <!-- actionId:/.test(line));
    for (const row of statusRows) {
      const actionId = (row.match(/actionId:(\S+) order:/) || [])[1];
      const cells = row.split('|').slice(3, 3 + columns.length).map((cell) => cell.trim());
      cells.forEach((cell, index) => {
        const branch = columns[index];
        if (!branch) return;
        const waiting = cell.includes('\u{1F44B}');
        const skipped = cell.includes('\u26AA');
        const hasCheckbox = body.includes(`<!-- sfdx-hardis-manual-action id:${actionId} org:${branch} pr:${pr.number} when:`);
        check(
          !waiting || hasCheckbox,
          pr.number,
          `${actionId} is waiting for manual execution in ${branch} but offers no checkbox to tick`,
        );
        check(
          !hasCheckbox || waiting,
          pr.number,
          `${actionId} offers a checkbox for ${branch} though its status there is not "waiting" (${cell})`,
        );
        check(
          !(skipped && manualActionIds.has(actionId)),
          pr.number,
          `manual action ${actionId} is marked skipped in ${branch}: it left the pending list and can no longer be ticked`,
        );
      });
    }

    // An action must appear once per row, not once per job that ran it
    const actionRows = [...body.matchAll(/<!-- actionId:([^\s]+) order:\d+ -->/g)].map((m) => m[1]);
    const seen = new Map();
    for (const id of actionRows) seen.set(id, (seen.get(id) || 0) + 1);
    for (const [id, count] of seen) {
      // one row in "Status by org branch" plus one in the "Action Details" fold
      check(count <= 2, pr.number, `Deployment Actions repeats action ${id} ${count} times`);
    }
  } else if ((expected.manualActions || []).length > 0) {
    fail(pr.number, "no Deployment Actions comment though the Pull Request declares actions");
    checks++;
  }

  // 6. A promotion Pull Request must name every Pull Request it carries, in its description and in
  //    the scope its validation comment reports
  if (expected.kind === "promotion" && (expected.carries || []).length > 0) {
    for (const carried of expected.carries) {
      check(
        new RegExp(`\\b${carried}\\b`).test(pr.description || ""),
        pr.number,
        `promotion description does not name carried Pull Request #${carried}`,
      );
      check(allPrNumbers.has(carried), pr.number, `promotion carries #${carried}, absent from the repository`);
    }
    const validation = byKind.validation[0];
    if (validation) {
      for (const carried of expected.carries) {
        check(
          new RegExp(`#${carried}\\b`).test(validation.body),
          pr.number,
          `validation comment does not mention carried Pull Request #${carried}`,
        );
      }
    }
  }

  // 7. A story Pull Request must never claim to carry anything
  if (expected.kind === "story") {
    check(
      !/promotionPullRequests/.test(pr.description || ""),
      pr.number,
      "a story Pull Request declares promotionPullRequests",
    );
  }
}

console.log(`${checks} checks over ${dump.prs.length} Pull Requests (${dump.provider})`);
if (findings.length === 0) {
  console.log("OK: every sfdx-hardis Pull Request comment is consistent");
  process.exit(0);
}
console.log(`${findings.length} FINDING(S):`);
for (const finding of findings) console.log("  - " + finding);
process.exit(1);
