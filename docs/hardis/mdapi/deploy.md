<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:mdapi:deploy

## Description


## Command Behavior

**A wrapper command for Salesforce CLI's `sf project deploy start` (formerly `sfdx force:mdapi:deploy`), designed to assist with deployment error resolution.**

This command facilitates the deployment of metadata API source (either from a zip file, a deployment directory, or a validated deploy request ID) to a Salesforce org. Its primary enhancement over the standard Salesforce CLI command is its ability to provide tips and guidance for solving common deployment errors.

Key features:

- **Flexible Input:** Supports deploying from a `.zip` file (`--zipfile`), a local directory (`--deploydir`), or by referencing a previously validated deployment (`--validateddeployrequestid`).
- **Test Level Control:** Allows specifying the test level for deployments (`NoTestRun`, `RunSpecifiedTests`, `RunLocalTestsInOrg`, `RunAllTestsInOrg`).
- **Error Handling Assistance:** Displays helpful tips and links to documentation to guide you through resolving deployment failures.

**Important Note:** The underlying Salesforce CLI command `sfdx force:mdapi:deploy` is being deprecated by Salesforce in November 2024. It is recommended to migrate to `sf project deploy start` for future compatibility. See [Salesforce CLI Migration Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm) for more information.

For visual assistance with solving deployment errors, refer to this article:

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

<details markdown="1">
<summary>Technical explanations</summary>

This command acts as an intelligent wrapper around the Salesforce CLI's metadata deployment functionality:

- **Command Wrapping:** It uses the `wrapSfdxCoreCommand` utility to execute the `sfdx force:mdapi:deploy` (or its equivalent `sf project deploy start`) command, passing through all relevant flags and arguments.
- **Error Analysis (Implicit):** While the direct code snippet doesn't show explicit error analysis, the description implies that the `wrapSfdxCoreCommand` or a subsequent process intercepts deployment failures and provides contextual help.
- **User Guidance:** It logs messages to the console, including deprecation warnings and pointers to external documentation for troubleshooting.
- **Argument Passthrough:** It directly passes the command-line arguments (`this.argv`) to the underlying Salesforce CLI command, ensuring all standard deployment options are supported.
</details>


## Parameters

| Name                            |  Type   | Description              |  Default  | Required |                                Options                                 |
|:--------------------------------|:-------:|:-------------------------|:---------:|:--------:|:----------------------------------------------------------------------:|
| checkonly<br/>-c                | boolean | checkOnly                |           |          |                                                                        |
| concise                         | boolean | concise                  |           |          |                                                                        |
| debug                           | boolean | debug                    |           |          |                                                                        |
| deploydir<br/>-d                | option  | deployDir                |           |          |                                                                        |
| flags-dir                       | option  | undefined                |           |          |                                                                        |
| ignoreerrors                    | boolean | ignoreErrors             |           |          |                                                                        |
| ignorewarnings<br/>-g           | boolean | ignoreWarnings           |           |          |                                                                        |
| json                            | boolean | Format output as json.   |           |          |                                                                        |
| purgeondelete                   | boolean | purgeOnDelete            |           |          |                                                                        |
| runtests<br/>-r                 | option  | runTests                 |           |          |                                                                        |
| singlepackage<br/>-s            | boolean | singlePackage            |           |          |                                                                        |
| soapdeploy                      | boolean | soapDeploy               |           |          |                                                                        |
| target-org<br/>-o               | option  | undefined                |           |          |                                                                        |
| testlevel<br/>-l                | option  | testLevel                | NoTestRun |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| validateddeployrequestid<br/>-q | option  | validatedDeployRequestId |           |          |                                                                        |
| verbose                         | boolean | verbose                  |           |          |                                                                        |
| wait<br/>-w                     | option  | wait                     |    120    |          |                                                                        |
| websocket                       | option  | websocket                |           |          |                                                                        |
| zipfile<br/>-f                  | option  | zipFile                  |           |          |                                                                        |

## Examples


