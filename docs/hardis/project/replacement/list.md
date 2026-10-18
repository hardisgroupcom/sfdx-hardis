<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:replacement:list

## Description


## Command Behavior

**Lists the replacement rules of the project: the rules of every place, the effective rules of every target org, and the built-in rules.**

Read-only. With `--json`, the result holds:

- `definitions`: every rule as stored, with its place (`project`, `branch`, `issue`) and the lower places it changes.
- `effective`: for each major branch, and `default` (dev sandboxes and scratch orgs), the rules after the merge of the places, whether they apply, and where their value comes from. Secrets only show the CI/CD variable names they are read from, never a value.
- `builtInRules`: the elements removed according to the deployment API version of the target org, and their state.
- `layers`, `majorBranches`, `secretLookups`, `issues` (invalid rules).

The VS Code Replacement Rules panel reads this result.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

```sh
sf hardis:project:replacement:list --agent --json
```

No prompt: the command is read-only. `--skip-issue` avoids the call to the git provider.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads `config/.sfdx-hardis.yml`, every `config/branches/.sfdx-hardis.*.yml` and the YAML block of the "sfdx-hardis Replacement Rules" issue of the git provider.
- The merge is the one of the deployments (`mergeReplacementRules`): built-in, project, branch file of the target, issue.
</details>


## Parameters

| Name          |  Type   | Description                                               | Default | Required | Options |
|:--------------|:-------:|:----------------------------------------------------------|:-------:|:--------:|:-------:|
| agent         | boolean | Run in non-interactive mode for agents and automation     |         |          |         |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                           |         |          |         |
| flags-dir     | option  | Import flag values from a directory.                      |         |          |         |
| json          | boolean | Format output as json.                                    |         |          |         |
| skip-issue    | boolean | Do not read the rules of the git provider issue           |         |          |         |
| target-branch | option  | Only compute the effective rules of this major branch     |         |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration |         |          |         |

## Examples

```shell
$ sf hardis:project:replacement:list
```

```shell
$ sf hardis:project:replacement:list --agent --json
```

```shell
$ sf hardis:project:replacement:list --target-branch uat --json
```


