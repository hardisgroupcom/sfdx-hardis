#!/usr/bin/env node
/**
 * Reads the public fork of a learner, to check what a discussion comment says
 * against what really happened there.
 *
 *   node inspect-fork.mjs <login>                 # the fork, its course updates, its Pull Requests
 *   node inspect-fork.mjs <login> --pr 18         # one Pull Request: commits, checks, comments, files
 *   node inspect-fork.mjs <login> --file config/.sfdx-hardis.yml [--ref <sha or branch>]
 *
 * Read-only: every call is a GET on a public repository. It needs the GitHub CLI,
 * signed in. A fork that was renamed or made private answers 404: say so, and ask
 * the learner instead of guessing.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const login = args[0];
if (!login || login.startsWith("--")) {
  console.error("Usage: node inspect-fork.mjs <login> [--pr <number>] [--file <path> [--ref <ref>]] [--repo <name>]");
  process.exit(1);
}
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const REPO = `${login}/${option("repo", "sfdx-hardis-training")}`;
const PR = option("pr", "");
const FILE = option("file", "");
const REF = option("ref", "");

if (FILE) {
  printFile(FILE, REF);
} else if (PR) {
  printPullRequest(PR);
} else {
  printFork();
}

function printFork() {
  const repo = api(`repos/${REPO}`);
  console.log(`# ${REPO}`);
  console.log(`created ${day(repo.created_at)}, last push ${day(repo.pushed_at)}, default branch ${repo.default_branch}`);

  // The reset branches say which levels the fork was set up for
  const branches = api(`repos/${REPO}/branches?per_page=100`).map((branch) => branch.name);
  console.log(`\n## Branches (${branches.length})`);
  console.log(branches.join(", "));

  console.log("\n## Protection of the major branches");
  for (const branch of ["integration", "uat", "preprod", "main"].filter((name) => branches.includes(name))) {
    const detail = api(`repos/${REPO}/branches/${branch}`);
    const checks = detail.protection?.required_status_checks?.contexts || [];
    console.log(`${branch}: ${detail.protected ? `protected, required checks: ${checks.join(", ") || "none"}` : "NOT protected"}`);
  }

  const pulls = api(`repos/${REPO}/pulls?state=all&per_page=100&sort=created&direction=asc`);
  // A fork only holds what the course had on the day of its last update: a setting or a
  // command the course received later is not there, whatever the lab says
  const updates = pulls.filter((pull) => pull.head.ref.startsWith("course/"));
  console.log("\n## Course updates (Update my course)");
  if (updates.length === 0) {
    console.log("none: the fork holds the course as it was on the day it was forked");
  }
  for (const pull of updates) {
    console.log(`#${pull.number} ${pull.merged_at ? `merged ${day(pull.merged_at)}` : pull.state} into ${pull.base.ref}`);
  }

  console.log(`\n## Pull Requests (${pulls.length})`);
  for (const pull of pulls) {
    const state = pull.merged_at ? `merged ${pull.merged_at.slice(0, 16)}Z` : pull.state;
    console.log(`#${pull.number} ${state} | ${pull.head.ref} -> ${pull.base.ref} | ${pull.title}`);
  }
}

function printPullRequest(number) {
  const pull = api(`repos/${REPO}/pulls/${number}`);
  console.log(`# ${REPO}#${number} ${pull.title}`);
  console.log(`${pull.head.ref} -> ${pull.base.ref}, ${pull.merged_at ? `merged ${pull.merged_at}` : pull.state}, created ${pull.created_at}`);

  console.log("\n## Commits");
  const commits = api(`repos/${REPO}/pulls/${number}/commits?per_page=100`);
  for (const commit of commits) {
    console.log(`${commit.sha.slice(0, 7)} ${commit.commit.committer.date} ${commit.commit.message.split("\n")[0]}`);
  }

  // Every attempt of every run: a check that is green now may have been red, or the reverse,
  // at the time the learner wrote
  console.log("\n## Workflow runs, with every attempt");
  const runs = api(`repos/${REPO}/actions/runs?event=pull_request&branch=${encodeURIComponent(pull.head.ref)}&per_page=100`).workflow_runs;
  for (const run of runs.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      const detail = attempt === run.run_attempt ? run : api(`repos/${REPO}/actions/runs/${run.id}/attempts/${attempt}`);
      console.log(`${run.head_sha.slice(0, 7)} ${run.name} | attempt ${attempt}: ${detail.conclusion || detail.status} | ${detail.run_started_at} -> ${detail.updated_at}`);
    }
  }

  console.log("\n## Files changed");
  for (const file of api(`repos/${REPO}/pulls/${number}/files?per_page=100`)) {
    console.log(`${file.status.padEnd(8)} ${file.filename}`);
  }

  console.log("\n## Comments");
  for (const comment of api(`repos/${REPO}/issues/${number}/comments?per_page=100`)) {
    const firstLines = comment.body.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
    console.log(`${comment.user.login}, created ${comment.created_at}, updated ${comment.updated_at}\n  ${firstLines}`);
  }
  console.log(`\nRead a file as this Pull Request had it: node inspect-fork.mjs ${login} --file <path> --ref ${pull.head.sha.slice(0, 7)}`);
}

function printFile(file, ref) {
  const content = api(`repos/${REPO}/contents/${file.split("/").map(encodeURIComponent).join("/")}${ref ? `?ref=${ref}` : ""}`);
  if (Array.isArray(content)) {
    console.log(content.map((entry) => entry.name).join("\n"));
    return;
  }
  console.log(Buffer.from(content.content, "base64").toString("utf8"));
}

function api(endpoint) {
  try {
    return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    const reason = String(error.stderr || error.message).split("\n")[0];
    console.error(`GET ${endpoint} failed: ${reason}`);
    process.exit(1);
  }
}

function day(date) {
  return date.slice(0, 10);
}
