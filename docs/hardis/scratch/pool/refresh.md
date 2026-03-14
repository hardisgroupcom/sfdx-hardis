<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:refresh

## Description

## Command Behavior

**Refreshes a scratch org pool by creating new scratch orgs to fill the pool and deleting expired ones.**

This command is designed to maintain a healthy and adequately sized scratch org pool, ensuring that developers and CI/CD pipelines always have access to ready-to-use scratch orgs. It automates the lifecycle management of scratch orgs within the pool.

Key functionalities:

- **Expired Org Cleanup:** Identifies and deletes scratch orgs from the pool that are nearing their expiration date (configurable via `minScratchOrgRemainingDays` in `.sfdx-hardis.yml`).
- **Pool Replenishment:** Creates new scratch orgs to replace expired ones and to reach the `maxScratchOrgsNumber` defined in the pool configuration.
- **Parallel Creation:** New scratch orgs are created in parallel using child processes, optimizing the replenishment process.
- **Authentication Handling:** Authenticates to scratch orgs before deletion or creation, ensuring proper access.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the `poolConfig` from the project's `.sfdx-hardis.yml` file to get parameters like `maxScratchOrgsNumber`, `maxScratchOrgsNumberToCreateOnce`, and `minScratchOrgRemainingDays`.
- **Pool Storage Interaction:** It uses `getPoolStorage` and `setPoolStorage` to interact with the configured storage service (e.g., Salesforce Custom Object, Redis) to retrieve and update the list of scratch orgs in the pool.
- **Expiration Check:** It calculates the remaining days for each scratch org in the pool using moment and flags those below the `minScratchOrgRemainingDays` threshold for deletion.
- **Scratch Org Deletion:** For expired orgs, it authenticates to them using `authenticateWithSfdxUrlStore` and then executes `sf org delete scratch` via `execCommand`.
- **Scratch Org Creation:** To replenish the pool, it spawns new child processes that run the `sf hardis:scratch:create --pool` command. This allows for parallel creation of multiple scratch orgs.
- **Error Handling:** It includes error handling for scratch org creation failures, logging them and updating the pool storage accordingly.
- **Logging:** Provides detailed logs about the status of scratch orgs (kept, deleted, created, failed creations) and a summary of the refresh operation.
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
$ sf hardis:scratch:pool:refresh
```


