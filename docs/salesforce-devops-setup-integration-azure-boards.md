---
title: Configure Integrations between sfdx-hardis and Azure Boards Work Items
description: With sfdx-hardis, enrich pull requests with Azure Work Items info and post comments & tags on tickets when they are deployed to a Salesforce org
---
<!-- markdownlint-disable MD013 -->

- [Azure Boards integration](#azure-boards-integration)
  - [Update Work Items](#update-work-items)
- [Technical notes](#technical-notes)

## Azure Boards integration

If you use Azure Boards work items on your project, sfdx-hardis can use them to enrich its integrations.

sfdx-hardis automatically analyzes commits and Pull Request descriptions to collect work item references.

Make sure to link your work items to your Pull Requests before submitting them.

### Update Work Items

Add **comments** and **tags** on work items when they are deployed in a major org.

The default tag is `UPPERCASE(branch_name) + "_DEPLOYED"`.

To override it, define the environment variable **DEPLOYED_TAG_TEMPLATE**, which must contain `{BRANCH}`.

Example: `DEPLOYED_TO_{BRANCH}`

![](assets/images/screenshot-azure-work-item-comment.jpg)

## Technical notes

This integration uses the following variables, which must be available from the pipelines:

- SYSTEM_COLLECTIONURI
- SYSTEM_ACCESSTOKEN
- SYSTEM_TEAMPROJECT
- BUILD_REPOSITORY_ID

## Coding agents on a workstation

When a coding agent runs sfdx-hardis commands with `--agent` on a developer machine and no Azure DevOps token variable is set, sfdx-hardis uses a Microsoft Entra ID token of the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az login`) to read and update the work items, for the running command only. See [Azure DevOps: coding agents on a workstation](salesforce-devops-setup-integration-azure.md#coding-agents-on-a-workstation).

```sh
az login
sf hardis:project:connection:check --type ticketing --agent --json
```
