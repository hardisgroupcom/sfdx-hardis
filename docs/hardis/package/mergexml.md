<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:mergexml

## Description

Select and merge package.xml files

## Parameters

| Name               |  Type   | Description                                                                                  |      Default      | Required | Options |
|:-------------------|:-------:|:---------------------------------------------------------------------------------------------|:-----------------:|:--------:|:-------:|
| debug              | boolean | debug                                                                                        |                   |          |         |
| flags-dir          | option  | undefined                                                                                    |                   |          |         |
| folder<br/>-f      | option  | Root folder                                                                                  |     manifest      |          |         |
| json               | boolean | Format output as json.                                                                       |                   |          |         |
| packagexmls<br/>-p | option  | Comma separated list of package.xml files to merge. Will be prompted to user if not provided |                   |          |         |
| pattern<br/>-x     | option  | Name criteria to list package.xml files                                                      | /**/*package*.xml |          |         |
| result<br/>-r      | option  | Result package.xml file name                                                                 |                   |          |         |
| skipauth           | boolean | Skip authentication check when a default username is required                                |                   |          |         |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                    |                   |          |         |

## Examples

```shell
sf hardis:package:mergexml
```

```shell
sf hardis:package:mergexml --folder packages --pattern /**/*.xml --result myMergedPackage.xml
```

```shell
sf hardis:package:mergexml --packagexmls "config/mypackage1.xml,config/mypackage2.xml,config/mypackage3.xml" --result myMergedPackage.xml
```


