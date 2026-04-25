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

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:flowpositions --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|folder<br/>-f|option|Root folder|force-app|||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:clean:flowpositions
```

```shell
$ sf hardis:project:clean:flowpositions --agent
```


