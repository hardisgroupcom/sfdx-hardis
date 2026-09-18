<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:function:delete

## Description


## Command Behavior

**Removes a custom function from the project configuration.**

Before deleting, the command scans the project config, every branch config and every Pull Request action file for deployment actions still using the function as their `type`. Those actions would fail at deployment time with an unknown type, so:

- Interactively, the usages are listed and confirmation is asked.
- In agent mode, the deletion is **refused** unless `--force` is passed.

The script file itself is never deleted: it is an ordinary file of your repository, and it may be shared or kept for reference.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:function:delete --agent --id notifySlack
```

Required in agent mode: `--id`. Add `--force` to delete a function that deployment actions still reference.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes `config/.sfdx-hardis.yml` with `js-yaml`, preserving every other key.
- Usage scan covers `config/.sfdx-hardis.yml`, `config/branches/*.yml` and `scripts/actions/*.yml`.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|force|boolean|Delete even when deployment actions still use this function||||
|id|option|Id of the function to delete||||
|json|boolean|Format output as json.||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:function:delete
```

```shell
$ sf hardis:project:function:delete --agent --id notifySlack
```

```shell
$ sf hardis:project:function:delete --agent --id notifySlack --force
```


