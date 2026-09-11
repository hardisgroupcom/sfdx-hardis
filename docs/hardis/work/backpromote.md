<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:backpromote

## Description


## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings what your teammates merged in the parent branch (e.g. integration) into your User Story branch and your own org: a developer sandbox or a scratch org.**

A backpromote is a git merge of the parent branch into your branch, followed by the deployment of what that merge brought in. Git is the only source of truth: nothing is stored anywhere else. In VS Code, the **Backpromote (Beta)** panel of the sfdx-hardis extension shows what the merge brings and runs this same command with the choices made in the panel.

What the command does, in order:

1. **Checks:** you must be on a User Story branch (never a major, promotion or retrofit branch), with no uncommitted change, and the target org must be a developer sandbox or a scratch org. A production org, or the org of a major branch declared in `config/branches`, is refused: the CI/CD pipeline deploys those.
2. **Saves your org work:** when the org tracks its sources, its pending changes are pulled and committed in your branch first, so the merge sees them and the deployment never overwrites them. Use `--no-pull` to skip it.
3. **Merges the parent branch:** `git fetch` then `git merge origin/<parent branch>`. A file changed on both sides that git cannot merge on its own gets one decision: **overwrite** (take the parent branch version), **keep** (keep yours, as your org has it) or **merge** (solve it by hand). For a manual merge, the files are opened in VS Code and a prompt to paste into a coding agent (Claude Code, GitHub Copilot...) is saved: solve the conflicts, then run the command again, it finishes the merge and continues.
4. **Deploys the delta:** sfdx-git-delta computes what the merge brought in, and it is deployed to your org with its deletions (confirmed), the Apex test classes and the deployment actions declared by the Pull Requests merged, before and after the deployment. An item left out with `--exclude-metadata` stays in your branch and is not deployed now: with source tracking it stays pending, ready for a later push.

### Decisions from the flags

`--auto` takes every decision from the flags and asks nothing: every item is deployed unless `--exclude-metadata` says otherwise, every deletion applied unless `--skip-destructive`, every deployment action run unless `--actions` or `--skip-actions` says otherwise, and a conflicting file without an `--on-conflict` decision is left for a manual merge. This is how the VS Code panel runs the command.

### Plan (read-only)

`--plan --json` returns the checks, the Pull Requests the merge brings in, the items and the deletions it deploys, the files the merge may stop on (changed in the parent branch and in your branch or your org), the deployment actions and the pending changes of your org. It reads git and previews the org: it deploys, merges and writes nothing.

### Agent Mode

Use `--agent` to disable all interactive prompts. The command will:

- Use the branch the User Story was created from, or the configured `developmentBranch`, as the parent branch
- Behave as with `--auto`
- Stop on a conflicting file without decision, leaving the merge in progress and the coding agent prompt in `hardis-report/`: solve it and run the command again

<details markdown="1">
<summary>Technical explanations</summary>

- **Target org check:** queries `Organization.Id`, `IsSandbox` and `TrialExpirationDate`, and compares the username (and the sandbox it belongs to) and the instance URL with the major orgs of `config/branches`.
- **Org pending changes:** `sf project retrieve preview` for the plan, `sf project retrieve start` then a commit for the run, when the org tracks its sources.
- **Merge:** `git merge --no-edit origin/<parent>`. The pre-merge commit is kept in the `refs/sfdx-hardis/backpromote-base` ref while the merge waits for its conflicts, so the next run finishes the merge (`git commit`) and deploys the same delta. `overwrite` is `git checkout --theirs`, `keep` is `git checkout --ours`.
- **Delta:** sfdx-git-delta between the pre-merge commit and the merge commit, cached in the temporary folder per commit pair.
- **Pull Requests, actions and test classes:** the first-parent commits of the parent branch since the merge base, with the Pull Request numbers read from their messages, and `scripts/actions/.sfdx-hardis.<PR>.yml` read from the parent branch.
- **Progress of a background plan:** when `SFDX_HARDIS_PROGRESS_FILE` is set (the VS Code panel sets it), each step is appended to that file as one JSON line.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|actions|option|Comma-separated ids of the deployment actions to run. Default: every action of the Pull Requests brought in.||||
|agent|boolean|Run in non-interactive mode for agents and automation||||
|auto|boolean|Take every decision from the flags and ask nothing (the VS Code panel passes it).||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|exclude-metadata|option|Type:Name of an item not to deploy nor delete now, for example "Layout:Account-Account Layout". Repeatable.||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|no-pull|boolean|Do not pull the pending changes of the org into your branch before the merge.||||
|on-conflict|option|What to do with a file git cannot merge: "<file path>=overwrite" (parent branch version), "=keep" (your version) or "=merge" (solve it by hand). Repeatable.||||
|parentbranch|option|Name of the parent branch to backpromote from. Will be guessed or prompted if not provided.||||
|plan|boolean|Read-only: return what a backpromote would do (use with --json). Deploys, merges and writes nothing.||||
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
$ sf hardis:work:backpromote --parentbranch integration
```

```shell
$ sf hardis:work:backpromote --auto --exclude-metadata "Layout:Opportunity-Sales Layout" --skip-actions
```

```shell
$ sf hardis:work:backpromote --auto --on-conflict "force-app/main/default/classes/InvoiceCalculator.cls=overwrite"
```

```shell
$ sf hardis:work:backpromote --plan --json
```

```shell
$ sf hardis:work:backpromote --agent
```


