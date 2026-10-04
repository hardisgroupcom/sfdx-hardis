# Commands

## hardis:auth

| Command                                       | Title |
|:----------------------------------------------|:------|
| [**hardis:auth:login**](hardis/auth/login.md) | Login |

## hardis:cache

| Command                                         | Title                   |
|:------------------------------------------------|:------------------------|
| [**hardis:cache:clear**](hardis/cache/clear.md) | Clear sfdx-hardis cache |

## hardis:config

| Command                                                                       | Title                                  |
|:------------------------------------------------------------------------------|:---------------------------------------|
| [**hardis:config:get**](hardis/config/get.md)                                 | Deploy metadata sources to org         |
| [**hardis:config:monitoring-defaults**](hardis/config/monitoring-defaults.md) | Get monitoring & notification defaults |

## hardis:datacloud

| Command                                                                                                       | Title                                                 |
|:--------------------------------------------------------------------------------------------------------------|:------------------------------------------------------|
| [**hardis:datacloud:extract:agentforce-conversations**](hardis/datacloud/extract/agentforce-conversations.md) | Extract Agentforce Conversations Data from Data Cloud |
| [**hardis:datacloud:extract:agentforce-feedback**](hardis/datacloud/extract/agentforce-feedback.md)           | Extract Agentforce Feedback Data from Data Cloud      |
| [**hardis:datacloud:sql-query**](hardis/datacloud/sql-query.md)                                               | Execute a SQL query on Data Cloud                     |

## hardis:deploy

| Command                                                 | Title                                                                                                 |
|:--------------------------------------------------------|:------------------------------------------------------------------------------------------------------|
| [**hardis:deploy:quick**](hardis/deploy/quick.md)       | sfdx-hardis wrapper for **sf project deploy quick** that displays tips to solve deployment errors.    |
| [**hardis:deploy:start**](hardis/deploy/start.md)       | sfdx-hardis wrapper for **sf project deploy start** that displays tips to solve deployment errors.    |
| [**hardis:deploy:validate**](hardis/deploy/validate.md) | sfdx-hardis wrapper for **sf project deploy validate** that displays tips to solve deployment errors. |

## hardis:doc

| Command                                                                     | Title                                                                                                             |
|:----------------------------------------------------------------------------|:------------------------------------------------------------------------------------------------------------------|
| [**hardis:doc:data-dictionary**](hardis/doc/data-dictionary.md)             | **Generates an Excel (.xlsx) data dictionary for one or more Salesforce objects, read live from the target org.** |
| [**hardis:doc:dora-report**](hardis/doc/dora-report.md)                     | DORA Metrics Report                                                                                               |
| [**hardis:doc:extract:permsetgroups**](hardis/doc/extract/permsetgroups.md) | Generate project documentation                                                                                    |
| [**hardis:doc:fieldusage**](hardis/doc/fieldusage.md)                       | **Retrieves and displays the usage of custom fields within a Salesforce org, based on metadata dependencies.**    |
| [**hardis:doc:flow2markdown**](hardis/doc/flow2markdown.md)                 | Flow to Markdown                                                                                                  |
| [**hardis:doc:metadata-deps**](hardis/doc/metadata-deps.md)                 | Find metadata dependencies                                                                                        |
| [**hardis:doc:mkdocs-to-cf**](hardis/doc/mkdocs-to-cf.md)                   | MkDocs to Cloudflare                                                                                              |
| [**hardis:doc:mkdocs-to-confluence**](hardis/doc/mkdocs-to-confluence.md)   | MkDocs to Confluence                                                                                              |
| [**hardis:doc:mkdocs-to-salesforce**](hardis/doc/mkdocs-to-salesforce.md)   | MkDocs to Salesforce                                                                                              |
| [**hardis:doc:object-field-usage**](hardis/doc/object-field-usage.md)       | **Analyzes how populated fields are for a specific Salesforce object.**                                           |
| [**hardis:doc:override-prompts**](hardis/doc/override-prompts.md)           | Override AI Prompt Templates                                                                                      |
| [**hardis:doc:packagexml2markdown**](hardis/doc/packagexml2markdown.md)     | PackageXml to Markdown                                                                                            |
| [**hardis:doc:plugin:generate**](hardis/doc/plugin/generate.md)             | Generate SF Cli Plugin Documentation                                                                              |
| [**hardis:doc:project2markdown**](hardis/doc/project2markdown.md)           | SFDX Project to Markdown                                                                                          |
| [**hardis:doc:release-notes**](hardis/doc/release-notes.md)                 | Release Notes                                                                                                     |

