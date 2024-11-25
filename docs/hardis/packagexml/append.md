<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:packagexml:append

## Description

Append one or multiple package.xml files into a single one

## Parameters

| Name               |  Type   | Description                                  | Default | Required | Options |
|:-------------------|:-------:|:---------------------------------------------|:-------:|:--------:|:-------:|
| debug              | boolean | debug                                        |         |          |         |
| flags-dir          | option  | undefined                                    |         |          |         |
| json               | boolean | Format output as json.                       |         |          |         |
| outputfile<br/>-f  | option  | package.xml output file                      |         |          |         |
| packagexmls<br/>-p | option  | package.xml files path (separated by commas) |         |          |         |
| websocket          | option  | websocket                                    |         |          |         |

## Examples

```shell
sf hardis packagexml append -p package1.xml,package2.xml -o package3.xml
```


