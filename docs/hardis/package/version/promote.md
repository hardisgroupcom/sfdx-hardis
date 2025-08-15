<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:version:promote

## Description


## Command Behavior

**Promotes a Salesforce package version from beta to released status in your Dev Hub.**

This command is a critical step in the package development lifecycle, marking a package version as stable and ready for production use. Once promoted, a package version can be installed in production organizations.

Key functionalities:

- **Package Version Selection:** Allows you to select a specific package version to promote. If the `--auto` flag is used, it automatically identifies package versions that are not yet released and promotes them.
- **Automated Promotion:** When `--auto` is enabled, it queries for all unreleased package versions and promotes them without further user interaction.
- **Dev Hub Integration:** Interacts with your connected Dev Hub to change the status of the package version.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Package Alias Retrieval:** It retrieves package aliases from your `sfdx-project.json` to identify available packages.
- **Automated Promotion Logic:** If `--auto` is used, it executes `sf package version list --released` to get a list of already released packages and then filters the available package aliases to find those that are not yet released.
- **Interactive Prompts:** If not in auto mode, it uses the `prompts` library to allow the user to select a package version to promote.
- **Salesforce CLI Integration:** It constructs and executes the `sf package version promote` command, passing the package version ID.
- **`execSfdxJson`:** This utility is used to execute the Salesforce CLI command and capture its JSON output.
- **Error Handling:** It handles cases where a package version might already be promoted or if other errors occur during the promotion process.
</details>


## Parameters

| Name                  |  Type   | Description                                                      | Default | Required | Options |
|:----------------------|:-------:|:-----------------------------------------------------------------|:-------:|:--------:|:-------:|
| auto<br/>-f           | boolean | Auto-detect which versions of which packages need to be promoted |         |          |         |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                  |         |          |         |
| flags-dir             | option  | undefined                                                        |         |          |         |
| json                  | boolean | Format output as json.                                           |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required    |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                        |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration        |         |          |         |

## Examples

```shell
$ sf hardis:package:version:promote
```

```shell
$ sf hardis:package:version:promote --auto
```