## hardis:doctor

| Command                               | Title  |
|:--------------------------------------|:-------|
| [**hardis:doctor**](hardis/doctor.md) | Doctor |

## hardis:git

| Command                                                                     | Title                 |
|:----------------------------------------------------------------------------|:----------------------|
| [**hardis:git:pull-requests:extract**](hardis/git/pull-requests/extract.md) | Extract pull requests |

## hardis:lint

| Command                                                               | Title                                      |
|:----------------------------------------------------------------------|:-------------------------------------------|
| [**hardis:lint:access**](hardis/lint/access.md)                       | check permission access                    |
| [**hardis:lint:metadatastatus**](hardis/lint/metadatastatus.md)       | check inactive metadatas                   |
| [**hardis:lint:missingattributes**](hardis/lint/missingattributes.md) | check missing description on custom fields |
| [**hardis:lint:unusedmetadatas**](hardis/lint/unusedmetadatas.md)     | check unused labels and custom permissions |

## hardis:mdapi

| Command                                           | Title                                                                                                                                                           |
|:--------------------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [**hardis:mdapi:deploy**](hardis/mdapi/deploy.md) | **A wrapper command for Salesforce CLI's `sf project deploy start` (formerly `sfdx force:mdapi:deploy`), designed to assist with deployment error resolution.** |
| [**hardis:mdapi:read**](hardis/mdapi/read.md)     | Read metadata using the CRUD-based Metadata API                                                                                                                 |
| [**hardis:mdapi:upsert**](hardis/mdapi/upsert.md) | Upsert metadata using the CRUD-based Metadata API                                                                                                               |

## hardis:misc

| Command                                                                               | Title                     |
|:--------------------------------------------------------------------------------------|:--------------------------|
| [**hardis:misc:custom-label-translations**](hardis/misc/custom-label-translations.md) | Custom Label Translations |
| [**hardis:misc:purge-references**](hardis/misc/purge-references.md)                   | Purge References          |
| [**hardis:misc:servicenow-report**](hardis/misc/servicenow-report.md)                 | ServiceNow Report         |
| [**hardis:misc:toml2csv**](hardis/misc/toml2csv.md)                                   | TOML to CSV               |

## hardis:org

