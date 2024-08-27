---
title: .sfdx-hardis.yml config file
description: Learn what is a sfdx-hardis config file
---
<!-- markdownlint-disable MD013 -->

sfdx-hardis projects are like any other sfdx projects, but with an additional configuration stored in a **.sfdx-hardis.yml config file**

Many of these properties are automatically set by CI/CD [setup](salesforce-ci-cd-setup-home.md) and [maintenance](salesforce-ci-cd-release-home.md) operations.

You can see the [**list of all configuration properties**](schema/sfdx-hardis-json-schema-parameters.html).

Here is an example of a .sfdx-hardis.yml config file:

```yaml
projectName: MyClient
devHubAlias: DevHub_MyClient
developmentBranch: integration
allowedOrgTypes:
  - sandbox
availableTargetBranches:
  - develop
  - preprod
autoCleanTypes:
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
autoRetrieveWhenPull:
  - CustomApplication:MyClient
  - CustomApplication:MyClientConnectApplication
  - CustomApplication:MyOtherApplication
  - CustomMetadata
devHubUsername: nicolas.vuillamy@ext.myclient.com
installPackagesDuringCheckDeploy: true
installedPackages:
  - Id: 0A37Z000000AtDYSA0
    SubscriberPackageId: 033i0000000LVMYAA4
    SubscriberPackageName: Marketing Cloud
    SubscriberPackageNamespace: et4ae5
    SubscriberPackageVersionId: 04t6S000001UjutQAC
    SubscriberPackageVersionName: Marketing Cloud
    SubscriberPackageVersionNumber: 238.3.0.2
    installOnScratchOrgs: true
    installDuringDeployments: true
  - Id: 0A35r0000009F9CCAU
    SubscriberPackageId: 033b0000000Pf2AAAS
    SubscriberPackageName: Declarative Lookup Rollup Summaries Tool
    SubscriberPackageNamespace: dlrs
    SubscriberPackageVersionId: 04t5p000001BmLvAAK
    SubscriberPackageVersionName: Release
    SubscriberPackageVersionNumber: 2.15.0.9
    installOnScratchOrgs: true
    installDuringDeployments: true
initPermissionSets:
  - AdminDefault
  - MarketingCloudConnectedApp
  - ApiUserPS
listViewsToSetToMine:
  - force-app/main/default/objects/Operation__c/listViews/MyCurrentOperations.listView-meta.xml
  - force-app/main/default/objects/Operation__c/listViews/MyFinalizedOperations.listView-meta.xml
```
