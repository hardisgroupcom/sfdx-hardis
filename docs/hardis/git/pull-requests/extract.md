<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:git:pull-requests:extract

## Description

Extract pull requests with filtering criteria

## Parameters

| Name                 |  Type   | Description                                                       | Default | Required |            Options            |
|:---------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-----------------------------:|
| debug<br/>-d         | boolean | Activate debug mode (more logs)                                   |         |          |                               |
| flags-dir            | option  | undefined                                                         |         |          |                               |
| json                 | boolean | Format output as json.                                            |         |          |                               |
| min-date<br/>-m      | option  | Minimum date for PR                                               |         |          |                               |
| outputfile<br/>-f    | option  | Force the path and name of output report file. Must end with .csv |         |          |                               |
| skipauth             | boolean | Skip authentication check when a default username is required     |         |          |                               |
| status<br/>-x        | option  | Status of the PR                                                  |         |          | open<br/>merged<br/>abandoned |
| target-branch<br/>-t | option  | Target branch of PRs                                              |         |          |                               |
| websocket            | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |                               |

## Examples

```shell
sf hardis:git:pull-requests:extract
```

```shell
sf hardis:git:pull-requests:extract --target-branch main --status merged
```


