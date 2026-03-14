<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:delete

## Description

## Command Behavior

**Provides an assisted menu to delete Salesforce scratch orgs associated with a Dev Hub.**

This command simplifies the process of cleaning up your Salesforce development environments by allowing you to easily select and delete multiple scratch orgs. This is crucial for managing your scratch org limits and ensuring that you don't accumulate unnecessary or expired orgs.

Key functionalities:

- **Interactive Scratch Org Selection:** Displays a list of all active scratch orgs linked to your Dev Hub, including their usernames, instance URLs, and last used dates.
- **Multi-Selection:** Allows you to select multiple scratch orgs for deletion.
- **Confirmation Prompt:** Prompts for confirmation before proceeding with the deletion, ensuring that you don't accidentally delete important orgs.
- **Dev Hub Integration:** Works with your configured Dev Hub to manage scratch orgs.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce CLI Integration:** It executes the `sf org list` command to retrieve a list of all scratch orgs associated with the current Dev Hub. It then filters this list to show only active orgs.
- **Interactive Prompts:** Uses the `prompts` library to present a multi-select menu of scratch orgs to the user.
- **Scratch Org Deletion:** For each selected scratch org, it executes the `sf org delete scratch --no-prompt` command to perform the deletion.
- **Error Handling:** Includes basic error handling for Salesforce CLI commands.
- **Data Sorting:** Sorts the list of scratch orgs by username, alias, and instance URL for better readability in the interactive menu.
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
$ sf hardis:scratch:delete
```


