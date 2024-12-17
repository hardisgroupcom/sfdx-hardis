<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:monitor:all

## Description

Monitor org, generate reports and sends notifications

You can disable some commands defining either a **monitoringDisable** property in `.sfdx-hardis.yml`, or a comma separated list in env variable **MONITORING_DISABLE**

Example in .sfdx-hardis.yml:
  
```yaml
monitoringDisable:
  - METADATA_STATUS
  - MISSING_ATTRIBUTES
  - UNUSED_METADATAS
```
  
Example in env var:

```sh
MONITORING_DISABLE=METADATA_STATUS,MISSING_ATTRIBUTES,UNUSED_METADATAS
```

A [default list of monitoring commands](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/#monitoring-commands) is used, if you want to override it you can define property **monitoringCommands** in your .sfdx-hardis.yml file

Example:

```yaml
monitoringCommands:
  - title: My Custom command
    command: sf my:custom:command
  - title: My Custom command 2
    command: sf my:other:custom:command
```

You can force the daily run of all commands by defining env var `MONITORING_IGNORE_FREQUENCY=true`

The default list of commands is the following:

|                                               Key                                               | Description                                                                     | Command                                                                                                                    | Frequency |
|:-----------------------------------------------------------------------------------------------:|:--------------------------------------------------------------------------------|:---------------------------------------------------------------------------------------------------------------------------|:---------:|
|         [AUDIT_TRAIL](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail)          | Detect suspect setup actions in major org                                       | [sf hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail)                       |   daily   |
|          [LEGACY_API](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi)           | Detect calls to deprecated API versions                                         | [sf hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi)                         |   daily   |
|            [ORG_LIMITS](https://sfdx-hardis.cloudity.com/hardis/org/monitor/limits)             | Detect if org limits are close to be reached                                    | [sf hardis:org:monitor:limits](https://sfdx-hardis.cloudity.com/hardis/org/monitor/limits)                                 |   daily   |
|            [LICENSES](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/licenses)            | Extract licenses information                                                    | [sf hardis:org:diagnose:licenses](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/licenses)                           |  weekly   |
|               [LINT_ACCESS](https://sfdx-hardis.cloudity.com/hardis/lint/access)                | Detect custom elements with no access rights defined in permission sets         | [sf hardis:lint:access](https://sfdx-hardis.cloudity.com/hardis/lint/access)                                               |  weekly   |
|     [UNUSED_LICENSES](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses)      | Detect permission set licenses that are assigned to users that do not need them | [sf hardis:org:diagnose:unusedlicenses](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses)               |  weekly   |
|        [UNUSED_USERS](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedusers)         | Detect active users without recent logins                                       | [sf hardis:org:diagnose:unusedusers](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedusers)                     |  weekly   |
|        [ACTIVE_USERS](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedusers)         | Detect active users with recent logins                                          | [sf hardis:org:diagnose:unusedusers --returnactiveusers](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedusers) |  weekly   |
|        [ORG_INFO](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/instanceupgrade)         | Get org info + SF instance info + next major upgrade date                       | [sf hardis:org:diagnose:instanceupgrade](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/instanceupgrade)             |  weekly   |
|     [RELEASE_UPDATES](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/releaseupdates)      | Gather warnings about incoming and overdue Release Updates                      | [sf hardis:org:diagnose:releaseupdates](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/releaseupdates)               |  weekly   |
|        [UNUSED_METADATAS](https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas)         | Detect custom labels and custom permissions that are not in use                 | [sf hardis:lint:unusedmetadatas](https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas)                             |  weekly   |
| [UNUSED_APEX_CLASSES](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-apex-classes) | Detect unused Apex classes in an org                                            | [sf hardis:org:diagnose:unused-apex-classes](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-apex-classes)     |  weekly   |
|  [CONNECTED_APPS](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-connected-apps)   | Detect unused Connected Apps in an org                                          | [sf hardis:org:diagnose:unused-connected-apps](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-connected-apps) |  weekly   |
|         [METADATA_STATUS](https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus)          | Detect inactive metadata                                                        | [sf hardis:lint:metadatastatus](https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus)                               |  weekly   |
|      [MISSING_ATTRIBUTES](https://sfdx-hardis.cloudity.com/hardis/lint/missingattributes)       | Detect missing description on custom field                                      | [sf hardis:lint:missingattributes](https://sfdx-hardis.cloudity.com/hardis/lint/missingattributes)                         |  weekly   |



## Parameters

| Name              |  Type   | Description                                                   |           Default            | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                              |          |         |
| flags-dir         | option  | undefined                                                     |                              |          |         |
| json              | boolean | Format output as json.                                        |                              |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |                              |          |         |
| target-org<br/>-o | option  | undefined                                                     | hardis@cityone.fr.intfluxne2 |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                              |          |         |

## Examples

```shell
sf hardis:org:monitor:all
```


