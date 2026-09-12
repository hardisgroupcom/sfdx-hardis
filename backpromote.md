# Backpromote: requirements and solution

Status: requirements for the refactoring of the `feat/backpromote-panel` branches of sfdx-hardis and vscode-sfdx-hardis.
This document supersedes the merge-based design currently on those branches (a `git merge` of the parent branch into the User Story branch).

## 1. Purpose

A backpromote brings into a **developer sandbox** what has been merged into a **parent major branch** (`integration`, `uat`...) since the last backpromote: the metadata, and the deployment actions declared on the Pull Requests that were merged.

Goals:

- Simple: one panel, one command, a handful of decisions.
- Shared: several people, on several computers, backpromote to the same sandbox over time. Nothing that matters is stored on a computer.
- Safe: a deployment action runs at most once per sandbox, a conflict marker never reaches an org, a major org is never a target.

Vocabulary used in this document and to be used in the code, the doc and the UI:

| Term | Meaning |
|------|---------|
| Parent branch | The major branch backpromoted from (`integration`, `uat`, `preprod`...). Chosen by the user, default `developmentBranch`. |
| Target sandbox | The developer sandbox that receives the backpromote. Never a major org. |
| Sandbox name | Short name built from the instance URL (`mycompany--dev1.sandbox.my.salesforce.com` gives `dev1`). |
| Backpromote branch | `backpromote/<parent branch>/<sandbox name>`, child of the parent branch, pushed to origin. Holds the manual merges of a backpromote and is the checkout the deployment runs from. It is not a history: the history lives in the Pull Request comments. |
| Backpromote comment | The "Backpromotes" comment sfdx-hardis writes on every Pull Request of a window, one row per sandbox. The only source of the backpromote history. |
| Start Pull Request | The first merged Pull Request of the parent branch included in this backpromote. Everything merged after it is included too. |
| Window | The commit range on the parent branch: from the commit before the start Pull Request to the head of the parent branch. |
| Delta | The metadata added, changed and deleted in the window, computed by sfdx-git-delta. |
| Deployment actions | `commandsPreDeploy` / `commandsPostDeploy` of `scripts/actions/.sfdx-hardis.<PR>.yml`, read for every Pull Request of the window. |

Do not use "retrofit" for this feature: `hardis:org:retrieve:sources:retrofit` already means the opposite direction (production to a major branch).

## 2. Principles

1. **The CLI is the engine.** `sf hardis:work:backpromote` does everything. The VS Code panel collects decisions, passes them as flags, and shows the JSON the command returns. No backpromote logic lives in the extension.
2. **Shared state lives in one Pull Request comment.** The "Backpromotes" comment of each Pull Request records which sandboxes received it, when, by whom, with which items left out, and which of its deployment actions ran in which sandbox. The CI/CD "Deployment Actions" comment is never read nor written by a backpromote. The backpromote branch on origin only carries manual merges. Nothing else is persisted, and no git commit is ever read to guess the history.
3. **Local files are cache only.** A cache speeds a run up and can be deleted at any time without changing the result: sfdx-git-delta output per commit pair, the org retrieve of the comparison step, the comment reads of a run.
4. **Dev sandboxes only.** Only CI/CD jobs deploy to major orgs. Production, and the orgs declared for major branches in `config/branches`, are refused before anything runs.
5. **Same behavior from the panel and from the terminal.** Every decision taken in the panel has a flag, and `--agent` takes every decision from the flags.

## 3. User path

The path below is the reference for both the panel and the interactive command. Each step names the flag the panel passes.

| Step | User sees / does | CLI |
|------|------------------|-----|
| 1 | Clicks the existing **Backpromote** card below the DevOps Pipeline diagram (it already opens `vscode-sfdx-hardis.showBackpromote`), or the entry in the Commands panel. The diagram nodes have no backpromote entry. | `sf hardis:work:backpromote` |
| 2 | Selects the target sandbox among the authenticated orgs. Major orgs are not listed (or listed disabled with the reason). | `--target-org <alias>` |
| 3 | Selects the parent branch among `developmentBranch` and `availableTargetBranches` only (default: `developmentBranch`). | `--parent-branch <name>` |
| 4 | The backpromote branch `backpromote/<parent>/<sandbox>` is fetched, or created from the parent branch head if it does not exist yet. | automatic |
| 5 | Sees the merged Pull Requests of the parent branch, newest first, with the ones already backpromoted greyed. Picks the start Pull Request (default: the first one not backpromoted yet). | `--from-pull-request <number>` |
| 6 | Sees the metadata of the window (added, changed, deleted) and the deployment actions of its Pull Requests, with what already ran in this sandbox greyed. Unticks what must not be backpromoted. | `--exclude-metadata`, `--skip-destructive`, `--actions`, `--skip-actions` |
| 7 | In the same list, an item whose sandbox version differs from the parent branch version carries, on the same single line, a select button **Overwrite / Keep org version / Merge** and a **Compare** button that opens the VS Code diff editor. | `--on-diff <file>=git\|org\|merge` |
| 8 | Clicking **Merge** switches the checkout to the backpromote branch (commit or stash first if needed), writes the merged file with markers, and opens it in the VS Code merge editor. The user solves the conflict with VS Code's own merge tools, or pastes the generated prompt into a coding agent, and saves. Everything is solved before the backpromote itself starts. | `--prepare --run-id <id> --on-diff <file>=merge` |
| 9 | Clicks **Backpromote** (enabled only when no marker remains): the merged files are committed in the backpromote branch, then pre-deployment actions, metadata deployment, post-deployment actions. Sees the progress and the result. | `--auto --run-id <id>` plus the flags above |
| 10 | The "Backpromotes" comment of every Pull Request of the window gets a row for the sandbox and the actions that ran in it. The backpromote branch is pushed when it holds manual merges. The checkout stays on the backpromote branch. | automatic |

