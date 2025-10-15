# Vector Configuration for sfdx-hardis Monitoring

This guide explains how to configure Vector to collect sfdx-hardis notification logs and send them to Loki or Datadog for monitoring with Grafana dashboards.

## Overview

This guide is part of the [sfdx-hardis monitoring suite](salesforce-monitoring-home.md). It covers:

- Writing notification logs to local JSON files via `NOTIF_API_LOGS_JSON_FILE`
- Configuring Vector to collect and forward logs to Loki or Datadog
- Querying logs in Grafana using LogQL

**Benefits:**

- **Local monitoring** without external API infrastructure
- **Loki ingestion** via Vector for Grafana dashboards  
- **Audit trails** of all notifications in NDJSON format
- **Offline development** and debugging
- **Multiple destinations** (Loki, Datadog, or both)

## Prerequisites

- [Vector](https://vector.dev/) installed (v0.28+)
- Loki instance running OR Datadog account (or both)
- Grafana instance (for visualization)
- sfdx-hardis installed and configured

## Quick Start

1. **Enable file logging** in sfdx-hardis:

   ```bash
   export NOTIF_API_LOGS_JSON_FILE=/path/to/logs/sfdx-hardis-logs.json
   ```

2. **Configure Vector** (see [Sample Vector Configuration](#sample-vector-configuration) below)

3. **Run monitoring commands**:

   ```bash
   sf hardis:org:monitor:all
   ```

4. **Query logs in Grafana** using LogQL (see [Query in Grafana](#4-query-in-grafana) below)

## Configuration

### Environment Variable

Set the following environment variable to enable JSON file logging:

```bash
export NOTIF_API_LOGS_JSON_FILE=/path/to/logs/sfdx-hardis-logs.json
```

### Log Format

Logs are written in **newline-delimited JSON (NDJSON)** format, with one complete notification per line:

```json
{"timestamp":"2025-10-10T14:30:00.000Z","source":"sfdx-hardis","type":"ORG_LIMITS","severity":"warning","orgIdentifier":"production-org","gitIdentifier":"my-repo/main","metric":75.5,"_metrics":{...},"_logElements":[...],"_title":"Org Limits Check","_jobUrl":"https://..."}
```

### Fields

Each log entry contains:

| Field           | Description                                                           |
|-----------------|-----------------------------------------------------------------------|
| `timestamp`     | ISO 8601 timestamp of when the notification was generated             |
| `source`        | Always "sfdx-hardis"                                                  |
| `type`          | Notification type (e.g., ORG_LIMITS, AUDIT_TRAIL, LEGACY_API)         |
| `severity`      | Notification severity (critical, error, warning, info, success, log)  |
| `orgIdentifier` | Salesforce org identifier                                             |
| `gitIdentifier` | Git repository and branch (format: `repo/branch`)                     |
| `metric`        | Primary metric value (if applicable)                                  |
| `_metrics`      | Object containing all metrics with details (value, min, max, percent) |
| `_logElements`  | Array of individual log elements (e.g., suspect audit logs)           |
| `_title`        | Human-readable notification title                                     |
| `_jobUrl`       | CI/CD job URL (if available)                                          |
| `limits`        | For ORG_LIMITS notifications: detailed limit information              |

## Usage Examples

### Basic Usage

```bash
# Set the log file path
export NOTIF_API_LOGS_JSON_FILE=./logs/sfdx-hardis-logs.json

# Run any monitoring command
sf hardis:org:monitor:limits --target-org myorg

# Logs will be written to ./logs/sfdx-hardis-logs.json
```

You can use both file logging AND API endpoint simultaneously:

```bash
# Send to API AND write to file
export NOTIF_API_URL=https://my-loki.example.com/loki/api/v1/push
export NOTIF_API_LOGS_JSON_FILE=./logs/sfdx-hardis-logs.json

sf hardis:org:monitor:all
```

### File Only (No API)

You can also use **only** file logging without any API endpoint:

```bash
# Only write to file (no API endpoint required)
export NOTIF_API_LOGS_JSON_FILE=./logs/sfdx-hardis-logs.json

sf hardis:org:monitor:all
```

## Integration with Monitoring Stack

### Vector + Loki + Grafana

This setup is configured to work with the dashboards provided by sfdx-hardis.

If you're using a monitoring stack (Vector + Loki + Grafana), configure Vector to watch the log file: 

**1. Set the log file path to your logs directory:**

```bash
export NOTIF_API_LOGS_JSON_FILE=/path/to/monitoring/logs/sfdx-hardis-logs.json
```

**2. Vector Configuration** [config/vector/vector.toml](## Sample Vector Configuration)

The default Vector configuration is already compatible! It:
- Reads NDJSON files from the logs directory
- Parses JSON and extracts all fields
- Sends to Loki with proper labels

No changes needed if you're using the standard Vector config!

**4. Query in Grafana:**

```logql
# All sfdx-hardis notifications
{source="sfdx-hardis"}

# Org limits warnings
{source="sfdx-hardis", type="ORG_LIMITS", severity="warning"}

# All notifications for a specific org
{orgIdentifier="production-org"}

# Extract metrics from logs
{source="sfdx-hardis"} | json | metric > 75
```

### Log Rotation

The file is append-only. Consider rotating logs periodically:

**Option 1: Include date in filename**

```bash
# Set filename with date - creates a new file each day
export NOTIF_API_LOGS_JSON_FILE="./logs/sfdx-hardis-logs-$(date +%Y-%m-%d).json"
```

**Option 2: Rotation script**

```bash
# Rotate if file exists and is older than 1 day
LOG_FILE="./logs/sfdx-hardis-logs.json"
if [ -f "$LOG_FILE" ]; then
  # Check if file is older than 1 day
  if [ $(find "$LOG_FILE" -mtime +1 | wc -l) -gt 0 ]; then
    YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)
    mv "$LOG_FILE" "./logs/sfdx-hardis-logs-$YESTERDAY.json"
  fi
fi
```

## Related Environment Variables

- **NOTIF_API_LOGS_JSON_FILE** : Path to write notification logs
- **NOTIF_API_METRICS_URL** : Metrics endpoint (Prometheus Pushgateway or Grafana Cloud)
- **DD_API_KEY** : Datadog API key (if using Datadog sink)
- **DD_URL** : Datadog endpoint URL (if using Datadog sink)
- **LOG_FILES_PATH** :  Vector: Path to watch for log files (only for vector)


**Note:** If `NOTIF_API_METRICS_URL` contains `/metrics/job/` or `pushgateway`, metrics are automatically formatted for Prometheus. Otherwise, InfluxDB format is used. 

## Next Steps

After setting up Vector, you can:

1. **Set up Grafana dashboards** - See [Monitoring Configuration](salesforce-monitoring-config-home.md)
2. **Configure metrics collection** - Use `NOTIF_API_METRICS_URL` for Prometheus/Pushgateway

## Additional Resources

### Official Documentation

- [Vector Configuration Guide](https://vector.dev/docs/reference/configuration/)
- [Loki LogQL Documentation](https://grafana.com/docs/loki/latest/logql/)
- [Datadog Logs](https://docs.datadoghq.com/logs/)
- [Grafana Explore](https://grafana.com/docs/grafana/latest/explore/)

### sfdx-hardis Monitoring Guides

- [Monitoring Home](salesforce-monitoring-home.md) - Overview of all monitoring features
- [Monitoring Configuration](salesforce-monitoring-config-home.md) - Configuration guides
- [API Integration](salesforce-ci-cd-setup-integration-api.md) - Direct API integration (without Vector)



## Sample Vector Configuration

Below is a complete Vector configuration that supports both Loki and Datadog destinations. You can use either or both based on your needs.

### Configuration File: `vector.toml`

```toml
# Vector Configuration for sfdx-hardis Monitoring
# https://vector.dev/docs/reference/configuration/

# Data directory for Vector's state
data_dir = "/var/lib/vector"

# Source: File logs
# Reads NDJSON log files written by sfdx-hardis apiProvider.ts
[sources.local_files]
  type = "file"
  include = [
    "${LOG_FILES_PATH:-/logs/**/*.log}",
    "/logs/**/*.json"
  ]
  read_from = "beginning"
  max_line_bytes = 10485760  # 10MB max line size for large aggregate logs

# Transform: Parse JSON logs (flat NDJSON format from sfdx-hardis)
[transforms.parse_json]
  type = "remap"
  inputs = ["local_files"]
  source = '''
  # Parse the JSON line
  parsed, err = parse_json(.message)
  if err != null {
    # Not JSON, skip this line
    abort
  }

  # Merge the parsed JSON into the event
  . = merge!(., parsed)

  # Add metadata
  .host = get_hostname!()
  .source_file = string(.file) ?? "log-file"

  # Set defaults only if missing (apiProvider.ts should provide all fields)
  if !exists(.source) {
    .source = "sfdx-hardis"
  }
  if !exists(.type) {
    .type = "UNKNOWN"
  }
  if !exists(.severity) {
    .severity = "info"
  }
  if !exists(.orgIdentifier) {
    .orgIdentifier = "unknown-org"
  }
  if !exists(.gitIdentifier) {
    .gitIdentifier = "unknown"
  }

  # Parse timestamp if it's a string
  if exists(.timestamp) && is_string(.timestamp) {
    ts, ts_err = parse_timestamp(.timestamp, format: "%+")
    if ts_err == null {
      .timestamp = ts
    }
  }
  '''

# Transform: Ensure dashboard compatibility
# apiProvider.ts already provides most fields, this just ensures proper structure
[transforms.ensure_compatibility]
  type = "remap"
  inputs = ["parse_json"]
  source = '''
  # For ORG_LIMITS: Transform _metrics to limits structure if needed
  # Dashboards expect: limits.DataStorageMB.percentUsed, etc.
  # apiProvider.ts now includes limits field, but transform _metrics as fallback
  if .type == "ORG_LIMITS" && !exists(.limits) && exists(._metrics) && is_object(._metrics) {
    .limits = {}

    # Dynamically create limit structures from _metrics
    metrics_keys = keys!(._metrics)
    for_each(metrics_keys) -> |_index, key| {
      metric_val = get!(._metrics, [key])

      # Check if this is a limit object (has percent, value, max fields)
      if is_object(metric_val) && exists(metric_val.percent) {
        limit_obj = {}
        limit_obj.percentUsed = to_float(metric_val.percent) ?? 0.0
        limit_obj.used = to_int(metric_val.value) ?? 0
        limit_obj.max = to_int(metric_val.max) ?? 0
        limit_obj.name = key
        limit_obj.label = key

        .limits = set!(.limits, [key], limit_obj)
      }
    }
  }

  # FIX: Ensure all Loki label fields have non-empty values
  # Vector Loki sink silently drops events if label templates resolve to null/empty
  if !exists(.gitIdentifier) || .gitIdentifier == null || .gitIdentifier == "" {
    .gitIdentifier = "unknown"
  }
  if !exists(.source_file) || .source_file == null || .source_file == "" {
    .source_file = "log-file"
  }
  '''

# Sink: Send logs to Loki
[sinks.loki]
  type = "loki"
  inputs = ["ensure_compatibility"]
  endpoint = "http://loki:3100"
  encoding.codec = "json"

  # Labels for Loki - Required by sfdx-hardis Grafana dashboards
  labels.job = "sfdx-hardis"
  labels.source = "{{ source }}"
  labels.type = "{{ type }}"
  labels.orgIdentifier = "{{ orgIdentifier }}"
  labels.severity = "{{ severity }}"
  labels.gitIdentifier = "{{ gitIdentifier }}"
  labels.source_file = "{{ source_file }}"

# Sink: Send logs to Datadog (OPTIONAL)
# Remove this entire section if not using Datadog to avoid errors with missing env variables
[sinks.datadog]
  type = "datadog_logs"
  inputs = ["ensure_compatibility"]
  default_api_key = "${DD_API_KEY}"      # Set this in your environment
  endpoint = "${DD_URL}"                 # Example: https://http-intake.logs.datadoghq.com
  compression = "gzip"
```

### Using the Configuration

**1. For Loki only:**

- Keep the `[sinks.loki]` section
- Remove or comment out the `[sinks.datadog]` section

**2. For Datadog only:**

- Remove or comment out the `[sinks.loki]` section  
- Keep the `[sinks.datadog]` section and set `DD_API_KEY` and `DD_URL` environment variables

**3. For both Loki and Datadog:**

- Keep both sink sections
- Set Datadog environment variables

**4. Set environment variables:**

```bash
# Required for Vector
export LOG_FILES_PATH=/path/to/logs

# Optional for Datadog
export DD_API_KEY=your_datadog_api_key
export DD_URL=https://http-intake.logs.datadoghq.com
```
