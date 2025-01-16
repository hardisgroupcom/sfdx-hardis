<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:flow2markdown

## Description

Generates a markdown documentation from a Flow file
  
If [AI integration](https://sfdx-hardis.cloudity.com/salesforce-ai-setup/) is configured, documentation will contain a summary of the Flow.  
  

## Parameters

| Name              |  Type   | Description                                                                    | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                |         |          |         |
| flags-dir         | option  | undefined                                                                      |         |          |         |
| inputfile<br/>-x  | option  | Path to Flow metadata file. If not specified, the command will prompt the user |         |          |         |
| json              | boolean | Format output as json.                                                         |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output markdown file. Must end with .md             |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                  |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                      |         |          |         |
| with-history      | boolean | Generate a markdown file with the history diff of the Flow                     |         |          |         |

## Examples

```shell
sf hardis:doc:flow2markdown
```

```shell
sf hardis:doc:flow2markdown --inputfile force-app/main/default/flows/MyFlow.flow-meta.xml
```


