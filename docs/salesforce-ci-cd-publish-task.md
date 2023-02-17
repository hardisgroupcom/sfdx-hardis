---
title: Publish a task on a Salesforce CI/CD project
description: Learn how to commit and create a merge request
---
<!-- markdownlint-disable MD013 -->

- [Commit your updates](#commit-your-updates)
  - [Retrieve metadatas](#retrieve-metadatas)
  - [Stage and commit](#stage-and-commit)
- [Prepare merge request](#prepare-merge-request)
- [Create merge request](#create-merge-request)
  - [Using Gitlab](#using-gitlab)
  - [Using Github](#using-github)
  - [Using Azure](#using-azure)

___

## Commit your updates

### Retrieve metadatas

If you made updates on your org that you have not pulled yet, Use command ![Pull from org button](assets/images/btn-pull-from-org.jpg) to **pull your latest updates in local files**

- If you updated config elements that you do not see in your local files, you may discuss with your release manager to [automate force retrieve metadatas](salesforce-ci-cd-retrieve.md)
- If it is not possible to use pull configuration, you may retrieve metadatas using ![Select and retrieve button](assets/images/btn-select-retrieve.jpg) (but it will retrieve locally many files and it will be harder to select the ones you really need, select carefully the items that you stage and commit)

### Stage and commit

In VsCode Git extension, **stage** and **commit** created, updated and deleted files that you want to publish

- By selecting the metadata files you can **see the differences** with the previous versions, to know if you want to publish or not an updated file
- **Never use Stage all function**

_The following video shows how to perform theses operations_

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/Ik6whtflmfY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

___

## Prepare merge request

- **Once your commit is completed**, run command ![Save / publish my current task button](assets/images/btn-save-publish-task.jpg) to prepare your merge request.

- As you committed your files like explained in the previous section, select option ![Message my commit is ready](assets/images/msg-commit-ready.jpg) when prompted.

- Wait for the script to complete, and select **Push commit to server** when prompted

> ![Under the hood](assets/images/engine.png) **_Under the hood_**
>
> The script performs the following operations:
>
> - Update `manifest/package.xml` automatically according to the committed updates
> - Clean XML of metadatas according to .sfdx-hardis.yml config property `autoCleanTypes` and `autoRemoveUserPermissions`
> - New git commit with automated updates
> - Git push commit to git server
>
> More details in [hardis:work:save](https://hardisgroupcom.github.io/sfdx-hardis/hardis/work/save/) command documentation

___

## Create merge request

It is now time to create your merge request to technically publish your updates at the upper level !

Depending on the CI platform you use, follow the related guide.

### Using Gitlab

See [Create a merge request using Gitlab](salesforce-ci-cd-merge-request-gitlab.md)

### Using Azure

See [Create a merge request using Azure](salesforce-ci-cd-pull-request-azure.md)

### Using GitHub

See [Create a merge request using Github](salesforce-ci-cd-pull-request-github.md)
