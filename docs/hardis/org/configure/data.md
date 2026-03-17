<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:data

## Description


## Command Behavior

**Configures a Salesforce Data Migration Utility (SFDMU) project for data export and import operations.**

This command assists in setting up SFDMU workspaces, which are essential for managing data within your Salesforce environments. It streamlines the creation of `export.json` files and related configurations, enabling efficient data seeding, migration, and synchronization.

Key functionalities:

- **Template-Based Configuration:** Allows you to choose from predefined SFDMU templates or start with a blank configuration. Templates can pre-populate `export.json` with common data migration scenarios.
- **Interactive Setup:** Guides you through the process of defining the SFDMU project folder name, label, and description.
- **`export.json` Generation:** Creates the `export.json` file, which is the core configuration file for SFDMU, defining objects to export/import, queries, and operations.
- **Additional File Generation:** Can generate additional configuration files, such as a `badwords.json` file for data filtering scenarios.
- **Scratch Org Integration:** Offers to automatically configure the SFDMU project to be used for data import when initializing a new scratch org, ensuring consistent test data across development environments.

See this article for a practical example:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SFDMU Integration:** It acts as a setup wizard for SFDMU, generating the necessary configuration files that the `sfdmu` plugin consumes.
- **Interactive Prompts:** Uses the `prompts` library to gather user input for various configuration parameters, such as the data path, label, and description.
- **File System Operations:** Employs `fs-extra` to create directories (e.g., `data/your-project-name/`) and write the `export.json` and any additional configuration files.
- **JSON Manipulation:** Constructs the `export.json` content dynamically based on user input and selected templates, including defining objects, queries, and operations.
- **PascalCase Conversion:** Uses `pascalcase` to format the SFDMU folder name consistently.
- **Configuration Persistence:** Updates the project's `sfdx-hardis.yml` file (via `setConfig`) to include the newly configured data package if it's intended for scratch org initialization.
- **WebSocket Communication:** Uses `WebSocketClient.requestOpenFile` to open the generated `export.json` file in VS Code, facilitating immediate configuration.
- **Required Plugin Check:** Explicitly lists `sfdmu` as a required plugin, ensuring the necessary dependency is present.
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
$ sf hardis:org:configure:data
```


