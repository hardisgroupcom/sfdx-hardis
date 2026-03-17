<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:mergexml

## Description


## Command Behavior

**Merges multiple Salesforce `package.xml` files into a single, consolidated `package.xml` file.**

This command is useful for combining metadata definitions from various sources (e.g., different feature branches, separate development efforts) into one comprehensive package.xml, which can then be used for deployments or retrievals.

Key functionalities:

- **Flexible Input:** You can specify the `package.xml` files to merge either by:
  - Providing a comma-separated list of file paths using the `--packagexmls` flag.
  - Specifying a folder and a glob pattern using `--folder` and `--pattern` to automatically discover `package.xml` files.
  - If no input is provided, an interactive menu will prompt you to select files from the `manifest` folder.
- **Customizable Output:** You can define the name and path of the resulting merged `package.xml` file using the `--result` flag.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses `glob` to find `package.xml` files based on the provided folder and pattern, or it directly uses the list of files from the `--packagexmls` flag.
- **Interactive Prompts:** If no `package.xml` files are specified, it uses the `prompts` library to allow the user to interactively select files to merge.
- **`appendPackageXmlFilesContent` Utility:** The core merging logic is handled by the `appendPackageXmlFilesContent` utility function. This function reads the content of each input `package.xml` file, combines their metadata types and members, and writes the consolidated content to the specified result file.
- **XML Manipulation:** Internally, `appendPackageXmlFilesContent` parses the XML of each `package.xml`, merges the `<types>` and `<members>` elements, and then rebuilds the XML structure for the output file.
- **File System Operations:** It uses `fs-extra` to ensure the output directory exists and to write the merged `package.xml` file.
- **WebSocket Communication:** It uses `WebSocketClient.requestOpenFile` to open the generated merged `package.xml` file in VS Code for immediate review.
</details>


## Parameters

| Name               |  Type   | Description                                                                                  |      Default      | Required | Options |
|:-------------------|:-------:|:---------------------------------------------------------------------------------------------|:-----------------:|:--------:|:-------:|
| debug              | boolean | debug                                                                                        |                   |          |         |
| flags-dir          | option  | undefined                                                                                    |                   |          |         |
| folder<br/>-f      | option  | Root folder                                                                                  |     manifest      |          |         |
| json               | boolean | Format output as json.                                                                       |                   |          |         |
| packagexmls<br/>-p | option  | Comma separated list of package.xml files to merge. Will be prompted to user if not provided |                   |          |         |
| pattern<br/>-x     | option  | Name criteria to list package.xml files                                                      | /**/*package*.xml |          |         |
| result<br/>-r      | option  | Result package.xml file name                                                                 |                   |          |         |
| skipauth           | boolean | Skip authentication check when a default username is required                                |                   |          |         |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                    |                   |          |         |

## Examples

```shell
$ sf hardis:package:mergexml
```

```shell
$ sf hardis:package:mergexml --folder packages --pattern /**/*.xml --result myMergedPackage.xml
```

```shell
$ sf hardis:package:mergexml --packagexmls "config/mypackage1.xml,config/mypackage2.xml,config/mypackage3.xml" --result myMergedPackage.xml
```


