<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:reorder

## Description


## Command Behavior

**Reorders deployment actions in the project configuration.**

Supports two modes:

1. **Single move**: Move one action to a new position using `--action-id` and `--position`.
2. **Full reorder**: Provide the complete ordered list of action IDs using `--order` to rearrange all actions in a single call.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
# Single move
sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --action-id <uuid> --position 1

# Full reorder
sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --order "id1,id2,id3"
```

Required in agent mode:

- `--scope`, `--when`
- Either `--action-id` + `--position`, or `--order`

<details markdown="1">
<summary>Technical explanations</summary>

- For single move: removes the action from its current position and inserts at the new position (1-based, clamped to valid range).
- For full reorder: validates that the provided IDs match exactly the existing action IDs, then reorders.
</details>


## Parameters

| Name         |  Type   | Description                                                                 | Default | Required |          Options           |
|:-------------|:-------:|:----------------------------------------------------------------------------|:-------:|:--------:|:--------------------------:|
| action-id    | option  | ID of the action to move (single move mode)                                 |         |          |                            |
| agent        | boolean | Run in non-interactive mode for agents and automation                       |         |          |                            |
| branch       | option  | Target branch name (for branch scope, defaults to current branch)           |         |          |                            |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                             |         |          |                            |
| flags-dir    | option  | undefined                                                                   |         |          |                            |
| json         | boolean | Format output as json.                                                      |         |          |                            |
| order        | option  | Comma-separated list of all action IDs in desired order (full reorder mode) |         |          |                            |
| position     | option  | New 1-based position for the action (single move mode)                      |         |          |                            |
| pr-id        | option  | Pull request ID (for pr scope, defaults to draft)                           |         |          |                            |
| scope        | option  | Configuration scope: project, branch, or pr                                 |         |          | project<br/>branch<br/>pr  |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                   |         |          |                            |
| when         | option  | When to run the action: pre-deploy or post-deploy                           |         |          | pre-deploy<br/>post-deploy |

## Examples

```shell
$ sf hardis:project:action:reorder
```

```shell
$ sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --action-id abc-123 --position 1
```

```shell
$ sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --order "id1,id2,id3"
```


