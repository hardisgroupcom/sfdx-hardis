---
title: Configure a Salesforce CI/CD Cleaning using sfdx-hardis
description: Learn how to configure the automated cleaning of sfdx sources before creating a Merge Request
---
<!-- markdownlint-disable MD013 -->

- [Why cleaning sources ?](#why-cleaning-sources-)
- [Dashboards](#dashboards)
- [Destructive Changes](#destructive-changes)
- [List Views Mine](#list-views-mine)
- [Minimize Profiles](#minimize-profiles)
- [System.debug](#systemdebug)
- [Named metadatas](#named-metadatas)
  - [Case Entitlement](#case-entitlement)
  - [DataDotCom](#datadotcom)
  - [Local Field](#local-field)
  - [Product Request](#product-request)

___

## Why cleaning sources ?

Salesforce CI/CD Pipelines does not natively work without many manual operations to update the XML... so the deployments passes !

sfdx-hardis provides a set of commands to automate those boring XML updates that can be called every time a user [prepares a merge request](salesforce-ci-cd-publish-task.md#prepare-merge-request) using command [sfdx hardis:work:save](https://hardisgroupcom.github.io/sfdx-hardis/hardis/work/save/)

Here is the list of available automated cleanings, that can also be called manually using command ![](assets/images/btn-clean-sources.jpg)

Example of cleaning config in a .sfdx-hardis.yml config file:

```yaml
autoCleanTypes:
  - destructivechanges
  - datadotcom
  - minimizeProfiles
  - listViewsMine
```
___

## Dashboards

Property: **dashboards**

Removes hardcoded user ids from Dashboards

___

## Destructive Changes

Property: **destructivechanges**

Any file corresponding to an element existing in **manifest/destructiveChanges.xml** is deleted.

___

## List Views Mine

Property: **listViewsMine**

List views with scope **Mine** can not be deployed.

As a workaround, scope is set back to **Everything** in XML, but the list view reference is kept in a property **listViewsToSetToMine** in .sfdx-hardis.yml, and after deployment, manual clicks are simulated to **set back their scope to Mine** !

___

## Minimize Profiles

Property: **minimizeProfiles**

It is a bad practice to define on Profiles elements that can be defined on Permission Sets.

Salesforce will [deprecate such capability in Spring 26](https://admin.salesforce.com/blog/2023/permissions-updates-learn-moar-spring-23).

Don't wait for that, and use minimizeProfiles cleaning to automatically remove from Profiles any permission that exists on a Permission Set !

The folowing XML tags are removed automatically:

- classAccesses
- customMetadataTypeAccesses
- externalDataSourceAccesses
- fieldPermissions
- objectPermissions
- pageAccesses
- userPermissions _(except on Admin Profile)_

You can override this list by defining a property **minimizeProfilesNodesToRemove** in your .sfdx-hardis.yml config file.

__

## System.debug

Property: **systemDebug**

System.debug are useless, as explained in [this article](https://medium.com/@michael.bobard/get-rid-of-your-system-debug-with-2-clicks-to-improve-your-performance-80febae76755)

Comments automatically all System.debug in the code to enhance peformances.

___

## Named metadatas

Cleaning can remove files related to named elements.

### Case Entitlement

Property: **caseentitlement**

Removes [all Case Entitlement related fields](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/clean/caseentitlement.json), like Case.EntitlementId and Case.MilestoneStatus

### DataDotCom

Property: **datadotcom**

Removes [all Case Data.com related fields](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/clean/datadotcom.json), like Account.DandbCompanyId and Account.Jigsaw

### Local Field

Property: **localfields**

Removes [all Local fields](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/clean/localfields.json), like Account.NameLocal and Lead.CompanyLocal

### Product Request

Property: **productrequest**

Removes [all Local fields](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/clean/localfields.json), like ProductRequest.ShipToAddress and ProductRequest.ShipmentType
