<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:save

## Description

When a work task is completed, guide user to create a merge request

Advanced instructions in [Publish a task](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/)

- Generate package-xml diff using sfdx-git-delta
- Automatically update `manifest/package.xml` and `manifest/destructiveChanges.xml` according to the committed updates
- Automatically Clean XML files using `.sfdx-hardis.yml` properties
  - `autocleantypes`: List of auto-performed sources cleanings, available on command [hardis:project:clean:references](https://sfdx-hardis.cloudity.com/hardis/project/clean/references/)
  - `autoRemoveUserPermissions`: List of userPermission to automatically remove from profile metadatas

Example:

```yaml
autoCleanTypes:
  - destructivechanges
  - datadotcom
  - minimizeProfiles
  - listViewsMine
autoRemoveUserPermissions:
  - EnableCommunityAppLauncher
  - FieldServiceAccess
  - OmnichannelInventorySync
  - SendExternalEmailAvailable
  - UseOmnichannelInventoryAPIs
  - ViewDataLeakageEvents
  - ViewMLModels
  - ViewPlatformEvents
  - WorkCalibrationUser
```

- Push commit to server
  

## Parameters

| Name                  |  Type   | Description                                                                           | Default | Required |                        Options                        |
|:----------------------|:-------:|:--------------------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command                   |         |          |                                                       |
| auto                  | boolean | No user prompts (when called from CI for example)                                     |         |          |                                                       |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                                       |         |          |                                                       |
| json                  | boolean | format output as json                                                                 |         |          |                                                       |
| loglevel              | option  | logging level for this command invocation                                             |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| noclean<br/>-c        | boolean | No cleaning of local sources                                                          |         |          |                                                       |
| nogit<br/>-g          | boolean | No automated git operations                                                           |         |          |                                                       |
| nopull<br/>-n         | boolean | No scratch pull before save                                                           |         |          |                                                       |
| skipauth              | boolean | Skip authentication check when a default username is required                         |         |          |                                                       |
| targetbranch          | option  | Name of the Merge Request target branch. Will be guessed or prompted if not provided. |         |          |                                                       |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org                    |         |          |                                                       |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                             |         |          |                                                       |

## Examples

```shell
sfdx hardis:work:task:save
```

```shell
sfdx hardis:work:task:save --nopull --nogit --noclean
```


