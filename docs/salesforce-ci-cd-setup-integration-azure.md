---
title: Configure Integrations between sfdx-hardis and Azure Pipelines
description: Post Notes on Azure Repos Pull Request from CI jobs
---
<!-- markdownlint-disable MD013 -->

## Azure Pull Request notes

In order to avoid to have to open job logs to see deployment errors, sfdx-hardis can post them as a thread on the Pull Request UI

To use this capability:

- Go to Settings -> Access Tokens -> Create a project access token with level **Developer** and scope **api**, and name it **SFDX HARDIS BOT**
- Go to Settings -> CI/CD -> Variables -> Create a variable named **CI_SFDX_HARDIS_AZURE_TOKEN** and past the access token value

Everytime you will make a pull request, the CI job will post its result as comment !

- Example with deployment errors

![](assets/images/zure-mr-comment.jpg)

- Example with failing test classes

![](assets/images/azure-mr-comment-failed-tests.jpg)

Notes:

- This integration works with sfdx-hardis pipeline, but also on home-made pipelines, just call [sfdx hardis:source:deploy](https://sfdx-hardis.cloudity.com/hardis/source/deploy/) instead of `sfdx force:source:deploy` !

- This integration use the following variables:
  - SYSTEM_ACCESSTOKEN
  - CI_SFDX_HARDIS_AZURE_TOKEN
  - SYSTEM_COLLECTION_URI
  - BUILD_BUILD_URI
  - BUILD_REPOSITORY_ID
  - SYSTEM_JOB_DISPLAY_NAME
  - SYSTEM_PULLREQUEST_PULLREQUESTID
