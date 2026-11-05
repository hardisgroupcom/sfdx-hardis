<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:promotion:create

## Description


## Command Behavior (Beta)

**This feature is in Beta.** Promotion branches are switched off by default; their behavior may still change from feedback. Please report any issue or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Assembles a promotion branch: a branch carrying only the approved User Stories of a major branch (ex: uat), so they reach the next major branch (ex: preprod) before the rest of the promotion window.**

This is the only supported way to create a [promotion branch (Beta)](https://sfdx-hardis.cloudity.com/salesforce-devops-promotion-branches/). The command:

- checks that `enablePromotionBranches: true` is set in the sfdx-hardis configuration;
- checks that `allowedPromotionSteps` declares the steps promotions may run on (ex: `- source: uat` / `target: preprod`), and keeps to them: only those source and target branches are offered, and naming another one fails;
- requires the [git provider connection](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integrations-home/) (GitHub, GitLab, Bitbucket or Azure DevOps) and refuses to run without it: the carried Pull Requests are read from the provider, so the command behaves the same on every platform and every carried Pull Request gets its real title and author. From VS Code, the extension passes its own connection; from a terminal, an agent or CI, set the provider token as an environment variable or in a `.env` file at the repository root;
- lists the Pull Requests merged into the source branch and not yet promoted to the target branch, and lets you select the ones to carry (or takes them from `--pull-requests`). A Pull Request another promotion branch already carries to the same target is left out, unless `--include-already-promoted` is passed. With `detectManualCherryPicks: true`, so is a Pull Request that reached the target branch through a cherry-pick made by hand (see `hardis:project:promotion:list-candidates`);
- creates the branch from the target branch, named `promotion/<source>/<target>/<YYYY-MM-DD>-<HHMM>` (UTC, ex: `promotion/uat/preprod/2026-09-06-1430`), with `-2`, `-3`... added only when that name is already taken;
- cherry-picks the merge commit of each selected Pull Request, oldest first, with `-x` so each commit keeps a pointer to its origin;
- pushes the branch and creates the Pull Request to the target branch, with a description declaring the carried Pull Requests (`promotionPullRequests`), their titles, authors, source branches and tickets.

The deployment jobs then treat the declared Pull Requests as the scope of the promotion Pull Request: their deployment actions run, their Apex test classes are collected, their custom behaviors are inherited.

On a cherry-pick conflict, you choose (or `--on-conflict` decides) to:

- **commit-with-markers, and all the following conflicts** (**recommended**, the first answer offered): same as below, and the command stops asking for the rest of the promotion. A promotion window conflicts on the same files story after story, so the promotion is assembled in one go and every conflict is then solved in a single pass by a coding agent: copy the prompt from the Pull Request description (also saved in `hardis-report/`) and paste it to Claude Code, Codex, Copilot... This is a prompt answer only, `--on-conflict commit-with-markers` already applies to every conflict;
- **solve now**: the conflicting files are listed (and opened, when VS Code runs the command), you solve them while the command waits, then confirm. The command checks that no marker is left in those files and commits the story with its resolution (the git hooks of the project run, as for any clean commit). Until then you can still commit with the markers, skip the story or abort. Asked again at the next conflict, and a prompt answer only: nothing can solve a conflict unattended;
- **commit-with-markers**: commit the story anyway with its git conflict markers, so the conflicts can be solved later on the branch, by hand or with a coding agent. The Pull Request description lists the files to fix and embeds a ready-to-paste prompt for a coding agent (Claude Code, Codex, Copilot...), also saved as a markdown report in `hardis-report/`. The validation job fails until the markers are gone. The git hooks of the project are skipped for that commit only (a pre-commit hook would fail on the markers); the commit that solves them runs the hooks as usual;
- **take-source** (**risky**, for this conflict or all the following ones): keep the source branch version of the conflicting lines, the rest of each file still merges both sides. Nobody reviews that choice: a change made in the target branch on the same lines (a hotfix, a retrofit) can be lost, and lines of User Stories that are not promoted can come along, and no validation job notices. The Pull Request description lists those files under a warning, and the commit message names them. A conflict git cannot settle that way (a file deleted on one side and changed on the other) is asked about again, without this answer (abort in agent mode);
- **skip**: leave the story out, it is listed as such in the Pull Request description;
- **abort**: stop, the branch is deleted and nothing is pushed.

<details markdown="1">
<summary>Technical explanations</summary>

- Candidates are the first-parent commits of `origin/<source>` since its merge base with `origin/<target>`, grouped with their Pull Requests like `hardis:work:backpromote` does (Pull Request numbers read from the merge commit messages and completed by the git provider API, whose connection this command requires).
- A first-parent commit that only moves other merges (a major-to-major sync like `integration -> uat`, a promotion branch merged into its target) is opened up into the first-parent commits it brought in, so each User Story is a candidate of its own instead of the whole sync window being a single row.
- The branch is created with `git checkout -b <name> origin/<target>`, commits are applied with `git cherry-pick -x` (`-m 1` for merge commits).
- **take-source** cherry-picks the story again with `git cherry-pick -x -X theirs`: "theirs" is the commit being picked (source branch), "ours" the promotion branch (target branch).
- A commit holding conflict markers is made with `-c core.hooksPath=<empty folder>`, a private folder created for that commit and removed after it: `git cherry-pick` has no `--no-verify`, and this skips the hooks of any hook manager (Husky, pre-commit, lefthook, `.git/hooks`).
- The Pull Request is created through the git provider API (GitHub, GitLab, Azure DevOps, Bitbucket token), or with the `gh` CLI on GitHub. The creation is retried a few times: the branch is pushed a fraction of a second before, and a provider that has not indexed the new ref yet answers that the source branch does not exist. Without either, the branch is pushed and the description is saved under `hardis-report/` to create the Pull Request by hand, and the message names the reason the provider gave.
- The date and the time are in UTC. The name is checked against every promotion branch of the step that exists or existed: local and remote branches, remote-tracking refs, the merge commits of the target branch and its Pull Requests merged in the last two days. A name already taken gets `-2`, `-3`..., one more than the highest one found, and the branch creation stops on a name that still exists instead of resuming that branch.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:promotion:create --agent --source-branch uat --pull-requests 482,487,491
```

In agent mode:

- `--source-branch` and `--pull-requests` are required; `--target-branch` defaults to the first merge target of the source branch. Outside agent mode, `--pull-requests` only preselects the stories in the prompt (this is how the VS Code extension passes the stories ticked in the DevOps Pipeline), and the user confirms the selection.
- Every number of `--pull-requests` must match a Pull Request merged into the source branch and not yet promoted, otherwise the command fails before touching git.
- A cherry-pick conflict undoes the whole promotion (branch deleted, nothing pushed) and fails the command naming the conflicting Pull Request, unless `--on-conflict skip`, `--on-conflict commit-with-markers` or `--on-conflict take-source` (risky, see above) is passed.
- To choose those numbers first, list what can be promoted with `sf hardis:project:promotion:list-candidates --agent --source-branch uat --json`: same candidates, nothing created.
- The git provider token must be available (ex: `GITHUB_TOKEN`), from the environment or from a `.env` file at the repository root: agent mode never prompts for the connection, it stops without it.

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.cloudity.com) course runs this command, click by click, on an org of your own:

- [Lab 3.10 - Promote a subset with promotion branches (Beta)](https://sfdx-hardis-training.cloudity.com/en/level-3-release-manager/3-10-promote-a-subset-with-promotion-branches/)

<!-- training-links:end -->


## Parameters

| Name                     |  Type   | Description                                                                                                                                                                                                                                                                                                                    | Default | Required |                        Options                         |
|:-------------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:------------------------------------------------------:|
| agent                    | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                                                                                                                          |         |          |                                                        |
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                                                                                                                                                                                                                                                                |         |          |                                                        |
| flags-dir                | option  | Import flag values from a directory.                                                                                                                                                                                                                                                                                           |         |          |                                                        |
| include-already-promoted | boolean | Also offer the Pull Requests another promotion branch already carries to the same target branch (left out by default).                                                                                                                                                                                                         |         |          |                                                        |
| json                     | boolean | Format output as json.                                                                                                                                                                                                                                                                                                         |         |          |                                                        |
| on-conflict              | option  | What to do when a cherry-pick conflicts: skip (leave the story out), commit-with-markers (commit it with its conflict markers, to solve later), take-source (risky: keep the source branch version of the conflicting lines, without review), abort (undo the whole promotion). Prompted if not provided, abort in agent mode. |         |          | skip<br/>commit-with-markers<br/>take-source<br/>abort |
| pull-requests<br/>-p     | option  | Comma-separated numbers of the Pull Requests to carry (ex: 482,487). Preselected in the prompt when provided, taken as is in agent mode where the flag is required.                                                                                                                                                            |         |          |                                                        |
| skip-pull-request        | boolean | Push the promotion branch without creating its Pull Request (the description is saved in hardis-report/).                                                                                                                                                                                                                      |         |          |                                                        |
| skipauth                 | boolean | Skip authentication check when a default username is required                                                                                                                                                                                                                                                                  |         |          |                                                        |
| source-branch<br/>-s     | option  | Major branch the approved User Stories are merged into (ex: uat). Prompted if not provided, required in agent mode.                                                                                                                                                                                                            |         |          |                                                        |
| target-branch<br/>-t     | option  | Major branch the promotion goes to (ex: preprod). Defaults to the first merge target of the source branch.                                                                                                                                                                                                                     |         |          |                                                        |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                                                                                                                      |         |          |                                                        |

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


