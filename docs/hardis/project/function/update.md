<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:function:update

## Description


## Command Behavior

**Updates a custom function declared in the project configuration.**

Only the fields you pass are changed; everything else keeps its current value.

`--inputs` and `--outputs` **replace** the whole contract rather than merging into it, so a single flag fully describes the new shape. Pass an empty value to remove every input or output.

Changing the contract does not rewrite the deployment actions already using the function: an action that no longer matches (a missing required input, a value outside a `select` list) is reported by `hardis:project:action:list` and fails at deployment time with the reason.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:function:update --agent --id notifySlack --label "Notify the release channel" --timeout 1200
```

Required in agent mode: `--id`. Every other flag is optional, and every prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes `config/.sfdx-hardis.yml` with `js-yaml`, preserving every other key.
- Re-validates the whole definition after the merge, so an update cannot leave an invalid function behind.
- Renaming a function through `--new-id` is deliberately not supported: the id is the action type, and existing actions reference it.
</details>


## Parameters

| Name             |  Type   | Description                                                                           | Default | Required | Options |
|:-----------------|:-------:|:--------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent            | boolean | Run in non-interactive mode for agents and automation                                 |         |          |         |
| allowed-contexts | option  | New comma-separated execution contexts. Pass an empty value to remove the restriction |         |          |         |
| debug<br/>-d     | boolean | Activate debug mode (more logs)                                                       |         |          |         |
| description      | option  | New description                                                                       |         |          |         |
| flags-dir        | option  | undefined                                                                             |         |          |         |
| id               | option  | Id of the function to update                                                          |         |          |         |
|inputs|option|Replace the input contract: "name[:type][:required][|opt1,opt2][=default]" entries separated by ";". Empty value removes every input||||
|json|boolean|Format output as json.||||
|label|option|New label||||
|outputs|option|Replace the output contract: "name[:type]" entries separated by ";". Empty value removes every output||||
|runtime|option|New runtime: node, python or bash|||node<br/>python<br/>bash|
|script|option|New script path||||
|timeout|option|New maximum duration of a run, in seconds||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||
|when|option|Restrict the function to one deployment phase, or "any" to remove the restriction|||pre-deploy<br/>post-deploy<br/>any|

## Examples

```shell
$ sf hardis:project:function:update
```

```shell
$ sf hardis:project:function:update --agent --id notifySlack --label "Notify the release channel"
```

```shell
$ sf hardis:project:function:update --agent --id notifySlack --inputs "channel:string:required;severity:select|info,warning,critical=info"
```

```shell
$ sf hardis:project:function:update --agent --id notifySlack --timeout 1200 --when post-deploy
```


