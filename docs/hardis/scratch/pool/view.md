<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:view

## Description


## Command Behavior

**Displays information about the configured scratch org pool, including its current state and available scratch orgs.**

This command provides visibility into your scratch org pool, allowing you to monitor its health, check the number of available orgs, and verify its configuration. It's a useful tool for administrators and developers managing shared scratch org environments.

Key functionalities:

- **Pool Configuration Display:** Shows the `poolConfig` defined in your ".sfdx-hardis.yml" file, including the chosen storage service and the maximum number of scratch orgs.
- **Pool Storage Content:** Displays the raw content of the pool storage, which includes details about each scratch org in the pool (e.g., alias, username, expiration date).
- **Available Scratch Org Count:** Provides a summary of how many scratch orgs are currently available in the pool.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the `poolConfig` from the project's ".sfdx-hardis.yml" file using `getConfig`.
- **Pool Storage Retrieval:** It uses `getPoolStorage` to connect to the configured storage service (e.g., Salesforce Custom Object, Redis) and retrieve the current state of the scratch org pool.
- **Data Display:** It logs the retrieved pool configuration and pool storage content to the console in a human-readable format.
- **Error Handling:** It checks if a scratch org pool is configured for the project and provides a warning message if it's not.
</details>


## Parameters

| Name                  |  Type   | Description                                                   | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir             | option  | undefined                                                     |         |          |         |
| json                  | boolean | Format output as json.                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                     |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:scratch:pool:view
```


