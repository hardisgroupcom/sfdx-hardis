<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:create

## Description


## Command Behavior

**Creates a new Salesforce package (either Managed or Unlocked) in your Dev Hub.**

This command streamlines the process of setting up a new Salesforce package, which is a fundamental step for modularizing your Salesforce metadata and enabling continuous integration and delivery practices. It guides you through defining the package's essential properties.

Key functionalities:

- **Interactive Package Definition:** Prompts you for the package name, the path to its source code, and the package type (Managed or Unlocked).
- **Package Type Selection:**
  - **Managed Packages:** Ideal for AppExchange solutions, where code is hidden in subscriber orgs.
  - **Unlocked Packages:** Suitable for client projects or shared tooling, where code is readable and modifiable in subscriber orgs.
- **Package Creation:** Executes the Salesforce CLI command to create the package in your connected Dev Hub.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Prompts:** Uses the `prompts` library to gather necessary information from the user, such as `packageName`, `packagePath`, and `packageType`.
- **Salesforce CLI Integration:** It constructs and executes the `sf package create` command, passing the user-provided details as arguments.
- **`execSfdxJson`:** This utility is used to execute the Salesforce CLI command and capture its JSON output, which includes the newly created package's ID.
- **User Feedback:** Provides clear messages to the user about the successful creation of the package, including its ID and the associated Dev Hub.
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
$ sf hardis:package:create
```


