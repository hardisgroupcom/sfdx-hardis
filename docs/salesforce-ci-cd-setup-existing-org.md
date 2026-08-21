---
title: Retrieve an existing org into the SFDX project
description: Learn how to initialize the SFDX sources of a CI/CD project from an existing Salesforce org, and how to clean the retrieved metadata
---

<!-- markdownlint-disable MD013 -->

## Retrieve an existing org (optional)

If this is a new Salesforce project, or if you want to set up CI/CD in **incremental mode**, you can skip this step and go directly to [Create the first Pull Request](#create-the-first-pull-request).

Thanks to source-tracked sandboxes, you can also opt for a **half-incremental init**, with only some metadata types like Apex, LWC and Permission Sets. In that case, retrieve manually the metadata you need, for example with the Metadata Retriever of the VS Code SFDX Hardis extension.

If you want a **full init**, follow the steps below.

- [Retrieve metadata](#retrieve-metadata)
- [Automated metadata cleaning](#automated-metadata-cleaning)
  - [Remove managed items](#remove-managed-items)
  - [Remove (hidden) files](#remove-hidden-files)
  - [Remove empty items](#remove-empty-items)
  - [Standard objects without customization](#standard-objects-without-customization)
- [Manual metadata cleaning](#manual-metadata-cleaning)
- [Retrieve installed packages](#retrieve-installed-packages)
- [Create the first Pull Request](#create-the-first-pull-request)

### Retrieve metadata

- Run the generate package.xml command: [hardis:org:generate:packagexmlfull](https://sfdx-hardis.cloudity.com/hardis/org/generate/packagexmlfull/)
- Clean up the generated package.xml by removing the unnecessary metadata
- Run the retrieve command: [sf project retrieve start](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_retrieve_start_unified)

Example:

- `sf hardis:org:generate:packagexmlfull --target-org nico@example.com --outputfile ./packagexmlfull.xml`
- Remove the Document part from packagexmlfull.xml

  ```xml
      <types>
          <members>Doc1</members>
          <members>Doc2</members>
          <members>Doc3</members>
          <name>Document</name>
      </types>
  ```

- `sf project retrieve start -x ./packagexmlfull.xml --ignore-conflicts`

### Automated metadata cleaning

You now have way too much metadata locally, including standard and managed items that are not customized, so not needed in the repository.

Follow these steps to automatically remove many of them, then proceed to the final manual cleaning.

#### Remove managed items

Run the following command to delete all elements with a namespace.

```shell
sf hardis:project:clean:manageditems --namespace SOMENAMESPACE
```

#### Remove (hidden) files

Some items have no namespace but are managed anyway, and contain `(hidden)`. Delete them with the following command.

```shell
sf hardis:project:clean:hiddenitems
```

#### Remove empty items

Some files are empty and do not need to be kept in the repository. Remove them with the following command.

```shell
sf hardis:project:clean:emptyitems
```

#### Standard objects without customization

The retrieve command pulled all standard objects and fields.

Those that have never been customized do not need to remain in the repository. Delete them with the following command (it can take some time).

```shell
sf hardis:project:clean:standarditems
```

### Manual metadata cleaning

The automated cleaning removed a lot of items, but many useless ones remain in the repository.

Manually delete the files (or even folders) that are maintained directly in the production org:

- `applications`: delete the ones **starting with `standard__`**
- `appMenus`: delete the whole folder
- `cleanDataServices`: delete the whole folder
- `dashboards`: delete **all user dashboards**
- `emailServices`: delete the whole folder
- `flowDefinitions`: delete the whole folder (Salesforce now uses the `flows` folder)
- `installedPackages`: delete the whole folder
- `layouts`: delete all **standard layouts that have not been customized**
- `profiles`: delete all **standard** profiles
- `profilePasswordPolicies`: delete the whole folder
- `profileSessionSettings`: delete the whole folder
- `reports`: delete **all reports that have been created directly in the production org**

### Retrieve installed packages

Use **DevOps Pipeline -> Installed Packages**, then **Retrieve from org**, to retrieve the list of packages of your project.

See [Install packages](salesforce-ci-cd-work-on-task-install-packages.md).

> CLI alternative: `sf hardis:org:retrieve:packageconfig --target-org YOUR_PROD_ORG_USER`

This updates the file **config/.sfdx-hardis.yml**.

- Keep only the packages that you use in all orgs
- Set the **installDuringDeployments** property to `true` if you need the package installed on all orgs
- Set the **installOnScratchOrgs** property to `true` if you use scratch orgs and need the package installed when you create a new scratch org

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

### Create the first Pull Request

> Do not forget to run ![Save / Publish my User Story](assets/images/btn-save-publish-task.jpg) and to follow the other instructions before creating your initial Pull Request (Merge Request on GitLab).

Time to [create the first Pull Request](salesforce-ci-cd-setup-merge-request.md).

You will probably have many updates to make in new commits before all jobs are green.
