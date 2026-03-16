# hardis:org:diagnose:apex-api-version

## Description

Detects Apex classes and triggers deployed with API versions at or below a configurable threshold.

**Apex metadata API version** is the version the code was compiled against. This is separate from `hardis:org:diagnose:legacyapi`, which checks deprecated **API call** versions (SOAP, REST, Bulk) from EventLogFile.

- **Threshold:** API versions at or below the threshold are flagged. Configure via `DEPRECATED_API_VERSION` env var (default: `50`) or `--threshold` flag.
- **Apex classes:** Queries custom Apex classes (excludes managed packages). Excludes `@isTest` classes by default; use `--includetestclasses` to include them.
- **Apex triggers:** Queries custom Apex triggers (excludes managed packages).
- **CSV report:** Generates a report listing all deprecated classes and triggers with their ApiVersion.
- **Notifications:** Sends alerts to Grafana, Slack, MS Teams when deprecated Apex is found.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.

## Parameters

| Name                    | Type    | Description                                                                 | Default | Required | Options |
|:------------------------|:-------:|:----------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| threshold<br/>-t        | option  | API version threshold. Classes/triggers with ApiVersion <= this are flagged. Overrides DEPRECATED_API_VERSION. |         |          |         |
| includetestclasses<br/>-i | boolean | Include @isTest classes in the report (excluded by default)                 | false   |          |         |
| outputfile<br/>-f       | option  | Force the path and name of output report file. Must end with .csv           |         |          |         |
| debug<br/>-d            | boolean | Activate debug mode (more logs)                                             |         |          |         |
| skipauth                | boolean | Skip authentication check when a default username is required               |         |          |         |
| target-org<br/>-o       | option  | Target org alias or username                                                |         |          |         |
| websocket               | option  | Websocket host:port for VsCode SFDX Hardis UI integration                 |         |          |         |

## Environment Variables

| Variable               | Description                                                                 | Default |
|:-----------------------|:----------------------------------------------------------------------------|:--------|
| **DEPRECATED_API_VERSION** | API version threshold. Classes/triggers with ApiVersion at or below this are flagged. | `50`    |

## Examples

```shell
$ sf hardis:org:diagnose:apex-api-version
```

```shell
$ sf hardis:org:diagnose:apex-api-version --threshold 55
```

```shell
$ sf hardis:org:diagnose:apex-api-version --outputfile ./reports/apex-api-version.csv
```

```shell
DEPRECATED_API_VERSION=55 sf hardis:org:diagnose:apex-api-version
```
