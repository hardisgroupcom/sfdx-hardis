<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:fix:profiletabs

## Description


## Command Behavior

**Interactively updates tab visibility settings in Salesforce profiles, addressing a common issue where tab visibilities are not correctly retrieved by `sf project retrieve start`.**

This command provides a user-friendly interface to manage tab settings within your profile XML files, ensuring that your local project accurately reflects the intended tab configurations in your Salesforce org.

Key functionalities:

- **Interactive Tab Selection:** Displays a multi-select menu of all available tabs in your org, allowing you to choose which tabs to update.
- **Visibility Control:** Lets you set the visibility for the selected tabs to either `DefaultOn` (Visible) or `Hidden`.
- **Profile Selection:** Presents a multi-select menu of all .profile-meta.xml files in your project, allowing you to apply the tab visibility changes to specific profiles.
- **XML Updates:** Modifies the <tabVisibilities> section of the selected profile XML files to reflect the chosen tab settings. If a tab visibility setting already exists for a selected tab, it will be updated; otherwise, a new one will be added.
- **Sorted Output:** The <tabVisibilities> in the updated profile XML files are sorted alphabetically for consistency and readability.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Queries (Tooling API):** It queries the `TabDefinition` object using `soqlQueryTooling` to retrieve a list of all available tabs in the target org.
- **File Discovery:** Uses `glob` to find all .profile-meta.xml files within the specified project path.
- **Interactive Prompts:** Leverages the `prompts` library to create interactive menus for selecting tabs, visibility settings, and profiles.
- **XML Parsing and Manipulation:** Uses `parseXmlFile` to read the content of profile XML files and `writeXmlFile` to write the modified content back. It manipulates the `tabVisibilities` array within the parsed XML to add or update tab settings.
- **Array Sorting:** Employs the `sort-array` library to sort the `tabVisibilities` alphabetically by tab name.
- **Logging:** Provides feedback to the user about which profiles have been updated and a summary of the changes.
</details>


## Parameters

| Name              |  Type   | Description                                                   |         Default         | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-----------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                         |          |         |
| flags-dir         | option  | undefined                                                     |                         |          |         |
| json              | boolean | Format output as json.                                        |                         |          |         |
| path<br/>-p       | option  | Root folder                                                   | C:\git\pro\sfdx-hardis2 |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |                         |          |         |
| target-org<br/>-o | option  | undefined                                                     |                         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                         |          |         |

## Examples

```shell
$ sf hardis:project:fix:profiletabs
```


