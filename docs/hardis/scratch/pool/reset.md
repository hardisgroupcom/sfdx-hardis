<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:reset

## Description


## Command Behavior

**Resets the scratch org pool by deleting all existing scratch orgs within it.**

This command provides a way to clear out the entire scratch org pool, effectively starting fresh. This can be useful for:

- **Troubleshooting:** If the pool becomes corrupted or contains problematic scratch orgs.
- **Major Changes:** When there are significant changes to the scratch org definition or initialization process that require all existing orgs to be recreated.
- **Cleanup:** Periodically cleaning up the pool to ensure only the latest and most relevant scratch orgs are available.

Key functionalities:

- **Full Pool Deletion:** Identifies all scratch orgs currently in the pool and initiates their deletion.
- **Dev Hub Integration:** Works with your configured Dev Hub to manage the scratch orgs within the pool.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the `poolConfig` from the project's .sfdx-hardis.yml file to ensure a pool is configured.
- **Pool Storage Interaction:** It uses `getPoolStorage` to retrieve the current list of scratch orgs in the pool and `setPoolStorage` to clear the pool's record.
- **Scratch Org Deletion:** It iterates through each scratch org in the retrieved list. For each org, it authenticates to it using `authenticateWithSfdxUrlStore` and then executes `sf org delete scratch` via `execCommand`.
- **Logging:** Provides clear messages about the deletion process and the status of each scratch org.
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


