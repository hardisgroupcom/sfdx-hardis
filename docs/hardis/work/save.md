<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:save

## Description


## Command Behavior

**Guides the user through the process of saving their work, preparing it for a Merge Request (also named Pull Request), and pushing changes to the remote Git repository.**

This command automates several critical steps involved in finalizing a development User Story and integrating it into the main codebase. It ensures that your local changes are properly synchronized, cleaned, and committed before being pushed.

Key functionalities include:

- **Git Status Management:** Ensures a clean Git working directory by handling ongoing merges and unstaging files.
- **Org Synchronization (Optional):** Prompts the user to pull the latest metadata updates from their scratch org or source-tracked sandbox, ensuring local files reflect the org's state.
- **Package.xml Updates:** Automatically generates `package.xml` and `destructiveChanges.xml` files based on the Git delta between your current branch and the target branch, reflecting added, modified, and deleted metadata.
- **Automated Source Cleaning:** Applies predefined cleaning operations to your local Salesforce sources, such as removing unwanted references, minimizing profiles, or cleaning XML files based on configurations in your `.sfdx-hardis.yml`.
  - `autoCleanTypes`: A list of automated source cleanings, configurable via [hardis:project:clean:references](${CONSTANTS.DOC_URL_ROOT}/hardis/project/clean/references/).
  - `autoRemoveUserPermissions`: A list of user permissions to automatically remove from profile metadata.
- **Deployment Plan Generation:** Builds an automated deployment plan based on the updated `package.xml` and configured deployment splits.
- **Commit and Push:** Guides the user to commit the changes and push them to the remote Git repository, optionally handling force pushes if a branch reset occurred.
- **Merge Request Guidance:** Provides information and links to facilitate the creation of a merge request after the changes are pushed.

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

Advanced instructions are available in the [Publish a User Story documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of orchestrated steps:

- **Git Integration:** Extensively uses the `git` utility for status checks, adding files, committing, and pushing. It also leverages `sfdx-git-delta` for generating metadata differences between Git revisions.
- **Interactive Prompts:** Employs the `prompts` library to interact with the user for decisions like pulling sources or pushing commits.
- **Configuration Management:** Reads and updates project and user configurations using `getConfig` and `setConfig` to store preferences and deployment plans.
- **Metadata Synchronization:** Calls `forceSourcePull` to retrieve metadata from the org and `callSfdxGitDelta` to generate `package.xml` and `destructiveChanges.xml` based on Git changes.
- **XML Manipulation:** Utilizes `appendPackageXmlFilesContent`, `removePackageXmlFilesContent`, `parseXmlFile`, and `writeXmlFile` for modifying `package.xml` and `destructiveChanges.xml` files.
- **Automated Cleaning:** Integrates with `CleanReferences.run` and `CleanXml.run` commands to perform automated cleaning operations on the Salesforce source files.
- **Deployment Plan Building:** Dynamically constructs a deployment plan by analyzing the `package.xml` content and applying configured deployment splits.
- **WebSocket Communication:** Uses `WebSocketClient.sendRefreshStatusMessage` to notify connected VS Code clients about status updates.
- **External Tool Integration:** Requires the `sfdx-git-delta` plugin to be installed for its core functionality.
</details>


## Parameters

| Name              |  Type   | Description                                                                           | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| auto              | boolean | No user prompts (when called from CI for example)                                     |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                       |         |          |         |
| flags-dir         | option  | undefined                                                                             |         |          |         |
| json              | boolean | Format output as json.                                                                |         |          |         |
| noclean<br/>-c    | boolean | No cleaning of local sources                                                          |         |          |         |
| nogit<br/>-g      | boolean | No automated git operations                                                           |         |          |         |
| nopull<br/>-n     | boolean | No scratch pull before save                                                           |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                         |         |          |         |
| target-org<br/>-o | option  | undefined                                                                             |         |          |         |
| targetbranch      | option  | Name of the Merge Request target branch. Will be guessed or prompted if not provided. |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                             |         |          |         |

## Examples

```shell
$ sf hardis:work:task:save
```

```shell
$ sf hardis:work:task:save --nopull --nogit --noclean
```


