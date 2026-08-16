---
title: Configure Google Chat notifications from Salesforce CI/CD
description: Send notifications on Google Chat spaces during CI/CD operations
---
<!-- markdownlint-disable MD013 -->

## Google Chat Integration

You can receive notifications on Google Chat spaces when sfdx-hardis events are happening:

- Deployment from a major branch to a major Salesforce org (ex: integration git branch to Integration Org)
- Salesforce [Org Monitoring](salesforce-monitoring-home.md)
  - Latest updates
  - Failing apex tests
  - Monitoring checks notifications

## Prerequisite: Google Workspace

Google Chat **incoming webhooks are a Google Workspace feature**. Per [Google's official documentation](https://developers.google.com/workspace/chat/quickstart/webhooks), creating a webhook requires "a Business or Enterprise Google Workspace account with access to Google Chat", and the Workspace administrator must allow users to add and use incoming webhooks. A personal `@gmail.com` account cannot create one.

To test the integration without a corporate Workspace account, you have two options:

- **Validate the payload without Google Chat**: create a unique URL on [webhook.site](https://webhook.site/), set it as `GOOGLE_CHAT_WEBHOOK_URL`, run any monitoring or deployment command, and inspect the captured JSON. This exercises the full provider code path.
- **Real Google Chat rendering**: start a Google Workspace 14-day trial on a throwaway domain you own, or ask a teammate on a Workspace tenant to host the webhook on a test space and share the URL.

## Configure Google Chat Webhook

### Create the webhook

- Open Google Chat in a browser
- Navigate to your target space
- Click the arrow next to the space title and select **Apps & integrations**
- Click **Add webhooks**
- Name it `sfdx-hardis` and optionally set an avatar URL
- Click **Save**
- Click the More menu and select **Copy link** to retrieve the webhook URL

### Configure sfdx-hardis for Google Chat

- Create a secret value named **GOOGLE_CHAT_WEBHOOK_URL** with the webhook URL in your Git provider configuration

- Additionally, you can create branch-scoped webhooks by creating appropriate variables
  - Example: Variable **GOOGLE_CHAT_WEBHOOK_URL_INTEGRATION** for integration branch

- You can also define an additional webhook to receive only warning, error and critical notifications
  - Example: Variable **GOOGLE_CHAT_WEBHOOK_URL_ERRORS_WARNINGS**

- Make sure all those variables are visible to your CI/CD pipelines

That's all, you're all set !

## Per notification type severity threshold

Google Chat belongs to the `messaging` channel (shared with Slack and Microsoft Teams). You can raise the minimum severity required to post a notification on this channel per notification type, directly in `.sfdx-hardis.yml`:

```yaml
monitoringCommands:
  - key: AUDIT_TRAIL
    notifications:
      messaging: warning   # Slack/Teams/Google Chat only on warning, error, critical
  - key: METADATA_STATUS
    notifications:
      messaging: off       # mute Slack/Teams/Google Chat for this type
```

See [Monitoring configuration](salesforce-monitoring-config-home.md#fine-grained-routing-per-notification-type) for the full per-channel routing model.
