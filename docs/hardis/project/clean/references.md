<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:references

## Description


## Command Behavior

**Removes unwanted references and cleans up metadata within your Salesforce DX project sources.**

This command provides a powerful way to maintain a clean and efficient Salesforce codebase by eliminating unnecessary or problematic metadata. It supports various cleaning types, from removing hardcoded user references in dashboards to minimizing profile attributes.

Key functionalities include:

- **Configurable Cleaning Types:** You can specify a particular cleaning type (e.g., 
- **JSON/XML Configuration:** Cleaning operations can be driven by a JSON configuration file or a 
- **Interactive Selection:** If no cleaning type is specified, the command interactively prompts you to select which references to clean.
- **Persistent Configuration:** You can choose to save your cleaning selections in your project's configuration (`.sfdx-hardis.yml`) so they are automatically applied during future Work Save operations.
- **File Deletion:** Beyond just cleaning XML content, it can also delete related files (e.g., custom field files and their translations when a custom field is marked for deletion).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves several steps:

- **Configuration Loading:** It reads the project's configuration to determine default cleaning types and user preferences.
- **Cleaning Type Processing:** For each selected cleaning type, it either executes a dedicated sub-command (e.g., 
- **XML Filtering:** For template-based cleanings, it constructs a temporary JSON configuration file based on predefined templates or user-provided 
- **Package.xml Cleanup:** It iterates through 
- **Object Property Removal:** The 
</details>


## Parameters

| Name          |  Type   | Description                                                   | Default | Required |                                                                                            Options                                                                                            |
|:--------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------:|
| config<br/>-c | option  | Path to a JSON config file or a destructiveChanges.xml file   |         |          |                                                                                                                                                                                               |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |         |          |                                                                                                                                                                                               |
| flags-dir     | option  | undefined                                                     |         |          |                                                                                                                                                                                               |
| json          | boolean | Format output as json.                                        |         |          |                                                                                                                                                                                               |
| skipauth      | boolean | Skip authentication check when a default username is required |         |          |                                                                                                                                                                                               |
| type<br/>-t   | option  | Cleaning type                                                 |         |          | all<br/>caseentitlement<br/>dashboards<br/>datadotcom<br/>destructivechanges<br/>localfields<br/>productrequest<br/>entitlement<br/>flowPositions<br/>sensitiveMetadatas<br/>minimizeProfiles |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                                                                                                                                                                                               |

## Examples

```shell
$ sf hardis:project:clean:references
```

```shell
$ sf hardis:project:clean:references --type all
```

```shell
$ sf hardis:project:clean:references --config ./cleaning/myconfig.json
```

```shell
$ sf hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml
```


