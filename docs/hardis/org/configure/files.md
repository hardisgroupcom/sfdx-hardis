<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:files

## Description


## Command Behavior

**Configures a project for exporting file attachments from a Salesforce org.**

This command streamlines the setup of configurations for mass downloading files (such as Notes, Attachments, or Salesforce Files) associated with Salesforce records. It's particularly useful for data backups, migrations, or integrating Salesforce files with external systems.

Key functionalities:

- **Template-Based Configuration:** Allows you to choose from predefined templates for common file export scenarios or start with a blank configuration. Templates can pre-populate the export settings.
- **Interactive Setup:** Guides you through defining the export project folder name and other export parameters.
- **`export.json` Generation:** Creates an `export.json` file within the designated project folder. This file contains the configuration for the file export operation, including:
  - **SOQL Query:** A SOQL query to select the parent records from which files will be exported.
  - **File Types:** Specifies which types of files (e.g., `ContentVersion`, `Attachment`) to include.
  - **Output Folder/File Naming:** Defines how the exported files and their containing folders will be named based on record fields.
  - **Overwrite Options:** Controls whether existing files or parent records should be overwritten during the export.

See this article for a practical example:

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Template Selection:** It uses `selectTemplate` to present predefined file export templates or a blank option to the user.
- **Interactive Prompts:** The `promptFilesExportConfiguration` utility is used to gather detailed export settings from the user, such as the SOQL query, file types, and naming conventions.
- **File System Operations:** Employs `fs-extra` to create the project directory (`files/your-project-name/`) and write the `export.json` configuration file.
- **PascalCase Conversion:** Uses `pascalcase` to format the files export path consistently.
- **JSON Serialization:** Serializes the collected export configuration into a JSON string and writes it to `export.json`.
- **WebSocket Communication:** Uses `WebSocketClient.requestOpenFile` to open the generated `export.json` file in VS Code, facilitating immediate configuration.
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
$ sf hardis:org:configure:files
```


