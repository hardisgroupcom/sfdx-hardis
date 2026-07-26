# IRM — on-call and incident management

## Capabilities

- **On-call schedules**: rotating shifts, overrides, escalation policies
- **Alert routing**: receive from Grafana Alerting, Prometheus, Datadog, PagerDuty, etc.
- **Incident management**: declare incidents, add participants, track tasks and timeline
- **Escalation chains**: auto-escalate if no response after N minutes
- **Integrations**: Slack, Teams, Telegram, GitHub, Jira, StatusPage

## Integration sources

| Source | Setup |
|--------|-------|
| Grafana Alerting | Native — configure in contact points (use IRM webhook receiver type) |
| Prometheus Alertmanager | Webhook URL from IRM |
| Datadog | Webhook integration |
| PagerDuty | Event integration |
| Jira | Issue-triggered alerts |
| Custom | Generic webhook |

## Routing from Grafana Alerting to IRM

In `provisioning/alerting/contact_points.yaml`:

```yaml
apiVersion: 1
contactPoints:
  - orgId: 1
    name: irm-routing
    receivers:
      - uid: irm-webhook
        type: webhook
        settings:
          url: https://<region>.grafana.net/api/plugins/grafana-irm-app/resources/integrations/<integration-id>/webhook
          httpMethod: POST
```

Then route alerts to this contact point via a notification policy matcher (e.g. `severity = page`).

## Verifying the IRM integration

1. Trigger a test alert in Grafana (use the "Test" button in the alert rule UI, or send a fake one via `POST /api/v1/alerts`)
2. In the IRM UI, the alert should appear under the matching integration within ~30 seconds
3. If it doesn't:
   - Check the webhook URL matches the integration's URL in IRM
   - Check the notification policy actually routes to the `irm-routing` contact point
   - Check Grafana logs for HTTP errors on the webhook POST

## Common failure modes

| Symptom | Likely cause |
|---|---|
| Alert fires in Grafana but never reaches IRM | Notification policy doesn't match the alert's labels; check matchers in `policies.yaml` |
| Alert reaches IRM but no on-call notification | Escalation chain misconfigured (e.g. no users in the rotation, or quiet hours suppressing) |
| Same alert opens duplicate IRM incidents | Group_by on the notification policy isn't including the unique-ifying labels |
