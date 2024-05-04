---
title: Configure API notifications from Salesforce CI/CD
description: Learn how to send notifications to external apis like Grafana
---
<!-- markdownlint-disable MD013 -->

## API Integration

You can send notifications to an external API endpoints, for example to build Grafana dashboards

- Deployment from a major branch to a major Salesforce org (ex: integration git branch to Integration Org)
- Salesforce [Org Monitoring](salesforce-monitoring-home.md)
  - Latest updates
  - Failing apex tests
  - Monitoring checks notifications

## Configuration

Define the following CI/CD variables:

- **NOTIF_API_URL** : API endpoint
- **NOTIF_API_BASIC_AUTH_USERNAME** : Basic auth username _(if using Basic Auth)_
- **NOTIF_API_BASIC_AUTH_PASSWORD** : Basic auth password/token _(if using Basic Auth)_
- **NOTIF_API_BEARER_TOKEN** : Bearer token _(if using bearer auth)_

Examples:

```sh
NOTIF_API_URL=https://logs-prod-012.grafana.net/loki/api/v1/push
NOTIF_API_BASIC_AUTH_USERNAME=3435645645
NOTIF_API_BASIC_AUTH_PASSWORD=GHTRGDHDHdhghg23345DFG^sfg!ss
```

```sh
NOTIF_API_URL=https://my.custom.endpoint.net
NOTIF_API_BEARER_TOKEN=DDHGHfgfgjfhQESRDTHFKGKHFswgFHDHGDH
```

If you want to see the content of the API notifications in execution logs, you can define `NOTIF_API_DEBUG=true`

That's all, you're all set !


