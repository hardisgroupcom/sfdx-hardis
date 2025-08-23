<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:new

## Description


## Command Behavior

**Assisted menu to start working on a Salesforce User Story, streamlining the setup of your development environment.**

This command guides you through the process of preparing your local environment and a Salesforce org for a new development or configuration based User Story. It automates several steps, ensuring consistency and adherence to project standards.

Key features include:

- **Git Branch Management:** Ensures your local Git repository is up-to-date with the target branch and creates a new Git branch with a formatted name based on your User Story details. Branch naming conventions can be customized via the `branchPrefixChoices` property in `.sfdx-hardis.yml`.

- **Org Provisioning & Initialization:** Facilitates the creation and initialization of either a scratch org or a source-tracked sandbox. The configuration for org initialization (e.g., package installation, source push, permission set assignments, Apex script execution, data loading) can be defined in `config/.sfdx-hardis.yml
- **Project-Specific Configuration:** Supports defining multiple target branches (`availableTargetBranches`) and projects (`availableProjects`) in `.sfdx-hardis.yml`, allowing for tailored User Stories workflows.

- **User Story Name Validation:** Enforces User Story name formatting using `newTaskNameRegex` and provides examples via `newTaskNameRegexExample
- **Shared Development Sandboxes:** Accounts for scenarios with shared development sandboxes, adjusting prompts to prevent accidental overwrites.

Advanced instructions are available in the [Create New User Story documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-create-new-task/).

<details markdown="1">
<summary>Technical explanations</summary>

The command's logic orchestrates various underlying processes:

- **Git Operations:** Utilizes `checkGitClean`, `ensureGitBranch`, `gitCheckOutRemote`, and `git().pull()` to manage Git repository state and branches.
- **Interactive Prompts:** Leverages the `prompts` library to gather user input for User Story type, source types, and User Story names.
- **Configuration Management:** Reads and applies project-specific configurations from `.sfdx-hardis.yml` using `getConfig` and `setConfig- **Org Initialization Utilities:** Calls a suite of utility functions for org setup, including `initApexScripts`, `initOrgData`, `initOrgMetadatas`, `initPermissionSetAssignments`, `installPackages`, and `makeSureOrgIsConnected- **Salesforce CLI Interaction:** Executes Salesforce CLI commands (e.g., `sf config set target-org`, `sf org open`, `sf project delete tracking`) via `execCommand` and `execSfdxJson- **Dynamic Org Selection:** Presents choices for scratch orgs or sandboxes based on project configuration and existing orgs, dynamically calling `ScratchCreate.run` or `SandboxCreate.run` as needed.
- **WebSocket Communication:** Sends refresh status messages via `WebSocketClient.sendRefreshStatusMessage()` to update connected VS Code clients.
</details>


## Parameters

| Name                  |  Type   | Description                                                   | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir             | option  | undefined                                                     |         |          |         |
| json                  | boolean | Format output as json.                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                     |         |          |         |
| target-org<br/>-o     | option  | undefined                                                     |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:work:new
```


