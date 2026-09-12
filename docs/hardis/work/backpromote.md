<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:backpromote

## Description


## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings into a developer sandbox (or a scratch org) what the team merged in a parent major branch (integration, uat...) since the last backpromote: the metadata, and the deployment actions declared by the merged Pull Requests.**

Several people backpromote to the same sandbox over time, from different computers: nothing that matters is stored on a computer. The history of a sandbox is read from the **"Backpromotes" comment** sfdx-hardis writes on every Pull Request it backpromotes, and from nothing else. In VS Code, the **Backpromote (Beta)** panel of the sfdx-hardis extension runs this same command with the choices made in the panel.

What the command does, in order:

1. **Checks:** a git provider token must be configured (the history lives in the Pull Request comments), the target org must be a developer sandbox or a scratch org (a production org, or the org of a major branch declared in `config/branches`, is refused: the CI/CD pipeline deploys those), and the parent branch must be `developmentBranch` or one of `availableTargetBranches`.
2. **Start Pull Request:** the merged Pull Requests of the parent branch are listed, newest first, and the "Backpromotes" comment of each one is read until one holds a row for this sandbox: the default start is the Pull Request merged right after it. Everything merged after the start, up to the head of the parent branch, is the **window**.
3. **Delta and actions:** sfdx-git-delta computes what the window deploys and deletes, and `scripts/actions/.sfdx-hardis.<PR>.yml` gives the deployment actions of its Pull Requests. An action with a success row for this sandbox in the "Backpromotes" comment never runs twice (`runOnlyOnceByOrg`).
4. **Comparison with the sandbox:** the ticked items are retrieved from the sandbox into a cache and compared with the parent branch version. For every file that differs, one decision: **Overwrite** (`git`, the parent branch version is deployed), **Keep org version** (`org`, the item is not deployed and listed as kept) or **Merge** (`merge`, the file is written with conflict markers in the backpromote branch and solved with the VS Code merge editor, by hand or with the coding agent prompt saved in `hardis-report/`).
5. **Deployment from the backpromote branch:** the checkout is switched to `backpromote/<parent branch>/<sandbox name>` (a child of the parent branch that only holds the manual merges; the working tree is committed or stashed first when it is not clean), the merged files are committed, then the pre-deployment actions run, the metadata is deployed (`NoTestRun`), the deletions are applied, the post-deployment actions run.
6. **History:** every Pull Request of the window gets a row for the sandbox in its "Backpromotes" comment (complete, or partial with the items left out), and the backpromote branch is pushed when it holds manual merges. The checkout **stays on the backpromote branch**: the last line of the output says how to get back to your own branch.

### Decisions from the flags

`--auto` takes every decision from the flags and asks nothing: `--from-pull-request` for the start, `--exclude-metadata` for the items and deletions not to deploy, `--skip-destructive`, `--actions` / `--skip-actions`, `--on-diff <file>=git|org|merge` per file and `--on-diff-default` for the others (default `git`). It refuses to start while a prepared file still holds conflict markers. This is how the VS Code panel runs the command.

### Plan (read-only)

`--plan --json` returns the checks, the Pull Requests with their backpromote rows, the window, the items, the deletions, the deployment actions with what already ran in this sandbox, and the comparison of every file with the sandbox (with the absolute paths of the sandbox, parent branch and base versions kept in the cache). It reads git, the Pull Request comments and the sandbox: it deploys, merges, commits and writes nothing. `--prepare` goes one step further: it switches the checkout to the backpromote branch and writes the files marked `merge` with their markers, so that they can be solved before the run.

### Agent Mode

Use `--agent` to disable all interactive prompts. The command will:

- Take the parent branch from `--parent-branch`, else `developmentBranch`
- Take the start from `--from-pull-request`, else the first Pull Request not backpromoted yet (and refuse when the history holds no row within the scan limit)
- Behave as with `--auto`, leaving manual actions pending (confirm them later with `--confirm-action <id>`)
- Stop with status `waitingForMerges` (exit code 0) when a file marked `merge` is written with markers: edit the files listed in the JSON, then run the same command again with the returned `runId`. A file left with markers is not deployed and is listed as "conflict pending" in the comment row.

Typical sequence: `--plan --json` to read the plan, decide, `--agent --run-id <runId> --from-pull-request <n> --on-diff ... --json`, edit the merged files, run the same command again.

<details markdown="1">
<summary>Technical explanations</summary>

