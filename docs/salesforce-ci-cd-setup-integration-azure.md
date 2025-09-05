---
title: Configure Integrations between sfdx-hardis and Azure Pipelines
description: Post Notes on Azure Repos Pull Request from CI jobs
---

<!-- markdownlint-disable MD013 -->

## Azure Pull Request notes

In order to avoid to have to open job logs to see deployment errors, sfdx-hardis can post them as a thread on the Pull Request UI

### Global configuration

To use this capability:

- A build policy must be defined

  - See <https://docs.microsoft.com/en-US/azure/devops/repos/git/branch-policies?view=azure-devops&tabs=browser#build-validation>

- You must allow **Contribute** and **Contribute to Pull Requests** on your Build Service (Settings -> Repositories -> Select your build service)

![Screenshot](assets/images/AzureReporterConfigContribute.jpg)

### Tech Work Item

If you want to use **Flow Diff** (visual diff of flow differences):

- Create an Azure boards ticket exactly named **sfdx-hardis tech attachments**. IT will be used to link uploaded images.

  - If you prefer to name it differently, define variable `AZURE_ATTACHMENTS_WORK_ITEM_ID` with the number of your ticket as value.

- An Azure Work item can have only 100 attached images, so frequently delete old image attachments, or delete the ticket then recreate it with the same name.

![Screenshot](assets/images/az-tech-work-item.png)

### Examples

Everytime you will make a pull request, the CI job will post its result as comment !

- Example with deployment errors

![](assets/images/azure-pr-comment-failed.jpg)

- Example with failing test classes

![](assets/images/azure-pr-comment-failed-tests.jpg)

- Example when all is ok :)

![](assets/images/azure-pr-comment.jpg)

Notes:

- This integration works with sfdx-hardis pipeline, but also on home-made pipelines, just call [sf hardis:project:deploy:start](https://sfdx-hardis.cloudity.com/hardis/project/deploy/start/) instead of `sf project:deploy:start` !

- This integration use the following variables:
  - SYSTEM_ACCESSTOKEN: $(System.AccessToken)
  - CI_SFDX_HARDIS_AZURE_TOKEN: $(System.AccessToken)
  - SYSTEM_COLLECTIONURI: $(System.CollectionUri)
  - SYSTEM_JOB_DISPLAY_NAME: $(System.JobDisplayName)
  - SYSTEM_JOB_ID: $(System.JobId)
  - SYSTEM_PULLREQUEST_PULLREQUESTID: $(System.PullRequest.PullRequestId)
  - SYSTEM_TEAMPROJECT: $(System.TeamProject)
  - BUILD_BUILD_ID: $(Build.BuildId)
  - BUILD_REPOSITORY_ID: $(Build.Repository.ID)
  - AZURE_ATTACHMENTS_WORK_ITEM_ID (optional: identifier of the Work Items used to attach images)
