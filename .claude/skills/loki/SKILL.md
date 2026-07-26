---
name: loki
license: Apache-2.0
description: >
  Grafana Loki log aggregation and LogQL query language. Covers LogQL syntax (log queries, metric queries,
  label matchers, line filters, parsers: json/logfmt/pattern/regexp/unpack, label filters, line_format),
  Loki architecture, log ingestion via Alloy/Promtail/Fluent Bit, structured metadata, and Logs Drilldown.
  Use when writing LogQL queries, configuring Loki, troubleshooting log pipelines, or analyzing logs.
---

# Grafana Loki - Log Aggregation

> **Docs**: https://grafana.com/docs/loki/latest/

Indexes only metadata (labels), not full log content — dramatically cheaper than full-text search systems.

## LogQL Quick Reference

### Log Stream Selector (required in every query)

```logql
{app="nginx"}                        # exact match
{app!="nginx"}                       # not equal
{app=~"nginx|apache"}               # regex match
{app!~"debug.*"}                     # regex not match
{app="nginx", env="prod"}           # AND (multiple labels)
```

### Line Filters (pipeline stage 1 - put first for performance)

```logql
{app="nginx"} |= "error"            # contains string
{app="nginx"} != "info"             # does not contain
{app="nginx"} |~ "error|warn"       # regex match
{app="nginx"} !~ "health.*check"    # regex not match
{app="nginx"} |= `"status":5`       # backtick avoids escaping
```

### Parsers

```logql
# JSON
{app="api"} | json
{app="api"} | json status="http_status", path="request.path"

# Logfmt
{app="api"} | logfmt
{app="api"} | logfmt --strict
{app="api"} | logfmt --keep-empty

# Pattern (positional, _ discards)
{app="nginx"} | pattern `<ip> - - <_> "<method> <uri> <_>" <status> <bytes>`

# Regexp (named capture groups)
{app="nginx"} | regexp `(?P<method>\w+) (?P<path>\S+) HTTP/(?P<version>\S+)`

# Unpack (unwrap Promtail packed labels)
{app="api"} | unpack
```

### Label Filters (after parsers)

```logql
{app="api"} | json | status >= 500
{app="api"} | json | status == 200 and method != "OPTIONS"
{app="api"} | logfmt | duration > 1s
{app="api"} | json | level =~ "error|warn"
{app="api"} | json | bytes > 20MB
{app="api"} | json | path != "/healthz"
```

### Line Format

```logql
{app="api"} | json | line_format "{{.method}} {{.path}} -> {{.status}} ({{.duration}})"
{app="api"} | logfmt | line_format `{{.level | upper}}: {{.msg}}`
```

### Label Format

```logql
{app="api"} | logfmt | label_format new_name=old_name
{app="api"} | logfmt | label_format severity=level, svc=app
{app="api"} | logfmt | label_format msg=`{{.level}}: {{.message}}`
```

### Drop/Keep Labels

```logql
{app="api"} | json | drop filename, level="debug"
{app="api"} | json | keep level, status, method
```

### Decolorize

```logql
{app="cli-tool"} | decolorize
```

## Metric Queries

### Log Range Aggregations

```logql
# Requests per second
rate({app="nginx"}[5m])

# Total log lines in window
count_over_time({app="nginx"}[1h])

# Bytes per second
bytes_rate({app="nginx"}[5m])

# Total bytes
bytes_over_time({app="nginx"}[1h])

# Returns 1 if no logs in range (for absence alerting)
absent_over_time({app="nginx"}[5m])
```

### Aggregation

```logql
# Error rate by service
sum(rate({env="prod"} |= "error" [5m])) by (app)

# Top 5 most active services
topk(5, sum(rate({env="prod"}[5m])) by (app))

# Total errors across all services
sum(count_over_time({env="prod"} |= "error" [5m]))
```

### Unwrapped Range Aggregations (numeric values from logs)

```logql
# Average request duration from logfmt
avg_over_time({app="api"} | logfmt | unwrap duration [5m])

# 95th percentile latency
quantile_over_time(0.95, {app="api"} | logfmt | unwrap duration [5m]) by (app)

# Sum of bytes from JSON logs
sum_over_time({app="api"} | json | unwrap bytes [5m])

# With conversion (duration string → seconds)
avg_over_time({app="api"} | logfmt | unwrap duration | duration_seconds [5m])
```

### Offset Modifier

```logql
# Compare current rate vs 1 hour ago
rate({app="nginx"}[5m]) / rate({app="nginx"}[5m] offset 1h)
```

## Practical Examples

### Error rate alert query
```logql
sum(rate({env="prod"} |= "error" [5m])) by (service)
/
sum(rate({env="prod"}[5m])) by (service)
> 0.05
```

### Slow requests
```logql
{app="api"} | logfmt | duration > 1s | line_format "SLOW: {{.method}} {{.path}} {{.duration}}"
```

### HTTP 5xx errors with details
```logql
{app="nginx"} | pattern `<ip> - - <_> "<method> <uri> <_>" <status> <bytes>` | status >= 500
```

### Credential leak detection
```logql
{namespace="prod"} |~ `https?://\w+:\w+@`
```

## Sending Logs to Loki

### Via Grafana Alloy

```alloy
loki.source.file "app" {
  targets    = [{__path__ = "/var/log/app/*.log", job = "app"}]
  forward_to = [loki.process.parse.receiver]
}

loki.process "parse" {
  forward_to = [loki.write.cloud.receiver]
  stage.json {
    expressions = { level = "level", msg = "message" }
  }
  stage.labels {
    values = { level = "" }
  }
  stage.drop {
    expression = ".*healthcheck.*"
  }
}

loki.write "cloud" {
  endpoint {
    url = "https://logs-xxx.grafana.net/loki/api/v1/push"
    basic_auth {
      username = sys.env("LOKI_USER")
      password = sys.env("GRAFANA_API_KEY")
    }
  }
  external_labels = { cluster = "prod" }
}
```

### Via Kubernetes (Alloy DaemonSet)

```alloy
discovery.kubernetes "pods" {
  role = "pod"
}

loki.source.kubernetes "pods" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [loki.write.cloud.receiver]
}
```

### Loki HTTP Push API

```bash
curl -X POST https://logs-xxx.grafana.net/loki/api/v1/push \
  -u "user:apikey" \
  -H 'Content-Type: application/json' \
  -d '{
    "streams": [{
      "stream": { "app": "myapp", "env": "prod" },
      "values": [
        ["1609459200000000000", "log line here"]
      ]
    }]
  }'
```

## Architecture

```
Push path:  Client → Distributor → Ingester (WAL) → Object Storage (chunks)
Read path:  Query → Query Frontend → Querier → Ingester + Store (chunks)
```

**Components:**
- **Distributor**: Validates and hashes incoming log streams
- **Ingester**: Buffers chunks in memory, flushes to object storage
- **Querier**: Executes LogQL queries
- **Query Frontend**: Caches, splits, and parallelizes queries
- **Compactor**: Manages retention and deduplication

## References

- [LogQL Reference](references/logql.md)
- [Configuration](references/configuration.md)
- [Sending Data](references/send-data.md)
