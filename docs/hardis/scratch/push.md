<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:push

## Description

## Command Behavior

**Pushes local Salesforce DX source files to a scratch org or source-tracked sandbox.**

This command is a fundamental operation in Salesforce DX development, allowing developers to synchronize their local codebase with their development org. It ensures that changes made locally are reflected in the scratch org, enabling testing and validation.

Key functionalities:

- **Source Synchronization:** Deploys all local changes (metadata and code) to the target scratch org.
- **Underlying Command:** Internally, this command executes `sf project deploy start` to perform the push operation.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce CLI Wrapper:** It acts as a wrapper around the standard Salesforce CLI `sf project deploy start` command.
- **`forceSourcePush` Utility:** The core logic resides in the `forceSourcePush` utility function, which orchestrates the deployment process.
- **Connection Handling:** It uses the connection to the target org to perform the push operation.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:scratch:push
```


