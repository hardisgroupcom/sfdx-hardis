# Alert rule examples

Full YAML for the three rule types Grafana supports. The main SKILL.md keeps concise inline examples; this file has the complete patterns plus advanced queries.

## Contents

- [Grafana-managed alert rule (YAML provisioning)](#grafana-managed-alert-rule-yaml-provisioning)
- [Prometheus / Mimir alert rule (ruler)](#prometheus--mimir-alert-rule-ruler)
- [Loki alert rule (LogQL)](#loki-alert-rule-logql)
- [Contact point receiver types](#contact-point-receiver-types)
- [Notification templates](#notification-templates)

## Grafana-managed alert rule (YAML provisioning)

```yaml
# provisioning/alerting/rules.yaml
apiVersion: 1
groups:
  - orgId: 1
    name: MyAlertGroup
    folder: MyFolder
    interval: 1m
    rules:
      - uid: high-error-rate
        title: High Error Rate
        condition: C
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange:
              from: 300   # 5 minutes
              to: 0
            model:
              expr: sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
          - refId: B
            datasourceUid: __expr__
            model:
              type: reduce
              refId: B
              expression: A
              reducer: last
          - refId: C
            datasourceUid: __expr__
            model:
              type: math
              refId: C
              expression: $B > 0.05
        noDataState: NoData
        execErrState: Alerting
        for: 5m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "High error rate on {{ $labels.service }}"
          description: "Error rate is {{ $values.B }}%"
          runbook_url: "https://runbooks.example.com/high-error-rate"
```

## Prometheus / Mimir alert rule (ruler)

```yaml
groups:
  - name: service-alerts
    interval: 1m
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
          /
          sum(rate(http_requests_total[5m])) by (service)
          > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate: {{ $labels.service }}"

      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "P95 latency > 1s on {{ $labels.service }}"

      # Recording rule
      - record: job:http_requests:rate5m
        expr: sum(rate(http_requests_total[5m])) by (job)
```

## Loki alert rule (LogQL)

```yaml
groups:
  - name: log-alerts
    rules:
      - alert: HighErrorLogs
        expr: |
          sum(rate({app="myapp"} |= "error" [5m])) by (app)
          /
          sum(rate({app="myapp"}[5m])) by (app)
          > 0.05
        for: 10m
        labels:
          severity: page
        annotations:
          summary: "High error log rate for {{ $labels.app }}"

      - alert: CredentialsLeak
        expr: |
          sum by (cluster, job, pod) (
            count_over_time({namespace="prod"} |~ "https?://(\\w+):(\\w+)@" [5m]) > 0
          )
        for: 5m
        labels:
          severity: critical
```

## Contact point receiver types

SKILL.md shows PagerDuty + Slack inline. Other receiver types use the same shape under `receivers[].settings`:

```yaml
# Email
- orgId: 1
  name: email-alerts
  receivers:
    - uid: email-receiver
      type: email
      settings:
        addresses: 'oncall@example.com;alerts@example.com'

# Generic webhook
- orgId: 1
  name: webhook-alerts
  receivers:
    - uid: webhook-receiver
      type: webhook
      settings:
        url: https://your-endpoint.com/grafana-alerts
        httpMethod: POST
```

Other supported `type` values (full settings shape in [Grafana Alerting contact-point docs](https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/)): `teams`, `telegram`, `discord`, `opsgenie`, `victorops`, `sns`, `googlechat`, `line`, `wecom`, `kafka`, `oncall` (Grafana OnCall webhook).

## Notification templates

```
# Custom Slack template
{{ define "slack.custom.title" }}
  [{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}]
  {{ .CommonLabels.alertname }}
{{ end }}

{{ define "slack.custom.text" }}
{{ range .Alerts }}
*Alert:* {{ .Annotations.summary }}
*Severity:* {{ .Labels.severity }}
*Service:* {{ .Labels.service }}
*Details:* {{ .Annotations.description }}
{{ if .Annotations.runbook_url }}*Runbook:* {{ .Annotations.runbook_url }}{{ end }}
{{ end }}
{{ end }}
```
