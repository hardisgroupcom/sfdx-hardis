---
title: Configure Microsoft Teams notifications from Salesforce CI/CD
description: Learn how to configure Microsoft Teams notifications using Web Hooks
---
<!-- markdownlint-disable MD013 -->

In case issues or suspiscious results are found during CI jobs(failures, critical updates to come...), sfdx-hardis can send notifications to Microsoft Teams channels.

You can define hooks using env variables:

- MS_TEAMS_WEBHOOK_URL _(Used by default if no level hooks are defined)_
- MS_TEAMS_WEBHOOK_URL_CRITICAL
- MS_TEAMS_WEBHOOK_URL_SEVERE
- MS_TEAMS_WEBHOOK_URL_WARNING
- MS_TEAMS_WEBHOOK_URL_INFO

Ex: `MS_TEAMS_WEBHOOK_URL_CRITICAL=https://mycompany.webhook.office.com/webhookb2/f49c28c6-d10b-412c-b961-fge456bd@c1a7fa9b-90b3-49ab-b5e2-345HG88c/IncomingWebhook/b43c20SDSGFG56712d848bc1cebb17/53ee2e22-a867-4e74-868a-F3fs3935`
