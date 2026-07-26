<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:link-pull-request

## Description


## Command Behavior

**Renames the draft deployment actions file to associate it with a specific pull request.**

When deployment actions are created with PR scope but no `--pr-id`, they are stored in a draft file (`scripts/actions/.sfdx-hardis.draft.yml`). This command renames that file to match a pull request ID, so the actions will be picked up during CI/CD deployments for that PR.

If `--pr-id` is set to `current`, the command will attempt to detect the pull request associated with the current git branch.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:link-pull-request --agent --pr-id 123
sf hardis:project:action:link-pull-request --agent --pr-id current
```

Required in agent mode:

- `--pr-id`

<details markdown="1">
<summary>Technical explanations</summary>

- Renames `scripts/actions/.sfdx-hardis.draft.yml` to `scripts/actions/.sfdx-hardis.<prId>.yml`.
- Fails if the draft file does not exist or if the target file already exists.
- When `--pr-id current` is used, resolves the PR ID from the current branch via GitProvider.
</details>


## Parameters

| Name         |  Type   | Description                                                                  | Default | Required | Options |
|:-------------|:-------:|:-----------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent        | boolean | Run in non-interactive mode for agents and automation                        |         |          |         |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                              |         |          |         |
| flags-dir    | option  | undefined                                                                    |         |          |         |
| json         | boolean | Format output as json.                                                       |         |          |         |
| pr-id        | option  | Pull request ID to link, or "current" to auto-detect from the current branch |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                    |         |          |         |

## Examples

```shell
$ sf hardis:project:action:link-pull-request
```

```shell
$ sf hardis:project:action:link-pull-request --pr-id 123
```

```shell
$ sf hardis:project:action:link-pull-request --agent --pr-id current
```


