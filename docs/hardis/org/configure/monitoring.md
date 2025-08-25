<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:monitoring

## Description


## Command Behavior

**Configures the monitoring of a Salesforce org within a dedicated Git repository.**

This command streamlines the setup of continuous monitoring for a Salesforce organization, ensuring that changes and health metrics are tracked and reported. It is designed to be run within a Git repository specifically dedicated to monitoring configurations.

Key functionalities include:

- **Git Repository Validation:** Ensures the current Git repository's name contains "monitoring" to enforce best practices for separating monitoring configurations from deployment sources.
- **Prerequisite Check:** Guides the user to confirm that necessary monitoring prerequisites (CI/CD variables, permissions) are configured on their Git server.
- **Org Selection:** Prompts the user to select or connect to the Salesforce org they wish to monitor.
- **Monitoring Branch Creation:** Creates or checks out a dedicated Git branch (e.g., `monitoring_yourinstanceurl`) for the monitoring configuration.
- **SFDX Project Setup:** Initializes an SFDX project structure within the repository if it doesn't already exist, and copies default monitoring files.
- **Configuration File Update:** Updates the local `.sfdx-hardis.yml` file with the target org's username and instance URL.
- **SSL Certificate Generation:** Generates an SSL certificate for secure authentication to the monitored org.
- **Automated Commit and Push:** Offers to automatically commit and push the generated configuration files to the remote Git repository.
- **Scheduling Guidance:** Provides instructions and links for scheduling the monitoring job on the Git server.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of Git operations, file system manipulations, and Salesforce CLI interactions:

- **Git Operations:** Utilizes `ensureGitRepository`, `getGitRepoName`, `execCommand` (for `git add`, `git stash`), `ensureGitBranch`, and `gitAddCommitPush` to manage the Git repository, branches, and commits.
- **Interactive Prompts:** Employs the `prompts` library to interact with the user for confirmations and selections.
- **File System Management:** Uses `fs-extra` for copying default monitoring files (`defaults/monitoring`) and managing the SFDX project structure.
- **Salesforce CLI Integration:** Calls `sf project generate` to create a new SFDX project and uses `promptOrg` for Salesforce org authentication and selection.
- **Configuration Management:** Updates the `.sfdx-hardis.yml` file using `setInConfigFile` to store org-specific monitoring configurations.
- **SSL Certificate Generation:** Leverages `generateSSLCertificate` to create the necessary SSL certificates for JWT-based authentication to the Salesforce org.
- **External Tool Integration:** Requires `openssl` to be installed on the system for SSL certificate generation.
- **WebSocket Communication:** Uses `WebSocketClient.sendRunSfdxHardisCommandMessage` to restart the command in VS Code if the default org changes, and `WebSocketClient.sendRefreshStatusMessage` to update the status.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| orginstanceurl    | option  | Org instance url (technical param, do not use manually)       |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:configure:monitoring
```


