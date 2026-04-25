<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:create

## Description


## Command Behavior

**Creates and initializes a Salesforce sandbox org.**

This command automates the process of provisioning a new sandbox environment, making it ready for development or testing. It handles various aspects of sandbox creation and initial setup, reducing manual effort and ensuring consistency.

Key functionalities:

- **Sandbox Definition:** Uses a `project-sandbox-def.json` file (if present in `config/`) to define sandbox properties like name, description, license type, and source sandbox. If not provided, it uses default values.
- **Dynamic Naming:** Generates a unique sandbox alias based on the current username, Git branch, and a timestamp.
- **Sandbox Creation:** Executes the Salesforce CLI command to create the sandbox, including setting it as the default org and waiting for its completion.
- **User Update:** Updates the main sandbox user's details (e.g., Last Name, First Name) and can fix country values or marketing user permissions if needed.
- **Initialization Scripts:** Runs predefined Apex scripts, assigns permission sets, and imports initial data into the newly created sandbox, based on configurations in your project.
- **Error Handling:** Provides detailed error messages for common sandbox creation issues, including Salesforce-specific errors.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It loads project and user configurations using `getConfig` to retrieve settings like `projectName`, `devHubAlias`, and `userEmail`.
- **Git Integration:** Retrieves the current Git branch name using `getCurrentGitBranch` to inform sandbox naming.
- **File System Operations:** Uses `fs-extra` to manage sandbox definition files (reading `project-sandbox-def.json`, writing a user-specific definition file) and temporary directories.
- **Salesforce CLI Execution:** Executes Salesforce CLI commands (`sf org create sandbox`, `sf data get record`, `sf data update record`, `sf org open`) using `execSfdxJson` for sandbox creation, user updates, and opening the org in a browser.
- **Cache Management:** Clears the Salesforce CLI org list cache (`clearCache('sf org list')`) to ensure the newly created sandbox is immediately recognized.
- **Initialization Utilities:** Calls a suite of utility functions (`initPermissionSetAssignments`, `initApexScripts`, `initOrgData`) to perform post-creation setup tasks.
- **Error Assertions:** Uses `assert` to check the success of Salesforce CLI commands and provides custom error messages for better debugging.
- **WebSocket Communication:** Uses `WebSocketClient.sendRefreshStatusMessage` to notify connected VS Code clients about the new sandbox.
- **Required Plugin Check:** Explicitly lists `sfdmu` as a required plugin, indicating its role in data initialization.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:create
```