## 4. Functional requirements

### 4.1 Target sandbox

- R1. The target org must be a sandbox (`Organization.IsSandbox = true`) or a scratch org (decision: scratch orgs are accepted, with the same rules as a sandbox). Production is refused.
- R2. An org listed for a major branch in `config/branches/.sfdx-hardis.<branch>.yml` (`targetUsername`, `instanceUrl`) is refused, whatever its type. The current `findBackpromoteTargetOrgRefusal` rule is kept: match on username, on the sandbox part of the username and on the instance URL.
- R3. The sandbox name is derived from the instance URL: the part after `--` and before `.sandbox`, lower case. When the URL carries no `--` (scratch org, unusual domain), fall back to the sandbox part of the username, then to the org id. The existing `orgShortName` is the base.
- R4. The org id is read and written in every backpromote comment row (see 4.6) so that a refreshed sandbox (new org id, same name) starts over: rows with another org id are history, not state.
- R5. The panel lists the orgs known to `sf org list`, marks the major orgs as not selectable, and pre-selects the default org when it is a dev sandbox.

### 4.1b Parent branch

- R5b. The parent branch must be `developmentBranch` or one of `availableTargetBranches` (both from `config/.sfdx-hardis.yml`). Any other value, from the flag, the prompt or the pipeline node, is refused with the list of allowed branches. The interactive prompt and the panel picker offer only these branches, `developmentBranch` first and pre-selected. The current `listBackpromoteParentBranchChoices` and `findBackpromoteParentBranchRefusal` are reworked to this exact rule (today they accept any major branch of `config/branches`).
- R5c. When `availableTargetBranches` is not set, only `developmentBranch` is allowed, and the picker is not shown.

### 4.2 Backpromote branch

- R6. Name: `backpromote/<parent branch>/<sandbox name>`. The parent branch may contain `/` (`release/2026.09`): the sandbox name is always the last segment, the parent branch is everything between the prefix and the last segment.
- R7. Created from the head of the parent branch when it does not exist on origin. Fetched at every run: origin is the source of truth, the local copy is thrown away when they diverge.
- R8. Never merged anywhere. No Pull Request is opened from it. CI jobs must not run on it (check every pipeline template: GitHub, GitLab, Azure, Bitbucket, Jenkins).
- R9. Ignored by the DevOps Pipeline, by release notes, by promotion candidates and by `hardis:work:*` branch classification: `backpromote/` joins `promotion/` and `retrofit/` in `classifyBackpromoteCurrentBranch` and its extension mirror.
- R10. Pushed with `--force-with-lease` only when the run produced manual merges (committed, with or without markers), so that a colleague can finish them from another computer. A rejected push means someone else pushed manual merges for the same sandbox meanwhile: the run stops with a clear message and asks to start again.
- R11. Its head is the head of the parent branch at the start of the run, plus one commit per manual merge. At the start of a run it is reset to the parent head, then the pending manual merges recorded in the backpromote comments (R37) are carried over from the previous head with a cherry-pick. It records no history and holds no ledger.
- R12. A `--reset` flag deletes the branch on origin and locally, which abandons the pending manual merges. The history in the comments is never touched. Confirmed interactively, and in the panel.

### 4.3 Pull Request selection

- R13. The list comes from the first-parent commits of the parent branch, with the existing `listMergedPrsWithCommits` (Pull Request numbers read from merge messages, vehicle merges split so that User Stories are listed and not the major-to-major merges that carried them).
- R14. The history comes from the backpromote comments and from nothing else. The Pull Requests are walked from the newest merged one backwards, page by page, and the "Backpromotes" comment of each one is read. The walk stops at the first Pull Request whose comment holds a row for this sandbox name and this org id: that Pull Request and every older one are considered backpromoted, and the default start is the Pull Request merged right after it. When no such row is found within the scan limit (`backpromoteScanLimit`, default 100 Pull Requests), nothing is pre-selected and the user picks the start; the "Show earlier" link extends the scan by another page.
- R14b. A Pull Request with a row for this sandbox but another org id (refreshed sandbox) counts as not backpromoted and is shown with a "before refresh" label.
- R14c. A row can be **partial** (items excluded, kept as org version or conflict pending): the Pull Request still counts as backpromoted for the walk of R14, and its left-out items are listed again in the next plan (R20, R37).
- R15. The user chooses one start Pull Request. Everything merged after it up to the parent head is in the window. There is no cherry-picking of individual Pull Requests: the metadata of a Pull Request merged in the middle of the window cannot be separated from the ones after it without a real merge, and this is what got the previous design in trouble. Unticking a Pull Request is done at the metadata and action level (step 6).
- R16. Pull Requests whose backpromote comment holds a row for this sandbox and org id are shown greyed with the date and the author of that row. Choosing one of them again is allowed (a redeploy after a sandbox mishap) and re-runs nothing that the Pull Request comments mark as already run in this sandbox.
- R17. Each Pull Request shows: number, title, author, merge date, source branch, the number of metadata items and the number of deployment actions it carries.

### 4.4 Metadata delta

