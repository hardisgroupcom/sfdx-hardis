<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:ws

## Description


## Command Behavior

**Performs technical operations related to WebSocket communication, primarily for internal use by the sfdx-hardis VS Code Extension.**

This command is not intended for direct end-user interaction. It facilitates communication between the sfdx-hardis CLI and the VS Code Extension, enabling features like real-time status updates and plugin refreshes.

Key functionalities:

- **Refresh Status (`--event refreshStatus`):** Sends a message to the VS Code Extension to refresh its displayed status, ensuring that the UI reflects the latest state of Salesforce orgs or project activities.
- **Refresh Plugins (`--event refreshPlugins`):** Sends a message to the VS Code Extension to refresh its loaded plugins, useful after installing or updating sfdx-hardis or other related extensions.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **WebSocketClient:** It utilizes the `WebSocketClient` utility to establish and manage WebSocket connections.
- **Event-Driven Communication:** It listens for specific events (e.g., `refreshStatus`, `refreshPlugins`) and triggers corresponding actions on the connected WebSocket client.
- **Internal Use:** This command is primarily called programmatically by the VS Code Extension to maintain synchronization and provide a seamless user experience.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| event<br/>-e | option  | WebSocket event                                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:work:ws --event refreshStatus
```


