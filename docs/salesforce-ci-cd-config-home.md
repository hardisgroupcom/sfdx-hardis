---
title: Configure a Salesforce CI/CD Project using sfdx-hardis
description: Learn how to configure your Salesforce CI/CD project so it works easily with VsCode SFDX Hardis
---
<!-- markdownlint-disable MD013 -->

- [Package.xml](#packagexml)
- [destructiveChanges.xml](#destructivechangesxml)
- [Automated sources cleaning](#automated-sources-cleaning)
- [All configuration properties](#all-configuration-properties)

## Package.xml

A Salesforce CI/CD repository contains a file **manifest/package.xml**.

- It contains **all metadatas** that will be **deployed** by the **CI server**.

- It is **automatically updated** when [preparing merge requests](salesforce-ci-cd-publish-task.md#prepare-merge-request) by command [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)

- It is highly recommended to [**configure overwrite management**](salesforce-ci-cd-config-overwrite.md), to **avoid to overwrite metadatas that are maintained directly in production on purpose**
  - Dashboards
  - Reports
  - Remote site settings
  - Named credentials
  - ...

  _See [Overwrite management configuration documentation](salesforce-ci-cd-config-overwrite.md)_

- You can also use [**delta deployments**](salesforce-ci-cd-config-delta-deployment.md) if your project is big and you have performances issues.

___

## destructiveChanges.xml

A Salesforce CI/CD repository contains a file **manifest/destructiveChanges.xml**.

- It contains **all metadatas** that will be **deleted** by the **CI server**.

- It is **automatically updated** when [preparing merge requests](salesforce-ci-cd-publish-task.md#prepare-merge-request) by command [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)

___

## Automated sources cleaning

You can configure automated cleaning of sources before creating merge requests, using command [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)

Those cleanings can be:

- Deletion of sources existing in `destructiveChanges.xml`
- Remove from Profiles elements that are existing in Permission Sets, like Objects access configuration.
- etc ...

  _See [Overwrite cleaning configuration documentation](salesforce-ci-cd-config-cleaning.md)_

___

## All configuration properties

**.sfdx-hardis.yml** allows to make your project highly configuration. Have a look at its [list of configuration properties](schema/sfdx-hardis-json-schema-parameters.html) !
