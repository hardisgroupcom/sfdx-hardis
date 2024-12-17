<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unused-apex-classes

## Description

List all async Apex classes (Batch,Queueable,Schedulable) that has not been called for more than 365 days.
  
The result class list probably can be removed from the project, and that will improve your test classes performances :)

The number of unused day is overridable using --days option.

The command uses queries on AsyncApexJob and CronTrigger technical tables to build the result.

Apex Classes CreatedBy and CreatedOn fields are calculated from MIN(date from git, date from org)

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-unused-apex-classes/) and can output Grafana, Slack and MsTeams Notifications.

![](https://sfdx-hardis.cloudity.com/assets/images/screenshot-monitoring-unused-apex-grafana.jpg)


## Parameters

| Name              |  Type   | Description                                                                                             |           Default            | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| days<br/>-t       | option  | Extracts the users that have been inactive for the amount of days specified. In CI, default is 180 days |                              |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                         |                              |          |         |
| flags-dir         | option  | undefined                                                                                               |                              |          |         |
| json              | boolean | Format output as json.                                                                                  |                              |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv                                       |                              |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                           |                              |          |         |
| target-org<br/>-o | option  | undefined                                                                                               | hardis@cityone.fr.intfluxne2 |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                               |                              |          |         |

## Examples

```shell
sf hardis:org:diagnose:unused-apex-classes
```

```shell
sf hardis:org:diagnose:unused-apex-classes --days 700
```


