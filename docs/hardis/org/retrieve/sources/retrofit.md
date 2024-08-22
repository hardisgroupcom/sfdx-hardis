<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:sources:retrofit

## Description

Retrieve changes from org link to a ref branch not present in sources

  This command need to be triggered from a branch that is connected to a SF org. It will then retrieve all changes not present in that branch sources, commit them and create a merge request against the default branch. If a merge request already exists, it will simply add a new commit.

  Define the following properties in **.sfdx-hardis.yml**

- **productionBranch** : Name of the git branch that is corresponding to production org
- **retrofitBranch** : Name of the git branch that will be used as merge request target

  List of metadata to retrieve can be set in three way, in order of priority :

- `CI_SOURCES_TO_RETROFIT`: env variable (can be defined in CI context)
- `sourcesToRetrofit` property in `.sfdx-hardis.yml`
- Default list:

  - CompactLayout
  - CustomApplication
  - CustomField
  - CustomLabel
  - CustomLabels
  - CustomMetadata
  - CustomObject
  - CustomObjectTranslation
  - CustomTab
  - DuplicateRule
  - EmailTemplate
  - FlexiPage
  - GlobalValueSet
  - Layout
  - ListView
  - MatchingRules
  - PermissionSet
  - RecordType
  - StandardValueSet
  - Translations
  - ValidationRule

  You can also ignore some files even if they have been updated in production. To do that, define property **retrofitIgnoredFiles** in .sfdx-hardis.yml

  Example of full retrofit configuration:

  ```yaml
  productionBranch: master
  retrofitBranch: preprod
  retrofitIgnoredFiles:
  - force-app/main/default/applications/MyApp.app-meta.xml
  - force-app/main/default/applications/MyOtherApp.app-meta.xml
  - force-app/main/default/flexipages/MyFlexipageContainingDashboards.flexipage-meta.xml
  ```
  

## Parameters

| Name         |  Type   | Description                                                                    | Default | Required |                        Options                        |
|:-------------|:-------:|:-------------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion   | option  | override the api version used for api requests made by this command            |         |          |                                                       |
| commit       | boolean | If true, a commit will be performed after the retrofit                         |         |          |                                                       |
| commitmode   | option  | Defines if we commit all retrieved updates, or all updates including creations | updated |          |                    updated<br/>all                    |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                |         |          |                                                       |
| json         | boolean | format output as json                                                          |         |          |                                                       |
| loglevel     | option  | logging level for this command invocation                                      |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
|productionbranch|option|Name of the git branch corresponding to the org we want to perform the retrofit on.
Can be defined in productionBranch property in .sfdx-hardis.yml||||
|push|boolean|If true, a push will be performed after the retrofit||||
|pushmode|option|Defines if we send merge request options to git push arguments|default||default<br/>mergerequest|
|retrofittargetbranch|option|Name of branch the merge request will have as target
Can be defined in retrofitBranch property in .sfdx-hardis.yml||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
sf hardis:org:retrieve:sources:retrofit
```

```shell
sf hardis:org:retrieve:sources:retrofit --productionbranch master --commit --commitmode updated
```

```shell
sf hardis:org:retrieve:sources:retrofit --productionbranch master  --retrofitbranch preprod --commit --commitmode updated --push --pushmode mergerequest
```