| Command                                                                                             | Title                                                                                                                    |
|:----------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------------------------------------|
| [**hardis:org:community:update**](hardis/org/community/update.md)                                   | Update a community status.                                                                                               |
| [**hardis:org:configure:data**](hardis/org/configure/data.md)                                       | Configure Data project                                                                                                   |
| [**hardis:org:configure:files**](hardis/org/configure/files.md)                                     | Configure File export project                                                                                            |
| [**hardis:org:configure:generic-prompt**](hardis/org/configure/generic-prompt.md)                   | Configure Generic Prompt Template                                                                                        |
| [**hardis:org:configure:grafana-dashboards**](hardis/org/configure/grafana-dashboards.md)           | Install Grafana dashboards                                                                                               |
| [**hardis:org:configure:monitoring**](hardis/org/configure/monitoring.md)                           | Configure org monitoring                                                                                                 |
| [**hardis:org:connect**](hardis/org/connect.md)                                                     | Connect to an org                                                                                                        |
| [**hardis:org:create**](hardis/org/create.md)                                                       | Create sandbox org                                                                                                       |
| [**hardis:org:data:delete**](hardis/org/data/delete.md)                                             | Delete data                                                                                                              |
| [**hardis:org:data:export**](hardis/org/data/export.md)                                             | Export data                                                                                                              |
| [**hardis:org:data:import**](hardis/org/data/import.md)                                             | Import data                                                                                                              |
| [**hardis:org:diagnose:ai-usage**](hardis/org/diagnose/ai-usage.md)                                 | Check Agentforce and Data 360 credit usage                                                                               |
| [**hardis:org:diagnose:apex-api-version**](hardis/org/diagnose/apex-api-version.md)                 | Check Apex classes and triggers for deprecated API versions                                                              |
| [**hardis:org:diagnose:audittrail**](hardis/org/diagnose/audittrail.md)                             | Diagnose content of Setup Audit Trail                                                                                    |
| [**hardis:org:diagnose:consumption-alerts**](hardis/org/diagnose/consumption-alerts.md)             | Check consumption utilization alerts                                                                                     |
| [**hardis:org:diagnose:deployments**](hardis/org/diagnose/deployments.md)                           | Analyze metadata deployments and validations                                                                             |
| [**hardis:org:diagnose:flex-queue**](hardis/org/diagnose/flex-queue.md)                             | Monitor Apex flex queue (AsyncApexJob Holding)                                                                           |
| [**hardis:org:diagnose:instanceupgrade**](hardis/org/diagnose/instanceupgrade.md)                   | Get Instance Upgrade date                                                                                                |
| [**hardis:org:diagnose:legacyapi**](hardis/org/diagnose/legacyapi.md)                               | Check for legacy API use                                                                                                 |
| [**hardis:org:diagnose:licenses**](hardis/org/diagnose/licenses.md)                                 | List licenses subscribed and used in a Salesforce org                                                                    |
| [**hardis:org:diagnose:mfa**](hardis/org/diagnose/mfa.md)                                           | Diagnose MFA configuration                                                                                               |
| [**hardis:org:diagnose:minimalpermsets**](hardis/org/diagnose/minimalpermsets.md)                   | Detect permission sets with minimal permissions                                                                          |
| [**hardis:org:diagnose:releaseupdates**](hardis/org/diagnose/releaseupdates.md)                     | Check Release Updates of an org                                                                                          |
| [**hardis:org:diagnose:storage-stats**](hardis/org/diagnose/storage-stats.md)                       | Extract Data Storage stats                                                                                               |
| [**hardis:org:diagnose:underusedpermsets**](hardis/org/diagnose/underusedpermsets.md)               | Detect underused Permission Sets                                                                                         |
| [**hardis:org:diagnose:unsecure-connected-apps**](hardis/org/diagnose/unsecure-connected-apps.md)   | Detect Unsecured Connected Apps                                                                                          |
| [**hardis:org:diagnose:unsecure-permissions**](hardis/org/diagnose/unsecure-permissions.md)         | Audit dangerous permissions                                                                                              |
| [**hardis:org:diagnose:unused-apex-classes**](hardis/org/diagnose/unused-apex-classes.md)           | Detect unused Apex classes in an org                                                                                     |
| [**hardis:org:diagnose:unused-connected-apps**](hardis/org/diagnose/unused-connected-apps.md)       | Unused Connected Apps in an org                                                                                          |
| [**hardis:org:diagnose:unusedlicenses**](hardis/org/diagnose/unusedlicenses.md)                     | Detect unused Permission Set Licenses (beta)                                                                             |
| [**hardis:org:diagnose:unusedusers**](hardis/org/diagnose/unusedusers.md)                           | Detect unused Users in Salesforce                                                                                        |
| [**hardis:org:diagnose:usage-entitlements**](hardis/org/diagnose/usage-entitlements.md)             | Check usage-based entitlements                                                                                           |
| [**hardis:org:ext-client-app:rotate-credentials**](hardis/org/ext-client-app/rotate-credentials.md) | Rotate External Client App Credentials                                                                                   |
| [**hardis:org:files:export**](hardis/org/files/export.md)                                           | Export files                                                                                                             |
| [**hardis:org:files:import**](hardis/org/files/import.md)                                           | Import files                                                                                                             |
| [**hardis:org:fix:listviewmine**](hardis/org/fix/listviewmine.md)                                   | Fix listviews with                                                                                                       |
| [**hardis:org:generate:packagexmlfull**](hardis/org/generate/packagexmlfull.md)                     | Generate Full Org package.xml                                                                                            |
| [**hardis:org:list:metadata**](hardis/org/list/metadata.md)                                         | List metadata components of an org                                                                                       |
| [**hardis:org:monitor:all**](hardis/org/monitor/all.md)                                             | Monitor org                                                                                                              |
| [**hardis:org:monitor:backup**](hardis/org/monitor/backup.md)                                       | Backup DX sources                                                                                                        |
| [**hardis:org:monitor:errors**](hardis/org/monitor/errors.md)                                       | Monitor Apex and Flow errors                                                                                             |
| [**hardis:org:monitor:health-check**](hardis/org/monitor/health-check.md)                           | Check org security health                                                                                                |
| [**hardis:org:monitor:limits**](hardis/org/monitor/limits.md)                                       | Check org limits                                                                                                         |
| [**hardis:org:multi-org-query**](hardis/org/multi-org-query.md)                                     | Multiple Orgs SOQL Query                                                                                                 |
| [**hardis:org:purge:apexlog**](hardis/org/purge/apexlog.md)                                         | Purge Apex Logs                                                                                                          |
| [**hardis:org:purge:flow**](hardis/org/purge/flow.md)                                               | Purge Flow versions                                                                                                      |
| [**hardis:org:purge:profile**](hardis/org/purge/profile.md)                                         | Remove PS attributes from Profile                                                                                        |
| [**hardis:org:refresh:after-refresh**](hardis/org/refresh/after-refresh.md)                         | Restore Connected Apps after org refresh                                                                                 |
| [**hardis:org:refresh:before-refresh**](hardis/org/refresh/before-refresh.md)                       | > **This command must always be run by a human. It is intentionally interactive and must not be called by an AI agent.** |
| [**hardis:org:retrieve:packageconfig**](hardis/org/retrieve/packageconfig.md)                       | Retrieve package configuration from an org                                                                               |
| [**hardis:org:retrieve:sources:analytics**](hardis/org/retrieve/sources/analytics.md)               | Retrieve CRM Analytics configuration from an org                                                                         |
| [**hardis:org:retrieve:sources:dx**](hardis/org/retrieve/sources/dx.md)                             | Retrieve sfdx sources from org                                                                                           |
| [**hardis:org:retrieve:sources:dx2**](hardis/org/retrieve/sources/dx2.md)                           | Retrieve sfdx sources from org (2)                                                                                       |
| [**hardis:org:retrieve:sources:metadata**](hardis/org/retrieve/sources/metadata.md)                 | Retrieve sfdx sources from org                                                                                           |
| [**hardis:org:retrieve:sources:retrofit**](hardis/org/retrieve/sources/retrofit.md)                 | Retrofit changes from an org                                                                                             |
| [**hardis:org:select**](hardis/org/select.md)                                                       | Select org                                                                                                               |
| [**hardis:org:test:agents**](hardis/org/test/agents.md)                                             | Run agent tests                                                                                                          |
| [**hardis:org:test:apex**](hardis/org/test/apex.md)                                                 | Run apex tests                                                                                                           |
| [**hardis:org:user:activateinvalid**](hardis/org/user/activateinvalid.md)                           | Reactivate sandbox invalid users                                                                                         |
| [**hardis:org:user:freeze**](hardis/org/user/freeze.md)                                             | Freeze user logins                                                                                                       |
| [**hardis:org:user:unfreeze**](hardis/org/user/unfreeze.md)                                         | Unfreeze user logins                                                                                                     |
| [**hardis:org:user:unlink-security-key**](hardis/org/user/unlink-security-key.md)                   | Unlink user security keys / MFA methods                                                                                  |

