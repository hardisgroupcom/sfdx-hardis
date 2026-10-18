<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:replacement:preview

## Description


## Command Behavior

**Shows what the replacement rules would change in the local files for a deployment to a target org. Nothing is written.**

- `--target-branch` picks the major branch of the target org. Without it, the preview is the one of a dev sandbox or scratch org (`default` values).
- Built-in rules need the deployment API version of the target: `--api-version`, or `--target-org` to read it from the org, or the `org-api-version` sf config. Without any of them, built-in rules are skipped.
- Secrets are read from the environment like in a deployment job. Their values are never shown: a missing variable is reported with the names that were looked up.
- Every file of the package directories is checked, not only the files of a delta deployment.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

```sh
sf hardis:project:replacement:preview --agent --target-branch uat --api-version 67.0 --json
```

No prompt. Without `--target-branch`, the dev sandbox target is used.

<details markdown="1">
<summary>Technical explanations</summary>

- Runs the engine of the deployments (`applyReplacementRules`) with `write: false`.
- The result lists, for each file and rule: `changed`, `unchanged`, `not-found` or `risky-element` (an element a disabled built-in rule would remove), plus the warnings a Pull Request comment would show.
</details>


## Parameters

| Name              |  Type   | Description                                                             | Default | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                   |         |          |         |
| api-version       | option  | Deployment API version of the target org, for example 67.0              |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                         |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                    |         |          |         |
| json              | boolean | Format output as json.                                                  |         |          |         |
| target-branch     | option  | Major branch of the target org. Omitted: a dev sandbox or scratch org   |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org, to read its deployment API version |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration               |         |          |         |

## Examples

```shell
$ sf hardis:project:replacement:preview --target-branch uat
```

```shell
$ sf hardis:project:replacement:preview --agent --target-branch main --api-version 67.0 --json
```

```shell
$ sf hardis:project:replacement:preview --target-branch preprod --target-org my.user@example.com.preprod
```


