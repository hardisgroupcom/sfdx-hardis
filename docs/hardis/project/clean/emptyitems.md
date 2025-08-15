<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:emptyitems

## Description


## Command Behavior

**Removes empty or irrelevant metadata items from your Salesforce DX project sources.**

This command helps maintain a clean and efficient Salesforce codebase by deleting metadata files that are essentially empty or contain no meaningful configuration. These files can sometimes be generated during retrieval processes or remain after refactoring, contributing to unnecessary clutter in your project.

Key functionalities:

- **Targeted Cleaning:** Specifically targets and removes empty instances of:
  - Global Value Set Translations (`.globalValueSetTranslation-meta.xml`)
  - Standard Value Sets (`.standardValueSet-meta.xml`)
  - Sharing Rules (`.sharingRules-meta.xml`)
- **Content-Based Deletion:** It checks the XML content of these files for the presence of specific tags (e.g., `valueTranslation` for Global Value Set Translations) to determine if they are truly empty or lack relevant data.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses `glob` to find files matching predefined patterns for Global Value Set Translations, Standard Value Sets, and Sharing Rules within the specified root folder (defaults to `force-app`).
- **XML Parsing:** For each matching file, it reads and parses the XML content using `parseXmlFile`.
- **Content Validation:** It then checks the parsed XML object for the existence of specific nested properties (e.g., `xmlContent.GlobalValueSetTranslation.valueTranslation`). If these properties are missing or empty, the file is considered empty.
- **File Deletion:** If a file is determined to be empty, it is removed from the file system using `fs.remove`.
- **Logging:** Provides clear messages about which files are being removed and a summary of the total number of items cleaned.
</details>


## Parameters

| Name          |  Type   | Description                                                   |  Default  | Required | Options |
|:--------------|:-------:|:--------------------------------------------------------------|:---------:|:--------:|:-------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |           |          |         |
| flags-dir     | option  | undefined                                                     |           |          |         |
| folder<br/>-f | option  | Root folder                                                   | force-app |          |         |
| json          | boolean | Format output as json.                                        |           |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required |           |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |           |          |         |

## Examples

```shell
$ sf hardis:project:clean:emptyitems
```


