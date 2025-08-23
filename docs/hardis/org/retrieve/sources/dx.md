<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:sources:dx

## Description


## Command Behavior

**Retrieves Salesforce metadata from an org and converts it into Salesforce DX (SFDX) source format.**

This command provides a flexible way to pull metadata from any Salesforce org into your local SFDX project. It's particularly useful for:

- **Initial Project Setup:** Populating a new SFDX project with existing org metadata.
- **Environment Synchronization:** Bringing changes from a Salesforce org (e.g., a sandbox) into your local development environment.
- **Selective Retrieval:** Allows you to specify which metadata types to retrieve, or to filter out certain types.
- **Org Shape Creation:** Can optionally create an org shape, which is useful for defining the characteristics of scratch orgs.

Key functionalities:

- **Metadata Retrieval:** Connects to a target Salesforce org and retrieves metadata based on specified filters.
- **MDAPI to SFDX Conversion:** Converts the retrieved metadata from Metadata API format to SFDX source format.
- **Org Shape Generation (Optional):** If the `--shape` flag is used, it also captures the org's shape and stores installed package information.
- **Temporary File Management:** Uses temporary folders for intermediate steps, ensuring a clean working directory.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Temporary Directory Management:** It creates and manages temporary directories (`./tmp`, `mdapipkg`, `sfdx-project`) to stage the retrieved metadata and the converted SFDX sources.
- **`MetadataUtils.retrieveMetadatas`:** This utility is used to connect to the Salesforce org and retrieve metadata in Metadata API format. It supports filtering by metadata types and excluding certain items.
- **SFDX Project Creation:** It executes `sf project generate` to create a new SFDX project structure within a temporary directory.
- **MDAPI to SFDX Conversion:** It then uses `sf project convert mdapi` to convert the retrieved metadata from the MDAPI format to the SFDX source format.
- **File System Operations:** It uses `fs-extra` to copy the converted SFDX sources to the main project folder, while preserving important project files like `.gitignore` and `sfdx-project.json`.
- **Org Shape Handling:** If `--shape` is enabled, it copies the generated `package.xml` and stores information about installed packages using `setConfig`.
- **Error Handling:** Includes robust error handling for Salesforce CLI commands and file system operations.
- **WebSocket Communication:** Uses `WebSocketClient.sendRefreshCommandsMessage` to notify connected VS Code clients about changes to the project.
</details>


## Parameters

| Name                     |  Type   | Description                                                                        | Default | Required | Options |
|:-------------------------|:-------:|:-----------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                    |         |          |         |
| filteredmetadatas<br/>-m | option  | Comma separated list of Metadatas keys to remove from PackageXml file              |         |          |         |
| flags-dir                | option  | undefined                                                                          |         |          |         |
| folder<br/>-f            | option  | Folder                                                                             |    .    |          |         |
| instanceurl<br/>-r       | option  | URL of org instance                                                                |         |          |         |
| json                     | boolean | Format output as json.                                                             |         |          |         |
| keepmetadatatypes<br/>-k | option  | Comma separated list of metadatas types that will be the only ones to be retrieved |         |          |         |
| shape<br/>-s             | boolean | Updates project-scratch-def.json from org shape                                    |         |          |         |
| skipauth                 | boolean | Skip authentication check when a default username is required                      |         |          |         |
| target-org<br/>-o        | option  | undefined                                                                          |         |          |         |
| tempfolder<br/>-t        | option  | Temporary folder                                                                   |  ./tmp  |          |         |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                          |         |          |         |

## Examples

```shell
$ sf hardis:org:retrieve:sources:dx
```


