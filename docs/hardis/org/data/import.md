<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:data:import

## Description


## Command Behavior

**Imports and loads data into a Salesforce org using SFDX Data Loader (sfdmu) projects.**

This command enables teams to consistently upload structured data to Salesforce orgs, supporting data seeding, configuration migrations, and test data provisioning. It provides a safe and controlled mechanism for data imports with built-in safeguards for production environments.

Key functionalities:

- **Data Workspace Selection:** Allows selection of SFDX Data Loader projects either by project name, file path, or through an interactive prompt.
- **Target Org Selection:** Supports specifying the target org via command flags or interactive prompts, with default org detection.
- **Production Safeguards:** Implements safety mechanisms to prevent accidental data modifications in production orgs:
  - Requires explicit configuration via `sfdmuCanModify` in .sfdx-hardis.yml config file
  - Or via `SFDMU_CAN_MODIFY` environment variable
- **Interactive Mode:** Provides user-friendly prompts for workspace and org selection when not in CI mode.
- **CI/CD Integration:** Supports non-interactive execution with `--no-prompt` flag for automated pipelines.
- **SFDMU Integration:** Leverages the powerful SFDX Data Loader (sfdmu) plugin for reliable data import operations.

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)

<iframe width="560" height="315" src="https://www.youtube.com/embed/p4E2DUGZ3bs" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SFDX Data Loader Integration:** Requires the `sfdmu` Salesforce CLI plugin to be installed, which is verified before command execution.
- **Workspace Discovery:** Uses `findDataWorkspaceByName()` to locate data projects by name, or `selectDataWorkspace()` for interactive selection from available SFDX Data Loader workspaces.
- **Org Authentication:** Leverages the `target-org` flag with `requiredOrgFlagWithDeprecations` to obtain and validate org authentication.
- **Interactive Prompting:** When not in CI mode and `--no-prompt` is not set, uses `promptOrgUsernameDefault()` to allow users to confirm or change the target org.
- **Data Import Execution:** Delegates the actual import operation to `importData()` utility function, passing the workspace path, command context, and target username.
- **Safety Configuration:** Checks for production org protection configuration in project settings or environment variables before allowing modification of production instances.
- **Path Resolution:** Supports both explicit path specification via `--path` flag and project name lookup via `--project-name` flag.
- **Result Reporting:** Returns structured output with success message and import details for programmatic consumption.

The command is designed to work seamlessly in both interactive development scenarios and automated CI/CD pipelines, ensuring data consistency across different Salesforce environments.
</details>


## Parameters

| Name                |  Type   | Description                                                                           |                Default                 | Required | Options |
|:--------------------|:-------:|:--------------------------------------------------------------------------------------|:--------------------------------------:|:--------:|:-------:|
| debug<br/>-d        | boolean | Activate debug mode (more logs)                                                       |                                        |          |         |
| flags-dir           | option  | undefined                                                                             |                                        |          |         |
| json                | boolean | Format output as json.                                                                |                                        |          |         |
| no-prompt<br/>-r    | boolean | Do not prompt for Org, use default org                                                |                                        |          |         |
| path<br/>-p         | option  | Path to the sfdmu workspace folder                                                    |                                        |          |         |
| project-name<br/>-n | option  | Name of the sfdmu project to use (if not defined, you will be prompted to select one) |                                        |          |         |
| skipauth            | boolean | Skip authentication check when a default username is required                         |                                        |          |         |
| target-org<br/>-o   | option  | undefined                                                                             | nicolas.vuillamy@cloudity.com.afterftd |          |         |
| websocket           | option  | Websocket host:port for VsCode SFDX Hardis UI integration                             |                                        |          |         |

## Examples

```shell
$ sf hardis:org:data:import
```

```shell
$ sf hardis:org:data:import --project-name MyDataProject --target-org my-org@example.com
```

```shell
$ sf hardis:org:data:import --path ./scripts/data/MyDataProject --no-prompt --target-org my-org@example.com
```

```shell
$ SFDMU_CAN_MODIFY=prod-instance.my.salesforce.com sf hardis:org:data:import --project-name MyDataProject --target-org prod@example.com
```


