<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:replacement:delete

## Description


## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Removes a replacement rule, or an override of a rule, from one place (project config, branch config file or git provider issue).**

Removing an override from the issue gives back the rule of the repository: this is how a temporary fix made in the issue is undone. Removing the override of a built-in rule turns it back to its default state.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:replacement:delete --agent --layer issue --id partner-site-admin
```

Required in agent mode: `--layer` (and `--branch` with `--layer branch`) and `--id`. The confirmation prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- Project and branch rules are rewritten with `js-yaml`, keeping every other key; the `replacementRules` key is removed when it becomes empty.
- Issue rules are the YAML block of the issue body; the issue itself is kept.
</details>


## Parameters

| Name         |  Type   | Description                                                                                                                                                     | Default | Required |           Options            |
|:-------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:----------------------------:|
| agent        | boolean | Run in non-interactive mode for agents and automation                                                                                                           |         |          |                              |
| branch       | option  | Major branch of the branch config file, with --layer branch                                                                                                     |         |          |                              |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                                                                                                 |         |          |                              |
| flags-dir    | option  | Import flag values from a directory.                                                                                                                            |         |          |                              |
| id           | option  | Id of the rule to remove                                                                                                                                        |         |          |                              |
| json         | boolean | Format output as json.                                                                                                                                          |         |          |                              |
| layer        | option  | Where the rule is stored: project (config/.sfdx-hardis.yml), branch (config/branches/.sfdx-hardis.<branch>.yml) or issue (git provider issue, no commit needed) |         |          | project<br/>branch<br/>issue |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                       |         |          |                              |

## Examples

```shell
$ sf hardis:project:replacement:delete
```

```shell
$ sf hardis:project:replacement:delete --agent --layer issue --id partner-site-admin
```

```shell
$ sf hardis:project:replacement:delete --agent --layer branch --branch uat --id uat-hide-case-actions
```