## hardis:package

| Command                                                                 | Title                              |
|:------------------------------------------------------------------------|:-----------------------------------|
| [**hardis:package:create**](hardis/package/create.md)                   | Create a new package               |
| [**hardis:package:install**](hardis/package/install.md)                 | Install packages in an org         |
| [**hardis:package:mergexml**](hardis/package/mergexml.md)               | Merge package.xml files            |
| [**hardis:package:version:create**](hardis/package/version/create.md)   | Create a new version of a package  |
| [**hardis:package:version:list**](hardis/package/version/list.md)       | Create a new version of a package  |
| [**hardis:package:version:promote**](hardis/package/version/promote.md) | Promote new versions of package(s) |

## hardis:packagexml

| Command                                                                     | Title                                                                                                                                                   |
|:----------------------------------------------------------------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------------|
| [**hardis:packagexml:append**](hardis/packagexml/append.md)                 | **Appends the content of one or more Salesforce `package.xml` files into a single target `package.xml` file.**                                          |
| [**hardis:packagexml:remove**](hardis/packagexml/remove.md)                 | **Removes metadata components from a `package.xml` file using either another `package.xml` as a filter or inline metadata type/member specifications.** |
| [**hardis:packagexml:remove-managed**](hardis/packagexml/remove-managed.md) | **Removes all managed package items from a `package.xml` file, while preserving custom metadata created on top of managed objects.**                    |

