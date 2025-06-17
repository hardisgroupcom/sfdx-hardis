<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:auth:login

## Description


Logins to a Salesforce org from CI/CD workflows.

Will use the variables and files defined by configuration commands:

- CI/CD repos: [Configure Org CI Authentication](https://sfdx-hardis.cloudity.com/hardis/project/configure/auth/)
- Monitoring repos: [Configure Org Monitoring](https://sfdx-hardis.cloudity.com/hardis/org/configure/monitoring/)

If you have a technical org (for example to call Agentforce from another org, you can define variable SFDX_AUTH_URL_TECHNICAL_ORG and it will authenticate it with alias TECHNICAL_ORG)

You can get SFDX_AUTH_URL_TECHNICAL_ORG value by running the command: `sf org display --verbose --json` and copy the value of the field `sfdxAuthUrl` in the output.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|devhub<br/>-h|boolean|Also connect associated DevHub||||
|flags-dir|option|undefined||||
|instanceurl<br/>-r|option|URL of org instance||||
|json|boolean|Format output as json.||||
|scratchorg<br/>-s|boolean|Scratch org||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:auth:login
```

```shell
CI=true sf hardis:auth:login
```


