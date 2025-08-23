<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:packagexml:remove

## Description


## Command Behavior

**Removes metadata components from a `package.xml` file that are also present in another `package.xml` file (e.g., a `destructiveChanges.xml`).**

This command is useful for refining your `package.xml` manifests by excluding components that are being deleted or are otherwise irrelevant for a specific deployment or retrieval. For example, you can use it to create a `package.xml` that only contains additions and modifications, by removing items listed in a `destructiveChanges.xml`.

Key functionalities:

- **Source `package.xml`:** The main `package.xml` file from which components will be removed (specified by `--packagexml`). Defaults to `package.xml`.
- **Filter `package.xml`:** The `package.xml` file containing the components to be removed from the source (specified by `--removepackagexml`). Defaults to `destructiveChanges.xml`.
- **Output File:** The path to the new `package.xml` file that will contain the filtered content (specified by `--outputfile`).
- **Removed Only Output:** The `--removedonly` flag allows you to generate a `package.xml` that contains *only* the items that were removed from the source `package.xml`.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Parsing:** It reads and parses the XML content of both the source `package.xml` and the filter `package.xml`.
- **Content Comparison and Filtering:** It compares the metadata types and members defined in both files. Components found in the filter `package.xml` are excluded from the output.
- **XML Building:** After filtering, it rebuilds the XML structure for the new `package.xml` file.
- **File Writing:** The newly constructed XML content is then written to the specified output file.
- **`removePackageXmlFilesContent` Utility:** The core logic for this operation is encapsulated within the `removePackageXmlFilesContent` utility function, which handles the parsing, filtering, and writing of the `package.xml` files.
</details>


## Parameters

| Name                    |  Type   | Description                                                     | Default | Required | Options |
|:------------------------|:-------:|:----------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug                   | boolean | debug                                                           |         |          |         |
| flags-dir               | option  | undefined                                                       |         |          |         |
| json                    | boolean | Format output as json.                                          |         |          |         |
| outputfile<br/>-f       | option  | package.xml output file                                         |         |          |         |
| packagexml<br/>-p       | option  | package.xml file to reduce                                      |         |          |         |
| removedonly<br/>-z      | boolean | Use this flag to generate a package.xml with only removed items |         |          |         |
| removepackagexml<br/>-r | option  | package.xml file to use to filter input package.xml             |         |          |         |
| websocket               | option  | websocket                                                       |         |          |         |

## Examples

```shell
$ sf hardis packagexml:remove -p package.xml -r destructiveChanges.xml -o my-reduced-package.xml
```


