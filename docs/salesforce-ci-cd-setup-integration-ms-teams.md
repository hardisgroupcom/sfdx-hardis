---
title: Configure Microsoft Teams notifications from Salesforce CI/CD
description: Send notifications on Teams channels during CI/CD operations
---
<!-- markdownlint-disable MD013 -->

## Ms Teams Integration

You can receive notifications on Microsoft Teams channels when sfdx-hardis events are happening:

- Deployment from a major branch to a major Salesforce org (ex: integration git branch to Integration Org)
- Salesforce [Org Monitoring](salesforce-monitoring-home.md)
  - Latest updates
  - Failing apex tests
  - Monitoring checks notifications

## Configure Microsoft Teams Workflow

### Create Teams Workflow

Create a Teams Workflow using the following steps:

- Navigate to your Teams channel
- Click on the **"..."** menu and select **"Workflows"**
- Search for **"Post to a channel when a webhook request is received"**
- Configure the workflow:
  - Select the team and channel where notifications should appear
  - Copy the webhook URL provided

### Configure sfdx-hardis for Teams

- Create a secret value named **MS_TEAMS_WEBHOOK_URL** with the webhook URL in your Git provider configuration

- Additionally, you can create branch-scoped webhooks by creating appropriate variables
  - Example: Variable **MS_TEAMS_WEBHOOK_URL_INTEGRATION** for integration branch

- You can also define an additional webhook to receive only warning, error and critical notifications
  - Example: Variable **MS_TEAMS_WEBHOOK_URL_ERRORS_WARNINGS**

- Make sure all those variables are visible to your CI/CD pipelines

That's all, you're all set !

## Alternative: Email Notifications

If you prefer email-based notifications, you can also use [Email Notifications](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-email/) with the Teams Channel Email as `NOTIF_EMAIL_ADDRESS`.

To get Teams email channel, click on the channel contextual menu, then "Get channel E-mail Address":

![](assets/images/screenshot-teams-email-1.jpg)

Then make sure that anyone can send emails to the channel by selecting the first option:

![](assets/images/screenshot-teams-email-2.jpg)
