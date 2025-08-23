<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:refresh:before-refresh

## Description


## Command Behavior

**Backs up all Connected Apps, their secrets, certificates, and custom settings from a Salesforce org before a sandbox refresh, enabling full restoration after the refresh.**

This command is essential for Salesforce sandbox refresh operations where Connected Apps (and their Consumer Secrets), certificates, and custom settings would otherwise be lost. It automates the extraction, secure storage, and (optionally) deletion of Connected Apps, ensuring that all credentials and configuration can be restored post-refresh.

Key functionalities:

- **Connected App Discovery:** Lists all Connected Apps in the org, with options to filter by name, process all, or interactively select.
- **User Selection:** Allows interactive or flag-based selection of which Connected Apps to back up.
- **Metadata Retrieval:** Retrieves Connected App metadata and saves it in a dedicated project folder for the sandbox instance.
- **Consumer Secret Extraction:** Attempts to extract Consumer Secrets automatically using browser automation (Puppeteer), or prompts for manual entry if automation fails.
- **Config Persistence:** Stores the list of selected apps in the project config for use during restoration.
- **Optional Deletion:** Can delete the Connected Apps from the org after backup, as required for re-upload after refresh.
- **Certificate Backup:** Retrieves all org certificates and their definitions, saving them for later restoration.
- **Custom Settings Backup:** Lists all custom settings in the org, allows user selection, and exports their data to JSON files for backup.
- **Summary and Reporting:** Provides a summary of actions, including which apps, certificates, and custom settings were saved and whether secrets were captured.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is designed to be run before a sandbox refresh. It ensures that all Connected Apps, secrets, certificates, and custom settings are safely stored for later restoration.

<details markdown="1">
<summary>Technical explanations</summary>

- **Salesforce CLI Integration:** Uses `sf org list metadata`, `sf project retrieve start`, and other CLI commands to discover and retrieve Connected Apps, certificates, and custom settings.
- **Metadata Handling:** Saves Connected App XML files and certificate files in a dedicated folder under `scripts/sandbox-refresh/<sandbox-folder>`.
- **Consumer Secret Handling:** Uses Puppeteer to automate browser login and extraction of Consumer Secrets, falling back to manual prompts if needed.
- **Custom Settings Handling:** Lists all custom settings, allows user selection, and exports their data using `sf data tree export` to JSON files.
- **Config Management:** Updates `config/.sfdx-hardis.yml` with the list of selected apps for later use.
- **Deletion Logic:** Optionally deletes Connected Apps from the org (required for re-upload after refresh), with user confirmation unless running in CI or with `--delete` flag.
- **Error Handling:** Provides detailed error messages and guidance if retrieval or extraction fails.
- **Reporting:** Sends summary and configuration files to the WebSocket client for reporting and traceability.

</details>


## Parameters

| Name              |  Type   | Description                                                                                                                                                                       | Default | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| all<br/>-a        | boolean | If set, all Connected Apps from the org will be processed. Takes precedence over --name if both are specified.                                                                    |         |          |         |
| delete<br/>-d     | boolean | By default, Connected Apps are not deleted from the org after saving. Set this flag to force their deletion so they will be able to be reuploaded again after refreshing the org. |         |          |         |
| flags-dir         | option  | undefined                                                                                                                                                                         |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                                            |         |          |         |
| name<br/>-n       | option  | Connected App name(s) to process. For multiple apps, separate with commas (e.g., "App1,App2")                                                                                     |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                     |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                                                                                                         |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                         |         |          |         |

## Examples

```shell
$ sf hardis:org:refresh:before-refresh
```

```shell
$ sf hardis:org:refresh:before-refresh --name "MyConnectedApp"
```

```shell
$ sf hardis:org:refresh:before-refresh --name "App1,App2,App3"
```

```shell
$ sf hardis:org:refresh:before-refresh --all
```

```shell
$ sf hardis:org:refresh:before-refresh --delete
```