## hardis:project

| Command                                                                                           | Title                                                                                                                                                                                                                  |
|:--------------------------------------------------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [**hardis:project:action:base**](hardis/project/action/base.md)                                   |                                                                                                                                                                                                                        |
| [**hardis:project:action:create**](hardis/project/action/create.md)                               | Create deployment action                                                                                                                                                                                               |
| [**hardis:project:action:delete**](hardis/project/action/delete.md)                               | Delete deployment action                                                                                                                                                                                               |
| [**hardis:project:action:link-pull-request**](hardis/project/action/link-pull-request.md)         | Link draft actions to a pull request                                                                                                                                                                                   |
| [**hardis:project:action:list**](hardis/project/action/list.md)                                   | List deployment actions                                                                                                                                                                                                |
| [**hardis:project:action:reorder**](hardis/project/action/reorder.md)                             | Reorder deployment actions                                                                                                                                                                                             |
| [**hardis:project:action:run**](hardis/project/action/run.md)                                     | Run a deployment action                                                                                                                                                                                                |
| [**hardis:project:action:set-status**](hardis/project/action/set-status.md)                       | Set the status of a deployment action                                                                                                                                                                                  |
| [**hardis:project:action:test-class:add**](hardis/project/action/test-class/add.md)               | Add deployment Apex test class                                                                                                                                                                                         |
| [**hardis:project:action:test-class:list**](hardis/project/action/test-class/list.md)             | List deployment Apex test classes                                                                                                                                                                                      |
| [**hardis:project:action:test-class:remove**](hardis/project/action/test-class/remove.md)         | Remove deployment Apex test class                                                                                                                                                                                      |
| [**hardis:project:action:update**](hardis/project/action/update.md)                               | Update deployment action                                                                                                                                                                                               |
| [**hardis:project:audit:apiversion**](hardis/project/audit/apiversion.md)                         | Audit Metadatas API Version                                                                                                                                                                                            |
| [**hardis:project:audit:callincallout**](hardis/project/audit/callincallout.md)                   | Audit CallIns and CallOuts                                                                                                                                                                                             |
| [**hardis:project:audit:duplicatefiles**](hardis/project/audit/duplicatefiles.md)                 | Find duplicate sfdx files                                                                                                                                                                                              |
| [**hardis:project:audit:remotesites**](hardis/project/audit/remotesites.md)                       | Audit Remote Sites                                                                                                                                                                                                     |
| [**hardis:project:clean:emptyitems**](hardis/project/clean/emptyitems.md)                         | Clean retrieved empty items in dx sources                                                                                                                                                                              |
| [**hardis:project:clean:filter-xml-content**](hardis/project/clean/filter-xml-content.md)         | **Filters the content of Salesforce metadata XML files to remove specific elements, enabling more granular deployments.**                                                                                              |
| [**hardis:project:clean:flowpositions**](hardis/project/clean/flowpositions.md)                   | Clean Flow Positions                                                                                                                                                                                                   |
| [**hardis:project:clean:hiddenitems**](hardis/project/clean/hiddenitems.md)                       | Clean retrieved hidden items in dx sources                                                                                                                                                                             |
| [**hardis:project:clean:listviews**](hardis/project/clean/listviews.md)                           | Replace Mine by Everything in ListViews                                                                                                                                                                                |
| [**hardis:project:clean:manageditems**](hardis/project/clean/manageditems.md)                     | Clean retrieved managed items in dx sources                                                                                                                                                                            |
| [**hardis:project:clean:minimizeprofiles**](hardis/project/clean/minimizeprofiles.md)             | Clean profiles of Permission Set attributes                                                                                                                                                                            |
| [**hardis:project:clean:orgmissingitems**](hardis/project/clean/orgmissingitems.md)               | Clean SFDX items using target org definition                                                                                                                                                                           |
| [**hardis:project:clean:profiles-extract**](hardis/project/clean/profiles-extract.md)             | **Guides administrators through extracting Salesforce profiles, personas, and related metadata into structured CSV/XLSX deliverables.**                                                                                |
| [**hardis:project:clean:references**](hardis/project/clean/references.md)                         | Clean references in dx sources                                                                                                                                                                                         |
| [**hardis:project:clean:retrievefolders**](hardis/project/clean/retrievefolders.md)               | Retrieve dashboards, documents and report folders in DX sources                                                                                                                                                        |
| [**hardis:project:clean:sensitive-metadatas**](hardis/project/clean/sensitive-metadatas.md)       | Clean Sensitive Metadatas                                                                                                                                                                                              |
| [**hardis:project:clean:standarditems**](hardis/project/clean/standarditems.md)                   | Clean retrieved standard items in dx sources                                                                                                                                                                           |
| [**hardis:project:clean:systemdebug**](hardis/project/clean/systemdebug.md)                       | Clean System debug                                                                                                                                                                                                     |
| [**hardis:project:clean:xml**](hardis/project/clean/xml.md)                                       | Clean retrieved empty items in dx sources                                                                                                                                                                              |
| [**hardis:project:configure:auth**](hardis/project/configure/auth.md)                             | Configure authentication                                                                                                                                                                                               |
| [**hardis:project:convert:profilestopermsets**](hardis/project/convert/profilestopermsets.md)     | Convert Profiles into Permission Sets                                                                                                                                                                                  |
| [**hardis:project:create**](hardis/project/create.md)                                             | Login                                                                                                                                                                                                                  |
| [**hardis:project:deploy:notify**](hardis/project/deploy/notify.md)                               | Deployment Notifications                                                                                                                                                                                               |
| [**hardis:project:deploy:quick**](hardis/project/deploy/quick.md)                                 | sfdx-hardis wrapper for **sf project deploy quick** that displays tips to solve deployment errors.                                                                                                                     |
| [**hardis:project:deploy:simulate**](hardis/project/deploy/simulate.md)                           | Simulate the deployment of metadata in an org prompted to the user.<br/>Used by VS Code extension.                                                                                                                     |
| [**hardis:project:deploy:smart**](hardis/project/deploy/smart.md)                                 | Smart Deploy sfdx sources to org                                                                                                                                                                                       |
| [**hardis:project:deploy:sources:dx**](hardis/project/deploy/sources/dx.md)                       | Smart Deploy sfdx sources to org                                                                                                                                                                                       |
| [**hardis:project:deploy:sources:metadata**](hardis/project/deploy/sources/metadata.md)           | Deploy metadata sources to org                                                                                                                                                                                         |
| [**hardis:project:deploy:start**](hardis/project/deploy/start.md)                                 | sfdx-hardis wrapper for **sf project deploy start** that displays tips to solve deployment errors.                                                                                                                     |
| [**hardis:project:deploy:validate**](hardis/project/deploy/validate.md)                           | sfdx-hardis wrapper for **sf project deploy validate** that displays tips to solve deployment errors.                                                                                                                  |
| [**hardis:project:fix:profiletabs**](hardis/project/fix/profiletabs.md)                           | Fix profiles to add tabs that are not retrieved by SF CLI                                                                                                                                                              |
| [**hardis:project:fix:v53flexipages**](hardis/project/fix/v53flexipages.md)                       | Fix flexipages for v53                                                                                                                                                                                                 |
| [**hardis:project:function:base**](hardis/project/function/base.md)                               |                                                                                                                                                                                                                        |
| [**hardis:project:function:create**](hardis/project/function/create.md)                           | Create custom function                                                                                                                                                                                                 |
| [**hardis:project:function:delete**](hardis/project/function/delete.md)                           | Delete custom function                                                                                                                                                                                                 |
| [**hardis:project:function:list**](hardis/project/function/list.md)                               | List custom functions                                                                                                                                                                                                  |
| [**hardis:project:function:update**](hardis/project/function/update.md)                           | Update custom function                                                                                                                                                                                                 |
| [**hardis:project:generate:bypass**](hardis/project/generate/bypass.md)                           | **Generates custom permissions and permission sets to bypass specified Salesforce automations (Flows, Triggers, and Validation Rules) for specific sObjects, with optional automatic implementation of bypass logic.** |
| [**hardis:project:generate:flow-git-diff**](hardis/project/generate/flow-git-diff.md)             | Generate Flow Visual Gif Diff                                                                                                                                                                                          |
| [**hardis:project:generate:gitdelta**](hardis/project/generate/gitdelta.md)                       | Generate Git Delta                                                                                                                                                                                                     |
| [**hardis:project:lint**](hardis/project/lint.md)                                                 | Lint                                                                                                                                                                                                                   |
| [**hardis:project:metadata:activate-decomposed**](hardis/project/metadata/activate-decomposed.md) | Activate Decomposed Metadata (Beta)                                                                                                                                                                                    |
| [**hardis:project:metadata:findduplicates**](hardis/project/metadata/findduplicates.md)           | XML duplicate values finder                                                                                                                                                                                            |
| [**hardis:project:promotion:create**](hardis/project/promotion/create.md)                         | Create a promotion branch (Beta)                                                                                                                                                                                       |
| [**hardis:project:promotion:list-candidates**](hardis/project/promotion/list-candidates.md)       | List the User Stories waiting for promotion (Beta)                                                                                                                                                                     |
| [**hardis:project:skills:import**](hardis/project/skills/import.md)                               | Import Skills                                                                                                                                                                                                          |

