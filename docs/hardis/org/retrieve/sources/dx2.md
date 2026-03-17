<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:sources:dx2

## Description


## Command Behavior

**Retrieves Salesforce metadata from an org into SFDX source format, offering flexible input options for specifying metadata to retrieve.**

This command provides an alternative and enhanced way to pull metadata from any Salesforce org into your local SFDX project. It's particularly useful when you need fine-grained control over which metadata components are retrieved, either by providing a custom `package.xml` or by using predefined templates.

Key functionalities:

- **`package.xml` Input:** You can specify the path to a `package.xml` file using the `--packagexml` flag, which defines the exact metadata components to retrieve.
- **Template-Based Retrieval:** Use the `--template` flag to leverage predefined `package.xml` templates provided by sfdx-hardis (e.g., `wave` for CRM Analytics metadata), simplifying common retrieval scenarios.
- **Interactive Input:** If neither `--packagexml` nor `--template` is provided, the command will interactively prompt you to select a `package.xml` file or a template.
- **Target Org Selection:** Allows you to specify the Salesforce org from which to retrieve the sources. If not provided, it will prompt for selection.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Org Selection:** It uses `promptOrg` to guide the user in selecting the target Salesforce org if not provided via flags.
- **`package.xml` Resolution:** It determines the `package.xml` to use based on the provided flags (`--packagexml` or `--template`). If a template is used, it resolves the path to the corresponding template file within the sfdx-hardis installation.
- **File System Operations:** It checks if the specified `package.xml` file exists. If the file is outside the current project directory, it copies it to a temporary location within the project to ensure proper handling by the Salesforce CLI.
- **Salesforce CLI Retrieval:** It executes the `sf project retrieve start` command, passing the resolved `package.xml` path and the target username to retrieve the sources.
- **User Feedback:** Provides clear messages to the user about the retrieval process and its success.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| packagexml<br/>-x | option  | Path to package.xml file                                      |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| template<br/>-t   | option  | sfdx-hardis package.xml Template name. ex: wave               |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:retrieve:sources:dx2
```


