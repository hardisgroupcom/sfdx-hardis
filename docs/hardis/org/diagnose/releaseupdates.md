<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:releaseupdates

## Description

Export Release Updates into a CSV file with selected criteria, and highlight Release Updates that should be checked.

Before publishing **Breaking Changes** ❌, Salesforce announce them in the setup menu [**Release Updates**](https://help.salesforce.com/s/articleView?id=sf.release_updates.htm&type=5)

⚠️ Some of them are very important, because if you don't make the related upgrades in time (ex: before Winter 25) , your production org can crash !

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-release-updates/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:diagnose:releaseupdates
```