- **Target org check:** queries `Organization.Id`, `IsSandbox` and `TrialExpirationDate`, and compares the username (and the sandbox it belongs to) and the instance URL with the major orgs of `config/branches`. The sandbox name comes from the instance URL (`mycompany--dev1.sandbox...` gives `dev1`), else from the username, else from the org id; `--sandbox-name` overrides it.
- **History:** the "Backpromotes" comment is found by the hidden marker `<!-- sfdx-hardis backpromotes -->` and holds a hidden JSON block plus two readable tables: the sandbox rows (name, org id, date, user, parent branch, complete or partial with the items left out) and the deployment actions run by backpromotes. A refreshed sandbox has a new org id: its old rows are history, not state. `backpromoteScanLimit` (default 100) bounds the number of Pull Requests read.
- **Backpromote branch:** fetched at every run, rebuilt on the parent head (the manual merge commits are cherry-picked over it), pushed with `--force-with-lease` when it holds merges. `--reset` deletes it.
- **Merges:** three-way with `git merge-file` (base = the version at the start of the window) when the sandbox already received a backpromote, two-way with markers around every differing block otherwise. The three versions are kept in the cache for the VS Code merge editor.
- **Cache:** under the temporary folder, `sfdx-hardis/backpromote/`: the sfdx-git-delta output per commit pair, the comment reads and the run state per run id, the sandbox retrieve per org id and run id. Deleting it loses nothing.
- **Progress of a background call:** when `SFDX_HARDIS_PROGRESS_FILE` is set (the VS Code panel sets it), each step is appended to that file as one JSON line.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|actions|option|Comma-separated ids of the deployment actions to run. Default: every action of the window not run in this sandbox yet.||||
|agent|boolean|Run in non-interactive mode for agents and automation||||
|auto|boolean|Take every decision from the flags and ask nothing (the VS Code panel passes it).||||
|commit-message|option|Commit message when --dirty-tree commit is used.||||
|confirm-action|option|Id of a manual deployment action done in the sandbox by hand: its row is written as done. Repeatable.||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|dirty-tree|option|What to do with uncommitted changes before the checkout switches to the backpromote branch. Default: stash with --auto and --agent, asked otherwise.|||stash<br/>commit|
|exclude-metadata|option|Type:Name of an item not to deploy nor delete now, for example "Layout:Account-Account Layout". Repeatable.||||
|flags-dir|option|undefined||||
|from-pull-request|option|Number of the start Pull Request: it and everything merged after it are backpromoted. Default: the first one not backpromoted yet.||||
|json|boolean|Format output as json.||||
|on-diff|option|Decision for a file whose sandbox version differs: "<file path>=git" (overwrite with the parent branch version), "=org" (keep the org version) or "=merge" (merge by hand). Repeatable.||||
|on-diff-default|option|Decision for the files that differ and have no --on-diff decision.|git||git<br/>org<br/>merge|
|parent-branch|option|Parent branch to backpromote from: developmentBranch or one of availableTargetBranches. Default: developmentBranch.||||
|plan|boolean|Read-only: return what a backpromote would do (use with --json). Deploys, merges, commits and writes nothing.||||
|prepare|boolean|Switch the checkout to the backpromote branch and write the files marked merge with their conflict markers, without deploying.||||
|reset|boolean|Delete the backpromote branch of the sandbox on origin and locally (abandons the pending manual merges).||||
|run-id|option|Id of a previous --plan or --prepare call, to reuse its cache and its prepared files.||||
|sandbox-name|option|Short name of the sandbox (branch name and comment rows), when the one read from the instance URL is not right.||||
|scan-limit|option|Number of merged Pull Requests read to find the last backpromote of the sandbox. Default: backpromoteScanLimit (100).||||
|skip-actions|boolean|Run no deployment action.||||
|skip-destructive|boolean|Do not delete anything from the org.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:work:backpromote
```

```shell
$ sf hardis:work:backpromote --parent-branch integration --target-org dev1
```

```shell
$ sf hardis:work:backpromote --plan --json --target-org dev1 --parent-branch integration
```

```shell
$ sf hardis:work:backpromote --auto --run-id 7f3a --from-pull-request 412 --on-diff "force-app/main/default/classes/InvoiceCalculator.cls=merge" --target-org dev1
```

```shell
$ sf hardis:work:backpromote --agent --target-org dev1 --parent-branch integration --json
```

```shell
$ sf hardis:work:backpromote --reset --target-org dev1 --parent-branch integration
```


