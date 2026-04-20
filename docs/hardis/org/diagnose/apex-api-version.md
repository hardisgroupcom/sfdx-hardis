<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:apex-api-version

## Description

Detects Apex classes and triggers deployed with API versions at or below a configurable threshold.

**Apex metadata API version** is the version the code was compiled against. This is separate from `hardis:org:diagnose:legacyapi`, which checks deprecated **API call** versions (SOAP, REST, Bulk) from EventLogFile.

Key functionalities:

- **Threshold-based detection:** API versions at or below the threshold are flagged as deprecated. Configure via `DEPRECATED_APEX_API_VERSION` env var (default: `50`).
- **Apex classes:** Queries custom Apex classes (excludes managed packages). Optionally excludes `@isTest` classes via `--includetestclasses`.
- **Apex triggers:** Queries custom Apex triggers (excludes managed packages).
- **CSV report:** Generates a report listing all deprecated classes and triggers with their ApiVersion.
- **Notifications:** Sends alerts to Grafana, Slack, MS Teams when deprecated Apex is found.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|includetestclasses<br/>-i|boolean|Include @isTest classes in the report (excluded by default)||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|threshold<br/>-t|option|API version threshold. Classes/triggers with ApiVersion <= this value are flagged. Overrides DEPRECATED_APEX_API_VERSION env var.||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

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


