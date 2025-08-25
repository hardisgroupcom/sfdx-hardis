<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:refresh

## Description


## Command Behavior

**Refreshes your local Git branch and Salesforce org with the latest content from another Git branch.**

This command is designed to help developers keep their local development environment synchronized with changes made by other team members. It automates the process of pulling updates from a designated branch, merging them into your current working branch, and then pushing those changes to your scratch org or source-tracked sandbox.

Key functionalities:

- **Pre-Merge Check:** Prompts the user to confirm that they have saved their current work before proceeding with the merge, preventing accidental data loss.
- **Branch Selection:** Allows you to select a target Git branch (e.g., `integration`, `preprod`) from which to pull updates.
- **Git Operations:** Performs a series of Git operations:
  - Pulls the latest version of the selected merge branch.
  - Stashes your uncommitted local changes before merging.
  - Merges the selected branch into your current local branch.
  - Handles merge conflicts interactively, prompting the user to resolve them.
  - Restores your stashed changes after the merge.
- **Org Synchronization:** Pushes the updated local branch content to your scratch org or source-tracked sandbox, ensuring your org reflects the latest merged code.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves project configurations using `getConfig` to determine the default development branch.
- **Git Integration:** Extensively uses `simple-git` (`git()`) for various Git operations:
  - `git().branch()`: Lists local and remote branches.
  - `git().stash()`: Saves and restores uncommitted changes.
  - `git().fetch()`: Fetches updates from remote repositories.
  - `git().checkout()`: Switches between branches.
  - `git().pull()`: Pulls changes from a remote branch.
  - `git().merge()`: Merges one branch into another, handling conflicts.
- **Interactive Prompts:** Uses the `prompts` library to guide the user through confirmations (e.g., saving work) and branch selection.
- **Salesforce CLI Integration:** It uses `forceSourcePull` to pull changes from the scratch org and `forceSourcePush` to push changes to the scratch org.
- **Error Handling:** Includes robust error handling for Git operations (e.g., merge conflicts) and provides guidance to the user for resolution.
- **Environment Variable Check:** Checks for an `EXPERIMENTAL` environment variable to gate access to this command, indicating it might not be fully stable.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| nopull<br/>-n     | boolean | No scratch pull before save (careful if you use that!)        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:work:refresh
```


