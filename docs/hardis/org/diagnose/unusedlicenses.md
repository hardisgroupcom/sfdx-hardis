<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unusedlicenses

## Description

When you assign a Permission Set to a user, and that this Permission Set is related to a Permission Set License, a Permission Set License Assignment is automatically created for the user.

  But when you unassign this Permission Set from the user, **the Permission Set License Assignment is not deleted**.

  This leads that you can be **charged for Permission Set Licenses that are not used** !

  This command detects such useless Permission Set Licenses Assignments and suggests to delete them.

  Many thanks to [Vincent Finet](https://www.linkedin.com/in/vincentfinet/) for the inspiration during his great speaker session at [French Touch Dreamin '23](https://frenchtouchdreamin.com/), and his kind agreement for reusing such inspiration in this command :)
  

## Parameters

| Name                  |  Type   | Description                                                         | Default | Required |                        Options                        |
|:----------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command |         |          |                                                       |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                     |         |          |                                                       |
| json                  | boolean | format output as json                                               |         |          |                                                       |
| loglevel              | option  | logging level for this command invocation                           |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputfile<br/>-o     | option  | Force the path and name of output report file. Must end with .csv   |         |          |                                                       |
| skipauth              | boolean | Skip authentication check when a default username is required       |         |          |                                                       |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org  |         |          |                                                       |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |         |          |                                                       |

## Examples

```shell
sf hardis:org:diagnose:unusedlicenses
```

```shell
sf hardis:org:diagnose:unusedlicenses --fix
```


