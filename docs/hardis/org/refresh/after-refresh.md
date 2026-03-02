<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:refresh:after-refresh

## Description


## Command Behavior

**Restores all previously backed-up Connected Apps (including Consumer Secrets), certificates, custom settings, records and other metadata to a Salesforce org after a sandbox refresh.**

This command is the second step in the sandbox refresh process. It scans the backup folder created before the refresh, allows interactive or flag-driven selection of items to restore, and automates cleanup and redeployment to the refreshed org while preserving credentials and configuration.

Key functionalities:

- **Choose a backup to restore:** Lets you pick the saved sandbox project that contains the artifacts to restore.
- **Select which items to restore:** Finds Connected App XMLs, certificates, custom settings and other artifacts and lets you pick what to restore (or restore all).
- **Safety checks and validation:** Confirms files exist and prompts before making changes to the target org.
- **Prepare org for restore:** Optionally cleans up existing Connected Apps so saved apps can be re-deployed without conflict.
- **Redeploy saved artifacts:** Restores Connected Apps (with saved secrets), certificates, SAML SSO configs, custom settings and other metadata.
- **Handle SAML configs:** Cleans and updates SAML XML files and helps you choose certificates to wire into restored configs.
- **Restore records:** Optionally runs data import from selected SFDMU workspaces to restore record data.
- **Reporting & persistence:** Sends restore reports and can update project config to record what was restored.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is intended to be run after a sandbox refresh to re-apply saved metadata, credentials and data.

<details markdown="1">
<summary>Technical explanations</summary>

- **Backup Folder Handling:** Reads the immediate subfolders of `scripts/sandbox-refresh/` and validates the chosen project contains the expected `manifest/` and `force-app` layout.
- **Metadata & Deployment APIs:** Uses `sf project deploy start --manifest` for package-based deploys, `sf project deploy start --metadata-dir` for MDAPI artifacts (certificates), and utility functions for Connected App deployment that preserve consumer secrets.
- **SAML Handling:** Queries active certificates via tooling API, updates SAML XML files, and deploys using `sf project deploy start -m SamlSsoConfig`.
- **Records Handling:** Uses interactive selection of SFDMU workspaces and runs data import utilities to restore records.
- **Error Handling & Summary:** Aggregates results, logs success/warnings/errors, and returns a structured result indicating which items were restored and any failures.

</details>


## Parameters

| Name              |  Type   | Description                                                                                                                 |                Default                 | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------|:--------------------------------------:|:--------:|:-------:|
| all<br/>-a        | boolean | If set, all Connected Apps from the local repository will be processed. Takes precedence over --name if both are specified. |                                        |          |         |
| flags-dir         | option  | undefined                                                                                                                   |                                        |          |         |
| json              | boolean | Format output as json.                                                                                                      |                                        |          |         |
| name<br/>-n       | option  | Connected App name(s) to process (bypasses selection prompt). For multiple apps, separate with commas (e.g., "App1,App2")   |                                        |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                               |                                        |          |         |
| target-org<br/>-o | option  | undefined                                                                                                                   | nicolas.vuillamy@cloudity.com.afterftd |          |         |
| websocket         | option  | WebSocket host:port for VS Code SFDX Hardis UI integration                                                                  |                                        |          |         |

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


