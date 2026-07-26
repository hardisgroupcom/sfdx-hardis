---
name: alerting-irm
license: Apache-2.0
description: Configure Grafana Alerting, Incident Response Management (IRM), and SLOs end-to-end — provisions Grafana-managed and data-source-managed alert rules, contact points (Slack/PagerDuty/email/webhook), notification policies with hierarchical matchers, silences, mute timings, on-call schedules and escalation chains, incident-management integrations, and SLOs with multi-window burn-rate alerts. Use when configuring alerts, debugging notification routing, setting up on-call rotations, declaring or managing incidents, defining SLOs, provisioning alerting via YAML or API, picking matchers for a notification policy, building a PagerDuty/Slack webhook receiver, or troubleshooting why an alert isn't firing — even when the user says "page me on errors", "alert me when X happens", "route this to the platform team", or "set up an SLO" without naming Alerting or IRM.
---

# Grafana Alerting & IRM

> **Docs**: https://grafana.com/docs/grafana/latest/alerting.md

## Common Workflows

### Provisioning a new alert end-to-end

1. **Create contact points** (where notifications go):
   ```bash
   curl -X POST https://grafana.example.com/api/v1/provisioning/contact-points \
     -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
     -d @contact-points.json
   ```
   Verify:
   ```bash
   curl https://grafana.example.com/api/v1/provisioning/contact-points \
     -H 'Authorization: Bearer <token>' | jq '.[].name'
   ```

2. **Add notification policies** (which alerts go where) — see [§ Notification policies](#notification-policies) below for the matchers pattern.

3. **Write the alert rule** — pick the type:
   - Grafana-managed → see [references/alerting.md § Grafana-managed alert rule](references/alerting.md#grafana-managed-alert-rule-yaml-provisioning)
   - Prometheus/Mimir ruler → see [references/alerting.md § Prometheus / Mimir alert rule](references/alerting.md#prometheus--mimir-alert-rule-ruler)
   - Loki LogQL → see [references/alerting.md § Loki alert rule](references/alerting.md#loki-alert-rule-logql)

4. **Verify routing** before going live:
   ```bash
   # Force-fire a test alert from the rule's UI, then check Alertmanager's view
   curl https://grafana.example.com/api/alertmanager/grafana/api/v2/alerts \
     -H 'Authorization: Bearer <token>' | jq '.[] | {alertname: .labels.alertname, receiver: .receivers}'
   ```
   The expected receiver should appear. If the wrong receiver appears, re-check the policy's matchers.

### Routing alerts to IRM / on-call

1. In IRM, create an Integration of type "Grafana Alerting webhook" → copy the integration URL
2. Add a webhook contact point in Grafana Alerting pointing at that URL (full YAML in [references/irm.md § Routing](references/irm.md#routing-from-grafana-alerting-to-irm))
3. Add a notification policy matcher routing the right severity to the new contact point
4. Verify: trigger a test alert; it should appear in IRM within ~30s. Full debug procedure in [references/irm.md § Verifying the IRM integration](references/irm.md#verifying-the-irm-integration).

### Defining an SLO

1. Create the SLO via UI or API → Grafana auto-generates recording rules, dashboards, and burn-rate alerts (the generated YAML is in [references/slo.md](references/slo.md))
2. **Use multi-window burn-rate alerts**, not single-window — see [references/slo.md § Multi-window burn-rate alerts](references/slo.md#multi-window-burn-rate-alerts-recommended) for why single-window fires on noise
3. Verify with the 4-step pattern in [references/slo.md § Validating SLO config](references/slo.md#validating-slo-config)

## Contact Points (YAML provisioning)

```yaml
# provisioning/alerting/contact_points.yaml
apiVersion: 1
contactPoints:
  - orgId: 1
    name: pagerduty-critical
    receivers:
      - uid: pd-receiver
        type: pagerduty
        settings:
          integrationKey: YOUR_PAGERDUTY_KEY
          severity: critical

  - orgId: 1
    name: slack-alerts
    receivers:
      - uid: slack-receiver
        type: slack
        settings:
          url: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
          channel: '#alerts'
```

For email, webhook, Teams, Telegram, OnCall, and other receiver types, see [references/alerting.md § Contact point receiver types](references/alerting.md#contact-point-receiver-types).

## Notification policies

Hierarchical routing tree with label matchers:

```yaml
# provisioning/alerting/notification_policies.yaml
apiVersion: 1
policies:
  - orgId: 1
    receiver: default-receiver
    group_by: ['alertname', 'cluster', 'service']
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 12h
    routes:
      # Critical alerts → PagerDuty
      - receiver: pagerduty-critical
        matchers:
          - severity = critical
        group_wait: 10s
        repeat_interval: 4h

      # Platform team → Slack, but page on critical
      - receiver: slack-alerts
        matchers:
          - team = platform
        routes:
          - receiver: pagerduty-critical
            matchers:
              - severity = critical

      # Everything else → email
      - receiver: email-alerts
        matchers:
          - severity =~ "warning|info"
```

## Silences

Suppress notifications for matching alerts without stopping evaluation:

```bash
curl -X POST https://grafana.example.com/api/alertmanager/grafana/api/v2/silences \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "matchers": [
      {"name": "alertname", "value": "HighErrorRate", "isRegex": false},
      {"name": "env", "value": "staging", "isRegex": false}
    ],
    "startsAt": "2024-01-01T00:00:00Z",
    "endsAt": "2024-01-01T02:00:00Z",
    "comment": "Maintenance window",
    "createdBy": "admin"
  }'

# Verify it was created
curl https://grafana.example.com/api/alertmanager/grafana/api/v2/silences \
  -H 'Authorization: Bearer <token>' | jq '.[] | select(.status.state == "active")'
```

## Alert rule states

| State | Description |
|-------|-------------|
| **Normal** | Condition not met |
| **Pending** | Condition met, waiting for `for` duration |
| **Firing** | Condition met for full `for` duration |
| **NoData** | Query returned no data |
| **Error** | Query/evaluation error |
| **Recovering** | Was firing, condition no longer met |

## Provisioning directory layout

```
provisioning/alerting/
├── alert_rules.yaml          # Alert and recording rules
├── contact_points.yaml       # Notification destinations
├── notification_policies.yaml  # Routing tree
├── templates.yaml            # Message templates
└── mute_timings.yaml         # Recurring mute windows
```

## API provisioning (keeps UI editable)

Add `X-Disable-Provenance: true` to keep resources editable in the UI after API provisioning:

```bash
curl -X PUT https://grafana.example.com/api/v1/provisioning/policies \
  -H 'Authorization: Bearer <token>' \
  -H 'X-Disable-Provenance: true' \
  -H 'Content-Type: application/json' \
  -d @policy.json

curl -X POST https://grafana.example.com/api/v1/provisioning/alert-rules \
  -H 'Authorization: Bearer <token>' \
  -H 'X-Disable-Provenance: true' \
  -H 'Content-Type: application/json' \
  -d @rule.json
```

## References

- [`references/alerting.md`](references/alerting.md) — full alert rule YAML (Grafana-managed / Prometheus / Loki) + notification templates
- [`references/slo.md`](references/slo.md) — generated SLO recording rules + multi-window burn-rate alert pattern + validation steps
- [`references/irm.md`](references/irm.md) — IRM capabilities, integration sources, Alerting → IRM routing + verification + common failure modes
