<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:save

## Description


## Command Behavior

**Guides the user through the process of saving their work, preparing it for a Merge Request (also named Pull Request), and pushing changes to the remote Git repository.**

[![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/retrieve-and-commit-2026.gif)](https://www.youtube.com/watch?v=96i6M6CMflQ)

[![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/save-publish-pr-2026.gif)](https://www.youtube.com/watch?v=-h94uLQB62I)

This command automates several critical steps involved in finalizing a development User Story and integrating it into the main codebase. It ensures that your local changes are properly synchronized, cleaned, and committed before being pushed.

Key functionalities include:

- **Git Status Management:** Ensures a clean Git working directory by handling ongoing merges and unstaging files.
- **Org Synchronization (Optional):** In interactive mode, prompts the user to pull the latest metadata updates from their scratch org or source-tracked sandbox, ensuring local files reflect the org's state.
- **Package.xml Updates:** Automatically generates `package.xml` and `destructiveChanges.xml` files based on the Git delta between your current branch and the target branch, reflecting added, modified, and deleted metadata.
- **Automated Source Cleaning:** Applies predefined cleaning operations to your local Salesforce sources, such as removing unwanted references, minimizing profiles, or cleaning XML files based on configurations in your `.sfdx-hardis.yml`.
  - `autoCleanTypes`: A list of automated source cleanings, configurable via [hardis:project:clean:references](https://sfdx-hardis.cloudity.com/hardis/project/clean/references/).
  - `autoRemoveUserPermissions`: A list of user permissions to automatically remove from profile metadata.
  - The `flowPositions` cleaning is restricted to the Flows of the git delta `package.xml`, so it is not run at all when the User Story contains no Flow.
- **Deployment Plan Generation:** Builds an automated deployment plan based on the updated `package.xml` and configured deployment splits.
- **Commit and Push:** Guides the user to commit the changes and push them to the remote Git repository, optionally handling force pushes if a branch reset occurred.
- **Merge Request Guidance:** Provides information and links to facilitate the creation of a merge request after the changes are pushed.
- **Agent Mode (`--agent`):** Enables a fully non-interactive execution path for AI agents and automation. In this mode, prompts are disabled and decisions are derived from flags and configuration.
- **Expert Mode (`--expert`):** Skips the confirmation questions for experienced users, while keeping the prompts that ask for a real choice, like the target branch when it can not be guessed.

### Agent Mode Invocation

Use `--agent` to disable prompts. Typical usage:

`sf hardis:work:save --agent`

In `--agent` mode:

- target branch is resolved from `--targetbranch` when provided
- otherwise target branch is inferred from `localStorageBranchTargets` in user config for the current local branch
- metadata pull is always skipped (commits are assumed to be already prepared)
- data export is always skipped
- push is always attempted at the end of the command (unless `--nogit` is set)

If target branch cannot be resolved, the command fails fast with a validation error listing available options.

### Expert Mode

Use `--expert` to skip the confirmation questions:

`sf hardis:work:save --expert`

In `--expert` mode:

- the "have you already committed the updated metadata" question is skipped: your commits are assumed to be ready
- the data export questions are skipped
- the cleaning types selection is skipped: only the cleanings listed in `autoCleanTypes` are applied, none if the property is not set
- commits are pushed to the remote branch without confirmation
- the Merge Request page is opened in your browser at the end of the command

Prompts that ask for a real choice are kept, like the target branch selection when it can not be guessed.

Expert mode can also be activated for all commands with the environment variable `SFDX_HARDIS_EXPERT_MODE=true`.

VS Code users can activate it permanently with the setting **VsCode SFDX Hardis > User Mode Expert**, which sends `SFDX_HARDIS_EXPERT_MODE=true` to every sfdx-hardis command.

Example `.sfdx-hardis.yml` configuration:

```yaml
autoCleanTypes:
  - checkPermissions
  - destructivechanges
  - datadotcom
  - minimizeProfiles
  - listViewsMine
autoRemoveUserPermissions:
  - EnableCommunityAppLauncher
  - FieldServiceAccess
  - OmnichannelInventorySync
  - SendExternalEmailAvailable
  - UseOmnichannelInventoryAPIs
  - ViewDataLeakageEvents
  - ViewMLModels
  - ViewPlatformEvents
  - WorkCalibrationUser
```

Advanced instructions are available in the [Publish a User Story documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of orchestrated steps:

- **Git Integration:** Extensively uses the `git` utility for status checks, adding files, committing, and pushing. It also leverages `sfdx-git-delta` for generating metadata differences between Git revisions.
- **Interactive Prompts:** Employs the `prompts` library in interactive mode for decisions like pulling sources or pushing commits. In `--agent` mode, prompts are skipped.
- **Configuration Management:** Reads and updates project and user configurations using `getConfig` and `setConfig` to store preferences and deployment plans.
- **Metadata Synchronization:** Calls `forceSourcePull` in interactive mode when requested, and `callSfdxGitDelta` to generate `package.xml` and `destructiveChanges.xml` based on Git changes.
- **XML Manipulation:** Utilizes `appendPackageXmlFilesContent`, `removePackageXmlFilesContent`, `parseXmlFile`, and `writeXmlFile` for modifying `package.xml` and `destructiveChanges.xml` files.
- **Automated Cleaning:** Integrates with `CleanReferences.run` and `CleanXml.run` commands to perform automated cleaning operations on the Salesforce source files.
- **Deployment Plan Building:** Dynamically constructs a deployment plan by analyzing the `package.xml` content and applying configured deployment splits.
- **WebSocket Communication:** Uses `WebSocketClient.sendRefreshStatusMessage` to notify connected VS Code clients about status updates.
- **External Tool Integration:** Requires the `sfdx-git-delta` plugin to be installed for its core functionality.
</details>


## Parameters

| Name              |  Type   | Description                                                                                                                                                                                   | Default | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                                                         |         |          |         |
| auto              | boolean | No user prompts (when called from CI for example)                                                                                                                                             |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                                                                                               |         |          |         |
| expert            | boolean | Skip the confirmation questions (commit readiness, data export, cleaning selection, push) and open the Merge Request page at the end. Can also be activated with SFDX_HARDIS_EXPERT_MODE=true |         |          |         |
| flags-dir         | option  | undefined                                                                                                                                                                                     |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                                                        |         |          |         |
| noclean<br/>-c    | boolean | No cleaning of local sources                                                                                                                                                                  |         |          |         |
| nogit<br/>-g      | boolean | No automated git operations                                                                                                                                                                   |         |          |         |
| nopull<br/>-n     | boolean | No scratch pull before save                                                                                                                                                                   |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                                 |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                                                                                                                     |         |          |         |
| targetbranch      | option  | Name of the Merge Request target branch. Will be guessed or prompted if not provided.                                                                                                         |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                     |         |          |         |

## Examples

```shell
$ sf hardis:work:task:save
```

```shell
$ sf hardis:work:task:save --nopull --nogit --noclean
```

```shell
$ sf hardis:work:save --expert
```

```shell
$ sf hardis:work:save --agent --targetbranch integration
```


