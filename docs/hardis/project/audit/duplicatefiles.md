<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:audit:duplicatefiles

## Description


## Command Behavior

**Identifies and reports on duplicate file names within your Salesforce DX project folder.**

This command helps detect instances where files with the same name exist in different directories within your SFDX project. While some duplicates are expected (e.g., metadata files for different components of the same object), others can be a result of past Salesforce CLI bugs or improper source control practices, leading to confusion and potential deployment issues.

Key functionalities:

- **File Scan:** Recursively scans a specified root path (defaults to the current working directory) for all files.
- **Duplicate Detection:** Identifies files that share the same name but reside in different locations.
- **Intelligent Filtering:** Accounts for known patterns where duplicate file names are legitimate (e.g., `field-meta.xml`, `listView-meta.xml`, `recordType-meta.xml`, `webLink-meta.xml` files within object subdirectories).
- **Reporting:** Outputs a JSON object detailing the detected duplicates, including the file name and the full paths of its occurrences.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File System Traversal:** Uses `fs-readdir-recursive` to list all files within the specified directory, excluding `node_modules`.
- **Duplicate Logic:** Iterates through the list of all files and compares their base names. If two files have the same base name but different full paths, they are considered potential duplicates.
- **Exclusion Logic:** The `checkDoublingAllowed` function contains regular expressions to identify specific file path patterns where duplicate names are acceptable (e.g., `objects/Account/fields/MyField__c.field-meta.xml` and `objects/Contact/fields/MyField__c.field-meta.xml`). This prevents false positives.
- **Data Structuring:** Organizes the results into a JavaScript object where keys are duplicate file names and values are arrays of their full paths.
</details>


## Parameters

| Name         |  Type   | Description                                                   |         Default         | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-----------------------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |                         |          |         |
| flags-dir    | option  | undefined                                                     |                         |          |         |
| json         | boolean | Format output as json.                                        |                         |          |         |
| path<br/>-p  | option  | Root path to check                                            | C:\git\pro\sfdx-hardis2 |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |                         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                         |          |         |

## Examples

```shell
$ sf hardis:project:audit:duplicatefiles
```


