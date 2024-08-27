<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:minimizeprofiles

## Description

Remove all profile attributes that exist on Permission Sets

It is a bad practice to define on Profiles elements that can be defined on Permission Sets.

Salesforce will deprecate such capability in Spring 26.

Don't wait for that, and use minimizeProfiles cleaning to automatically remove from Profiles any permission that exists on a Permission Set !

The following XML tags are removed automatically:

- classAccesses
- customMetadataTypeAccesses
- externalDataSourceAccesses
- fieldPermissions
- objectPermissions
- pageAccesses
- userPermissions (except on Admin Profile)

You can override this list by defining a property minimizeProfilesNodesToRemove in your .sfdx-hardis.yml config file.

You can also skip profiles using property skipMinimizeProfiles

Example:

```yaml
skipMinimizeProfiles
  - MyClient Customer Community Login User
  - MyClientPortail Profile
```


## Parameters

| Name          |  Type   | Description                                                   |  Default  | Required |                        Options                        |
|:--------------|:-------:|:--------------------------------------------------------------|:---------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |           |          |                                                       |
| folder<br/>-f | option  | Root folder                                                   | force-app |          |                                                       |
| json          | boolean | format output as json                                         |           |          |                                                       |
| loglevel      | option  | logging level for this command invocation                     |   warn    |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth      | boolean | Skip authentication check when a default username is required |           |          |                                                       |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |           |          |                                                       |

## Examples

```shell
sf hardis:project:clean:minimizeprofiles
```


