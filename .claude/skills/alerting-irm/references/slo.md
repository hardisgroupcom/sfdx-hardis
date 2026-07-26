# SLOs and burn-rate alerts

Grafana auto-generates recording rules, dashboards, and burn-rate alerts when you define an SLO via the UI or API. Reference YAML for the generated artifacts:

## Generated recording rules

```yaml
groups:
  - name: slo_availability
    interval: 1m
    rules:
      - record: slo:availability:ratio_rate5m
        expr: |
          sum(rate(http_requests_total{status!~"5.."}[5m])) by (service)
          / sum(rate(http_requests_total[5m])) by (service)

      - record: slo:error_budget:remaining
        expr: |
          (slo:availability:ratio_rate30d - 0.999) / (1 - 0.999)
```

## Burn-rate alerts

```yaml
- alert: SLOBurnRateHigh
  expr: |
    slo:burn_rate:ratio_rate1h > 14.4      # 1h window, 5% budget in 1h
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "SLO burn rate critical for {{ $labels.service }}"
```

## Multi-window burn-rate alerts (recommended)

The single 1h-window check above fires on transient noise. Better to require burn rate above threshold in BOTH a long window (1h, the "sustained" signal) AND a short window (5m, the "still burning right now" signal):

```yaml
- alert: SLOBurnRateFast
  expr: |
    slo:burn_rate:ratio_rate1h > 14.4
    and
    slo:burn_rate:ratio_rate5m > 14.4
  for: 2m
  labels:
    severity: critical
```

The `and` filters out: (a) a single 5m spike that wasn't actually a sustained issue (1h window stays low), and (b) a slow burn that already recovered (5m window now low). This is the Google SRE "multi-window, multi-burn-rate" pattern — see [SRE Workbook ch. 5](https://sre.google/workbook/alerting-on-slos/).

## Validating SLO config

After creating an SLO:
1. Check recording rules are running: `GET /api/v1/rules?type=record` should include the SLO's recording rules
2. Wait for the rules to evaluate at least once (default interval 1m)
3. Verify burn rate is computed: `GET /api/v1/query?query=slo:burn_rate:ratio_rate1h` should return a numeric value (not empty)
4. Test the alert: force a failure (e.g. inject errors in staging) and confirm the alert fires within the `for` duration
