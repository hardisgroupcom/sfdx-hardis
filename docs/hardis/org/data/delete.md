<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:data:delete

## Description


## Command Behavior

**Deletes records in multiple Salesforce objects using an SFDMU (Salesforce Data Migration Utility) workspace.**

This command provides a powerful and controlled way to remove data from your Salesforce orgs based on configurations defined in an SFDMU workspace. It's particularly useful for:

- **Data Cleanup:** Removing test data, obsolete records, or sensitive information.
- **Environment Reset:** Preparing sandboxes for new development cycles by clearing specific data sets.
- **Compliance:** Deleting data to meet regulatory requirements.

**Important Considerations for Production Environments:**

If you intend to run this command in a production environment, you must:

- Set `runnableInProduction` to `true` in your `export.json` file within the SFDMU workspace.
- Define `sfdmuCanModify: YOUR_INSTANCE_URL` in your branch-specific configuration file (e.g., `config/branches/.sfdx-hardis.YOUR_BRANCH.yml`) to explicitly authorize data modification for that instance.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation relies heavily on the SFDMU plugin:

- **SFDMU Integration:** It leverages the `sfdmu` plugin to perform the actual data deletion operations. The command acts as a wrapper, providing an assisted interface for SFDMU execution.
- **Workspace Selection:** If the SFDMU workspace path is not provided via the `--path` flag, it interactively prompts the user to select a data workspace using `selectDataWorkspace`.
- **Org Selection:** It ensures that a target Salesforce org is selected (either via the `--target-org` flag or through an interactive prompt using `promptOrgUsernameDefault`) to specify where the data deletion will occur.
- **`deleteData` Utility:** The core logic for executing the SFDMU deletion process is encapsulated within the `deleteData` utility function, which takes the SFDMU workspace path and the target username as arguments.
- **Environment Awareness:** It checks the `isCI` flag to determine whether to run in an interactive mode (prompting for user input) or a non-interactive mode (relying solely on command-line flags).
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
$ sf hardis:org:data:delete
```


