<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:source:retrieve

## Description


## Command Behavior

**A wrapper command for Salesforce CLI's `sf project retrieve start` (formerly `sfdx force:source:retrieve`), with enhanced interactive features.**

This command facilitates the retrieval of metadata from a Salesforce org into your local project. It provides an assisted experience, especially when no specific retrieval constraints are provided.

Key features:

- **Assisted Metadata Selection:** If no `sourcepath`, `manifest`, `metadata`, or `packagenames` flags are specified, an interactive menu will prompt you to select the metadata types you wish to retrieve.
- **Assisted Org Selection:** If no target org is specified, an interactive menu will guide you to choose an org for the retrieval operation.
- **Backward Compatibility:** While this command wraps the newer `sf project retrieve start`, it maintains compatibility with the older `sfdx force:source:retrieve` flags.

**Important Note:** The underlying Salesforce CLI command `sfdx force:source:retrieve` is being deprecated by Salesforce in November 2024. It is recommended to migrate to `sf project retrieve start` for future compatibility. See [Salesforce CLI Migration Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm) for more information.

<details markdown="1">
<summary>Technical explanations</summary>

This command acts as an intelligent wrapper around the Salesforce CLI's source retrieval functionality:

- **Command Wrapping:** It uses the `wrapSfdxCoreCommand` utility to execute the `sfdx force:source:retrieve` (or its equivalent `sf project retrieve start`) command, passing through all relevant flags and arguments.
- **Interactive Prompts:** It leverages `MetadataUtils.promptMetadataTypes()` and `promptOrgUsernameDefault()` to provide interactive menus for metadata and org selection when the user does not provide them as flags.
- **Argument Transformation:** It dynamically constructs the command-line arguments for the underlying Salesforce CLI command based on user selections and provided flags.
- **Error Handling:** It includes basic error handling, such as prompting the user to re-select an org if an issue occurs during org selection.
- **Deprecation Warning:** It explicitly logs warnings about the deprecation of `sfdx force:source:retrieve` to inform users about upcoming changes.
</details>


## Parameters

| Name                  |  Type   | Description                                                         | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-------:|
| apiversion<br/>-a     | option  | Override the api version used for api requests made by this command |         |          |         |
| debug<br/>-d          | boolean | debugMode                                                           |         |          |         |
| flags-dir             | option  | undefined                                                           |         |          |         |
| forceoverwrite<br/>-f | boolean | forceoverwrite                                                      |         |          |         |
| json                  | boolean | Format output as json.                                              |         |          |         |
| manifest<br/>-x       | option  | manifest                                                            |         |          |         |
| metadata<br/>-m       | option  | metadata                                                            |         |          |         |
| packagenames<br/>-n   | option  | packagenames                                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required       |         |          |         |
| sourcepath<br/>-p     | option  | sourcePath                                                          |         |          |         |
| target-org<br/>-o     | option  | undefined                                                           |         |          |         |
| tracksource<br/>-t    | boolean | tracksource                                                         |         |          |         |
| verbose               | boolean | verbose                                                             |         |          |         |
| wait<br/>-w           | option  | wait                                                                |         |          |         |
| websocket             | option  | websocket                                                           |         |          |         |

## Examples


