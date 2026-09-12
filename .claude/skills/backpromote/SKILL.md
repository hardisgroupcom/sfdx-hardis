---
name: backpromote
description: Drive a backpromote (sf hardis:work:backpromote, Beta) from a coding agent, and solve the merges it asks for. Use when asked to bring what was merged in a parent major branch (integration, uat...) into a developer sandbox or a scratch org, to read or fix the "Backpromotes" Pull Request comments, or when a backpromote stopped with status waitingForMerges or conflictsRemaining.
user-invocable: true
---

# Backpromote from a coding agent

`sf hardis:work:backpromote` deploys into a **developer sandbox** what the team merged in a **parent
major branch** since the last backpromote of that sandbox: the metadata (computed by sfdx-git-delta on
the window of merged Pull Requests) and the deployment actions declared by those Pull Requests. The
requirements are in `backpromote.md` at the repository root; the command page is
`docs/hardis/work/backpromote.md`.

Vocabulary: parent branch (`developmentBranch` or one of `availableTargetBranches`), target sandbox
(never a major org), sandbox name (from the instance URL, `--sandbox-name` overrides), backpromote
branch `backpromote/<parent branch>/<sandbox name>` (holds the manual merges only), start Pull Request,
window, "Backpromotes" comment (the only source of the history).

## Procedure

Everything runs with `--json`; every decision is a flag; nothing is asked in `--agent` mode.

1. **Plan.** `sf hardis:work:backpromote --plan --json --target-org <alias> --parent-branch <branch>`.
   Read `status` (`ok`, `blocked`, `nothingToDo`), `checks` (a failed `gitProvider` check means no
   token: set `GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `SYSTEM_ACCESSTOKEN` or
   `CI_SFDX_HARDIS_BITBUCKET_TOKEN`), `pullRequests[]` (newest first, `backpromote` non null when the
   sandbox already received it, `selected` for the default start), `scan.found`, `window`, `items[]`,
   `deletions[]`, `actions[]` (`alreadyRunOn` set when it already ran in this sandbox), `comparison[]`
   and `runId`. When `scan.found` is false nothing is selected: pick the start with
   `--from-pull-request <number>` and run the plan again with `--run-id <runId>`.
2. **Decide.** For every `comparison[]` entry with status `different` or `pendingInOrg`, read the two
   (or three) versions at `versions.sandbox`, `versions.parentHead` and `versions.base` (absolute
   paths in the cache), then choose: `--on-diff "<file>=git"` (overwrite with the parent branch
   version, the default), `=org` (keep the org version, the item is listed as kept and offered again
   next time) or `=merge`. `--on-diff-default git|org|merge` covers the rest. Untick with
   `--exclude-metadata Type:Name`, `--skip-destructive`, `--actions a,b`, `--skip-actions`.
3. **Run.** `sf hardis:work:backpromote --agent --json --run-id <runId> --target-org <alias>
   --parent-branch <branch> --from-pull-request <n> [decisions]`. The checkout is switched to the
   backpromote branch (uncommitted changes are stashed, the JSON says so in `checkout`), the
   pre-deployment actions run, the metadata is deployed (`NoTestRun`), the deletions, the
   post-deployment actions, then the "Backpromotes" comments are written and the branch is pushed
   when it holds merges. Exit code 0 with `status` `ok`, `nothingToDo` or `waitingForMerges`; exit
   code 1 with the plan in `data` for `refused`, `conflictsRemaining`, `deployFailed`, `pushRejected`.
4. **Merge when asked.** `status: waitingForMerges` means the files marked `merge` were written with
   conflict markers in the checkout (absolute paths in `comparison[].file` under the git root, the
   prompt in `promptFile`, the exact command in `runCommand`). Edit each file, leave no
   `<<<<<<<`, `|||||||`, `=======`, `>>>>>>>` line, do not commit, then run `runCommand`. It commits
   the merged files in the backpromote branch, checks them and deploys. A file left with markers is
   not deployed and is listed as "conflict pending": the next plan offers it first.
5. **Manual actions.** `result.actions.pending` lists the manual actions (and the ones whose custom
   username could not be authenticated). Once done by hand in the sandbox:
   `sf hardis:work:backpromote --confirm-action <id> --json --run-id <runId> --target-org <alias> --parent-branch <branch>`.
6. **Back to the developer's branch.** The checkout stays on the backpromote branch. When the user
   wants their branch back: `git checkout <checkout.originalBranch>`, `git stash pop` when
   `checkout.stashed` is true, then propose `git merge origin/<parent branch>` so that the next
   `hardis:work:save` does not commit the backpromoted metadata as the story's own work.

Every call is idempotent: running the same command twice deploys nothing twice and runs no action
twice (the comment rows are the state). `--reset --auto` deletes the backpromote branch and abandons
the pending merges; the history in the comments is never touched.

## Merge rules

- Keep both intents when they touch different parts of the file.
- For shared configuration (layouts, profiles, permission sets, settings, flexipages) prefer the
  parent branch version; never remove an org-only element the sandbox work still needs.
- Salesforce metadata is XML: well-formed result, one entry per API name, the existing order and
  indentation, the XML declaration and namespace untouched. Only change the conflicting lines.
- Write, for each file, one sentence on what was kept from each side: it is the body of the commit
  message of the merge (the command asks for it in the prompt it writes).

## Where things live

| What | Where |
|------|-------|
| Command | `src/commands/hardis/work/backpromote.ts` |
| Pure rules (branch and sandbox names, history walk, two-way merge, flags, prompt) | `src/common/utils/backpromoteRules.ts` |
| "Backpromotes" comment (parse, render, upsert, cached reads) | `src/common/utils/backpromoteCommentUtils.ts` |
| Git (fetch, checkout switch, branch rebuild, merge-file, push with lease, delta cache) | `src/common/utils/backpromoteGitUtils.ts` |
| Org (target org, retrieve to the cache, comparison, deployments) | `src/common/utils/backpromoteOrgUtils.ts` |
| Plan JSON version 3, run state, terminal prompts | `src/common/utils/backpromotePlanUtils.ts` |
| Pull Request listing and action execution shared with promotion branches | `src/common/utils/backpromoteUtils.ts` |
| VS Code panel | `../vscode-sfdx-hardis/src/commands/showBackpromote.ts`, `src/utils/backpromote/`, `src/webviews/lwc-ui/modules/s/backpromote/` |
| End to end runbook | `.claude/skills/promotion-branches-e2e/reference/runbook.md`, section 6bis |