## hardis:scratch

| Command                                                               | Title                                    |
|:----------------------------------------------------------------------|:-----------------------------------------|
| [**hardis:scratch:create**](hardis/scratch/create.md)                 | Create and initialize scratch org        |
| [**hardis:scratch:delete**](hardis/scratch/delete.md)                 | Delete scratch orgs(s)                   |
| [**hardis:scratch:pool:create**](hardis/scratch/pool/create.md)       | Create and configure scratch org pool    |
| [**hardis:scratch:pool:localauth**](hardis/scratch/pool/localauth.md) | Authenticate locally to scratch org pool |
| [**hardis:scratch:pool:refresh**](hardis/scratch/pool/refresh.md)     | Refresh scratch org pool                 |
| [**hardis:scratch:pool:reset**](hardis/scratch/pool/reset.md)         | Reset scratch org pool                   |
| [**hardis:scratch:pool:view**](hardis/scratch/pool/view.md)           | View scratch org pool info               |
| [**hardis:scratch:pull**](hardis/scratch/pull.md)                     | Scratch PULL                             |
| [**hardis:scratch:push**](hardis/scratch/push.md)                     | Scratch PUSH                             |

## hardis:source

| Command                                                 | Title                                                                                                                                               |
|:--------------------------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------------------|
| [**hardis:source:deploy**](hardis/source/deploy.md)     | sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors.                                                     |
| [**hardis:source:push**](hardis/source/push.md)         | sfdx-hardis wrapper for sfdx force:source:push that displays tips to solve deployment errors.                                                       |
| [**hardis:source:retrieve**](hardis/source/retrieve.md) | **A wrapper command for Salesforce CLI's `sf project retrieve start` (formerly `sfdx force:source:retrieve`), with enhanced interactive features.** |

## hardis:ticket

| Command                                       | Title      |
|:----------------------------------------------|:-----------|
| [**hardis:ticket:get**](hardis/ticket/get.md) | Get ticket |

## hardis:work

| Command                                                         | Title                               |
|:----------------------------------------------------------------|:------------------------------------|
| [**hardis:work:backpromote**](hardis/work/backpromote.md)       | Backpromote to a dev sandbox (Beta) |
| [**hardis:work:new**](hardis/work/new.md)                       | New User Story                      |
| [**hardis:work:refresh**](hardis/work/refresh.md)               | Refresh User Story branch           |
| [**hardis:work:resetselection**](hardis/work/resetselection.md) | Select again                        |
| [**hardis:work:save**](hardis/work/save.md)                     | Save User Story                     |
| [**hardis:work:ws**](hardis/work/ws.md)                         | WebSocket operations                |

## hello:world

| Command                           | Title      |
|:----------------------------------|:-----------|
| [**hello:world**](hello/world.md) | Say hello. |
