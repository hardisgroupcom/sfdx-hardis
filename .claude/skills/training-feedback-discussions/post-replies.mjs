#!/usr/bin/env node
/**
 * Posts the replies of a feedback batch file, exactly as the file has them.
 *
 *   node post-replies.mjs hardis-report/training-feedback/feedback-2026-10-30.md            # dry run
 *   node post-replies.mjs hardis-report/training-feedback/feedback-2026-10-30.md --apply    # post
 *
 * The file is the one the skill writes (see "The batch file" in SKILL.md). Only the
 * threads marked `**Post:** yes` are posted, with the text between `<!-- reply-start -->`
 * and `<!-- reply-end -->`. After each post the file is updated: `**Post:** done` and a
 * `**Posted:**` line with the URL, so a second run never posts twice.
 *
 * Without --apply it only prints what it would post. It needs the GitHub CLI, signed in.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const FILE = args.find((arg) => !arg.startsWith("--"));
const APPLY = args.includes("--apply");
if (!FILE || !fs.existsSync(FILE)) {
  console.error("Usage: node post-replies.mjs <batch file> [--apply]");
  process.exit(1);
}

const MUTATION = `mutation($d:ID!,$r:ID,$b:String!){
  addDiscussionComment(input:{discussionId:$d,replyToId:$r,body:$b}){comment{url}}
}`;

let text = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const sections = splitSections(text);
let posted = 0;
let skipped = 0;
for (const section of sections) {
  const result = handleSection(section);
  if (result === "posted") posted++;
  else skipped++;
}
console.log(`\n${APPLY ? "Posted" : "Would post"} ${posted} reply(ies), ${skipped} thread(s) left alone.`);

function splitSections(content) {
  // A thread is a "## " heading followed by a feedback-meta comment
  return content
    .split(/^(?=## )/m)
    .filter((part) => part.includes("<!-- feedback-meta"))
    .map((part) => part.trimEnd());
}

function handleSection(section) {
  const heading = section.split("\n")[0].replace(/^## /, "");
  const meta = JSON.parse(section.match(/<!-- feedback-meta (\{.*?\}) -->/)[1]);
  const flag = (section.match(/\*\*Post:\*\*\s*(\w+)/) || [])[1] || "wait";
  if (flag !== "yes") {
    console.log(`- skip (${flag}): ${heading}`);
    return "skipped";
  }
  const reply = (section.match(/<!-- reply-start -->\n([\s\S]*?)\n<!-- reply-end -->/) || [])[1]?.trim();
  if (!reply || /\*\*\[your/i.test(reply)) {
    console.log(`- skip (reply empty or still holds a [your ...] choice): ${heading}`);
    return "skipped";
  }
  if (!APPLY) {
    console.log(`- would post: ${heading}\n  to ${meta.url}\n${indent(reply)}\n`);
    return "posted";
  }
  const url = post(meta, reply);
  console.log(`- posted: ${heading}\n  ${url}`);
  markDone(section, url);
  return "posted";
}

function post(meta, reply) {
  const bodyFile = path.join(os.tmpdir(), `feedback-reply-${Date.now()}.md`);
  fs.writeFileSync(bodyFile, reply);
  try {
    if (meta.kind === "issue") {
      return execFileSync("gh", ["issue", "comment", String(meta.number), "-R", meta.repo, "--body-file", bodyFile], {
        encoding: "utf8",
      }).trim();
    }
    const ghArgs = ["api", "graphql", "-f", `query=${MUTATION}`, "-f", `d=${meta.discussionId}`, "-F", `b=@${bodyFile}`];
    if (meta.replyToId) ghArgs.push("-f", `r=${meta.replyToId}`);
    ghArgs.push("-q", ".data.addDiscussionComment.comment.url");
    return execFileSync("gh", ghArgs, { encoding: "utf8" }).trim();
  } finally {
    fs.rmSync(bodyFile, { force: true });
  }
}

function markDone(section, url) {
  const updated = section.replace(/\*\*Post:\*\*\s*yes/, `**Post:** done\n- **Posted:** ${url}`);
  text = text.replace(section, updated);
  fs.writeFileSync(FILE, text);
}

function indent(block) {
  return block
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
