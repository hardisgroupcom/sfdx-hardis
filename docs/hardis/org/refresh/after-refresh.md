<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:refresh:after-refresh

## Description


## Command Behavior

**Restores all previously backed-up Connected Apps (including Consumer Secrets) to a Salesforce org after a sandbox refresh.**

This command is the second step in the sandbox refresh process. It scans the backup folder created before the refresh, allows selection of which Connected Apps to restore, and automates their deletion and redeployment to the refreshed org, ensuring all credentials and configuration are preserved.

Key functionalities:

- **Backup Folder Selection:** Prompts the user to select the correct backup folder for the sandbox instance.
- **Connected App Discovery:** Scans the backup for all Connected App metadata files.
- **User Selection:** Allows interactive or flag-based selection of which Connected Apps to restore.
- **Validation:** Ensures all selected apps exist in the backup and validates user input.
- **Org Cleanup:** Deletes existing Connected Apps from the refreshed org to allow clean redeployment.
- **Deployment:** Deploys the selected Connected Apps (with secrets) to the org.
- **Summary and Reporting:** Provides a summary of restored apps and their status.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is designed to be run after a sandbox refresh, using the backup created by the before-refresh command.

<details markdown="1">
<summary>Technical explanations</summary>

- **Backup Folder Handling:** Prompts for and validates the backup folder under `scripts/sandbox-refresh/`.
- **Metadata Scanning:** Uses glob patterns to find all `*.connectedApp - meta.xml` files in the backup.
- **Selection Logic:** Supports `--all`, `--name`, and interactive selection of apps to restore.
- **Validation:** Checks that all requested apps exist in the backup and provides clear errors if not.
- **Org Operations:** Deletes existing Connected Apps from the org before redeployment to avoid conflicts.
- **Deployment:** Uses utility functions to deploy Connected Apps and their secrets to the org.
- **Error Handling:** Handles and reports errors at each step, including parsing and deployment issues.

</details>


## Parameters

| Name              |  Type   | Description                                                                                                                 | Default | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| all<br/>-a        | boolean | If set, all Connected Apps from the local repository will be processed. Takes precedence over --name if both are specified. |         |          |         |
| flags-dir         | option  | undefined                                                                                                                   |         |          |         |
| json              | boolean | Format output as json.                                                                                                      |         |          |         |
| name<br/>-n       | option  | Connected App name(s) to process (bypasses selection prompt). For multiple apps, separate with commas (e.g., "App1,App2")   |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                               |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                                                   |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                   |         |          |         |

## Examples

```shell
$ sf hardis:org:refresh:after-refresh
```

```shell
$ sf hardis:org:refresh:after-refresh --name "MyConnectedApp" // Process specific app, no selection prompt
```

```shell
$ sf hardis:org:refresh:after-refresh --name "App1,App2,App3" // Process multiple apps, no selection prompt
```

```shell
$ sf hardis:org:refresh:after-refresh --all // Process all apps, no selection prompt
```

```shell
$ sf hardis:org:refresh:after-refresh --target-org myDevOrg
```


