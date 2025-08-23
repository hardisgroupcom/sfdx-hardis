<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:files:export

## Description


## Command Behavior

**Exports file attachments (ContentVersion, Attachment) from a Salesforce org based on a predefined configuration.**

This command enables the mass download of files associated with Salesforce records, providing a robust solution for backing up files, migrating them to other systems, or integrating them with external document management solutions.

Key functionalities:

- **Configuration-Driven Export:** Relies on an `export.json` file within a designated file export project to define the export criteria, including the SOQL query for parent records, file types to export, and output naming conventions.
- **Interactive Project Selection:** If the file export project path is not provided via the `--path` flag, it interactively prompts the user to select one.
- **Configurable Export Options:** Allows overriding default export settings such as `chunksize` (number of records processed in a batch), `polltimeout` (timeout for Bulk API calls), and `startchunknumber` (to resume a failed export).
- **Support for ContentVersion and Attachment:** Handles both modern Salesforce Files (ContentVersion) and older Attachments.

See this article for a practical example:

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **FilesExporter Class:** The core logic is encapsulated within the `FilesExporter` class, which orchestrates the entire export process.
- **SOQL Queries (Bulk API):** It uses Salesforce Bulk API queries to efficiently retrieve large volumes of parent record IDs and file metadata.
- **File Download:** Downloads the actual file content from Salesforce.
- **File System Operations:** Writes the downloaded files to the local file system, organizing them into folders based on the configured naming conventions.
- **Configuration Loading:** Reads the `export.json` file to get the export configuration. It also allows for interactive overriding of these settings.
- **Interactive Prompts:** Uses `selectFilesWorkspace` to allow the user to choose a file export project and `promptFilesExportConfiguration` for customizing export options.
- **Error Handling:** Includes mechanisms to handle potential errors during the export process, such as network issues or API limits.
</details>


## Parameters

| Name                    |  Type   | Description                                                   | Default | Required | Options |
|:------------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| chunksize<br/>-c        | option  | Number of records to add in a chunk before it is processed    |  1000   |          |         |
| debug<br/>-d            | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir               | option  | undefined                                                     |         |          |         |
| json                    | boolean | Format output as json.                                        |         |          |         |
| path<br/>-p             | option  | Path to the file export project                               |         |          |         |
| polltimeout<br/>-t      | option  | Timeout in MS for Bulk API calls                              | 300000  |          |         |
| skipauth                | boolean | Skip authentication check when a default username is required |         |          |         |
| startchunknumber<br/>-s | option  | Chunk number to start from                                    |         |          |         |
| target-org<br/>-o       | option  | undefined                                                     |         |          |         |
| websocket               | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:files:export
```


