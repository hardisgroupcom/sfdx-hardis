---
title: Initialize sfdx sources from Salesforce org
description: Learn how to initialize sfdx sources from a Salesforce org
---
<!-- markdownlint-disable MD013 -->

If this is a new Salesforce project, or if you want to setup CI/CD in **incremental mode**, you can skip this step and directly go to [Create first merge request](#create-first-merge-request).

Thanks to tracked sandboxes, you can also decide to opt for an **half-incremental init**, with only some metadata types like Apex, LWC & Permission sets. In that case retrieve manually the metadatas you need, for example with Org Browser.

If you want to go for a **full init setup**, follow the steps below !

- [Retrieve Metadatas](#retrieve-metadatas)
- [Automated Metadatas Cleaning](#automated-metadatas-cleaning)
  - [Remove Managed items](#remove-managed-items)
  - [Remove (hidden) files](#remove-hidden-files)
  - [Remove empty items](#remove-empty-items)
  - [Standard objects without custom](#standard-objects-without-custom)
- [Manual Metadata Cleaning](#manual-metadata-cleaning)
- [Retrieve installed packages](#retrieve-installed-packages)
- [Create first merge request](#create-first-merge-request)

## Retrieve Metadatas

- Run the following command that will retrieve locally all the metadatas of production org

`sfdx hardis:org:retrieve:sources:dx --shape -u YOURSOURCEORGUSERNAME`

- In case you get an error:
  - Run the generate package xml command : [hardis:org:generate:packagexmlfull](https://sfdx-hardis.cloudity.com/hardis/org/generate/packagexmlfull/)
  - Clean up the generated package created by removing the unnecessary metadatas
  - Run retrieve metadata command : [hardis:source:retrieve](https://sfdx-hardis.cloudity.com/hardis/source/retrieve/)

Example :
  
- `sfdx hardis:org:generate:packagexmlfull --targetusername nico@example.com --outputfile ./packagexmlfull.xml`
- Remove Document part on packagexmlfull.xml
  ```xml
      <types>
          <members>Doc1</members>
          <members>Doc2</members>
          <members>Doc3</members>
          <name>Document</name>
      </types>
  ```
- `sfdx hardis:source:retrieve -x ./packagexmlfull.xml`




## Automated Metadatas Cleaning

You have way too many metadatas locally, including standard and managed items that are not customize so are not needed in the repository.

Proceed to the following steps to automatically remove many of them, then proceed to the final manual cleaning

### Remove Managed items

Run the following command to delete all elements with a namespace.

```shell
sfdx hardis:project:clean:manageditems --namespace SOMENAMESPACE
```

### Remove (hidden) files

Some items have no namespace but are managed anyway, and contain `(hidden)`, so they must me deleted with the following command.

```shell
sfdx hardis:project:clean:hiddenitems
```

### Remove empty items

Some files are empty and do not need to be kept in repository, remove them using the following command.

```shell
sfdx hardis:project:clean:emptyitems
```

### Standard objects without custom

The retrieve command pulled all standard objects and fields.

Those which has never been customized do not need to remain in repository, delete them using the following command (that can take some time)

```shell
sfdx hardis:project:clean:standarditems
```

## Manual Metadata Cleaning

Automated Metadata cleaning removed a lot of items, but many are remaining that are useless in the repo.

Manually delete files (or even folders) that are maintained directly in production org

- `applications`: Delete the ones **starting with `standard__`**
- `àppMenus`: Delete all folder
- `cleanDataServices`: Delete all folder
- `dashboards`: Delete **all user dashboards**
- `emailServices`: Delete all folder
- `flowDefinitions` : Delete all folder (Salesforce now uses `flow` folder)
- `installedPackages`: Delete all folder
- `layouts`: Delete all **standard layouts that has not been customized**
- `profiles` : Delete all **standard** profiles
- `profilePasswordPolicies`: Delete all folder
- `profileSessionSettings`: Delete all folder,
- `reports`: Delete **all reports that have been created directly in production org**

## Retrieve installed packages

Run the following command to retrieve packages installed on production org

`sfdx hardis:org:retrieve:packageconfig -u YOUR_PROD_ORG_USER`

This will update file **config/.sfdx-hardis.yml**

- Keep only the packages that you are using in all orgs.
- Define **installDuringDeployments** property to `true` if you need this package installed on all orgs
- Define **installOnScratchOrgs** property to `true` if you are using scratch orgs and need this package installed when you create a new scratch org

_Example:_

```yaml
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
```

## Create first merge request

> Don't forget to run ![](assets/images/btn-save-publish-task.jpg) and to follow other instructions before creating your initial merge request !

Time to [create the first merge request](salesforce-ci-cd-setup-merge-request.md) !

You'll probably have many updates to perform in new commits before having all jobs in green :)
