<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:packagexml:append

## Description


## Command Behavior

**Appends the content of one or more Salesforce `package.xml` files into a single target `package.xml` file.**

This command is useful for consolidating metadata definitions from various sources into a single manifest. For instance, you might have separate `package.xml` files for different features or metadata types, and this command allows you to combine them into one comprehensive file for deployment or retrieval.

Key functionalities:

- **Multiple Input Files:** Takes a comma-separated list of `package.xml` file paths as input.
- **Single Output File:** Merges the content of all input files into a specified output `package.xml` file.
- **Metadata Consolidation:** Combines the `<types>` and `<members>` elements from all input files, ensuring that all unique metadata components are included in the resulting file.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Parsing:** It reads and parses the XML content of each input `package.xml` file.
- **Content Merging:** It iterates through the parsed XML structures, merging the `types` and `members` arrays. If a metadata type exists in multiple input files, its members are combined (duplicates are typically handled by the underlying XML utility).
- **XML Building:** After consolidating the metadata, it rebuilds the XML structure for the output `package.xml` file.
- **File Writing:** The newly constructed XML content is then written to the specified output file.
- **`appendPackageXmlFilesContent` Utility:** The core logic for this operation is encapsulated within the `appendPackageXmlFilesContent` utility function, which handles the parsing, merging, and writing of the `package.xml` files.
</details>


## Parameters

| Name               |  Type   | Description                                  | Default | Required | Options |
|:-------------------|:-------:|:---------------------------------------------|:-------:|:--------:|:-------:|
| debug              | boolean | debug                                        |         |          |         |
| flags-dir          | option  | undefined                                    |         |          |         |
| json               | boolean | Format output as json.                       |         |          |         |
| outputfile<br/>-f  | option  | package.xml output file                      |         |          |         |
| packagexmls<br/>-p | option  | package.xml files path (separated by commas) |         |          |         |
| websocket          | option  | websocket                                    |         |          |         |

## Examples

```shell
$ sf hardis packagexml append -p package1.xml,package2.xml -o package3.xml
```


