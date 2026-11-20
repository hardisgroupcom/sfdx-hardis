#!/usr/bin/env node
/**
 * Lists the comment threads of the sfdx-hardis-training and sfdx-hardis
 * discussions that still wait for an answer: the ones whose last message is not
 * from a maintainer. A discussion opened by a person (an idea, a question) counts
 * as a thread of its own until a maintainer writes in it.
 *
 *   node list-unanswered.mjs                       # every waiting thread, both repositories
 *   node list-unanswered.mjs --repo sfdx-hardis    # one repository only
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
const REPOS = option("repo", "sfdx-hardis-training,sfdx-hardis").split(",").map((name) => name.trim());
const MAINTAINERS = option("maintainers", "nvuillam").split(",").map((login) => login.trim().toLowerCase());
const SINCE = option("since", "");
const AS_JSON = args.includes("--json");

// Page sizes are kept small: GitHub refuses a query that could return more than 500,000 nodes
const QUERY = `query($owner:String!,$repo:String!,$after:String){
  repository(owner:$owner,name:$repo){
    discussions(first:25,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        id number title url body createdAt updatedAt category{name} author{login}
        comments(first:50){nodes{
          id url createdAt body author{login}
          replies(first:30){nodes{url createdAt body author{login}}}
        }}
      }
    }
  }
}`;

const waiting = [];
const discussions = REPOS.flatMap((repo) => fetchDiscussions(repo).map((discussion) => ({ ...discussion, repo })));
for (const discussion of discussions) {
  if (SINCE && discussion.updatedAt.slice(0, 10) < SINCE) {
    continue;
  }
  // giscus opens the discussion of a page itself: only a body written by a person is a question
  const opener = discussion.author ? discussion.author.login.toLowerCase() : "";
  if (opener && !opener.includes("giscus") && !isMaintainer(discussion)) {
    const answered = discussion.comments.nodes.flatMap((other) => [other, ...other.replies.nodes]).some(isMaintainer);
    if (!answered) {
      waiting.push({
        repo: discussion.repo,
        number: discussion.number,
        page: `${discussion.title} (${discussion.category.name}, opening post)`,
        url: discussion.url,
        discussionId: discussion.id,
        commentId: null,
        lastActivity: discussion.updatedAt,
        maintainerAlreadyInThread: false,
        answeredElsewhere: [],
        messages: [{ author: discussion.author.login, date: discussion.createdAt, body: discussion.body.trim() }]
      });
    }
  }
  for (const comment of discussion.comments.nodes) {
    const thread = [comment, ...comment.replies.nodes];
    const last = thread[thread.length - 1];
    if (isMaintainer(last)) {
      continue;
    }
    // A maintainer often answers several comments of one learner in a single
    // reply under another comment: such a thread looks unanswered and is not
    const answeredElsewhere = discussion.comments.nodes
      .filter((other) => other !== comment)
      .flatMap((other) => [other, ...other.replies.nodes])
      .filter((message) => isMaintainer(message) && message.createdAt > last.createdAt)
      .map((message) => message.url);
    waiting.push({
      repo: discussion.repo,
      number: discussion.number,
      // giscus names a discussion after the path of the page: en/level-2-.../2-3-.../
      page: discussion.title,
      url: comment.url,
      discussionId: discussion.id,
      commentId: comment.id,
      lastActivity: last.createdAt,
      maintainerAlreadyInThread: thread.some(isMaintainer),
      answeredElsewhere,
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

function fetchDiscussions(repo) {
  const all = [];
  let after = "";
  for (;;) {
    const call = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${OWNER}`, "-f", `repo=${repo}`];
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
    console.log(`## ${thread.repo}#${thread.number} ${thread.page}`);
    console.log(thread.url);
    if (thread.maintainerAlreadyInThread) {
      console.log("(a maintainer already answered in this thread, and the learner wrote again)");
    }
    if (thread.answeredElsewhere.length > 0) {
      console.log(`(a maintainer wrote elsewhere in this discussion afterwards: read it before answering, it may answer this one)`);
      thread.answeredElsewhere.forEach((url) => console.log(`  ${url}`));
    }
    for (const message of thread.messages) {
      console.log(`\n**${message.author}**, ${message.date.slice(0, 10)}:`);
      console.log(message.body.replace(/^/gm, "> "));
    }
    console.log("");
  }
}
