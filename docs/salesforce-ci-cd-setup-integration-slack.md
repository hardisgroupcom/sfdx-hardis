---
title: Configure Integrations between sfdx-hardis and Slack
description: Send notifications on slack channels during CI/CD operations
---
<!-- markdownlint-disable MD013 -->

![sfdx-hardis-slack-logo](assets/images/sfdx-hardis-slack.png)

## Slack Integration

You can receive notifications on slack channels when sfdx-hardis events are happening:

- Deployment from a major branch to a major Salesforce org (ex: integration git branch to Integration Org)
- [Salesforce org monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)
  - Latest updates
  - Failing apex tests
  - Monitoring checks notifications

![slack-notifs](assets/images/screenshot-slack.png)

## Configure Slack Application

All the following steps are summarized in this video tutorial

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/se292ABGUmI" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

### Create slack app

> Process only if a sfdx-hardis bot has not yet been configured on your slack. Otherwise, just request the slack token value to your slack administrator

Create a slack app here -> <https://api.slack.com/apps>

- Name it `sfdx-hardis bot` or _any nickname you like_, like your guinea pig name !
- Go to permissions and add the following scopes
  - chat-write
  - chat-write.customize
  - chat-write.public
- Create auth token and copy its values

### Configure sfdx-hardis for slack

- Create a secret value named **SLACK_TOKEN** with auth token value in your Git provider configuration
- Create a slack channel that will receive all notifications (ex: _#notifs-sfdx-hardis_)
- Open the channel info, copy its ID and create a secret value named **SLACK_CHANNEL_ID** in your git provider configuration
- Invite the sfdx-hardis bot user to the channel (ex: `/invite @sfdx-hardis-bot`)
- Additionally, you can create branch-scoped channels by creating new channels and create appropriate variables
  - Example: Channel _#notifs-sfdx-hardis-integration_ and variable **SLACK_CHANNEL_ID_INTEGRATION**
- Make sure all those variables are visible to your CI/CD pipelines

That's all, you're all set !
