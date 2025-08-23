<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:lint

## Description

## Command Behavior

**Applies syntactic analysis (linting) to your repository sources using Mega-Linter, ensuring code quality and adherence to coding standards.**

This command integrates Mega-Linter, a comprehensive linter orchestrator, into your Salesforce DX project. It helps identify and fix code style violations, potential bugs, and other issues across various file types relevant to Salesforce development.

Key functionalities:

- **Automated Linting:** Runs a suite of linters configured for Salesforce projects.
- **Fixing Issues (`--fix` flag):** Automatically attempts to fix detected linting issues, saving manual effort.
- **Configuration Management:** If `.mega-linter.yml` is not found, it guides you through the initial setup of Mega-Linter, prompting for the Salesforce flavor.
- **CI/CD Integration:** Designed to be used in CI/CD pipelines to enforce code quality gates.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Mega-Linter Integration:** It leverages the `mega-linter-runner` library to execute Mega-Linter.
- **Configuration Check:** Before running, it checks for the presence of `.mega-linter.yml`. If not found and not in a CI environment, it initiates an interactive setup process using `MegaLinterRunner().run({ install: true })`.
- **Linter Execution:** It calls `MegaLinterRunner().run(megaLinterOptions)` with the `salesforce` flavor and the `fix` flag (if provided).
- **Exit Code Handling:** The `process.exitCode` is set based on the Mega-Linter's exit status, allowing CI/CD pipelines to react to linting failures.
- **User Feedback:** Provides clear messages about the success or failure of the linting process.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| fix<br/>-f        | boolean | Apply linters fixes                                           |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:lint
```

```shell
$ sf hardis:project:lint --fix
```


