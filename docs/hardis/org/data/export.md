<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:data:export

## Description


## Command Behavior

**Exports data from a Salesforce org using an SFDMU (Salesforce Data Migration Utility) project.**

This command facilitates the extraction of data from your Salesforce environments based on configurations defined in an SFDMU workspace. It's a powerful tool for various data-related tasks, including:

- **Data Backup:** Creating snapshots of your Salesforce data.
- **Data Migration:** Extracting data for transfer to another Salesforce org or external system.
- **Reporting and Analysis:** Exporting specific datasets for detailed analysis outside of Salesforce.
- **Data Seeding:** Preparing data for import into other environments.

Key functionalities:

- **SFDMU Workspace Integration:** Leverages an existing SFDMU workspace (defined by an `export.json` file) to determine which objects and records to export, along with any filtering or transformation rules.
- **Interactive Workspace Selection:** If the SFDMU workspace path is not provided via the `--path` flag, it interactively prompts the user to select one.
- **Org Selection:** Ensures that a target Salesforce org is selected (either via the `--target-org` flag or through an interactive prompt) to specify the source of the data export.

See this article for a practical example:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation relies heavily on the SFDMU plugin:

- **SFDMU Integration:** It acts as a wrapper around the `sfdmu` plugin, which performs the actual data export operations. The command provides an assisted interface for SFDMU execution.
- **`exportData` Utility:** The core logic for executing the SFDMU export process is encapsulated within the `exportData` utility function, which takes the SFDMU workspace path and the source username as arguments.
- **Interactive Prompts:** Uses `selectDataWorkspace` to allow the user to choose an SFDMU project and `promptOrgUsernameDefault` for selecting the source Salesforce org when not running in a CI environment.
- **Environment Awareness:** Checks the `isCI` flag to determine whether to run in an interactive mode (prompting for user input) or a non-interactive mode (relying solely on command-line flags).
- **Required Plugin:** It explicitly lists `sfdmu` as a required plugin, ensuring that the necessary dependency is in place before execution.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| path<br/>-p       | option  | Path to the sfdmu workspace folder                            |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:data:export
```


