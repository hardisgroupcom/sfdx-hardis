---
title: Configure Integrations between sfdx-hardis and Azure Boards Work Items
description: Enrich pull requests with Azure Work Items info and post comments & tags on tickets when they are deployed to a Salesforce org
---
<!-- markdownlint-disable MD013 -->

- [Azure Boards integration](#azure-boards-integration)
  - [Update Work Items](#update-work-items)
- [Technical notes](#technical-notes)

## Azure Boards integration

If you use Azure Work Items on your project, sfdx-hardis can use it to enrich its integrations

Sfdx-hardis will automatically analyze commits and PR/MR descriptions to collect Work Items references !

Make sure to link your Work Items to your Pull Requests before submitting them !

### Update Work Items

Add **comments** and **tags** on JIRA tickets when they are deployed in a major org

Default tag is `UPPERCASE(branch_name) + "_DEPLOYED"`.

To override it, define env variable **DEPLOYED_TAG_TEMPLATE**, that must contain `{BRANCH}`.

Example: `DEPLOYED_TO_{BRANCH}`

![](assets/images/screenshot-azure-work-item-comment.jpg)

## Technical notes

This integration use the following variables, that must be available from the pipelines:

- SYSTEM_COLLECTIONURI
- SYSTEM_ACCESSTOKEN
- SYSTEM_TEAMPROJECT
- BUILD_REPOSITORY_ID
