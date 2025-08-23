<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:resetselection

## Description


## Command Behavior

**Resets the local Git repository to allow for a new selection of files to be included in a merge request.**

This command is designed to be used when you need to re-evaluate which changes should be part of your next merge request. It performs a soft Git reset, effectively unstaging all committed changes since the last merge with the target branch, and then cleans up any generated files.

Key functionalities:

- **Target Branch Selection:** Prompts you to select the target branch of your current or future merge request.
- **Soft Git Reset:** Performs a `git reset --soft` operation to uncommit changes, moving the HEAD pointer back but keeping the changes in your working directory.
- **Generated File Cleanup:** Resets and checks out `manifest/package.xml` and `manifest/destructiveChanges.xml` to their state before the reset, ensuring a clean slate for new selections.
- **Force Push Authorization:** Sets a flag in your user configuration (`canForcePush: true`) to allow a force push in the subsequent `hardis:work:save` command, as the history will have been rewritten.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Integration:** Uses `simple-git` (`git()`) to interact with the Git repository:
  - `git().branch()`: Retrieves information about local and remote branches.
  - `git().log()`: Fetches the commit history to determine which commits to reset.
  - `git().reset()`: Performs the soft reset operation.
  - `git().checkout()`: Resets specific files (`package.xml`, `destructiveChanges.xml`) to their previous state.
  - `git().status()`: Displays the current status of the Git repository after the reset.
- **Interactive Prompts:** Uses the `prompts` library to confirm the reset operation with the user and to select the target branch.
- **Configuration Management:** Updates the user's configuration (`.sfdx-hardis.yml`) using `setConfig` to set the `canForcePush` flag.
- **Error Handling:** Includes a check to prevent resetting protected branches.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:work:resetsave
```


