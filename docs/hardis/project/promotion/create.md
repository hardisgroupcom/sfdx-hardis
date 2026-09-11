<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:project:promotion:create

## Description

## Command Behavior

**Experimental feature.** Promotion branches are new and switched off by default; their behavior may still change from feedback.

**Assembles a promotion branch: a branch carrying only the approved User Stories of a major branch (ex: uat), so they reach the next major branch (ex: preprod) before the rest of the promotion window.**

This is the only supported way to create a [promotion branch (experimental)](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-promotion-branches/). The command:

- checks that `enablePromotionBranches: true` is set in the sfdx-hardis configuration;
- checks that `allowedPromotionSteps` declares the steps promotions may run on (ex: `- source: uat` / `target: preprod`), and keeps to them: only those source and target branches are offered, and naming another one fails;
- lists the Pull Requests merged into the source branch and not yet promoted to the target branch, and lets you select the ones to carry (or takes them from `--pull-requests`). A Pull Request another promotion branch already carries to the same target is left out, unless `--include-already-promoted` is passed;
- creates the branch from the target branch, named `promotion/<source>/<target>/<YYYY-MM-DD>-<counter>` (ex: `promotion/uat/preprod/2026-09-06-1`), the counter separating several promotions assembled the same day;
- cherry-picks the merge commit of each selected Pull Request, oldest first, with `-x` so each commit keeps a pointer to its origin;
- pushes the branch and creates the Pull Request to the target branch, with a description declaring the carried Pull Requests (`promotionPullRequests`), their titles, authors, source branches and tickets.

The deployment jobs then treat the declared Pull Requests as the scope of the promotion Pull Request: their deployment actions run, their Apex test classes are collected, their custom behaviors are inherited.

On a cherry-pick conflict, you choose (or `--on-conflict` decides) to:

- **skip**: leave the story out, it is listed as such in the Pull Request description;
- **commit-with-markers**: commit the story anyway with its git conflict markers, so the conflicts can be solved later on the branch, by hand or with a coding agent. The Pull Request description lists the files to fix and embeds a ready-to-paste prompt for a coding agent (Claude Code, Codex, Copilot...), also saved as a markdown report in `hardis-report/`. The validation job fails until the markers are gone;
- **commit-with-markers, and all the following conflicts**: same, and the command stops asking for the rest of the promotion (the prompt only, `--on-conflict commit-with-markers` already applies to every conflict);
- **abort**: stop, the branch is deleted and nothing is pushed.

<details markdown="1">
<summary>Technical explanations</summary>

- Candidates are the first-parent commits of `origin/<source>` since its merge base with `origin/<target>`, grouped with their Pull Requests like `hardis:work:backpromote` does (Pull Request numbers read from the merge commit messages and completed by the git provider API when a token is available).
- The branch is created with `git checkout -b <name> origin/<target>`, commits are applied with `git cherry-pick -x` (`-m 1` for merge commits).
- The Pull Request is created through the git provider API (GitHub, GitLab, Azure DevOps, Bitbucket token), or with the `gh` CLI on GitHub. The creation is retried a few times: the branch is pushed a fraction of a second before, and a provider that has not indexed the new ref yet answers that the source branch does not exist. Without either, the branch is pushed and the description is saved under `hardis-report/` to create the Pull Request by hand, and the message names the reason the provider gave.
- The counter is computed from the existing `promotion/<source>/<target>/<date>-*` branches, local and remote.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:promotion:create --agent --source-branch uat --pull-requests 482,487,491
```

In agent mode:

- `--source-branch` and `--pull-requests` are required; `--target-branch` defaults to the first merge target of the source branch. Outside agent mode, `--pull-requests` only preselects the stories in the prompt (this is how the VS Code extension passes the stories ticked in the DevOps Pipeline), and the user confirms the selection.
- Every number of `--pull-requests` must match a Pull Request merged into the source branch and not yet promoted, otherwise the command fails before touching git.
- A cherry-pick conflict undoes the whole promotion (branch deleted, nothing pushed) and fails the command naming the conflicting Pull Request, unless `--on-conflict skip` or `--on-conflict commit-with-markers` is passed.
- To choose those numbers first, list what can be promoted with `sf hardis:project:promotion:list-candidates --agent --source-branch uat --json`: same candidates, nothing created.

## Parameters

| Name                     |  Type   | Description                                                                                                                                                                                                                      | Default | Required |                Options                 |
|:-------------------------|:-------:|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:--------------------------------------:|
| agent                    | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                            |         |          |                                        |
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                                                                                                                                                                  |         |          |                                        |
| flags-dir                | option  | undefined                                                                                                                                                                                                                        |         |          |                                        |
| include-already-promoted | boolean | Also offer the Pull Requests another promotion branch already carries to the same target branch (left out by default).                                                                                                           |         |          |                                        |
| json                     | boolean | Format output as json.                                                                                                                                                                                                           |         |          |                                        |
| on-conflict              | option  | What to do when a cherry-pick conflicts: skip (leave the story out), commit-with-markers (commit it with its conflict markers, to solve later), abort (undo the whole promotion). Prompted if not provided, abort in agent mode. |         |          | skip<br/>commit-with-markers<br/>abort |
| pull-requests<br/>-p     | option  | Comma-separated numbers of the Pull Requests to carry (ex: 482,487). Preselected in the prompt when provided, taken as is in agent mode where the flag is required.                                                              |         |          |                                        |
| skip-pull-request        | boolean | Push the promotion branch without creating its Pull Request (the description is saved in hardis-report/).                                                                                                                        |         |          |                                        |
| skipauth                 | boolean | Skip authentication check when a default username is required                                                                                                                                                                    |         |          |                                        |
| source-branch<br/>-s     | option  | Major branch the approved User Stories are merged into (ex: uat). Prompted if not provided, required in agent mode.                                                                                                              |         |          |                                        |
| target-branch<br/>-t     | option  | Major branch the promotion goes to (ex: preprod). Defaults to the first merge target of the source branch.                                                                                                                       |         |          |                                        |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                        |         |          |                                        |

## Examples

```shell
$ sf hardis:project:promotion:create
```

```shell
$ sf hardis:project:promotion:create --source-branch uat
```

```shell
$ sf hardis:project:promotion:create --source-branch uat --target-branch preprod --pull-requests 482,487
```

```shell
$ sf hardis:project:promotion:create --agent --source-branch uat --pull-requests 482,487,491
```

```shell
$ sf hardis:project:promotion:create --agent --source-branch uat --pull-requests 482 --skip-pull-request
```

```shell
$ sf hardis:project:promotion:create --agent --source-branch uat --pull-requests 482,487 --on-conflict commit-with-markers
```
