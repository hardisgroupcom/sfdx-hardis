#!/usr/bin/env node
/**
 * Lists the comment threads of the sfdx-hardis-training discussions that still
 * wait for an answer: the ones whose last message is not from a maintainer.
 *
 *   node list-unanswered.mjs                       # every waiting thread
 *   node list-unanswered.mjs --since 2026-10-13    # only threads that moved since that day
 *   node list-unanswered.mjs --maintainers nvuillam,someone-else
 *   node list-unanswered.mjs --json                # for a script
 *
 * Read-only: it never posts, edits or closes anything. It needs the GitHub CLI,
 * signed in.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const OWNER = "hardisgroupcom";
const REPO = "sfdx-hardis-training";
const MAINTAINERS = option("maintainers", "nvuillam").split(",").map((login) => login.trim().toLowerCase());
const SINCE = option("since", "");
const AS_JSON = args.includes("--json");

// Page sizes are kept small: GitHub refuses a query that could return more than 500,000 nodes
const QUERY = `query($owner:String!,$repo:String!,$after:String){
  repository(owner:$owner,name:$repo){
    discussions(first:25,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url updatedAt category{name}
        comments(first:50){nodes{
          id url createdAt body author{login}
          replies(first:30){nodes{createdAt body author{login}}}
        }}
      }
    }
  }
}`;

const waiting = [];
const discussions = fetchDiscussions();
for (const discussion of discussions) {
  if (SINCE && discussion.updatedAt.slice(0, 10) < SINCE) {
    continue;
  }
  for (const comment of discussion.comments.nodes) {
    const thread = [comment, ...comment.replies.nodes];
    const last = thread[thread.length - 1];
    if (isMaintainer(last)) {
      continue;
    }
    waiting.push({
      number: discussion.number,
      // giscus names a discussion after the path of the page: en/level-2-.../2-3-.../
      page: discussion.title,
      url: comment.url,
      commentId: comment.id,
      lastActivity: last.createdAt,
      maintainerAlreadyInThread: thread.some(isMaintainer),
      messages: thread.map((message) => ({
        author: message.author ? message.author.login : "ghost",
        date: message.createdAt,
        body: message.body.trim()
      }))
    });
  }
}
waiting.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

if (AS_JSON) {
  console.log(JSON.stringify(waiting, null, 2));
} else {
  print(waiting);
}

function fetchDiscussions() {
  const all = [];
  let after = "";
  for (;;) {
    const call = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${OWNER}`, "-f", `repo=${REPO}`];
    if (after) {
      call.push("-f", `after=${after}`);
    }
    const page = JSON.parse(execFileSync("gh", call, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).data.repository.discussions;
    all.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) {
      return all;
    }
    after = page.pageInfo.endCursor;
  }
}

function isMaintainer(message) {
  return Boolean(message.author) && MAINTAINERS.includes(message.author.login.toLowerCase());
}

function print(threads) {
  if (threads.length === 0) {
    console.log(`No thread waits for an answer${SINCE ? ` since ${SINCE}` : ""}. ${discussions.length} discussion(s) read.`);
    return;
  }
  console.log(`${threads.length} thread(s) wait for an answer, out of ${discussions.length} discussion(s) read.\n`);
  for (const thread of threads) {
    console.log(`## #${thread.number} ${thread.page}`);
    console.log(thread.url);
    if (thread.maintainerAlreadyInThread) {
      console.log("(a maintainer already answered in this thread, and the learner wrote again)");
    }
    for (const message of thread.messages) {
      console.log(`\n**${message.author}**, ${message.date.slice(0, 10)}:`);
      console.log(message.body.replace(/^/gm, "> "));
    }
    console.log("");
  }
}
