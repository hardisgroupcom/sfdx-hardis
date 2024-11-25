<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pull

## Description

This commands pulls the updates you performed in your scratch or sandbox org, into your local files

Then, you probably want to stage and commit the files containing the updates you want to keep, as explained in this video.

<iframe width="560" height="315" src="https://www.youtube.com/embed/Ik6whtflmfY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

- Calls `sf project retrieve start` under the hood
- If there are errors, proposes to automatically add erroneous item in `.forceignore`, then pull again
- If you don't see your updated items in the results, you can manually retrieve [using SF Extension **Org Browser** or **Salesforce CLI**](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/#retrieve-metadatas)
- If you want to always retrieve sources like CustomApplication that are not always detected as updates by project:retrieve:start , you can define property **autoRetrieveWhenPull** in .sfdx-hardis.yml

Example:
```yaml
autoRetrieveWhenPull:
  - CustomApplication:MyCustomApplication
  - CustomApplication:MyOtherCustomApplication
  - CustomApplication:MyThirdCustomApp
```


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:scratch:pull
```


