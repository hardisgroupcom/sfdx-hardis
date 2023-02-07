<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:sources:dx

## Description

Deploy SFDX source to org, following deploymentPlan in .sfdx-hardis.yml

In case of errors, [tips to fix them](https://hardisgroupcom.github.io/sfdx-hardis/deployTips/) will be included within the error messages.

### Dynamic deployment items

If necessary,you can define the following files (that supports wildcards <members>*</members>):

- `manifest/packageDeployOnce.xml`: Every element defined in this file will be deployed only if it is not existing yet in the target org (can be useful with ListView for example, if the client wants to update them directly in production org)
- `manifest/packageXmlOnChange.xml`: Every element defined in this file will not be deployed if it already has a similar definition in target org (can be useful for SharingRules for example)

### Deployment plan

If you need to deploy in multiple steps, you can define a property `deploymentPlan` in `.sfdx-hardis.yml`.

- If a file `manifest/package.xml` is found, it will be placed with order 0 in the deployment plan

- If a file `manifest/destructiveChanges.xml` is found, it will be executed as --postdestructivechanges

- If env var `SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES` is defined as `true` , split of package.xml will be ignored

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
- You can automatically update this property by listing all packages installed on an org using command `sfdx hardis:org:retrieve:packageconfig`

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
    installDuringDeployments: true              // set as true to install package during a deployment using sfdx hardis:project:deploy:sources:dx
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

### Automated fixes post deployments

#### List view with scope Mine

If you defined a property **listViewsToSetToMine** in your .sfdx-hardis.yml, related ListViews will be set to Mine ( see command <https://hardisgroupcom.github.io/sfdx-hardis/hardis/org/fix/listviewmine/> )

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
  

## Parameters

| Name                  |  Type   | Description                                                          |    Default    | Required |                                Options                                 |
|:----------------------|:-------:|:---------------------------------------------------------------------|:-------------:|:--------:|:----------------------------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command  |               |          |                                                                        |
| check<br/>-c          | boolean | Only checks the deployment, there is no impact on target org         |               |          |                                                                        |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                      |               |          |                                                                        |
| json                  | boolean | format output as json                                                |               |          |                                                                        |
| loglevel              | option  | logging level for this command invocation                            |     warn      |          |         trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal          |
| packagexml<br/>-p     | option  | Path to package.xml containing what you want to deploy in target org |               |          |                                                                        |
| skipauth              | boolean | Skip authentication check when a default username is required        |               |          |                                                                        |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org   |               |          |                                                                        |
| testlevel<br/>-l      | option  | Level of tests to apply to validate deployment                       | RunLocalTests |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration            |               |          |                                                                        |

## Examples

```shell
sfdx hardis:project:deploy:sources:dx
```

```shell
sfdx hardis:project:deploy:sources:dx --check
```


