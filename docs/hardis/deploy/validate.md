<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:deploy:validate

## Description

sfdx-hardis wrapper for **sf project deploy validate** that displays tips to solve deployment errors.

Note: Use **--json** argument to have better results

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_validate_unified)

### Deployment pre or post commands

You can define command lines to run before or after a deployment, with parameters:

- **id**: Unique Id for the command
- **label**: Human readable label for the command
- **skipIfError**: If defined to "true", the post-command won't be run if there is a deployment failure
- **context**: Defines the context where the command will be run. Can be **all** (default), **check-deployment-only** or **process-deployment-only**
- **runOnlyOnceByOrg**: If set to true, the command will be run only one time per org. A record of SfdxHardisTrace__c is stored to make that possible (it needs to be existing in target org)

If the commands are not the same depending on the target org, you can define them into **config/branches/.sfdx-hardis-BRANCHNAME.yml** instead of root **config/.sfdx-hardis.yml**

Example:

```yaml
commandsPreDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json

commandsPostDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to desired username
    command: sf data update record --sobject User --where "Username='admin-yser@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
  - id: someActionToRunJustOneTime
    label: And to run only if deployment is success
    command: sf sfdmu:run ...
    skipIfError: true
    context: process-deployment-only
    runOnlyOnceByOrg: true
```


## Parameters

| Name                     |  Type   | Description              |                 Default                  | Required | Options |
|:-------------------------|:-------:|:-------------------------|:----------------------------------------:|:--------:|:-------:|
| api-version<br/>-a       | option  | api-version              |                                          |          |         |
| async                    | boolean | async                    |                                          |          |         |
| coverage-formatters      | option  | coverage-formatters      |                                          |          |         |
| debug                    | boolean | debug                    |                                          |          |         |
| dry-run                  | boolean | dry-run                  |                                          |          |         |
| flags-dir                | option  | undefined                |                                          |          |         |
| ignore-conflicts<br/>-c  | boolean | ignore-conflicts         |                                          |          |         |
| ignore-errors<br/>-r     | boolean | ignore-errors            |                                          |          |         |
| ignore-warnings<br/>-g   | boolean | ignore-warnings          |                                          |          |         |
| json                     | boolean | Format output as json.   |                                          |          |         |
| junit                    | boolean | junit                    |                                          |          |         |
| manifest<br/>-x          | option  | manifest                 |                                          |          |         |
| metadata<br/>-m          | option  | metadata                 |                                          |          |         |
| metadata-dir             | option  | metadata-dir             |                                          |          |         |
| post-destructive-changes | option  | post-destructive-changes |                                          |          |         |
| pre-destructive-changes  | option  | pre-destructive-changes  |                                          |          |         |
| purge-on-delete          | boolean | purge-on-delete          |                                          |          |         |
| results-dir              | option  | results-dir              |                                          |          |         |
| single-package           | boolean | single-package           |                                          |          |         |
| source-dir<br/>-d        | option  | source-dir               |                                          |          |         |
| target-org<br/>-o        | option  | undefined                | <nicolas.vuillamy@cloudity.com.playnico> |          |         |
| test-level               | option  | test-level               |                                          |          |         |
| tests                    | option  | tests                    |                                          |          |         |
| wait<br/>-w              | option  | wait                     |                    33                    |          |         |

## Examples


