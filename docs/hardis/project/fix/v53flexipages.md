<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:fix:v53flexipages

## Description


## Command Behavior

**Fixes Salesforce FlexiPages for compatibility with API Version 53.0 (Winter '22 release) by adding missing identifiers to component instances.**

Salesforce introduced a change in API Version 53.0 that requires `identifier` tags within `componentInstance` and `fieldInstance` elements in FlexiPage metadata. If these identifiers are missing, deployments to orgs with API version 53.0 or higher will fail. This command automates the process of adding these missing identifiers, ensuring your FlexiPages remain deployable.

Key functionalities:

- **Targeted FlexiPage Processing:** Scans all .flexipage-meta.xml files within the specified root folder (defaults to current working directory).
- **Identifier Injection:** Inserts a unique `identifier` tag (e.g., `SFDX_HARDIS_REPLACEMENT_ID`) into `componentInstance` and `fieldInstance` elements that lack one.

**Important Note:** After running this command, ensure you update your `apiVersion` to `53.0` (or higher) in your `package.xml` and `sfdx-project.json` files.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses `glob` to find all .flexipage-meta.xml files.
- **Content Reading:** Reads the XML content of each FlexiPage file.
- **Regular Expression Replacement:** Employs a set of regular expressions to identify specific XML patterns (componentName.../componentName.../componentInstance, componentName.../componentName.../visibilityRule, fieldItem.../fieldItem.../fieldInstance) that are missing the `identifier` tag.
- **Dynamic ID Generation:** For each match, it generates a unique identifier (e.g., `sfdxHardisIdX`) and injects it into the XML structure.
- **File Writing:** If changes are made, the modified XML content is written back to the FlexiPage file using `fs.writeFile`.
- **Logging:** Provides messages about which FlexiPages are being processed and a summary of the total number of identifiers added.
</details>


## Parameters

| Name         |  Type   | Description                                                   |         Default         | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-----------------------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |                         |          |         |
| flags-dir    | option  | undefined                                                     |                         |          |         |
| json         | boolean | Format output as json.                                        |                         |          |         |
| path<br/>-p  | option  | Root folder                                                   | C:\git\pro\sfdx-hardis2 |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |                         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                         |          |         |

## Examples

```shell
$ sf hardis:project:fix:v53flexipages
```


