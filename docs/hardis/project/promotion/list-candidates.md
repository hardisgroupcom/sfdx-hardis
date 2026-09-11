<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:project:promotion:list-candidates

## Description

## Command Behavior

**Experimental feature.** Promotion branches are new and switched off by default; their behavior may still change from feedback.

**Lists the Pull Requests merged into a major branch (ex: uat) and not yet promoted to the next one (ex: preprod), so you can choose the ones a [promotion branch (experimental)](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-promotion-branches/) will carry.**

This is the read-only half of `sf hardis:project:promotion:create`: same configuration checks, same candidates, same rules about what is already on its way, but nothing is created, pushed or closed. Run it to know what can be promoted, then pass the numbers you picked to `hardis:project:promotion:create --pull-requests`.

The command:

- checks that `enablePromotionBranches: true` and `allowedPromotionSteps` are set, and keeps to the allowed steps: only those source and target branches are offered, and naming another one fails;
- lists the Pull Requests merged into the source branch since its merge base with the target branch, leaving out the merges between major branches and the promotion branches themselves (they carry other people's work, they are not User Stories);
- marks the ones another promotion branch already carries to the same target branch. They are left out of the candidates unless `--include-already-promoted` is passed, and always reported in the `alreadyPromoted` result;
- names the promotion Pull Request already open between the two branches, if any. It is left untouched: `hardis:project:promotion:create` is what closes it, once its replacement exists.

With `--json`, the result holds `candidates` (Pull Request numbers, title, author, source branch, commit, date), `alreadyPromoted`, and `openPromotions`.

<details markdown="1">
<summary>Technical explanations</summary>

- Candidates are the first-parent commits of `origin/<source>` since its merge base with `origin/<target>`, grouped with their Pull Requests like `hardis:work:backpromote` does (Pull Request numbers read from the merge commit messages and completed by the git provider API when a token is available).
- A promotion merged into the source branch is expanded into the User Stories its `promotionPullRequests` block declares, recursively, so a story promoted twice in a row keeps its number.
- A candidate can be a merge commit carrying several Pull Requests: they are listed together, because cherry-picking it carries all of them.
- Already-promoted detection reads the promotion Pull Requests of the target branch, bounded by the date of the oldest candidate. Without a git provider token, the check is skipped and said out loud.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:promotion:list-candidates --agent --source-branch uat --json
```

In agent mode:

- `--source-branch` is required; `--target-branch` defaults to the first merge target of the source branch allowed by `allowedPromotionSteps`.
- Nothing is prompted and nothing is written to git: the command only reads.

## Parameters

| Name                     |  Type   | Description                                                                                                                               | Default | Required | Options |
|:-------------------------|:-------:|:------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                    | boolean | Run in non-interactive mode for agents and automation                                                                                     |         |          |         |
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                                                                           |         |          |         |
| flags-dir                | option  | undefined                                                                                                                                 |         |          |         |
| include-already-promoted | boolean | Also list as candidates the Pull Requests another promotion branch already carries to the same target branch (reported apart by default). |         |          |         |
| json                     | boolean | Format output as json.                                                                                                                    |         |          |         |
| skipauth                 | boolean | Skip authentication check when a default username is required                                                                             |         |          |         |
| source-branch<br/>-s     | option  | Major branch the approved User Stories are merged into (ex: uat). Prompted if not provided, required in agent mode.                       |         |          |         |
| target-branch<br/>-t     | option  | Major branch the promotion goes to (ex: preprod). Defaults to the first merge target of the source branch.                                |         |          |         |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                 |         |          |         |

## Examples

```shell
$ sf hardis:project:promotion:list-candidates
```

```shell
$ sf hardis:project:promotion:list-candidates --source-branch uat
```

```shell
$ sf hardis:project:promotion:list-candidates --source-branch uat --target-branch preprod
```

```shell
$ sf hardis:project:promotion:list-candidates --agent --source-branch uat --json
```

```shell
$ sf hardis:project:promotion:list-candidates --agent --source-branch uat --include-already-promoted
```
