---
title: Configure Microsoft Teams notifications from Salesforce CI/CD
description: Learn how to configure Microsoft Teams notifications using Web Hooks
---
<!-- markdownlint-disable MD013 -->

## Ms Teams Integration

You can receive notifications on Microsoft Teams channels when sfdx-hardis events are happening:

- Deployment from a major branch to a major Salesforce org (ex: integration git branch to Integration Org)
- Salesforce org monitoring
  - Latest updates
  - Failing apex tests
  - Monitoring checks notifications

## Create Incoming Web Hook

Follow [Microsoft Tutorial](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook?tabs=dotnet) to create an incoming Web Hook for any Teams Channel

## Configure secret variable

- Create a secret value named **MS_TEAMS_WEBHOOK_URL** with Web Hook url in your Git provider configuration

_Example: `MS_TEAMS_WEBHOOK_URL=https://mycompany.webhook.office.com/webhookb2/f49c28c6-d10b-412c-b961-fge456bd@c1a7fa9b-90b3-49ab-b5e2-345HG88c/IncomingWebhook/b43c20SDSGFG56712d848bc1cebb17/53ee2e22-a867-4e74-868a-F3fs3935`_

- Additionally, you can create branch-scoped channels by creating new channels and create appropriate variables
  - Example: Channel _#notifs-sfdx-hardis-integration_ and variable **MS_TEAMS_WEBHOOK_URL_INTEGRATION**

- Make sure all those variables are visible in your CI/CD pipelines

That's all, you're all set !


