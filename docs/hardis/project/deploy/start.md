<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:start

## Description

sfdx-hardis wrapper for **sf project deploy start** that displays tips to solve deployment errors.

Note: Use **--json** argument to have better results

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_start_unified)

### Deployment pre or post commands

You can define command lines to run before or after a deployment, with parameters:

- **id**: Unique Id for the command
- **label**: Human readable label for the command
- **allowFailure**: If defined to "true", a failure of this action does not make the deployment job fail
- **context**: Defines the context where the command will be run. Can be **all** (default), **check-deployment-only** or **process-deployment-only**
- **runOnlyOnceByOrg**: If set to true (default), the action runs only once per target org - subsequent deployments skip it. State is tracked in the "Deployment Actions" PR comment.

Post-deployment actions are never run when the metadata deployment failed: they are reported as `not run` and are proposed again during the next successful deployment.

After every action runs, its result (✅ success, ❌ failed, 👋 manual) is recorded in a dedicated **"Deployment Actions"** PR comment - ordered by org (integration → uat → preprod → prod) - regardless of `runOnlyOnceByOrg`.

When several Pull Requests of the same deployment carry an identical action (same type, phase, user and parameters), it runs once and the other Pull Requests record it as done: see [Identical actions run once](https://sfdx-hardis.cloudity.com/salesforce-devops-work-on-user-story-deployment-actions/#identical-actions-run-once).

If the commands are not the same depending on the target org, you can define them into **config/branches/.sfdx-hardis-BRANCHNAME.yml** instead of root **config/.sfdx-hardis.yml**

You can also keep a single definition and restrict it with `includeTargetBranches` or `excludeTargetBranches` (use `dev-sandboxes` for developer sandboxes).

Example:

```yaml
commandsPreDeploy:
  - id: 32e7e3d7-eeeb-4162-ae9e-a4013e8439e1
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: bf114a50-8f40-4ac2-bf2b-910139292f76
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json

commandsPostDeploy:
  - id: ddd0d387-0b84-4ce5-8b0a-a9a370d2ece3
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: 25891b5b-6053-4f91-9416-037e3e3f6e46
    label: Assign Knowledge user to desired username
    command: sf data update record --sobject User --where "Username='admin-yser@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
  - id: a807b752-71dd-4345-a115-413ccd3dbbcc
    label: And to run only if deployment is success
    command: sf sfdmu:run ...
    context: process-deployment-only
    runOnlyOnceByOrg: true
```

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:deploy:start --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

| Name                     |  Type   | Description                                                                                                  | Default | Required | Options |
|:-------------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                    | boolean | Run in non-interactive mode for agents and automation                                                        |         |          |         |
| api-version<br/>-a       | option  | api-version                                                                                                  |         |          |         |
| async                    | boolean | async                                                                                                        |         |          |         |
| coverage-formatters      | option  | coverage-formatters                                                                                          |         |          |         |
| debug                    | boolean | debug                                                                                                        |         |          |         |
| dry-run                  | boolean | dry-run                                                                                                      |         |          |         |
| flags-dir                | option  | Import flag values from a directory.                                                                         |         |          |         |
| ignore-conflicts<br/>-c  | boolean | ignore-conflicts                                                                                             |         |          |         |
| ignore-errors<br/>-r     | boolean | ignore-errors                                                                                                |         |          |         |
| ignore-warnings<br/>-g   | boolean | ignore-warnings                                                                                              |         |          |         |
| json                     | boolean | Format output as json.                                                                                       |         |          |         |
| junit                    | boolean | junit                                                                                                        |         |          |         |
| manifest<br/>-x          | option  | manifest                                                                                                     |         |          |         |
| metadata<br/>-m          | option  | metadata                                                                                                     |         |          |         |
| metadata-dir             | option  | metadata-dir                                                                                                 |         |          |         |
| post-destructive-changes | option  | post-destructive-changes                                                                                     |         |          |         |
| pre-destructive-changes  | option  | pre-destructive-changes                                                                                      |         |          |         |
| purge-on-delete          | boolean | purge-on-delete                                                                                              |         |          |         |
| results-dir              | option  | results-dir                                                                                                  |         |          |         |
| single-package           | boolean | single-package                                                                                               |         |          |         |
| source-dir<br/>-d        | option  | source-dir                                                                                                   |         |          |         |
| target-org<br/>-o        | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set. |         |   true   |         |
| test-level               | option  | test-level                                                                                                   |         |          |         |
| tests                    | option  | tests                                                                                                        |         |          |         |
| wait<br/>-w              | option  | wait                                                                                                         |   33    |          |         |

## Examples


