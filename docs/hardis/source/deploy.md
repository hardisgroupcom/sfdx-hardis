<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:source:deploy

## Description

sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors.

Additional to the base command wrapper: If using **--checkonly**, add options **--checkcoverage** and **--coverageformatters json-summary** to check that org coverage is > 75% (or value defined in .sfdx-hardis.yml property **apexTestsMinCoverageOrgWide**)

### Deployment results

You can also have deployment results as pull request comments, on:

- GitHub (see [GitHub Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-github/))
- Gitlab (see [Gitlab integration configuration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-gitlab/))
- Azure DevOps (see [Azure integration configuration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure/))


[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

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

Notes:

- You can disable coloring of errors in red by defining env variable SFDX_HARDIS_DEPLOY_ERR_COLORS=false

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy)


## Parameters

| Name                            |  Type   | Description             |  Default  | Required |                                Options                                 |
|:--------------------------------|:-------:|:------------------------|:---------:|:--------:|:----------------------------------------------------------------------:|
| checkcoverage                   | boolean | Check Apex org coverage |           |          |                                                                        |
| checkonly<br/>-c                | boolean | checkonly               |           |          |                                                                        |
| coverageformatters              | option  | coverageformatters      |           |          |                                                                        |
| debug                           | boolean | debug                   |           |          |                                                                        |
| flags-dir                       | option  | undefined               |           |          |                                                                        |
| forceoverwrite<br/>-f           | boolean | forceoverwrite          |           |          |                                                                        |
| ignoreerrors<br/>-o             | boolean | ignoreErrors            |           |          |                                                                        |
| ignorewarnings<br/>-g           | boolean | ignoreWarnings          |           |          |                                                                        |
| json                            | boolean | Format output as json.  |           |          |                                                                        |
| junit                           | boolean | junit                   |           |          |                                                                        |
| manifest<br/>-x                 | option  | flagsLong.manifest      |           |          |                                                                        |
| metadata<br/>-m                 | option  | metadata                |           |          |                                                                        |
| postdestructivechanges          | option  | postdestructivechanges  |           |          |                                                                        |
| predestructivechanges           | option  | predestructivechanges   |           |          |                                                                        |
| resultsdir                      | option  | resultsdir              |           |          |                                                                        |
| runtests<br/>-r                 | option  | runTests                |           |          |                                                                        |
| soapdeploy                      | boolean | soapDeploy              |           |          |                                                                        |
| sourcepath<br/>-p               | option  | sourcePath              |           |          |                                                                        |
| target-org<br/>-o               | option  | undefined               |           |          |                                                                        |
| testlevel<br/>-l                | option  | testlevel               | NoTestRun |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| tracksource<br/>-t              | boolean | tracksource             |           |          |                                                                        |
| validateddeployrequestid<br/>-q | option  | validateDeployRequestId |           |          |                                                                        |
| verbose                         | boolean | verbose                 |           |          |                                                                        |
| wait<br/>-w                     | option  | wait                    |    60     |          |                                                                        |
| websocket                       | option  | websocket               |           |          |                                                                        |

## Examples

```shell
sf hardis:source:deploy -x manifest/package.xml --wait 60 --ignorewarnings --testlevel RunLocalTests --postdestructivechanges ./manifest/destructiveChanges.xml --target-org nicolas.vuillamy@cloudity.com.sfdxhardis --checkonly --checkcoverage --verbose --coverageformatters json-summary
```


