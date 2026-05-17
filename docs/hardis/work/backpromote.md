<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:backpromote

## Description


## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings the latest changes merged into a parent branch (e.g. integration) into the developer's feature branch and deploys them to their dev sandbox.**

This command automates the "backpromote" workflow, similar to what Copado provides. It allows developers to stay synchronized with changes made by other team members that have been merged into a shared branch.

Key functionalities:

- **Pre-flight checks:** Verifies the git working directory is clean (no unstaged or staged files) and that the feature branch is already up to date with the parent branch.
- **Scope selection:** Lists merged pull requests on the parent branch (grouped with their commits) and lets the user choose up to which PR to backpromote. Tracks the last backpromoted commit for incremental runs.
- **Delta computation:** Uses sfdx-git-delta to compute the metadata differences between the last backpromoted state and the selected target.
- **Org conflict detection:** Retrieves the same metadata from the org, compares with local files, and generates Excel and PDF conflict reports showing git-diff-style colored output.
- **Interactive validation:** Lets the user review and deselect metadata items before deployment. Destructive changes require explicit confirmation.
- **Deployment:** Deploys validated metadata to the dev sandbox with NoTestRun (or RunSpecifiedTests if PR test classes are configured).
- **Deployment actions:** Executes deployment actions from the selected PRs. For actions requiring a different user, attempts LoginAs authentication and falls back to a manual checklist with one-by-one validation.
- **State tracking:** Stores the last backpromoted commit and executed deployment actions in user config for future runs.

### Agent Mode

Use `--agent` to disable all interactive prompts. The command will:

- Use the configured `developmentBranch` as the parent branch
- If a previous backpromote state exists, auto-select only the next PR
- If no previous state, require `--from` flag (PR number or commit SHA) and select only the next PR from that point
- Deploy all metadata without interactive validation
- Auto-confirm destructive changes with a warning
- Log manual actions instead of prompting

Required flags: `--agent`, and `--from` if no previous backpromote state exists.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Integration:** Uses `simple-git` to verify branch status and list commits. Requires the branch to be clean and up to date with the parent branch before proceeding.
- **sfdx-git-delta:** Computes metadata deltas between git commits to identify changed metadata items.
- **Org Metadata Retrieval:** Uses `sf project retrieve start` with the delta package.xml to retrieve current org state for conflict detection.
- **Diff Library:** Uses the `diff` npm package to compute file-level differences between org and local metadata.
- **ExcelJS:** Generates Excel conflict reports via `generateCsvFile`.
- **md-to-pdf:** Converts markdown conflict reports to PDF using `generatePdfFileFromMarkdown`.
- **Deployment Actions:** Uses `ActionsProvider` to execute deployment actions, with `authOrg` for LoginAs authentication.
- **Configuration:** Stores backpromote state and deployment action history in user config via `setConfig('user', ...)`.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|from|option|PR number or commit SHA to start the backpromote from. Required in --agent mode when no previous backpromote state exists.||||
|json|boolean|Format output as json.||||
|parentbranch|option|Name of the parent branch to backpromote from. Will be guessed or prompted if not provided.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com.integci|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:work:backpromote
```

```shell
$ sf hardis:work:backpromote --parentbranch integration
```

```shell
$ sf hardis:work:backpromote --agent
```

```shell
$ sf hardis:work:backpromote --agent --from abc1234
```


