---
title: Configure Integrations between sfdx-hardis and external tools
description: Manage sfdx integrations with Gitlab, GitHub, Azure, BitBucket, Microsoft Teams
---
<!-- markdownlint-disable MD013 -->

Every info that sfdx-hardis can provide is available in log files or console terminals.

In order to enhance the user experience, integrations with external tools must be configured.

## Git Providers

Depending of your git provider, configure one of the following integrations.

- [GitHub](salesforce-ci-cd-setup-integration-github.md)
  - Deployment status in Merge Request notes
  - Quick Deploy to enhance performances

- [Gitlab](salesforce-ci-cd-setup-integration-gitlab.md)
  - Deployment status in Merge Request notes
  - Quick Deploy to enhance performances

- [Azure Pipelines](salesforce-ci-cd-setup-integration-azure.md)
  - Deployment status in Pull Request threads
  - Quick Deploy to enhance performances

- BitBucket
  - Coming soon !

## Message notifications

- [Slack](salesforce-ci-cd-setup-integration-slack.md)
  - Notifications

- [Microsoft Teams](salesforce-ci-cd-setup-integration-ms-teams.md)
  - Notifications
  - Alerts

## Ticketing providers

- [Jira](salesforce-ci-cd-setup-integration-jira.md)
  - Enrich MR/PR comments by adding tickets references and links
  - Enrich notifications comments by adding tickets references and links
  - Post a comment and a label on JIRA issues when they are deployed in a major org

- [Azure Boards](salesforce-ci-cd-setup-integration-azure-boards.md)
  - Enrich MR/PR comments by adding work items references and links
  - Enrich notifications comments by adding work items references and links
  - Post a comment and a tag on Azure Work Items when they are deployed in a major org

- [Generic ticketing](salesforce-ci-cd-setup-integration-generic-ticketing.md)
  - Enrich MR/PR comments by adding tickets references and links
  - Enrich notifications comments by adding tickets references and links