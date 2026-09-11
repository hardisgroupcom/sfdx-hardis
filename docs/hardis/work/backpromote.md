<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:backpromote

## Description


## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings the changes merged into a parent branch (e.g. integration) into the developer's own org: a developer sandbox or a scratch org.**

Developers stay in sync with what their teammates merged, without waiting for a new sandbox. In VS Code, the **Backpromote (Beta)** panel of the sfdx-hardis extension shows everything on one page and runs this same command with the choices made in the panel.

Key functionalities:

- **Connected to the git provider:** the history of what each developer org received is kept in Pull Request comments, shared by every developer and machine, and nothing is stored locally. The command refuses to run until sfdx-hardis is connected to GitHub, GitLab, Azure DevOps or Bitbucket.
- **Developer orgs only:** the target org must be a developer sandbox or a scratch org. A production org, or the org of a major branch declared in `config/branches`, is refused: the CI/CD pipeline deploys those.
- **Pre-flight checks:** the git working directory must be clean, the current branch must be a User Story branch (not a major branch, a promotion branch or a retrofit branch), the parent branch must be a major branch, and the current branch must already contain the latest commit of the parent branch.
- **Pull Request selection:** the Pull Requests merged in the parent branch after the last one backpromoted to this org are listed (use `--from` to list older ones), and each one can be selected or left out. An item also changed by a Pull Request left out is deployed with that change too, since the deployment reads the files of the branch: the command warns about it.
- **History per org:** a Pull Request deployed into an org is recorded in a comment of that Pull Request with the Salesforce Organization Id, the date, the merge commit and the result of its deployment actions. A refreshed sandbox is a new org and starts with nothing backpromoted.
- **Delta computation:** sfdx-git-delta computes what each selected Pull Request deploys and deletes.
- **Org conflict detection:** the same metadata is retrieved from the org and compared with the local files, with Excel and PDF reports and VS Code diffs.
- **Items changed in the org:** each one is deployed by default, can be kept as it is in the org, or merged. A merge writes a three-way merge with git conflict markers into the local file, opens it in VS Code, and saves a prompt to paste into a coding agent (Claude Code, GitHub Copilot...) to solve it. The solved file is then deployed as it is, and is to be committed with the User Story.
- **Deletions:** listed and confirmed. Declining really skips them.
- **Deployment:** NoTestRun, or RunSpecifiedTests when the selected Pull Requests declare test classes.
- **Deployment actions:** the actions of the selected Pull Requests run before and after the deployment, skipping those already run in this org. Actions requiring another user try LoginAs, then fall back to a manual checklist.

### Explicit selection

As soon as `--pull-requests`, `--commits` or `--to` is passed, the command asks nothing about what to deploy: every item of the selection is deployed and every deletion applied, unless `--exclude-metadata` or `--skip-destructive` says otherwise, and the actions not already run in this org are executed, unless `--actions` or `--skip-actions` says otherwise. This is how the VS Code panel runs the command.

### Plan and merge (read-only modes)

- `--plan --json` returns the checks, the listed Pull Requests with what each one deploys and where it was already backpromoted, the items changed in the org, the deletions and the deployment actions. It deploys nothing and writes nothing.
- `--prepare-merge Type:Name` writes the three-way merge of these items into the local files and returns the coding agent prompt. Run the command again with `--merged-metadata Type:Name` once the conflicts are solved.

### Agent Mode

Use `--agent` to disable all interactive prompts. The command will:

- Use the configured `developmentBranch` (or the branch the feature branch was created from) as the parent branch
- Without selection flags, select only the oldest Pull Request not yet backpromoted to the org
- With `--pull-requests`, `--commits` or `--to`, deploy exactly that selection
- Deploy every item without interactive validation, apart from `--exclude-metadata`
- Auto-confirm destructive changes with a warning, unless `--skip-destructive`
- Log manual actions instead of prompting

