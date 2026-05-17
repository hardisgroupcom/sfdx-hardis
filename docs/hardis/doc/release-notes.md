<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:release-notes

## Description

Generate release notes for a Salesforce project release.

## Command Behavior

Collects data from multiple sources and generates a comprehensive release notes document:

- **Git Provider** (GitHub, GitLab, Azure DevOps, Bitbucket): merged pull requests, contributors
- **Ticket Provider** (JIRA, Azure Boards): ticket details, status, assignees
- **sfdx-git-delta**: metadata changes (created, updated, deleted)
- **Deployment Actions**: manual tasks and automated actions from PR comments
- **AI Provider** (optional): generates a structured summary of the release

Supports two modes:

- **prepare**: preview what will be included in the upcoming release (finds open PR or computes hypothetical delta). Accepts `--source-branch` to identify the source branch; if `--target-branch` is omitted, it is inferred from the source branch mergeTargets configuration. If neither source branch nor target branch can be determined, the user is prompted.
- **post**: document a completed release (uses merged PRs and tags)

Output includes a **Markdown report** (optionally converted to PDF), a **multi-tab XLSX** with detailed data, and an optional **notification** (Slack, Teams, etc.) for production releases in post mode.

The command can determine the release scope from git tags (semver), branch names, commit ranges, or date ranges.

This command is part of [sfdx-hardis Documentation](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

The command resolves the release scope using one of several strategies:

1. **Tag-based**: uses `git rev-list` to find commit SHAs for semver tags, auto-detects the previous tag via `git tag --sort=-v:refname`
2. **Branch-based**: uses `GitProvider.listPullRequestsInBranchSinceLastMerge()` or `GitProvider.findOpenPullRequest()` (prepare mode) with the major orgs configuration
3. **Date-based**: filters PRs by `minDate` / max date
4. **Commit-based**: uses explicit commit SHAs

Metadata changes are computed via `sfdx-git-delta` (`sf sgd:source:delta`), which generates `package.xml` (additions) and `destructiveChanges.xml` (deletions).

Deployment actions are loaded from PR comments (via the `<!-- sfdx-hardis deployment-actions-state -->` marker) or from `scripts/actions/.sfdx-hardis.{PR_ID}.yml` files.

Inter-major-branch PRs (e.g., integration to preprod) are excluded since they represent promotions, not user stories.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:release-notes --agent --mode post --target-branch main
```

In agent mode:

- All interactive prompts are skipped.
- `--mode` defaults to `post` when not provided.
- `--target-branch` defaults to the current git branch.
- When `--mode post` and `--target-branch` are provided without `--merge-commit`, the latest merge commit on the target branch is used automatically.
- When `--mode prepare` and `--source-branch` is provided without `--target-branch`, the target branch is inferred from the source branch mergeTargets configuration.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|from-date|option|Start date for the release scope (YYYY-MM-DD). Mutually exclusive with tag flags.||||
|json|boolean|Format output as json.||||
|merge-commit|option|Specific merge commit SHA to use as the end of the release scope||||
|mode<br/>-m|option|Release notes mode: prepare (preview upcoming release) or post (document completed release)|||prepare<br/>post|
|outputfile<br/>-f|option|Force the path and name of the output report file||||
|pdf|boolean|Generate the documentation in PDF format (enabled by default, use --no-pdf to skip)||||
|previous-tag|option|Previous git tag (semver). If omitted, auto-detected from existing tags.||||
|release-tag|option|Git tag for the release (semver, e.g. v1.2.0)||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|source-branch|option|Source branch name (e.g. integration, develop). In prepare mode, if --target-branch is not set, the target branch is inferred from this branch's mergeTargets configuration.||||
|source-commit|option|Source commit SHA to use as the start of the release scope||||
|target-branch<br/>-t|option|Target major branch name (e.g. main, production). If omitted, prompted or auto-detected.||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com.integci|||
|to-date|option|End date for the release scope (YYYY-MM-DD). Mutually exclusive with tag flags.||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:release-notes
```

```shell
$ sf hardis:doc:release-notes --mode post --release-tag v1.2.0
```

```shell
$ sf hardis:doc:release-notes --mode prepare --target-branch main
```

```shell
$ sf hardis:doc:release-notes --mode prepare --source-branch integration
```

```shell
$ sf hardis:doc:release-notes --mode post --target-branch main
```

```shell
$ sf hardis:doc:release-notes --mode post --target-branch main --no-pdf
```

```shell
$ sf hardis:doc:release-notes --mode post --from-date 2026-01-01 --to-date 2026-03-31
```

```shell
$ sf hardis:doc:release-notes --agent --mode post --target-branch main
```


