<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:project2markdown

## Description

Generates a markdown documentation from a SFDX project

- Package.xml files
- Source Packages
- sfdx-hardis configuration
- Installed packages

Can work on any sfdx project, no need for it to be a sfdx-hardis flavored one.

Generated markdown files will be written in **docs** folder (except README.md where a link to doc index is added)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc-2.jpg)


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:project2markdown
```


