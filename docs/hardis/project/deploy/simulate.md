<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:simulate

## Description


## Command Behavior

**Simulates the deployment of Salesforce metadata to a target org, primarily used by the VS Code Extension for quick validation.**

This command allows developers to perform a dry run of a metadata deployment without actually committing changes to the Salesforce org. This is incredibly useful for:

- **Pre-Deployment Validation:** Identifying potential errors, warnings, or conflicts before a full deployment.
- **Troubleshooting:** Quickly testing metadata changes and debugging issues in a safe environment.
- **Local Development:** Validating changes to individual metadata components (e.g., a Permission Set) without needing to run a full CI/CD pipeline.

Key functionalities:

- **Source Specification:** Takes a source file or directory (`--source-dir`) containing the metadata to be simulated.
- **Target Org Selection:** Prompts the user to select a Salesforce org for the simulation. This allows for flexible testing across different environments.
- **Dry Run Execution:** Executes the Salesforce CLI's `sf project deploy start --dry-run` command, which performs all validation steps but does not save any changes to the org.

This command is primarily used by the VS Code Extension to provide immediate feedback to developers.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses `promptOrgUsernameDefault` to allow the user to select the target Salesforce org for the deployment simulation.
- **Salesforce CLI Integration:** It constructs and executes the `sf project deploy start` command with the `--dry-run` and `--ignore-conflicts` flags. The `--source-dir` and `--target-org` flags are dynamically populated based on user input.
- **`wrapSfdxCoreCommand`:** This utility is used to execute the Salesforce CLI command and capture its output.
- **Connection Variables:** Ensures Salesforce connection variables are set using `setConnectionVariables`.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| source-dir<br/>-f | option  | Source file or directory to simulate the deployment           |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:deploy:simulate --source-dir force-app/defaut/main/permissionset/PS_Admin.permissionset-meta.xml
```


