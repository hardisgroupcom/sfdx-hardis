<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
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
  - checkPermissions
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

| Name              |  Type   | Description                                                                           | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| auto              | boolean | No user prompts (when called from CI for example)                                     |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                       |         |          |         |
| flags-dir         | option  | undefined                                                                             |         |          |         |
| json              | boolean | Format output as json.                                                                |         |          |         |
| noclean<br/>-c    | boolean | No cleaning of local sources                                                          |         |          |         |
| nogit<br/>-g      | boolean | No automated git operations                                                           |         |          |         |
| nopull<br/>-n     | boolean | No scratch pull before save                                                           |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                         |         |          |         |
| target-org<br/>-o | option  | undefined                                                                             |         |          |         |
| targetbranch      | option  | Name of the Merge Request target branch. Will be guessed or prompted if not provided. |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                             |         |          |         |

## Examples

```shell
sf hardis:work:task:save
```

```shell
sf hardis:work:task:save --nopull --nogit --noclean
```


