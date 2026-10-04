<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:new

## Description


## Command Behavior

**Assisted menu to start working on a Salesforce User Story, streamlining the setup of your development environment.**

[![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/new-user-story-2026.gif)](https://www.youtube.com/watch?v=58OPSy40nNA)

This command guides you through the process of preparing your local environment and a Salesforce org for a new development or configuration based User Story. It automates several steps, ensuring consistency and adherence to project standards.

Key features include:

- **Git Branch Management:** Creates a new Git branch with a formatted name based on your User Story details, based on the latest version of the target branch. The new branch is created from `origin/<target>` instead of checking out the target branch locally, so it works even when the target branch is already checked out in another git worktree. Branch naming conventions can be customized via the `branchPrefixChoices` property in `.sfdx-hardis.yml`.

- **Org Provisioning & Initialization:** Facilitates the creation and initialization of either a scratch org or a source-tracked sandbox. The configuration for org initialization (e.g., package installation, source push, permission set assignments, Apex script execution, data loading) can be defined in `config/.sfdx-hardis.yml
- **Project-Specific Configuration:** Supports defining multiple target branches (`availableTargetBranches`) and projects (`availableProjects`) in `.sfdx-hardis.yml`, allowing for tailored User Stories workflows.

- **User Story Name Validation:** Enforces User Story name formatting using `newTaskNameRegex` and provides examples via `newTaskNameRegexExample`. The regex is applied to the name as you type it, so a pattern such as `^MYPROJECT-[0-9]+ .*` can require spaces. Once validated, the name is converted into a git-compatible branch name, where spaces and special characters become `-`.

- **Shared Development Sandboxes:** Accounts for scenarios with shared development sandboxes, adjusting prompts to prevent accidental overwrites.
- **Sandbox initialization:** Only when `offerSandboxInit: true` is set, the command offers to initialize the selected sandbox: installed packages, `initPermissionSets`, `scratchOrgInitApexScripts` and `scripts/data/ScratchInit`. It never deploys metadata.

- **Developer sandbox metadata:** The metadata of an existing sandbox is not updated by this command. To bring into it what the team merged in the target branch, use [hardis:work:backpromote](https://sfdx-hardis.cloudity.com/salesforce-devops-backpromote/) (the Backpromote panel in VS Code).

- **Agent Mode (`--agent`):** Enables a fully non-interactive execution path for AI agents and automation. In this mode, all required decisions must be provided as flags and are validated at command start with explicit error messages listing missing inputs and available options.

### Agent Mode Invocation

Use `--agent` to disable all prompts. Typical usage:

`sf hardis:work:new --agent --task-name "MYPROJECT-123 My Story" --target-branch integration --branch-prefix feature`

Required in agent mode:

- `--task-name`
- `--target-branch`

Optional in agent mode:

- `--branch-prefix` (must be one of configured `branchPrefixChoices` values, usually `feature`, `fix`, or `retrofit`)

In `--agent` mode, org type is computed automatically:

- `currentOrg` when `allowedOrgTypes` is missing
- `currentOrg` when `allowedOrgTypes` only contains `sandbox`
- otherwise first value of `allowedOrgTypes`

In `--agent` mode, the command also computes automatically:

- branch prefix: value provided by `--branch-prefix`, otherwise first configured branch prefix choice, fallback `feature`
- scratch mode: always create a new scratch org

In `--agent` mode, the command intentionally skips:

- sandbox initialization
- updating default target branch in user config

In `--agent` mode, opening org in browser is optional via `--open-org`.

Advanced instructions are available in the [Create New User Story documentation](https://sfdx-hardis.cloudity.com/salesforce-devops-create-new-user-story/).

<details markdown="1">
<summary>Technical explanations</summary>

The command's logic orchestrates various underlying processes:

- **Git Operations:** Utilizes `checkGitClean` and `createWorkBranchFromTarget` to manage Git repository state and branches. `createWorkBranchFromTarget` fetches `origin/<target>` and creates the new branch from it (falling back to the local target ref), checks out the branch if it already exists, and fails with a clear message if it is checked out in another git worktree.
- **Interactive Prompts:** Leverages the `prompts` library to gather user input for User Story type, source types, and User Story names.
- **Configuration Management:** Reads and applies project-specific configurations from `.sfdx-hardis.yml` using `getConfig` and `setConfig- **Org Initialization Utilities:** Calls a suite of utility functions for org setup, including `initApexScripts`, `initOrgData`, `initPermissionSetAssignments`, `installPackages`, and `makeSureOrgIsConnected- **Salesforce CLI Interaction:** Executes Salesforce CLI commands (e.g., `sf config set target-org`, `sf org open`) via `execCommand` and `execSfdxJson- **Dynamic Org Selection:** Presents choices for scratch orgs or sandboxes based on project configuration and existing orgs, dynamically calling `ScratchCreate.run` or `SandboxCreate.run` as needed. A scratch org that a major branch deploys to is never offered for reuse.
- **WebSocket Communication:** Sends refresh status messages via `WebSocketClient.sendRefreshStatusMessage()` to update connected VS Code clients.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own, in these labs:

- [Lab 1.3 - Start a User Story on its own Git branch](https://sfdx-hardis-training.github.io/en/level-1-contributor-basics/1-3-start-a-user-story-on-a-git-branch/)
- [Lab 1.7 - Capstone: deliver a User Story on your own](https://sfdx-hardis-training.github.io/en/level-1-contributor-basics/1-7-capstone-deliver-a-user-story-on-your-own/)
- [Lab 2.2 - Fix a deployment error caused by a missing dependency](https://sfdx-hardis-training.github.io/en/level-2-contributor-advanced/2-2-fix-a-missing-dependency-deployment-error/)
- [Lab 2.9 - Capstone: deliver a User Story that has it all](https://sfdx-hardis-training.github.io/en/level-2-contributor-advanced/2-9-capstone-deliver-a-user-story-that-has-it-all/)
- [Lab 3.7 - Production is broken: hotfix and retrofit](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-7-hotfix-and-retrofit/)
- [Lab 3.10 - Promote a subset with promotion branches (Beta)](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-10-promote-a-subset-with-promotion-branches/)

<!-- training-links:end -->


## Parameters

| Name                  |  Type   | Description                                                                                   | Default | Required | Options |
|:----------------------|:-------:|:----------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                 | boolean | Run in non-interactive mode for agents and automation                                         |         |          |         |
| branch-prefix         | option  | Branch prefix to use (must be in configured branchPrefixChoices, e.g. feature, fix, retrofit) |         |          |         |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                                               |         |          |         |
| flags-dir             | option  | Import flag values from a directory.                                                          |         |          |         |
| json                  | boolean | Format output as json.                                                                        |         |          |         |
| open-org              | boolean | Open the selected org in browser                                                              |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required                                 |         |          |         |
| target-branch         | option  | Target branch to branch from                                                                  |         |          |         |
| target-dev-hub<br/>-v | option  | Username or alias of the Dev Hub org.                                                         |         |          |         |
| target-org<br/>-o     | option  | Username or alias of the target org.                                                          |         |          |         |
| task-name             | option  | Task name used in created branch name                                                         |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                     |         |          |         |

## Examples

```shell
$ sf hardis:work:new
```

```shell
$ sf hardis:work:new --agent --task-name "MYPROJECT-123 My Story" --target-branch integration
```

```shell
$ sf hardis:work:new --agent --task-name "MYPROJECT-123 My Story" --target-branch integration --branch-prefix retrofit
```


