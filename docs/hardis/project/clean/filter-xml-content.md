<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:filter-xml-content

## Description


## Command Behavior

**Filters the content of Salesforce metadata XML files to remove specific elements, enabling more granular deployments.**

This command addresses a common challenge in Salesforce development: deploying only a subset of metadata from an XML file when the target org might not support all elements or when certain elements are not desired. It allows you to define rules in a JSON configuration file to remove unwanted XML nodes.

Key functionalities:

- **Configurable Filtering:** Uses a JSON configuration file (e.g., `filter-config.json`) to define which XML elements to remove. This configuration specifies the XML tags to target and the values within those tags that should trigger removal.
- **Targeted File Processing:** Processes XML files within a specified input folder (defaults to current directory) and writes the filtered content to an output folder.
- **Example Use Cases:** Useful for scenarios like:
  - Removing references to features not enabled in the target org.
  - Stripping out specific profile permissions or field-level security settings.
  - Cleaning up metadata that is not relevant to a particular deployment.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** Reads the `filter-config.json` file, which contains an array of `filters`. Each filter defines a `name`, `description`, `folders` (where to apply the filter), `file_extensions`, and an `exclude_list`.
- **File System Operations:** Copies the input folder to an output folder (if different) to avoid modifying original files directly. It then iterates through the files in the output folder that match the specified file extensions.
- **XML Parsing and Manipulation:** For each matching XML file:
  - It uses `xml2js.Parser` to parse the XML content into a JavaScript object.
  - It recursively traverses the JavaScript object, applying the `filterElement` function.
  - The `filterElement` function checks for `type_tag` and `identifier_tag` defined in the `exclude_list`. If a match is found and the value is in the `excludeDef.values`, the element is removed from the XML structure.
  - After filtering, it uses `writeXmlFile` to write the modified JavaScript object back to the XML file.
- **Logging:** Provides detailed logs about the filtering process, including which files are being processed and which elements are being filtered.
- **Summary Reporting:** Tracks and reports on the files that have been updated due to filtering.
</details>


## Parameters

| Name                |  Type   | Description                                                   | Default | Required | Options |
|:--------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| configfile<br/>-c   | option  | Config JSON file path                                         |         |          |         |
| debug               | boolean | debug                                                         |         |          |         |
| flags-dir           | option  | undefined                                                     |         |          |         |
| inputfolder<br/>-i  | option  | Input folder (default: "." )                                  |         |          |         |
| json                | boolean | Format output as json.                                        |         |          |         |
| outputfolder<br/>-f | option  | Output folder (default: parentFolder + _xml_content_filtered) |         |          |         |
| websocket           | option  | websocket                                                     |         |          |         |

## Examples

```shell
sf hardis:project:clean:filter-xml-content -i "./mdapi_output"
```

```shell
sf hardis:project:clean:filter-xml-content -i "retrieveUnpackaged"
```


