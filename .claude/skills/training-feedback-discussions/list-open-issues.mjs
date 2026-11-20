#!/usr/bin/env node
/**
 * Lists the open issues of sfdx-hardis-training, sorted into what waits for a
 * maintainer and what waits for the learner.
 *
 *   node list-open-issues.mjs                       # every open issue
 *   node list-open-issues.mjs --since 2026-10-13    # only issues that moved since that day
 *   node list-open-issues.mjs --maintainers nvuillam,someone-else
 *   node list-open-issues.mjs --json                # for a script
 *
 * Read-only: it never comments, labels or closes anything. It needs the GitHub
 * CLI, signed in.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const REPO = "hardisgroupcom/sfdx-hardis-training";
const MAINTAINERS = option("maintainers", "nvuillam").split(",").map((login) => login.trim().toLowerCase());
const SINCE = option("since", "");
const AS_JSON = args.includes("--json");
// The claim workflow comments as a bot: its audit is not an answer from a person
const BOTS = ["github-actions", "github-actions[bot]"];

const raw = JSON.parse(
  execFileSync(
    "gh",
    ["issue", "list", "-R", REPO, "--state", "open", "--limit", "500", "--json", "number,title,url,author,createdAt,updatedAt,labels,body,comments"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
);

const issues = raw
  .filter((issue) => !SINCE || issue.updatedAt.slice(0, 10) >= SINCE)
  .map((issue) => {
    const labels = issue.labels.map((label) => label.name);
    const messages = [
      { author: login(issue.author), date: issue.createdAt, body: issue.body.trim() },
      ...issue.comments.map((comment) => ({ author: login(comment.author), date: comment.createdAt, body: stripEmailQuote(comment.body) }))
    ];
    const people = messages.filter((message) => !BOTS.includes(message.author.toLowerCase()));
    const last = people[people.length - 1];
    return {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      kind: kindOf(labels),
      labels,
      author: login(issue.author),
      lastActivity: issue.updatedAt,
      lastPerson: last.author,
      waitsForMaintainer: !MAINTAINERS.includes(last.author.toLowerCase()),
      messages
    };
  })
  .sort((a, b) => Number(b.waitsForMaintainer) - Number(a.waitsForMaintainer) || b.lastActivity.localeCompare(a.lastActivity));

if (AS_JSON) {
  console.log(JSON.stringify(issues, null, 2));
} else {
  print(issues);
}

function login(author) {
  return author ? author.login : "ghost";
}

function kindOf(labels) {
  if (labels.includes("badge-claim")) {
    return labels.includes("needs-work") ? "badge claim that failed the audit" : "badge claim";
  }
  return "report or question";
}

// Replies sent by email carry the whole previous message: keep what the person wrote
function stripEmailQuote(body) {
  const lines = body.trim().split(/\r?\n/);
  const cut = lines.findIndex((line, index) => /^On .+ wrote:$/.test(line.trim()) || (/^On .+/.test(line.trim()) && /wrote:$/.test((lines[index + 1] || "").trim())));
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

function print(list) {
  if (list.length === 0) {
    console.log(`No open issue${SINCE ? ` moved since ${SINCE}` : ""}.`);
    return;
  }
  const waiting = list.filter((issue) => issue.waitsForMaintainer).length;
  console.log(`${list.length} open issue(s), ${waiting} waiting for a maintainer.\n`);
  for (const issue of list) {
    console.log(`## #${issue.number} ${issue.title}`);
    console.log(`${issue.url}`);
    console.log(`${issue.kind}${issue.labels.length ? ` [${issue.labels.join(", ")}]` : ""}, ${issue.waitsForMaintainer ? "WAITS FOR A MAINTAINER" : "last word from a maintainer"} (last person: ${issue.lastPerson})`);
    for (const message of issue.messages) {
      const body = message.body.length > 1500 ? `${message.body.slice(0, 1500)}\n[... cut, ${message.body.length} characters]` : message.body;
      console.log(`\n**${message.author}**, ${message.date.slice(0, 10)}:`);
      console.log(body.replace(/^/gm, "> "));
    }
    console.log("");
  }
}
