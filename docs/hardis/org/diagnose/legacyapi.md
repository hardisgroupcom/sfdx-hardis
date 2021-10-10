<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:legacyapi

## Description

Checks if an org uses a deprecated API version


Advanced command guide in [**this article**](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)

- Salesforce will remove access to old API versions in the following releases
- An external application (ESB, ETL, Web Portal, Mobile application...) using a deprecated API version will receive errors as response, and this will probably break integrations business processes
- More info in [Salesforce Help](https://help.salesforce.com/s/articleView?id=000351312&language=en_US&mode=1&type=1) and in this [Salesforce blog post](https://t.co/uc2cobzmVi?amp=1)

| API versions | Salesforce deprecation release |
|:------------:|:------------------------------:|
| 7.0 to 20.0  |           Summer 21            |
| 21.0 to 30.0 |           Summer 22            |

- Run the command `sfdx hardis:org:diagnose:legacyapi`

![Legacy API result](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/legacy-api-result.png)

- If you see deprecated API calls, open the detailed CSV file and identify the sources of deprecated API calls
- You need to update your ecosystem external applications so they call a more recent version of APIS (52.0)


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|eventtype<br/>-e|option|Type of EventLogFile event to analyze|ApiTotalUsage|||
|json|boolean|format output as json||||
|limit<br/>-l|option|Number of latest EventLogFile events to analyze|999|||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|mode<br/>-m|option|Detection mode: jsforce or apex|jsforce|||
|outputfile<br/>-o|option|Force the path and name of output report file. Must end with .csv||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:diagnose:legacyapi
```

```shell
$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com
```

```shell
$ sfdx hardis:org:diagnose:legacyapi --outputfile 'c:/path/to/folder/legacyapi.csv'
```

```shell
$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com --outputfile ./tmp/legacyapi.csv
```


