<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:sources:dx

## Description

Smart deploy of SFDX sources to target org, with many useful options.

In case of errors, [tips to fix them](https://sfdx-hardis.cloudity.com/deployTips/) will be included within the error messages.

### Quick Deploy

In case Pull Request comments are configured on the project, Quick Deploy will try to be used (equivalent to button Quick Deploy)

If you do not want to use QuickDeploy, define variable `SFDX_HARDIS_QUICK_DEPLOY=false`

- [GitHub Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-github/)
- [Gitlab Merge requests notes config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-gitlab/)
- [Azure Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure/)

### Delta deployments

To activate delta deployments, define property `useDeltaDeployment: true` in `config/.sfdx-hardis.yml`.

This will activate delta deployments only between minor and major branches (major to major remains full deployment mode)

If you want to force the delta deployment into major orgs (ex: preprod to prod), this is not recommended but you can use env variable ALWAYS_ENABLE_DELTA_DEPLOYMENT=true

### Smart Deployments Tests

Not all metadata updates can break test classes, use Smart Deployment Tests to skip running test classes if ALL the following conditions are met:

- Delta deployment is activated and applicable to the source and target branches
- Delta deployed metadatas are all matching the list of **NOT_IMPACTING_METADATA_TYPES** (see below)
- Target org is not a production org

Activate Smart Deployment tests with:

- env variable `USE_SMART_DEPLOYMENT_TESTS=true`
- .sfdx-hardis.yml config property `useSmartDeploymentTests: true`

Defaut list for **NOT_IMPACTING_METADATA_TYPES** (can be overridden with comma-separated list on env var NOT_IMPACTING_METADATA_TYPES)

- Audience
- AuraDefinitionBundle
- Bot
- BotVersion
- ContentAsset
- CustomObjectTranslation
- CustomSite
- CustomTab
- Dashboard
- ExperienceBundle
- Flexipage
- GlobalValueSetTranslation
- Layout
- LightningComponentBundle
- NavigationMenu
- ReportType
- Report
- SiteDotCom
- StandardValueSetTranslation
- StaticResource
- Translations

Note: if you want to disable Smart test classes for a PR, add **nosmart** in the text of the latest commit.

### Dynamic deployment items / Overwrite management

If necessary,you can define the following files (that supports wildcards <members>*</members>):

- `manifest/package-no-overwrite.xml`: Every element defined in this file will be deployed only if it is not existing yet in the target org (can be useful with ListView for example, if the client wants to update them directly in production org).
  - Can be overridden for a branch using .sfdx-hardis.yml property **packageNoOverwritePath** or environment variable PACKAGE_NO_OVERWRITE_PATH (for example, define: `packageNoOverwritePath: manifest/package-no-overwrite-main.xml` in config file `config/.sfdx-hardis.main.yml`)
- `manifest/packageXmlOnChange.xml`: Every element defined in this file will not be deployed if it already has a similar definition in target org (can be useful for SharingRules for example)

See [Overwrite management documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-overwrite/)

### Deployment plan

If you need to deploy in multiple steps, you can define a property `deploymentPlan` in `.sfdx-hardis.yml`.

- If a file `manifest/package.xml` is found, it will be placed with order 0 in the deployment plan

- If a file `manifest/destructiveChanges.xml` is found, it will be executed as --postdestructivechanges

- If env var `SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES` is defined as `false` , split of package.xml will be applied

Example:

```yaml
deploymentPlan:
  packages:
    - label: Deploy Flow-Workflow
      packageXmlFile: manifest/splits/packageXmlFlowWorkflow.xml
      order: 6
    - label: Deploy SharingRules - Case
      packageXmlFile: manifest/splits/packageXmlSharingRulesCase.xml
      order: 30
      waitAfter: 30
```

### Packages installation

You can define a list of package to install during deployments using property `installedPackages`

- If `INSTALL_PACKAGES_DURING_CHECK_DEPLOY` is defined as `true` (or `installPackagesDuringCheckDeploy: true` in `.sfdx-hardis.yml`), packages will be installed even if the command is called with `--check` mode
- You can automatically update this property by listing all packages installed on an org using command `sf hardis:org:retrieve:packageconfig`

Example:

```yaml
installedPackages:
  - Id: 0A35r0000009EtECAU
    SubscriberPackageId: 033i0000000LVMYAA4
    SubscriberPackageName: Marketing Cloud
    SubscriberPackageNamespace: et4ae5
    SubscriberPackageVersionId: 04t6S000000l11iQAA
    SubscriberPackageVersionName: Marketing Cloud
    SubscriberPackageVersionNumber: 236.0.0.2
    installOnScratchOrgs: true                  // true or false depending you want to install this package when creating a new scratch org
    installDuringDeployments: true              // set as true to install package during a deployment using sf hardis:project:deploy:smart
    installationkey: xxxxxxxxxxxxxxxxxxxx       // if the package has a password, write it in this property
    - Id: 0A35r0000009F9CCAU
    SubscriberPackageId: 033b0000000Pf2AAAS
    SubscriberPackageName: Declarative Lookup Rollup Summaries Tool
    SubscriberPackageNamespace: dlrs
    SubscriberPackageVersionId: 04t5p000001BmLvAAK
    SubscriberPackageVersionName: Release
    SubscriberPackageVersionNumber: 2.15.0.9
    installOnScratchOrgs: true
    installDuringDeployments: true
```

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

### Automated fixes post deployments

#### List view with scope Mine

If you defined a property **listViewsToSetToMine** in your .sfdx-hardis.yml, related ListViews will be set to Mine ( see command <https://sfdx-hardis.cloudity.com/hardis/org/fix/listviewmine/> )

Example:

```yaml
listViewsToSetToMine:
  - "Operation__c:MyCurrentOperations"
  - "Operation__c:MyFinalizedOperations"
  - "Opportunity:Default_Opportunity_Pipeline"
  - "Opportunity:MyCurrentSubscriptions"
  - "Opportunity:MySubscriptions"
  - "Account:MyActivePartners"
```

Troubleshooting: if you need to fix ListViews with mine from an alpine-linux based docker image, use this workaround in your dockerfile:

```dockerfile
# Do not use puppeteer embedded chromium
RUN apk add --update --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
ENV CHROMIUM_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_EXECUTABLE_PATH="$\{CHROMIUM_PATH}" // remove \ before {
```

If you need to increase the deployment waiting time (sf project deploy start --wait arg), you can define env variable SFDX_DEPLOY_WAIT_MINUTES (default: 120)

If you need notifications to be sent using the current Pull Request and not the one just merged ([see use case](https://github.com/hardisgroupcom/sfdx-hardis/issues/637#issuecomment-2230798904)), define env variable SFDX_HARDIS_DEPLOY_BEFORE_MERGE=true

If you want to disable the calculation and display of Flow Visual Git Diff in Pull Request comments, define variable **SFDX_DISABLE_FLOW_DIFF=true**


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|check<br/>-c|boolean|Only checks the deployment, there is no impact on target org||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|delta|boolean|Applies sfdx-git-delta to package.xml before other deployment processes||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|packagexml<br/>-p|option|Path to package.xml containing what you want to deploy in target org||||
|runtests<br/>-r|option|If testlevel=RunSpecifiedTests, please provide a list of classes.
If testlevel=RunRepositoryTests, can contain a regular expression to keep only class names matching it. If not set, will run all test classes found in the repo.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|testlevel<br/>-l|option|Level of tests to validate deployment. RunRepositoryTests auto-detect and run all repository test classes|||NoTestRun<br/>RunSpecifiedTests<br/>RunRepositoryTests<br/>RunRepositoryTestsExceptSeeAllData<br/>RunLocalTests<br/>RunAllTestsInOrg|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:deploy:smart
```

```shell
$ sf hardis:project:deploy:smart --check
```

```shell
$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTests
```

```shell
$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTests --runtests '^(?!FLI|MyPrefix).*'
```

```shell
$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTestsExceptSeeAllData
```

```shell
$ sf hardis:project:deploy:smart
```

```shell
$ FORCE_TARGET_BRANCH=preprod NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org nicolas.vuillamy@myclient.com.preprod
```

```shell
$ SYSTEM_ACCESSTOKEN=xxxxxx SYSTEM_COLLECTIONURI=https://dev.azure.com/xxxxxxx/ SYSTEM_TEAMPROJECT="xxxxxxx" BUILD_REPOSITORY_ID=xxxxx SYSTEM_PULLREQUEST_PULLREQUESTID=1418 FORCE_TARGET_BRANCH=uat NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org my.salesforce@org.com
```

```shell
$ CI_SFDX_HARDIS_BITBUCKET_TOKEN=xxxxxx BITBUCKET_WORKSPACE=sfdxhardis-demo BITBUCKET_REPO_SLUG=test BITBUCKET_BUILD_NUMBER=1 BITBUCKET_BRANCH=uat BITBUCKET_PR_ID=2 FORCE_TARGET_BRANCH=uat NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org my-salesforce-org@client.com
```

```shell
$ GITHUB_TOKEN=xxxx GITHUB_REPOSITORY=my-user/my-repo FORCE_TARGET_BRANCH=uat NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org my-salesforce-org@client.com
```


