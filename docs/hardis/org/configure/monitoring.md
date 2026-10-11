<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:monitoring

## Description


## Command Behavior

> **This command requires human interaction and must be called manually, preferably from the [VS Code SFDX Hardis UI](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis). It is not suitable for automation or AI agent usage.**

**Configures the monitoring of a Salesforce org within a dedicated Git repository.**

This command streamlines the setup of continuous monitoring for a Salesforce organization, ensuring that changes and health metrics are tracked and reported. It is designed to be run within a Git repository specifically dedicated to monitoring configurations.

Key functionalities include:

- **Git Repository Validation:** Ensures the current Git repository's name contains "monitoring" to enforce best practices for separating monitoring configurations from deployment sources.
- **Prerequisite Check:** Guides the user to confirm that necessary monitoring prerequisites (CI/CD variables, permissions) are configured on their Git server.
- **Org Selection:** Prompts the user to select or connect to the Salesforce org they wish to monitor.
- **Monitoring Branch Creation:** Creates or checks out a dedicated Git branch (e.g., `monitoring_yourinstanceurl`) for the monitoring configuration.
- **SFDX Project Setup:** Initializes an SFDX project structure within the repository if it doesn't already exist, and copies default monitoring files.
- **Configuration File Update:** Updates the local `.sfdx-hardis.yml` file with the target org's username and instance URL.
- **Deployment Repository:** Asks for the address of the sfdx-hardis CI/CD repository that deploys to the org (optional, pass `--deployment-repository` to skip the question). It is stored as `deploymentRepository`, and suggested from the other monitoring branches of the repository. Emptying the answer, or passing an empty `--deployment-repository`, removes a value set before. The `AGENTS.md` file written at each backup then tells coding agents to search that repository and the pipelines of both repositories.
- **SSL Certificate Generation:** Generates an SSL certificate for secure authentication to the monitored org.
- **Automated Commit and Push:** Offers to automatically commit and push the generated configuration files to the remote Git repository.
- **Scheduling:** On GitHub, writes the monitoring workflow on the default branch with this org in its matrix and its two secrets in its jobs, since GitHub only schedules, and only offers Run workflow for, the workflows of that branch. On other Git servers, gives the instructions to schedule the job.
- **Empty repository:** A repository created empty on the Git server gets a first empty commit on `main`, so that the monitoring branch has something to start from.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of Git operations, file system manipulations, and Salesforce CLI interactions:

- **Git Operations:** Utilizes `ensureGitRepository`, `getGitRepoName`, `execCommand` (for `git add`, `git stash`), `ensureGitBranch`, and `gitAddCommitPush` to manage the Git repository, branches, and commits.
- **Interactive Prompts:** Employs the `prompts` library to interact with the user for confirmations and selections.
- **File System Management:** Uses Node.js `fs` for copying default monitoring files (`defaults/monitoring`) and managing the SFDX project structure.
- **Salesforce CLI Integration:** Calls `sf project generate` to create a new SFDX project and uses `promptOrg` for Salesforce org authentication and selection.
- **Configuration Management:** Updates the `.sfdx-hardis.yml` file using `setInConfigFile` to store org-specific monitoring configurations.
- **SSL Certificate Generation:** Leverages `generateSSLCertificate` to create the necessary SSL certificates for JWT-based authentication to the Salesforce org.
- **External Tool Integration:** Requires `openssl` to be installed on the system for SSL certificate generation.
- **WebSocket Communication:** Uses `WebSocketClient.sendRunSfdxHardisCommandMessage` to restart the command in VS Code if the default org changes, and `WebSocketClient.sendRefreshStatusMessage` to update the status.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own:

- [Lab 3.8 - Monitor your production org](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-8-monitor-your-production-org/)

<!-- training-links:end -->


## Parameters

| Name                  |  Type   | Description                                                                                                                                                | Default | Required | Options |
|:----------------------|:-------:|:-----------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                                                                                                            |         |          |         |
| deployment-repository | option  | Address of the sfdx-hardis CI/CD repository that deploys to the monitored org, stored as deploymentRepository without prompting. An empty value removes it |         |          |         |
| flags-dir             | option  | Import flag values from a directory.                                                                                                                       |         |          |         |
| json                  | boolean | Format output as json.                                                                                                                                     |         |          |         |
| orginstanceurl        | option  | Org instance url (technical param, do not use manually)                                                                                                    |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required                                                                                              |         |          |         |
| target-org<br/>-o     | option  | Username or alias of the target org.                                                                                                                       |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                  |         |          |         |

## Examples

```shell
$ sf hardis:org:configure:monitoring
```

```shell
$ sf hardis:org:configure:monitoring --deployment-repository https://github.com/my-company/my-project
```


