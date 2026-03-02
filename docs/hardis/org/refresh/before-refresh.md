<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:refresh:before-refresh

## Description


## Command Behavior

**Backs up all Connected Apps (including Consumer Secrets), certificates, custom settings, records and other metadata from a Salesforce org before a sandbox refresh, enabling full restoration after the refresh.**

This command prepares a complete backup prior to a sandbox refresh. It creates a dedicated project under `scripts/sandbox-refresh/<sandbox-folder>`, retrieves metadata and data, attempts to capture Connected App consumer secrets, and can optionally delete the apps so they can be reuploaded after the refresh.

Key functionalities:

- **Create a save project:** Generates a dedicated project folder to store all artifacts for the sandbox backup.
- **Find and select Connected Apps:** Lists Connected Apps in the org and lets you pick specific apps, use a name filter, or process all apps.
- **Save metadata for restore:** Builds a manifest and retrieves the metadata types you choose so they can be restored after the refresh.
- **Capture Consumer Secrets:** Attempts to capture Connected App consumer secrets automatically (opens a browser session when possible) and falls back to a short manual prompt when needed.
- **Collect certificates:** Saves certificate files and their definitions so they can be redeployed later.
- **Export custom settings & records:** Lets you pick custom settings to export as JSON and optionally export records using configured data workspaces.
- **Persist choices & report:** Stores your backup choices in project config and sends report files for traceability.
- **Optional cleanup:** Can delete backed-up Connected Apps from the org so they can be re-uploaded cleanly after the refresh.
- **Interactive safety checks:** Prompts you to confirm package contents and other potentially destructive actions; sensible defaults are chosen where appropriate.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is intended to be run before a sandbox refresh so that all credentials, certificates, metadata and data can be restored afterwards.

<details markdown="1">
<summary>Technical explanations</summary>

- **Salesforce CLI Integration:** Uses `sf org list metadata`, `sf project retrieve start`, `sf project generate`, `sf project deploy start`, and `sf data tree export`/`import` where applicable.
- **Metadata Handling:** Writes and reads package XML files under the generated project (`manifest/`), copies MDAPI certificate artifacts into `force-app/main/default/certs`, and produces `package-metadata-to-restore.xml` for post-refresh deployment.
- **Consumer Secret Handling:** Uses `puppeteer-core` with an executable path from `getChromeExecutablePath()` (env var `PUPPETEER_EXECUTABLE_PATH` may be required). Falls back to manual prompt when browser automation cannot be used.
- **Data & Records:** Exports custom settings to JSON and supports exporting records through SFDMU workspaces chosen interactively.
- **Config & Reporting:** Updates project/user config under `config/.sfdx-hardis.yml#refreshSandboxConfig` and reports artifacts to the WebSocket client.
- **Error Handling:** Provides clear error messages and a summary response object indicating success/failure and which secrets were captured.

</details>


## Parameters

| Name              |  Type   | Description                                                                                                                                                                       |                Default                 | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:--------------------------------------:|:--------:|:-------:|
| all<br/>-a        | boolean | If set, all Connected Apps from the org will be processed. Takes precedence over --name if both are specified.                                                                    |                                        |          |         |
| delete<br/>-d     | boolean | By default, Connected Apps are not deleted from the org after saving. Set this flag to force their deletion so they will be able to be reuploaded again after refreshing the org. |                                        |          |         |
| flags-dir         | option  | undefined                                                                                                                                                                         |                                        |          |         |
| json              | boolean | Format output as json.                                                                                                                                                            |                                        |          |         |
| name<br/>-n       | option  | Connected App name(s) to process. For multiple apps, separate with commas (e.g., "App1,App2")                                                                                     |                                        |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                     |                                        |          |         |
| target-org<br/>-o | option  | undefined                                                                                                                                                                         | nicolas.vuillamy@cloudity.com.afterftd |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                         |                                        |          |         |

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


