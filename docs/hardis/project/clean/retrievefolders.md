<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:retrievefolders

## Description


## Command Behavior

**Retrieves specific folders of Dashboards, Documents, Email Templates, and Reports from a Salesforce org into your DX project sources.**

This command is designed to help developers and administrators synchronize their local Salesforce DX project with the latest versions of these folder-based metadata types. It's particularly useful for:

- **Selective Retrieval:** Instead of retrieving all dashboards or reports, it allows you to retrieve specific folders, which can be more efficient for targeted development or backup.
- **Maintaining Folder Structure:** Ensures that the folder structure of these metadata types is preserved in your local project.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Folder Iteration:** It defines a list of folder-based metadata types (`dashboards`, `documents`, `email`, `reports`).
- **File System Check:** For each type, it checks if the corresponding folder exists in `force-app/main/default/`.
- **Recursive Retrieval:** It iterates through subfolders within these main folders. For each subfolder, it constructs and executes a `sf project retrieve start` command.
- **Salesforce CLI Integration:** It uses `sf project retrieve start -m <MetadataType>:<FolderName>` to retrieve the content of individual folders. This ensures that only the specified folder and its contents are retrieved.
- **Error Handling:** It includes basic error handling for the `execCommand` calls.
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
$ sf hardis:project:clean:retrievefolders
```


