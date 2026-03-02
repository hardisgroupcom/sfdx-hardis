<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:standarditems

## Description


## Command Behavior

**Removes unwanted standard Salesforce items from your Salesforce DX project sources.**

This command helps maintain a clean and focused Salesforce codebase by deleting metadata files that represent standard Salesforce objects or fields, especially when they are retrieved but not intended to be managed in your version control system. This is useful for reducing repository size and avoiding conflicts with standard Salesforce metadata.

Key functionalities:

- **Standard Object Cleaning:** Scans for standard objects (those without a `__c` suffix) within your `force-app/main/default/objects` folder.
- **Conditional Folder Deletion:** If a standard object folder contains no custom fields (fields with a `__c` suffix), the entire folder and its associated sharing rules (`.sharingRules-meta.xml`) are removed.
- **Standard Field Deletion:** If a standard object folder *does* contain custom fields, only the standard fields within that object are removed, preserving your custom metadata.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File System Traversal:** It starts by listing the contents of the `force-app/main/default/objects` directory.
- **Standard Object Identification:** It iterates through each directory within `objects` and identifies standard objects by checking if their name does not contain `__` (the custom object suffix).
- **Custom Field Detection:** For each standard object, it uses `glob` to search for custom fields (`*__*.field-meta.xml`) within its `fields` subdirectory.
- **Conditional Removal:**
  - If no custom fields are found, it removes the entire object directory and any corresponding sharing rules file using `fs.remove`.
  - If custom fields are found, it then uses `glob` again to find all standard fields (`*.field-meta.xml` without `__`) within the object's `fields` directory and removes only those standard field files.
- **Logging:** Provides clear messages about which folders and files are being removed or kept.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:clean:standarditems
```


