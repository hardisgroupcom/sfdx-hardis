<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:activateinvalid

## Description

Update sandbox users so their email is valid

  Example: replaces `toto@company.com.dev.invalid` with `toto@company.com.dev.invalid`

See article below

[![Reactivate all the sandbox users with .invalid emails in 3 clicks](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-email.jpg)](https://nicolas.vuillamy.fr/reactivate-all-the-sandbox-users-with-invalid-emails-in-3-clicks-2265af4e3a3d)


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|profiles<br/>-p|option|Comma-separated list of profiles names that you want to reactive users assigned to and with a .invalid email||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:user:activateinvalid
```

```shell
$ sfdx hardis:org:user:activateinvalid --targetusername myuser@myorg.com
```

```shell
$ sfdx hardis:org:user:activateinvalid --profiles 'System Administrator,MyCustomProfile' --targetusername myuser@myorg.com
```


