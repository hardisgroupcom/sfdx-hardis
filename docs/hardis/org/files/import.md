<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:files:import

## Description


This command facilitates the mass upload of files into Salesforce, allowing you to populate records with associated documents, images, or other file types. It's a crucial tool for data migration, content seeding, or synchronizing external file repositories with Salesforce.

Key functionalities:

- **Configuration-Driven Import:** Relies on an `export.json` file within a designated file export project (created using `sf hardis:org:configure:files`) to determine which files to import and how they should be associated with Salesforce records.
- **Interactive Project Selection:** If the file import project path is not provided via the `--path` flag, it interactively prompts the user to select one.
- **Overwrite Option:** The `--overwrite` flag allows you to replace existing files in Salesforce with local versions that have the same name. Be aware that this option doubles the number of API calls used.
- **Support for ContentVersion and Attachment:** Handles both modern Salesforce Files (ContentVersion) and older Attachments.

See this article for how to export files, which is often a prerequisite for importing:

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **FilesImporter Class:** The core logic is encapsulated within the `FilesImporter` class, which orchestrates the entire import process.
- **File System Scan:** Scans the local file system within the configured project directory to identify files for import.
- **Salesforce API Interaction:** Uses Salesforce APIs (e.g., ContentVersion, Attachment) to upload files and associate them with records.
- **Configuration Loading:** Reads the `export.json` file to get the import configuration, including SOQL queries to identify parent records for file association.
- **Interactive Prompts:** Uses `selectFilesWorkspace` to allow the user to choose a file import project and `prompts` for confirming the overwrite behavior.
- **Error Handling:** Includes mechanisms to handle potential errors during the import process, such as API limits or file upload failures.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| overwrite<br/>-f  | boolean | Override existing files (doubles the number of API calls)     |         |          |         |
| path<br/>-p       | option  | Path to the file export project                               |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:files:import
```


