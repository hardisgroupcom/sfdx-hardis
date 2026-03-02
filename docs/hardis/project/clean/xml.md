<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:xml

## Description

Remove XML elements using Glob patterns and XPath expressions
  
This can be very useful to avoid to always remove manually the same elements in the same XML file.

- **globpattern** can be any glob pattern allowing to identify the XML files to update, for example `/**/*.flexipage-meta.xml`

- **xpath** can be any xpath following the format `//ns:PARENT-TAG-NAME//ns:TAG-NAME[contains(text(),'TAG-VALUE')]`. If an element is found, the whole **PARENT-TAG-NAME** (with its subtree) will be removed.

![How to build cleaning XPath](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/doc-clean-xml.jpg)

Note: If globpattern and xpath are not sent, elements defined in property **cleanXmlPatterns** in **.sfdx-hardis.yml** config file will be used
  
  

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|folder<br/>-f|option|Root folder|force-app|||
|globpattern<br/>-p|option|Glob pattern to find files to clean. Ex: /**/*.flexipage-meta.xml||||
|json|boolean|Format output as json.||||
|namespace<br/>-n|option|XML Namespace to use|http://soap.sforce.com/2006/04/metadata|||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||
|xpath<br/>-x|option|XPath to use to detect the elements to remove. Ex: //ns:flexiPageRegions//ns:name[contains(text(),'dashboardName')]||||

## Examples

```shell
$ sf hardis:project:clean:xml
```

```shell
$ sf hardis:project:clean:xml --globpattern "/**/*.flexipage-meta.xml" --xpath "//ns:flexiPageRegions//ns:name[contains(text(),'dashboardName')]"
```


