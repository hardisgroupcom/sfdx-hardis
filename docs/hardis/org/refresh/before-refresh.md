<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:refresh:before-refresh

## Description


## Command Behavior

> **This command must always be run by a human. It is intentionally interactive and must not be called by an AI agent.**

**Backs up all Connected Apps (including Consumer Secrets), External Client Apps (including credentials), certificates, custom settings, records and other metadata from a Salesforce org before a sandbox refresh, enabling full restoration after the refresh.**

This command prepares a complete backup prior to a sandbox refresh. It creates a dedicated project under `scripts/sandbox-refresh/<sandbox-folder>`, retrieves metadata and data, attempts to capture Connected App and External Client App consumer secrets, and can optionally delete the apps so they can be reuploaded after the refresh.

Key functionalities:

- **Create a save project:** Generates a dedicated project folder to store all artifacts for the sandbox backup. When a backup folder already exists for the sandbox, you choose between continuing with it or restarting from scratch (the existing folder is then deleted, after an explicit confirmation).
- **Check Connected Apps conversion:** Since Spring '26, Connected Apps can not be re-created after a refresh (unless Salesforce Support enables it via a Case), while External Client Apps can be restored with their credentials. The command lists the Connected Apps that have no matching External Client App, warns that they will probably be lost, and pauses so you can convert them in Setup (App Manager). Once you confirm the conversion, the newly converted External Client Apps are saved like the others. Vendor-owned apps (whose metadata belongs to the app vendor's org, like OwnBackup or Microsoft Power Platform) can not be converted: they are excluded from this list and handled by the manual actions inventory.
- **Save External Client Apps:** Retrieves all External Client App metadata (ExternalClientApplication, ExtlClntAppOauthSettings, ExtlClntAppGlobalOauthSettings, ExtlClntAppOauthConfigurablePolicies, ExtlClntAppConfigurablePolicies), verifies that credentials (Consumer Key & Consumer Secret) are present in the retrieved Global OAuth settings, attempts to extract missing Consumer Secrets automatically via OAuth Credentials REST API or prompts for manual entry, and optionally deletes External Client Apps from the org so they can be recreated with the same credentials after the refresh.
- **Find and select Connected Apps (discouraged):** Lists Connected Apps in the org and lets you pick specific apps, use a name filter, or process all apps. Saving them is discouraged (declined by default) since they can not be restored after the refresh without a Salesforce Case: convert them to External Client Apps instead.
- **Save metadata for restore:** Builds a manifest and retrieves the metadata types you choose so they can be restored after the refresh.
- **Capture Consumer Secrets:** Attempts to capture Connected App consumer secrets automatically (opens a browser session when possible) and falls back to a short manual prompt when needed.
- **Collect certificates:** Saves certificate files and their definitions so they can be redeployed later.
- **Inventory manual actions:** Detects everything that can NOT be restored automatically and saves it in a `manual-restore-inventory.json` file: external OAuth authentications (apps like OwnBackup or Microsoft Power Platform authorized via "Log in with Salesforce", whose metadata belongs to the vendor org), Auth Providers, Named & External Credentials (their secrets are never included in metadata), and active scheduled jobs (deactivated by a refresh). The inventory is also exported as `manual-restore-inventory.csv` and `xls/manual-restore-inventory.xlsx` for human reading, and one Apex script per user is generated in `apex-scripts/` to reschedule the Scheduled Apex jobs with their original owners. The after-refresh command turns this file into a manual actions checklist.
- **Export custom settings & records:** Lets you pick custom settings to export as JSON and optionally export records using configured data workspaces.
- **Persist choices & report:** Stores your backup choices in project config and sends report files for traceability.
- **Optional cleanup:** Can delete backed-up Connected Apps and External Client Apps from the org so they can be re-uploaded cleanly after the refresh.
- **Interactive safety checks:** Prompts you to confirm package contents and other potentially destructive actions; sensible defaults are chosen where appropriate.

This command is part of [sfdx-hardis Sandbox Refresh](https://sfdx-hardis.cloudity.com/salesforce-sandbox-refresh/) and is intended to be run before a sandbox refresh so that all credentials, certificates, metadata and data can be restored afterwards.

<iframe width="560" height="315" src="https://www.youtube.com/embed/cMzzWDIARbo" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

- **Salesforce CLI Integration:** Uses `sf org list metadata`, `sf project retrieve start`, `sf project generate`, `sf project deploy start`, and `sf data tree export`/`import` where applicable.
- **Metadata Handling:** Writes and reads package XML files under the generated project (`manifest/`), copies MDAPI certificate artifacts into `force-app/main/default/certs`, and produces `package-metadata-to-restore.xml` for post-refresh deployment.
- **External Client App Handling:** Retrieves all 5 ECA metadata types, scans `extlClntAppGlobalOauthSets/` files for credentials (`consumerKey`, `consumerSecret`), extracts missing secrets via OAuth Credentials REST API or manual input, writes them back into the XML files, and deletes ECAs from the org using destructive changes so they can be recreated after refresh.
- **Consumer Secret Handling:** Uses `puppeteer-core` with an executable path from `getChromeExecutablePath()` (env var `PUPPETEER_EXECUTABLE_PATH` may be required) for Connected Apps. Falls back to manual prompt when browser automation cannot be used.
- **Data & Records:** Exports custom settings to JSON and supports exporting records through SFDMU workspaces chosen interactively.
- **Manual Actions Inventory:** Connected Apps listed by the Metadata API but not retrievable (owned by an external org) are excluded from the save instead of failing the command, and inventoried through SOQL queries on `ConnectedApplication` and `OauthToken` (aggregated client-side by app, with users and last used date). Auth Providers, External Credentials, Named Credentials (SOQL + Tooling API) and active `CronTrigger` jobs complete the inventory, stored as `manual-restore-inventory.json` in the save project.
- **Config & Reporting:** Updates project/user config under `config/.sfdx-hardis.yml#refreshSandboxConfig` and reports artifacts to the WebSocket client.
- **Error Handling:** Provides clear error messages and a summary response object indicating success/failure and which secrets were captured.

</details>


## Parameters

| Name              |  Type   | Description                                                                                                                                                                       | Default | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| all<br/>-a        | boolean | If set, all Connected Apps from the org will be processed. Takes precedence over --name if both are specified.                                                                    |         |          |         |
| delete<br/>-d     | boolean | By default, Connected Apps are not deleted from the org after saving. Set this flag to force their deletion so they will be able to be reuploaded again after refreshing the org. |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                                                                                              |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                                            |         |          |         |
| name<br/>-n       | option  | Connected App name(s) to process. For multiple apps, separate with commas (e.g., "App1,App2")                                                                                     |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                     |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set.                                                                      |         |   true   |         |
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