- R18. Computed by sfdx-git-delta between the commit before the start Pull Request merge and the parent head, on the packageDirectories of `sfdx-project.json`, with `package.xml` and `destructiveChanges.xml`. The existing `computeBackpromoteDelta` is kept, cached per commit pair in the temporary folder.
- R19. Items are displayed as `Type:Name`, grouped by type, with the Pull Requests that touched them (from `git log` of the item files in the window).
- R20. Every item is ticked by default. Unticked items are passed with `--exclude-metadata Type:Name` (repeatable, the current flag) and listed as excluded in the backpromote comment row of the Pull Requests that touched them, so the next run offers them again.
- R21. Deletions are listed apart, ticked by default in the panel and in the plan. `--auto` and `--agent` apply the ticked ones; the interactive terminal mode asks one confirmation before the destructive deployment. `--skip-destructive` skips them all, unticking one item passes it with `--exclude-metadata`.
- R22. Items excluded by `package-no-overwrite.xml` of the parent branch are shown greyed, never deployed: a dev sandbox is an org like the others for that rule.
- R23. Test level on the sandbox: `NoTestRun`. Apex test classes carried by the Pull Requests are deployed like any other metadata but never run. A scratch org follows the same rule.

### 4.5 Deployment actions

- R24. Collected from `scripts/actions/.sfdx-hardis.<PR>.yml` read at the parent head, for every Pull Request of the window, with the existing `collectBackpromoteActions`. Repository-level actions of `config/.sfdx-hardis.yml` are not run by a backpromote.
- R25. Context filter: `all` and `process-deployment-only` run, `check-deployment-only` never. `includeTargetBranches` / `excludeTargetBranches` are evaluated against the parent branch: the sandbox stands for the branch it is backpromoted from.
- R26. Run-once rule: the actions table of the "Backpromotes" comment of the Pull Request is the state store (see R32b), with the same semantics as the CI/CD "Deployment Actions" comment but kept apart from it: a backpromote never reads nor writes the CI/CD comment, and CI/CD jobs never read the "Backpromotes" comment. Each action row is keyed by action id, sandbox name and org id. An action with a success row for this sandbox and this org id is skipped and shown greyed in the panel. A failed row is retried. `runOnlyOnceByOrg: false` actions always run.
- R27. A git provider token is required for the whole command, not only for the run-once rule: without it the history of R14 cannot be read and nothing can be recorded. The command refuses to start without one and says how to configure it (`GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `SYSTEM_ACCESSTOKEN`, `CI_SFDX_HARDIS_BITBUCKET_TOKEN`). The panel checks it before showing anything else.
- R28. `manual` actions are listed, and the user confirms in the panel (or in a prompt) that the step was done in the sandbox. The confirmation writes the success row in the actions table of the "Backpromotes" comment. `--agent` does not confirm manual actions: they stay pending.
- R29. `customUsername` actions run only if that username is authenticated locally, otherwise they are skipped with a warning.
- R30. Pre-deployment actions run before the metadata deployment, post-deployment actions after it, and never when the deployment failed. `--actions a,b` restricts the run, `--skip-actions` runs none.

### 4.6 History: the "Backpromotes" Pull Request comment

- R31. The history of what a sandbox received is guessed from the "Backpromotes" comments of the Pull Requests, and from nothing else: no git commit, no branch position, no file, no database, no org custom object.
- R32. Every backpromote writes, on every Pull Request of the window, one row in that Pull Request's "Backpromotes" comment (created if missing, found again by a hidden marker like the "Deployment Actions" comment). The row holds: sandbox name, org id, date, git user, parent branch, status (`complete` or `partial`), and for a partial row the items of that Pull Request that were excluded, kept as org version or left with a conflict pending, and the sfdx-hardis version. One row per sandbox and org id: a redeploy updates the row instead of adding one.
- R32b. The same comment holds a second table, the deployment actions of that Pull Request run by backpromotes: action id, label, phase, sandbox name, org id, date, status (success, failed, pending for a manual action), git user. This table is the state store of R26. The two tables live in one comment so that a reader sees on one Pull Request page where its content and its actions went, and so that the walk of R14 reads one comment per Pull Request.
- R33. The sandbox row is written after the metadata deployment succeeded and the post-deployment actions ran, before the push of the backpromote branch. A sandbox row is never written for a failed deployment. A partial row is written when the window was deployed except for the listed items. The action rows are written as soon as each action finishes (pre-deployment actions included), so that an action that ran before a failed deployment is not run again.
- R33b. Reading is cheap by construction: the walk of R14 stops at the first hit, so a sandbox backpromoted regularly costs a handful of comment reads. Comment reads of a run are cached under the `runId` (R55) so that `--plan` and `--auto` do not read them twice.
- R33c. The comment is readable by a human on the Pull Request page: a short table, one line per sandbox, no JSON blob outside the hidden marker.

### 4.7 Comparison with the sandbox and conflict handling

- R34. Before deploying, the ticked items are retrieved from the sandbox into the cache folder (`sf project retrieve start --metadata ... --output-dir`), and each file is compared with its version at the parent head. When the sandbox tracks its sources, `sf project retrieve preview` is run first so that the panel shows which of these items also have pending changes in the org.
- R35. Files with no difference are deployed without a question. Files that do not exist in the sandbox are deployed without a question.
- R36. For every file with a difference the user chooses, per file or for all remaining files at once (in the panel: an **Overwrite / Keep org version / Merge** select button on the item's line):
  - **Overwrite** (`git`): the parent head version is deployed over the sandbox one (default).
  - **Keep org version** (`org`): the file is not deployed; the item is excluded for this run and listed as kept in the backpromote comment row.
  - **Merge** (`merge`): `--prepare` writes a merged file with conflict markers in the backpromote branch working tree (the checkout is switched first, R42). When the sandbox already received a backpromote (a row exists for this sandbox and org id), it is a 3-way merge (`git merge-file`: base = the version at the start of the window, ours = the sandbox version, theirs = the parent head version). When the sandbox was never backpromoted, it is a 2-way merge: the sandbox version and the parent head version as the two sides, markers around every differing block. The three versions are also kept in the cache so that the VS Code merge editor can show them.
- R36b. **The conflict is solved with VS Code's own tools, never with a widget of the panel.** The extension opens the file in the VS Code 3-way merge editor (base, sandbox version, parent head version from the cache, output = the file in the checkout), or, when the merge editor is not available, the file itself where VS Code decorates the markers with Accept Current / Accept Incoming / Accept Both / Compare. The panel draws no diff, no merge pane and no line selection. For people who prefer a coding agent, one **Copy agent prompt** button at the top of the What block gives a single prompt covering every prepared file (R38).
- R36c. **Outside agent mode, merges are solved before the backpromote runs.** The Backpromote button stays disabled while a marker remains in a prepared file, with the list of the files to finish. The effective run starts by committing the prepared files in the backpromote branch, then deploys them with the rest. There is no waiting state and no continue step in the panel.
- R37. A conflict marker never reaches the org. Outside agent mode the run refuses to start while a prepared file holds markers (status `conflictsRemaining`, the files listed). In agent mode a file left with markers is not deployed: the item is excluded for this run and listed as "conflict pending" in the backpromote comment row, with the commit of the backpromote branch that holds the merged file, and the next run offers it first. `assertNoPromotionConflictMarkers` style check runs on every file of the deployment package before `sf project deploy start`.
- R38. One coding agent prompt per run, never per file: it lists every prepared file with its three versions and the rule to solve each, and asks for one commit message body naming each file. It is written in `hardis-report/` and its path is returned in the JSON, as for promotion branches (`buildBackpromoteMergePrompt` is kept and reworded). It is rewritten each time `--prepare` adds a file.
- R39. The **Compare** button of an item opens the VS Code diff editor between the sandbox version and the parent head version, both read from the cache. The existing Flow visual diff is used for Flows. The panel itself renders no diff.
- R40. The comparison is skipped for a file the user already excluded, for deletions, and for binary static resources (deployed as git version, listed as "not compared").

### 4.8 Execution

- R41. Order: fetch and branch preparation, comparison and decisions, manual merges, pre-deployment actions, metadata deployment (`sf project deploy start` with the package of ticked items, `--ignore-conflicts` on a source-tracked org, `NoTestRun`), destructive changes (separate deployment, after confirmation), post-deployment actions, "Backpromotes" comments (action rows as they happen, sandbox rows at the end), push of the backpromote branch when it holds manual merges. The checkout stays on the backpromote branch.
- R42. The deployment is run from the backpromote branch, so that the manual merges are what gets deployed. The command switches the developer's checkout to the backpromote branch (`git checkout backpromote/<parent>/<sandbox>`), no worktree. When the working tree is not clean, the interactive mode proposes to **commit** on the current branch (with a message prompt) or to **stash** it; `--auto` and `--agent` stash it without asking. The stash message names the original branch and the run id, and the JSON returns the original branch and whether a stash was made. The plan mode (`--plan`) never switches branches.
- R42b. After the run, success or failure, the checkout **stays on the backpromote branch**. The command does not switch back and does not pop the stash: the result message and the panel say on which branch the checkout is, and the button of R49 brings the developer back.
- R43. A failed metadata deployment stops the run: no post-deployment action, no backpromote comment row, no push. The Pull Request comments already updated by the pre-deployment actions stay: those actions did run.
- R44. Progress: every step is sent to the panel through the existing progress file (`SFDX_HARDIS_PROGRESS_FILE`, one JSON line per step) and through the WebSocket messages, so the panel shows what is happening during a run of several minutes.
- R45. The command returns a JSON result with: target org, parent branch, backpromote branch, window, items deployed, items excluded (and why), deletions, actions run, skipped and failed, files with conflict pending, prompt file path, deployment result, and the URL of the sandbox.

### 4.9 Modes of the command

| Mode | Flags | What it does |
|------|-------|--------------|
| Interactive | none | Prompts for each step of the user path in the terminal. |
| Plan | `--plan --json` | Reads git, the Pull Request comments and the sandbox, and returns the lists of steps 5, 6 and 7 without deploying, merging, committing or pushing. Used by the panel to build its screens. Accepts `--from-pull-request` to compute the window and the comparison. |
| Prepare | `--prepare --run-id <id>` with `--on-diff` | Switches the checkout to the backpromote branch (commit or stash first, R42), writes the merged files with markers for the items marked `merge`, keeps the three versions in the cache, writes the coding agent prompt, and returns their paths. Deploys nothing. Called by the panel as soon as the user clicks **Merge**, before the VS Code merge editor opens. Running it again rewrites only the files not yet touched. |
| Run | `--auto --run-id <id>` with the decision flags | Takes every decision from the flags and asks nothing. Used by the panel's Backpromote button. Starts by committing the prepared files; refuses with status `conflictsRemaining` if one still holds markers. A file with a difference and no `--on-diff` decision takes `--on-diff-default` (default `git`). |
| Agent | `--agent` | Like `--auto`, plus: parent branch from the flag or `developmentBranch`, start Pull Request from the flag or the default of R14, differences resolved by `--on-diff` then `--on-diff-default` (default `git`), manual actions left pending. The only mode that may wait: a file marked `merge` and not yet prepared is written with markers and the run stops with status `waitingForMerges`; the agent edits it and runs the same command again with the `runId` (4.12). |
| Reset | `--reset` | Deletes the backpromote branch (R12). |

Typical panel sequence:

```shell
sf hardis:work:backpromote --plan --json --target-org dev1 --parent-branch integration
sf hardis:work:backpromote --plan --json --target-org dev1 --parent-branch integration --from-pull-request 412
sf hardis:work:backpromote --prepare --run-id <runId> --on-diff "force-app/main/default/layouts/Case-Case Layout.layout-meta.xml=merge" --json
# the extension opens the VS Code merge editor, the user solves and saves
sf hardis:work:backpromote --auto --run-id <runId> --from-pull-request 412 --on-diff "...=merge" --on-diff-default git --json
```

Typical agent sequence:

```shell
sf hardis:work:backpromote --plan --json --target-org dev1 --parent-branch integration
sf hardis:work:backpromote --plan --json --target-org dev1 --parent-branch integration --from-pull-request 412
sf hardis:work:backpromote --agent --target-org dev1 --parent-branch integration --from-pull-request 412 --run-id <runId> \
  --on-diff "force-app/main/default/classes/InvoiceCalculator.cls=merge" --on-diff-default git --json
# status waitingForMerges: the agent edits the listed files, then runs the same command again
sf hardis:work:backpromote --agent --target-org dev1 --parent-branch integration --from-pull-request 412 --run-id <runId> --json
```

Flags to keep from the current branch: `--target-org`, `--auto`, `--plan`, `--json`, `--exclude-metadata`, `--skip-destructive`, `--actions`, `--skip-actions`, `--agent`, `--debug`, `--websocket`, `--skipauth`.
Flags to rename: `--parentbranch` becomes `--parent-branch`.
Flags to add: `--from-pull-request`, `--on-diff`, `--on-diff-default`, `--prepare`, `--run-id`, `--reset`, `--sandbox-name` (override of R3 for unusual domains), `--confirm-action <id>` (R28, the panel's "Done in the sandbox" checkbox; alone it is a confirm mode that only writes the action rows), `--scan-limit <n>` (R14, the "Show earlier" link), `--dirty-tree stash|commit` and `--commit-message` (R42, the panel passes the answer of its modal to `--prepare` and `--auto`).
Flags to remove: `--on-conflict` (replaced by `--on-diff`), `--no-pull` (the org is never pulled into a branch anymore).

### 4.10 Multi-user and concurrency

- R46. Two people can backpromote to the same sandbox at different times from different computers: everything they need is on origin and in the Pull Request comments.
- R47. Two people backpromoting to the same sandbox at the same time both read a history without the other's row, and both deploy the same window. The result in the sandbox is the same, the second comment write updates the row (R32), and deployment actions cannot run twice as long as the "Deployment Actions" comment is updated before the next check. The race between two runs a few seconds apart is accepted and documented. When both produced manual merges, the second push is rejected (R10).
- R48. Branch protection rules of the repository must allow pushes to `backpromote/*`. The doc says so, and the command turns a push permission error into a readable message.

### 4.11 After the backpromote: the developer's own branch

- R49. The sandbox now holds the parent branch content, but the developer's User Story branch does not, and the checkout is on the backpromote branch (R42b). The command ends with a reminder, and the panel with a **Back to my branch** button, that: checks out the original branch, pops the stash the run made (if any), then proposes to merge the parent branch into it (`git merge origin/<parent>`) so that the next `hardis:work:save` does not commit the backpromoted metadata as if it were the story's own work. These are plain git operations, not a backpromote, and none of them runs automatically at the end of the command.

### 4.12 Orchestration by a coding agent

A coding agent (Claude Code, GitHub Copilot, Cursor...) must be able to drive a whole backpromote, including the merge decisions, with the command alone. The same requirements make the panel efficient, since the panel is also a client of the JSON.

- R50. **One command, no prompt in agent mode.** `--agent` never waits for input. Everything the interactive mode asks has a flag, and every unknown gets a documented default (R14 start, `git` version for differences unless `--on-diff-default` says otherwise, manual actions left pending). A split into several commands is not needed: one command with modes is one thing to learn.
- R51. **The plan tells the agent everything it needs to decide.** For every file with a difference the plan JSON gives absolute paths to the three versions in the cache (base, sandbox, parent head), the diff size, the Pull Requests that changed the file, and whether the sandbox also has pending changes on it. The agent reads the files itself, no UI needed.
- R52. **Decisions are flags, defaults are cheap.** `--on-diff <file>=git|org|merge` per file, `--on-diff-default git|org|merge` for the rest, `--exclude-metadata`, `--skip-destructive`, `--actions`, `--skip-actions`, `--from-pull-request`. An agent that agrees with the defaults runs `--agent --target-org X --parent-branch Y` and nothing else.
- R53. **A merge decided by the agent is a normal file edit.** In agent mode, `--on-diff file=merge` writes the merged file with markers in the checkout of the backpromote branch, then the run stops with status `waitingForMerges` (exit code 0, it is not an error), the JSON lists the files with their absolute paths, and the coding agent prompt of R38 contains the exact command to run again. The agent edits the files and runs the same command with the `runId`: it commits, checks the markers, deploys. A file left with markers is reported, not deployed, and the command can be run again after another edit. An agent can also use `--prepare` like the panel and run once.
- R54. **Every call is resumable and idempotent.** Running the same command twice deploys nothing twice and runs no action twice (R26, R32: the second run finds the rows the first one wrote). A run interrupted at any step can be restarted from the plan. Errors are returned in the JSON with a `status` field (`ok`, `waitingForMerges`, `refused`, `pushRejected`, `deployFailed`, `nothingToDo`) and a non-zero exit code only for real failures.
- R55. **Efficient in calls and in time.** `--plan` writes its computed state under a `runId` in the cache (delta, retrieve, comparison). `--auto --run-id <id>` reuses it instead of retrieving and diffing again, and recomputes only when the parent head, the backpromote branch head or the org id changed. Without `--run-id`, `--auto` does everything in one call. `--plan` accepts `--from-pull-request` so that one call returns the window, the items, the actions and the comparison at once.
- R56. **The agent finds the procedure without reading the code.** The command description has an `### Agent Mode` section with the sequence (plan, decide, run, edit, run again) and the JSON fields it relies on. A `backpromote` skill under `.claude/skills/` (and the equivalent `.github/` instructions) gives a coding agent the same procedure and the rules for a merge: keep both sides when they touch different parts, prefer the parent branch for shared configuration, never remove an org-only field the story needs, explain each file in the commit message body as promotion branches do.
- R57. **Sensitive output stays out of the JSON.** No token, no session id, no full org username when a sandbox name is enough, so that the JSON can be pasted in a chat with an agent.

## 5. Solution design

### 5.1 sfdx-hardis modules

| File | Role after the refactoring |
|------|----------------------------|
| `src/commands/hardis/work/backpromote.ts` | The command: flags, mode dispatch, the sequence of 4.8, the JSON result. |
| `src/common/utils/backpromoteRules.ts` | Pure functions, unit tested: branch naming and parsing, sandbox name, target org refusal, window computation from a Pull Request list with its comment rows (the walk of R14), backpromote comment row parsing and rendering, conflict marker count, `--on-diff` parsing, run command builder, coding agent prompt. |
| `src/common/utils/backpromoteGitUtils.ts` | Git: fetch, clean-tree check with commit or stash, checkout of the backpromote branch, branch create, reset to parent head, cherry-pick of pending manual merges, merge-file 3-way and 2-way, commits, push with lease, delta (sfdx-git-delta, cached). Remove `refs/sfdx-hardis/backpromote-base`, `MERGE_HEAD` handling and the org pull. |
| `src/common/utils/backpromoteOrgUtils.ts` (new) | Org: sandbox info (id, type, instance URL), retrieve of the ticked items into the cache, comparison with the parent head files, retrieve preview on tracked orgs, deployment and destructive deployment. |
| `src/common/utils/backpromotePlanUtils.ts` | Plan object (version 3), prompts of the interactive mode, progress reporting. |
| `src/common/utils/backpromoteUtils.ts` | Kept as is for what promotion:create shares: `listMergedPrsWithCommits`, `attributeCommitsToFirstParents`, `splitVehicleMerges`, `collectBackpromoteActions`, `executeBackpromoteActions` (extended with the sandbox org column of R26), `collectTestClassesFromPrs` (no longer used by backpromote, kept for callers). |
| `src/common/utils/backpromoteCommentUtils.ts` (new) | The "Backpromotes" comment: find by marker, parse the two tables (sandbox rows, action rows), upsert a sandbox row and an action row, render both tables, and the paged walk of R14 through the git provider (`listPullRequestComments` of each provider, with the `runId` cache). The CI/CD "Deployment Actions" comment module is not changed. `executeBackpromoteActions` takes this module as its state store. |
| `config/sfdx-hardis.jsonschema.json` | One new property: `backpromoteScanLimit` (integer, default 100). No feature switch (decision: backpromote is always available). |
| `docs/hardis/work/backpromote.md` and `docs/salesforce-ci-cd-backpromote.md` | Regenerated command page and a user guide with the panel screenshots. |
| `messages/backpromote.md`, `src/i18n/*.json` | Flag descriptions and every prompt, message and error. |
| `hardis:work:refresh` | Stays a deprecated stub pointing at backpromote. |

### 5.2 Plan JSON (version 3)

Returned by `--plan --json` and consumed by the panel. One object:

- `version: 3`, `runId`, `status` (R54)
- `targetOrg`: alias, instance URL, org id, sandbox name, tracks sources, refusal (if any)
- `parentBranch`, `allowedParentBranches` (R5b), `backpromoteBranch` (exists on origin, head, pending manual merges), `checkout` (original branch, clean or not, stash made or not)
- `pullRequests[]`: number, title, author, merge date, source branch, commit, item count, action count, `backpromote` (the comment row for this sandbox: date, user, status, left-out items, or null), `beforeRefresh`, `beforeLastBackpromote` (older than the newest backpromoted one: counted as backpromoted, comment not read), `selected`, `inWindow`, `scanned`
- `scan`: Pull Requests read, scan limit, whether the walk found a row (R14), cursor for "Show earlier"
- `window`: from commit, to commit, start Pull Request
- `items[]`: key, type, name, files, Pull Requests, `excludedLastTime`, `noOverwrite`
- `deletions[]`: key, files
- `actions[]`: id, label, type, phase (pre/post), context, Pull Request, `alreadyRunOn` (date or null), `manual`, `runnable` (token, custom username)
- `comparison[]`: file, item key, status (`same`, `different`, `missingInOrg`, `pendingInOrg`, `notCompared`), absolute paths of the base, sandbox and parent head versions (R51), diff line count, Pull Requests of the file, decision applied, `prepared` (file written with markers), `markersRemaining` (count), `conflictPending`
- `checks[]`: the refusals and warnings (token missing, working tree not clean, branch diverged...)
- `promptFile`: path of the coding agent prompt when merges are prepared, `runCommand`: the exact command to run once the merges are solved (R53)

### 5.3 VS Code panel

One LWC panel, `s/backpromote`, opened from the Commands panel and from the pipeline (the menu of a major branch node pre-fills the parent branch). One page, three blocks read from top to bottom, no wizard, no hidden screen. A user who agrees with the defaults reads the page and clicks one button.

1. **Where** (one line): sandbox picker (R5, major orgs disabled with the reason), parent branch picker (R5b, hidden when only `developmentBranch` is allowed), and a compact list of the merged Pull Requests with a radio button for the start (R16, R17). The default start is pre-selected, the already backpromoted ones are greyed with their date, the list is collapsed to the ones after the default start with a "Show earlier" link.
2. **What** (the plan): metadata items grouped by type with checkboxes, all ticked. **One line per metadata item**, whatever its state: checkbox, type, name, Pull Request numbers, then on the right the state pill. An item whose sandbox version differs carries on that same line a segmented select button **Overwrite** (default) **/ Keep org version / Merge** (no radio buttons) and a **Compare** button that opens the VS Code diff editor. Clicking **Merge** calls `--prepare` and opens the VS Code merge editor on the file; the same line then shows the marker count as its pill ("1 conflict left", then "merged") and the Merge segment reopens the merge editor. Nothing expands under the line. The panel draws no diff and no merge widget (R36b). At the top of the block: an "Overwrite all" link, and, as soon as one file is prepared, one **Copy agent prompt** button covering every conflict of the run (R38). Deletions in their own sub-list, ticked by default (R21). Deployment actions in their own sub-list, ticked, the ones already run in this sandbox greyed with their date, manual actions with a "Done in the sandbox" checkbox (R28). A partial row from a previous backpromote shows its left-out items with a "left out on..." label, ticked again by default.
3. **Go**: one **Backpromote** button with a one-line summary ("12 items, 1 deletion, 3 actions, 1 merged file"), then the progress log of R44 and the result. While a prepared file still holds markers the button is disabled and the summary names the files to finish (R36c). After success, the reminder of R49 with its **Back to my branch** button (checkout of the original branch, stash pop, then the proposed merge of the parent branch).

Every change in block 1 triggers one `--plan --json` call and refreshes block 2. Clicking **Merge** in block 2 runs `--prepare --run-id <id>` once per new decision and opens the merge editor. Block 3 builds one `sf hardis:work:backpromote --auto --run-id <id> ...` command from the state of the page and runs it in the command runner, like today.

Rules for the page:

- Nothing to configure before the first useful display: opening the panel with a default dev sandbox and one allowed parent branch shows the plan directly. The only precondition is the git provider token (R27): without it the page shows one message and the way to set it, nothing else.
- Every greyed element says why on hover and in a short label (already backpromoted on..., already run on..., production org, not in `availableTargetBranches`, no overwrite).
- Long lists are collapsed by type with counts, never paginated.
- One vocabulary: the labels of the page are the terms of section 1, the same words as the command output and the doc.

The extension mirror of `backpromoteRules.ts` is limited to what the panel needs before the first plan call (branch name parsing for the pipeline node menu, allowed parent branches). Everything else comes from the plan JSON.

### 5.4 Cache

Under the sfdx-hardis temporary folder:

- `backpromote/delta/<from>..<to>/`: sfdx-git-delta output.
- `backpromote/comments/<run id>/`: the comment reads of the walk of R14 (R33b).
- `backpromote/retrieve/<org id>/<run id>/`: the sandbox versions retrieved for the comparison, kept until the run ends or the next run starts, and used by the Compare button.

Deleting the folder loses nothing.

## 6. Errors and edge cases

- Target org refused (production, major org): stop before anything, message names the branch the org belongs to.
- Parent branch not a major branch: stop.
- No git provider token: refuse to start, say how to set it (R27).
- Comment reads fail (rate limit, network): stop before any deployment, the history cannot be trusted.
- Backpromote branch on origin diverged from the local one: the local branch is reset to origin (it holds nothing that is not on origin or in the parent branch).
- Working tree not clean: interactive mode asks commit or stash, `--auto` and `--agent` stash (R42). A stash that cannot be made (untracked conflicts) stops the run before anything else.
- Run ends on the backpromote branch (R42b): the last line of the output and the panel say so and give the way back (R49).
- Push rejected (manual merges only): stop with the message of R10. The comment rows are already written, the next run cherry-picks the pending merges again from origin.
- Sandbox refreshed (rows carry another org id): the Pull Requests show "before refresh" (R14b), every action counts as not run yet, no flag needed.
- No row found within the scan limit: nothing pre-selected, the user picks the start or extends the scan (R14).
- Window empty (nothing merged since the last backpromote): say so and stop.
- Delta empty but actions present: run the actions only.
- Deployment failure: stop after the deployment (R43), the error output goes through the existing deployment assistant tips.
- Conflict markers in a prepared file: outside agent mode the run refuses to start (`conflictsRemaining`), in agent mode the file is excluded (R37). Never a deployment with markers.
- Scratch org as target: allowed, sandbox name from the username (R3), everything else identical.
- Parent branch with `/` in its name: R6.

## 7. What was not in the initial list

Points I think are missing from the user path, added above or left as questions:

1. **Deletions.** The delta also removes metadata. They need their own list, ticked by default, with `--skip-destructive` and per-item unticking to hold them back (R21).
2. **The developer's User Story branch.** After the backpromote the sandbox is ahead of the branch the developer works on. Without a merge of the parent branch into the story branch, the next `hardis:work:save` commits the backpromoted metadata in the story (R49).
3. **Sandbox refresh.** Same name, new org. Actions must run again and the history must restart: org id in every comment row (R4, R14b, R26).
4. **Concurrency and push permissions.** Two users on the same sandbox, branch protection rules on `backpromote/*` (R10, R47, R48).
5. **Pipeline and CI hygiene.** The backpromote branch must be ignored by the pipeline diagram, release notes, promotion candidates, and no CI job may trigger on it (R8, R9).
6. **Git provider token on the developer's computer.** The history and the run-once rule both need it, unlike the current merge-based design. It becomes a hard requirement and the panel must guide the user (R27).
7. **Manual and custom-user actions** in a sandbox (R28, R29).
8. **`package-no-overwrite.xml`** applies to dev sandboxes too (R22).
9. **Test level.** `NoTestRun` on sandboxes, test classes are not collected anymore (R23).
10. **Where the deployment runs from.** The manual merges live in the backpromote branch, so the deployment must run from a checkout of that branch: the developer's checkout is switched, with a commit or a stash when it is not clean, and stays there after the run (R42, R42b, R49).
11. **Skipped items memory.** An item unticked or kept as org version must be offered again next time: the partial row of the backpromote comment lists it (R14c, R32).
12. **Naming.** The feature is backpromote everywhere; "retrofit" is another command.
13. **Binary files and Flows** in the comparison (R39, R40).
14. **Coding agent orchestration.** A stop-and-run-again protocol with a status, absolute file paths in the JSON, a `runId` to avoid recomputing, and a skill that tells the agent the procedure and the merge rules (4.12).
16. **Merges before the run, with VS Code's tools.** The panel never reimplements a diff or a merge: `--prepare` writes the files, VS Code's merge editor solves them, and the backpromote starts only once no marker remains (R36b, R36c, D8, D9, D10).
15. **Allowed parent branches.** `developmentBranch` or `availableTargetBranches` only (R5b).

## 8. Decisions taken

Answers given on 2026-09-12, applied in the requirements above.

| # | Question | Decision |
|---|----------|----------|
| D1 | Where does the deployment run from? | The developer's checkout is switched to the backpromote branch. When the working tree is not clean, the interactive mode proposes to commit or to stash on the current branch, `--auto` and `--agent` stash. After the run the checkout stays on the backpromote branch; the **Back to my branch** action of R49 brings the developer back and pops the stash (R42, R42b). |
| D2 | How far back does the history scan go? | A count: `backpromoteScanLimit`, default 100 merged Pull Requests, "Show earlier" extends by another page (R14). |
| D3 | Where do the backpromote rows and the actions state live? | One "Backpromotes" comment per Pull Request holding two tables: the sandbox rows and the deployment actions run by backpromotes. The CI/CD "Deployment Actions" comment is never touched (R26, R32, R32b). |
| D4 | Which base for a manual merge? | 3-way (base = version at the start of the window) when the sandbox already received a backpromote, 2-way otherwise (R36). |
| D5 | Sandbox rows in the CI/CD actions table? | Moot: backpromote actions have their own table (D3). |
| D6 | Project-level switch? | None. Backpromote is always available. Only `backpromoteScanLimit` enters the JSON schema. |
| D7 | Scratch orgs as targets? | Accepted, same rules as a sandbox, name from the username (R1, R3). |
| D8 | Entry point in the extension? | The **Backpromote** card that already exists below the DevOps Pipeline diagram (`handleBackpromote` opens `vscode-sfdx-hardis.showBackpromote`), plus the Commands panel entry. Nothing on the diagram nodes; the parent branch is chosen in the panel. |
| D9 | How are conflicts solved in the extension? | With VS Code's own merge editor and conflict decorations, opened from the item's line in the What block. Every item stays on one line: an **Overwrite / Keep org version / Merge** select button and a **Compare** button, no radio buttons, nothing expanded. One coding agent prompt for all the conflicts of the run, offered at the block level, never per file. The panel renders no diff and no merge widget (R36b, R39). |
| D10 | When are merges solved? | Before the backpromote runs, outside agent mode: `--prepare` writes the files, the user solves them, the Backpromote button is enabled only when no marker remains, and the run commits them first (R36c). Only `--agent` may stop with `waitingForMerges` and be run again. |

## 9. Refactoring plan from the current branches

Remove from sfdx-hardis `feat/backpromote-panel`:

- The merge of the parent branch into the current branch, `refs/sfdx-hardis/backpromote-base`, `MERGE_HEAD` continuation, `--on-conflict`, `overwrite/keep/merge` on git conflicts.
- The pull of the org pending changes into the current branch (`--no-pull`).
- The current-branch constraint (User Story branch only): the current branch no longer matters.
- Test class collection for the deployment.
- Plan version 2.

Keep and reuse: Pull Request listing and grouping, delta computation and cache, action collection and execution, target org refusal, sandbox short name, progress file, coding agent prompt, panel command runner integration.

Remove from vscode-sfdx-hardis `feat/backpromote-panel`: the conflict decision buttons of the merge-based design, the `Continue` state tied to `MERGE_HEAD`, the plan version 2 parsing, any diff rendering inside the LWC. Replace with the one-page layout of 5.3, the merge editor opening (`vscode.git` merge editor command with base, input1, input2 and output URIs, fallback to opening the file) and the marker watch on prepared files.

Both repositories get one Pull Request each, cross-linked, and the `promotion-branches` and `promotion-branches-e2e` skills are updated (invariant 29 and the backpromote runbook).

## 10. Test plan

Unit (sfdx-hardis, `test/common/utils/backpromoteRules.test.ts` and friends): branch naming and parsing with `/` in the parent, sandbox name from URL and username, window computation from comment rows (found, not found, partial, before refresh), comment row parsing and rendering, `--on-diff` parsing, conflict marker count, prompt content, run command builder.

Unit (vscode-sfdx-hardis, `backpromotePanelUtils.test.ts`): command building from the decisions, greying rules, screen transitions.

End to end (`promotion-branches-e2e` runbook, backpromote section): on the e2e org and a throwaway repository, two users simulated by two clones, one sandbox, three Pull Requests merged with actions, then: first backpromote from Pull Request 1, second from the default start, a merge prepared and solved before the run, an agent run that stops with `waitingForMerges` and is run again, a refresh simulation (rows with another org id), a partial backpromote whose left-out items come back in the next plan, a scan that finds no row, and the check that every action ran once per sandbox and every Pull Request of each window got its row.
