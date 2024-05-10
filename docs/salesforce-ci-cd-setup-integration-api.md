---
title: Configure API notifications from Salesforce CI/CD
description: Learn how to send notifications to external apis like Grafana
---
<!-- markdownlint-disable MD013 -->

## API Integration (BETA)

You can send notifications to an external API endpoints, for example to build Grafana dashboards

- Deployment from a major branch to a major Salesforce org (ex: integration git branch to Integration Org)
- Salesforce [Org Monitoring](salesforce-monitoring-home.md)
  - Latest updates
  - Failing apex tests
  - Monitoring checks notifications

## Logs Configuration

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

## Metrics Configuration

Additionally, you can send metrics in Prometheus format to a secondary API endpoint.

The configuration is the same than for logs, but with different variable names.

- **NOTIF_API_METRICS_URL**
- **NOTIF_API_METRICS_BASIC_AUTH_USERNAME**
- **NOTIF_API_METRICS_BASIC_AUTH_PASSWORD**
- **NOTIF_API_METRICS_BEARER_TOKEN**

Example:

```sh
NOTIF_API_METRICS_URL=https://influx-prod-72-prod-eu-west-2.grafana.net/api/v1/push/influx/write
NOTIF_API_BASIC_AUTH_USERNAME=345673
NOTIF_API_BASIC_AUTH_PASSWORD=GHTRGDHDHdhghg23345DFG^sfg!ss
```

## Troubleshooting

If you want to see the content of the API notifications in execution logs, you can define `NOTIF_API_DEBUG=true`