Required: a git provider token in the environment (`GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `AZURE_DEVOPS_EXT_PAT` or `CI_SFDX_HARDIS_BITBUCKET_TOKEN`).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git provider:** `GitProvider.getInstance()` then a merged Pull Request listing checks the connection. The history is one comment per Pull Request, found by the `<!-- sfdx-hardis backpromote-state -->` marker; each table row carries its record as encoded JSON in a hidden marker, and is merged with the comment's current content before every write.
- **Target org check:** queries `Organization.Id`, `IsSandbox` and `TrialExpirationDate`, and compares the username and instance URL with the major orgs of `config/branches`.
- **Git Integration:** Uses `simple-git` to verify branch status, list the first-parent commits of `origin/<parent branch>` and group the Pull Requests each one brought in. The listing stops at the newest group already backpromoted to the org.
- **sfdx-git-delta:** Computes the delta of each selected first-parent commit against its first parent, one run at a time, and unions them. The last commit touching an item decides whether it is deployed or deleted.
- **Org Metadata Retrieval:** Uses `sf project retrieve start` with the delta package.xml to retrieve current org state for conflict detection.
- **Diff Library:** Uses the `diff` npm package to compute file-level differences between org and local metadata.
- **Merge:** `git merge-file --diff3` between the org file, the file before the selection and the incoming file.
- **ExcelJS:** Generates Excel conflict reports via `generateCsvFile`.
- **md-to-pdf:** Converts markdown conflict reports to PDF using `generatePdfFileFromMarkdown`.
- **Deployment Actions:** Uses `ActionsProvider` to execute deployment actions, with `authOrg` for LoginAs authentication.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|actions|option|Comma-separated ids of the deployment actions to run. Default: the actions not already run in this org.||||
|agent|boolean|Run in non-interactive mode for agents and automation||||
|commits|option|Comma-separated SHAs of the parent branch commits to backpromote (for merges without a Pull Request number). Asks nothing about what to deploy.||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|exclude-metadata|option|Type:Name of an item not to deploy nor delete, for example "Layout:Account-Account Layout". Repeatable.||||
|flags-dir|option|undefined||||
|from|option|PR number or commit SHA: list the Pull Requests merged after it, instead of those merged after the last one backpromoted to the org.||||
|json|boolean|Format output as json.||||
|merged-metadata|option|Type:Name of an item whose local file holds a solved merge (see --prepare-merge): deploy it as it is. Repeatable.||||
|parentbranch|option|Name of the parent branch to backpromote from. Will be guessed or prompted if not provided.||||
|plan|boolean|Read-only: return what a backpromote would do (use with --json). Deploys and writes nothing.||||
|prepare-merge|option|Type:Name of an item changed both in the org and in the parent branch: write the three-way merge into the local file, return the coding agent prompt, and exit. Repeatable.||||
|pull-requests|option|Comma-separated numbers of the Pull Requests to backpromote. Asks nothing about what to deploy.||||
|skip-actions|boolean|Run no deployment action.||||
|skip-destructive|boolean|Do not delete anything from the org.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|to|option|PR number or commit SHA: select every Pull Request not yet backpromoted up to this one (included).||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:work:backpromote
```

```shell
$ sf hardis:work:backpromote --parentbranch integration
```

```shell
$ sf hardis:work:backpromote --pull-requests 478,481,487
```

```shell
$ sf hardis:work:backpromote --pull-requests 482 --exclude-metadata "Layout:Opportunity-Sales Layout" --skip-actions
```

```shell
$ sf hardis:work:backpromote --plan --json
```

```shell
$ sf hardis:work:backpromote --plan --from abc1234 --json
```

```shell
$ sf hardis:work:backpromote --pull-requests 482 --prepare-merge Flow:Quote_Approval --json
```

```shell
$ sf hardis:work:backpromote --pull-requests 482 --merged-metadata Flow:Quote_Approval
```

```shell
$ sf hardis:work:backpromote --agent
```


