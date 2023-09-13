---
title: Configure Integrations between sfdx-hardis and Slack
description: Send notifications on slack channels during CI/CD operations
---
<!-- markdownlint-disable MD013 -->

## Slack Integration

You can receive notifications on slack channels when CI/CD events are happening:
- Deployment from a major branch to a major Salesforce org (ex: integration git branch to Integration Org)
- More soon (ask for them !)

## Configure Slack Application

Create a slack app here -> https://api.slack.com/apps

- Name it `sfdx-hardis bot`` or _any nickname you like_, like your guinea pig name !
- Go to permissions and add the following scopes
  - chat-write
  - chat-write.customize
  - chat-write.public
- Create auth token and copy its values
- Create a secret value named **SLACK_TOKEN** with auth token value in your Git provider configuration
- Create a slack channel that will receive all notifications (ex: _#notifs-sfdx-hardis_)
- Open the channel info, copy its ID and create a secret value named **SLACK_CHANNEL_ID** in your git provider configuration
- Additionnally, you can create branch-scoped channels by creating new channels and create appropriate variables
  - Example: Channel _#notifs-sfdx-hardis-integration_ and variable **SLACK_CHANNEL_ID_iNTEGRATION**
- Make sure all those variables are visible to your CI/CD pipelines

That's all, you're all set !