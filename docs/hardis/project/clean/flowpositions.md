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

By default, all Flows of the **--folder** are scanned. Use **--flows** or **--files** to restrict the cleaning to a subset:

```sh
sf hardis:project:clean:flowpositions --flows Opportunity_Won,Account_Before_Save
sf hardis:project:clean:flowpositions --files force-app/main/default/flows/Opportunity_Won.flow-meta.xml
```

**hardis:work:save** uses **--flows** with the Flow members of the package.xml built by sfdx-git-delta, so repositories with hundreds of Flows are not scanned entirely.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:flowpositions --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

| Name          |  Type   | Description                                                                |  Default  | Required | Options |
|:--------------|:-------:|:---------------------------------------------------------------------------|:---------:|:--------:|:-------:|
| agent         | boolean | Run in non-interactive mode for agents and automation                      |           |          |         |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                                            |           |          |         |
| files         | option  | Comma-separated list of Flow metadata files to clean, instead of all Flows |           |          |         |
| flags-dir     | option  | undefined                                                                  |           |          |         |
| flows         | option  | Comma-separated list of Flow API names to clean, instead of all Flows      |           |          |         |
| folder<br/>-f | option  | Root folder                                                                | force-app |          |         |
| json          | boolean | Format output as json.                                                     |           |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required              |           |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration                  |           |          |         |

## Examples

```shell
$ sf hardis:project:clean:flowpositions
```

```shell
$ sf hardis:project:clean:flowpositions --flows Opportunity_Won,Account_Before_Save
```

```shell
$ sf hardis:project:clean:flowpositions --agent
```


