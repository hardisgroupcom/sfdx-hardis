<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:misc:custom-label-translations

## Description


## Command Behavior

**Extracts selected custom labels, or all custom labels used within a given Lightning Web Component (LWC), from all available language translation files in the project.**

This command streamlines the process of managing and isolating specific custom label translations. It's particularly useful for:

- **Localization Management:** Focusing on translations for a subset of labels or for labels relevant to a specific UI component.
- **Collaboration:** Sharing only the necessary translation files with translators, reducing complexity.
- **Debugging:** Isolating translation issues for specific labels or components.

Key functionalities:

- **Label Selection:** You can specify custom label names directly using the `--label` flag (comma-separated).
- **LWC-based Extraction:** Alternatively, you can provide an LWC developer name using the `--lwc` flag, and the command will automatically identify and extract all custom labels referenced within that LWC's JavaScript files.
- **Interactive Prompts:** If neither `--label` nor `--lwc` is provided, the command will interactively prompt you to choose between selecting specific labels or extracting from an LWC.
- **Output Generation:** For each language found in your project's `translations` folder, it generates a new `.translation-meta.xml` file containing only the extracted custom labels and their translations. These files are placed in a timestamped output directory.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses `glob` to find all `*.translation-meta.xml` files in the `**/translations/` directory and, if an LWC is specified, it searches for the LWC's JavaScript files (`**/lwc/**/*.js`).
- **LWC Label Extraction:** The `extractLabelsFromLwc` function uses regular expressions (`@salesforce/label/c.([a-zA-Z0-9_]+)`) to parse LWC JavaScript files and identify referenced custom labels.
- **XML Parsing and Building:** It uses `xml2js` (`parseStringPromise` and `Builder`) to:
  - Read and parse existing `.translation-meta.xml` files.
  - Filter the `customLabels` array to include only the requested labels.
  - Construct a new XML structure containing only the filtered labels.
  - Build a new XML string with proper formatting and write it to a new file.
- **Interactive Prompts:** The `prompts` library is used extensively to guide the user through the selection of extraction methods (labels or LWC) and specific labels/components.
- **File System Operations:** It uses `fs-extra` for creating output directories (`extracted-translations/`) and writing the generated translation files.
- **WebSocket Communication:** It uses `WebSocketClient.requestOpenFile` to open the output directory in VS Code for easy access to the generated files.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| label<br/>-l | option  | Developer name(s) of the custom label(s), comma-separated     |         |          |         |
| lwc<br/>-c   | option  | Developer name of the Lightning Web Component                 |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:misc:custom-label-translations --label CustomLabelName
```

```shell
$ sf hardis:misc:custom-label-translations --label Label1,Label2
```

```shell
$ sf hardis:misc:custom-label-translations --lwc MyComponent
```


