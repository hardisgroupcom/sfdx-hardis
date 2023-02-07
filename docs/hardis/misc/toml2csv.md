<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:misc:toml2csv

## Description

Split TOML file into distinct CSV files

## Parameters

| Name                  |  Type   | Description                                                              | Default | Required |                        Options                        |
|:----------------------|:-------:|:-------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command      |         |          |                                                       |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                          |         |          |                                                       |
| filtersections<br/>-l | option  | List of sections to process (if not set, all sections will be processed) |         |          |                                                       |
| json                  | boolean | format output as json                                                    |         |          |                                                       |
| loglevel              | option  | logging level for this command invocation                                |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputdir<br/>-o      | option  | Output directory                                                         |         |          |                                                       |
| skipauth              | boolean | Skip authentication check when a default username is required            |         |          |                                                       |
| skiptransfo<br/>-s    | boolean | Do not apply transformation to input data                                |         |          |                                                       |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org       |         |          |                                                       |
| tomlfile<br/>-f       | option  | Input TOML file path                                                     |         |          |                                                       |
| transfoconfig<br/>-t  | option  | Path to JSON config file for mapping and transformation                  |         |          |                                                       |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                |         |          |                                                       |

## Examples

```shell
sfdx hardis:misc:toml2csv --tomlfile 'D:/clients/toto/V1_full.txt' 
```

```shell
sfdx hardis:misc:toml2csv --skiptransfo --tomlfile 'D:/clients/toto/V1_full.txt' 
```

```shell
sfdx hardis:misc:toml2csv --skiptransfo --tomlfile 'D:/clients/toto/V1_full.txt' --outputdir 'C:/tmp/rrrr'
```

```shell
NODE_OPTIONS=--max_old_space_size=9096 sfdx hardis:misc:toml2csv --skiptransfo --tomlfile './input/V1.txt' --outputdir './output' --filtersections 'COMPTES,SOUS'
```


