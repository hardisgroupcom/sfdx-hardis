<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pull

## Description

This commands pulls the updates you performed in your scratch or sandbox org, into your local files

Then, you probably want to stage and commit the files containing the updates you want to keep, as explained in this video.

<iframe width="560" height="315" src="https://www.youtube.com/embed/Ik6whtflmfY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

- Calls sfdx force:source:pull under the hood
- If there are errors, proposes to automatically add erroneous item in `.forceignore`, then pull again
- If you want to always retrieve sources like CustomApplication that are not always detected as updates by force:source:pull , you can define property **autoRetrieveWhenPull** in .sfdx-hardis.yml

Example:
```yaml
autoRetrieveWhenPull:
  - CustomApplication:MyCustomApplication
  - CustomApplication:MyOtherCustomApplication
  - CustomApplication:MyThirdCustomApp
```


## Parameters

| Name                  |  Type   | Description                                                         | Default | Required |                        Options                        |
|:----------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command |         |          |                                                       |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                     |         |          |                                                       |
| json                  | boolean | format output as json                                               |         |          |                                                       |
| loglevel              | option  | logging level for this command invocation                           |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth              | boolean | Skip authentication check when a default username is required       |         |          |                                                       |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org  |         |          |                                                       |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |         |          |                                                       |

## Examples

```shell
sfdx hardis:scratch:pull
```


