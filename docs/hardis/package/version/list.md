<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:version:list

## Description


## Command Behavior

**Lists all Salesforce package versions associated with your Dev Hub.**

This command provides a comprehensive overview of your Salesforce packages and their versions, including details such as package ID, version number, installation key status, and creation date. It's an essential tool for managing your package development lifecycle, tracking releases, and identifying available versions for installation or promotion.

Key functionalities:

- **Comprehensive Listing:** Displays all package versions, regardless of their status (e.g., released, beta).
- **Dev Hub Integration:** Retrieves package version information directly from your connected Dev Hub.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation is straightforward:

- **Salesforce CLI Integration:** It directly executes the `sf package version list` command.
- **`execCommand`:** This utility is used to run the Salesforce CLI command and capture its output.
- **Output Display:** The raw output from the Salesforce CLI command is displayed to the user, providing all the details about the package versions.
</details>


## Parameters

| Name                  |  Type   | Description                                                   | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir             | option  | undefined                                                     |         |          |         |
| json                  | boolean | Format output as json.                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                     |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:package:version:list
```


