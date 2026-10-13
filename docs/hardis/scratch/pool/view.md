<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:view

## Description


## Command Behavior

**Displays information about the configured scratch org pool, including its current state and available scratch orgs.**

This command provides visibility into your scratch org pool, allowing you to monitor its health, check the number of available orgs, and verify its configuration. It's a useful tool for administrators and developers managing shared scratch org environments.

Key functionalities:

- **Pool Configuration Display:** Shows the `poolConfig` defined in your ".sfdx-hardis.yml" file, including the chosen storage service and the maximum number of scratch orgs.
- **Pool Content:** Lists the scratch orgs available in the pool (alias, username, expiration date), the last scratch orgs taken from it, the last failed creations and the scratch org limits of the Dev Hub.
- **Available Scratch Org Count:** Provides a summary of how many scratch orgs are currently available in the pool.
- **No credential in the output:** The result never contains the credentials of a scratch org. With the `gitProvider` storage, the counts are available even without the encryption key.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the `poolConfig` from the project's ".sfdx-hardis.yml" file using `getConfig`.
- **Pool Summary Retrieval:** It uses `getPoolSummary` to read the configured storage service (dashboard of the git provider, or Salesforce Custom Object on the Dev Hub) and build a summary of the pool.
- **JSON Output:** With `--json`, the `pool` property holds the summary read by the VS Code extension panel. `errorKind` is `noGitProvider` when the storage cannot be reached.
- **Data Display:** It logs the pool configuration and the available scratch orgs to the console in a human-readable format.
- **Error Handling:** It checks if a scratch org pool is configured for the project and provides a warning message if it's not (`errorKind` is then `noPool`). The Dev Hub is optional: when one is connected, its scratch org limits are read live.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:scratch:pool:view --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

| Name                  |  Type   | Description                                                   | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                 | boolean | Run in non-interactive mode for agents and automation         |         |          |         |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir             | option  | Import flag values from a directory.                          |         |          |         |
| json                  | boolean | Format output as json.                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required |         |          |         |
| target-dev-hub<br/>-v | option  | Username or alias of the Dev Hub org.                         |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:scratch:pool:view
```

```shell
$ sf hardis:scratch:pool:view --agent
```


