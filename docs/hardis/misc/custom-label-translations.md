<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:misc:custom-label-translations

## Description

Extract selected custom labels, or of a given Lightning Web Component (LWC), from all language translation files. This command generates translation files ('*.translation - meta.xml') for each language already retrieved in the current project, containing only the specified custom labels.

## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| label<br/>-l | option  | Developer name(s) of the custom label(s), comma-separated     |         |          |         |
| lwc<br/>-c   | option  | Developer name of the Lightning Web Component                 |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
sf hardis:misc:custom-label-translations --label CustomLabelName
```

```shell
sf hardis:misc:custom-label-translations --label Label1,Label2
```

```shell
sf hardis:misc:custom-label-translations --lwc MyComponent
```


