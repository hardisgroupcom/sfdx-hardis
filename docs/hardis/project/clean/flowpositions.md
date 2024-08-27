<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:flowpositions

## Description

Replace all positions in Auto-Layout Flows by 0 to simplify conflicts management

As Flows are defined as Auto-Layout, the edition in Setup UI is not impacted.
  
Before:

```xml
<locationX>380</locationX>
<locationY>259</locationY>
```

After:

```xml
<locationX>0</locationX>
<locationY>0</locationY>
```

Can be automated at each **hardis:work:save** if **flowPositions** is added in .sfdx-hardis.yml **autoCleanTypes** property  

Example in config/.sfdx-hardis.yml:

```yaml
autoCleanTypes:
  - destructivechanges
  - flowPositions
```


## Parameters

| Name          |  Type   | Description                                                   |  Default  | Required |                        Options                        |
|:--------------|:-------:|:--------------------------------------------------------------|:---------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |           |          |                                                       |
| folder<br/>-f | option  | Root folder                                                   | force-app |          |                                                       |
| json          | boolean | format output as json                                         |           |          |                                                       |
| loglevel      | option  | logging level for this command invocation                     |   warn    |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth      | boolean | Skip authentication check when a default username is required |           |          |                                                       |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |           |          |                                                       |

## Examples

```shell
sf hardis:project:clean:flowpositions
```


