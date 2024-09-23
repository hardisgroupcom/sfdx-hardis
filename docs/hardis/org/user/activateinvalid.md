<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:activateinvalid

## Description

Update sandbox users so their email is valid

  Example: replaces `toto@company.com.dev.invalid` with `toto@company.com.dev.invalid`

See article below

[![Reactivate all the sandbox users with .invalid emails in 3 clicks](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-email.jpg)](https://nicolas.vuillamy.fr/reactivate-all-the-sandbox-users-with-invalid-emails-in-3-clicks-2265af4e3a3d)


## Parameters

| Name              |  Type   | Description                                                                                                  | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                              |         |          |         |
| flags-dir         | option  | undefined                                                                                                    |         |          |         |
| json              | boolean | Format output as json.                                                                                       |         |          |         |
| profiles<br/>-p   | option  | Comma-separated list of profiles names that you want to reactive users assigned to and with a .invalid email |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                                    |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |         |          |         |

## Examples

```shell
sf hardis:org:user:activateinvalid
```

```shell
sf hardis:org:user:activateinvalid --target-org myuser@myorg.com
```

```shell
sf hardis:org:user:activateinvalid --profiles 'System Administrator,MyCustomProfile' --target-org myuser@myorg.com
```


