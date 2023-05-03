---
title: How to solve Salesforce DX Deployment errors
description: Learn how to fix issues that can happen during sfdx deployments
---
<!-- markdownlint-disable MD013 -->

# Salesforce deployment errors tips

This page summarizes all errors that can be detected by sfdx-hardis wrapper commands

| sfdx command                                                                                                                                                                                | sfdx-hardis wrapper command                                                         |
|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:------------------------------------------------------------------------------------|
| [sfdx force:source:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy)   | [sfdx hardis:source:deploy](https://sfdx-hardis.cloudity.com/hardis/source/deploy/) |
| [sfdx force:source:push](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push)       | [sfdx hardis:source:push](https://sfdx-hardis.cloudity.com/hardis/source/push/)     |
| [sfdx force:mdapi:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_mdapi.htm#cli_reference_force_mdapi_beta_deploy) | [sfdx hardis:mdapi:deploy](https://sfdx-hardis.cloudity.com/hardis/mdapi/deploy/)   |

You can also use this function on a [sfdx-hardis Salesforce CI/CD project](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)

If you see a deployment error which is not here yet, please [add it in this file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/deployTipsList.ts) :)

Example:

![Deployment Tip example](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/deploy-tip-example.jpg)

## Allow deployment with pending Apex Jobs

- `You can bypass this error by allowing deployments with Apex jobs in the Deployment Settings page in Setup.`

**Resolution tip**

```shell
Go to target org, in Setup -> Deployment Settings -> Activate option "Allow deployments of components when corresponding Apex jobs are pending or in progress."

```

## Can not change field type to a formula field

- `Error (.*) Cannot update a field from a Formula to something else`

**Resolution tip**

```shell
You need to manually delete or rename the field in the target org to allow the deployment to pass
- First, try to manually delete field {1} in the target org
- if you can't delete {1}, rename it into {1}_ToDel, then once the deployment done, delete {1}_ToDel
```

## Can not change type due to existing data

- `Error (.*) Cannot change type due to existing data`

**Resolution tip**

```shell
It is usually not recommended to change types of fields, but if it's really necessary you can:
- Manually change the type of {1} in the target org
- If you can't manually change the type:
  - you may modify the dependencies (Formulas, Flows...) using {1}, so they don't use this field
  - you can also delete dependencies (Formulas, Flows...) using {1}, but make sure they are deployed again later
- More help: https://help.salesforce.com/s/articleView?id=000327186&type=1
```

## Can not change field type with picklist

- `Error (.*) Cannot change which global value set this picklist uses`

**Resolution tip**

```shell
You probably updated the type of field {1}, and Salesforce does not allows that with deployments. You can:
- Try to manually change the type of {1} directly in target org, but it may not be technically possible
- Delete field {1} in target org: it will be recreated after deployment (but you will loose data on existing records, so be careful if your target is a production org)
- Create another field with desired type and manage data recovery if the target is a production org
```

## Can not delete custom field

- `This (.*) is referenced elsewhere in salesforce.com`
- `Le champ personnalisé (.*) est utilisé dans (.*)`

**Resolution tip**

```shell
Custom field {1} can not be deleted because it is used elsewhere. Remove its references ans try again
THIS MAY BE A FALSE POSITIVE if you are just testing the deployment, as destructiveChanges are deployed separately from updated items deployment check
```

## Can not delete record type

- `Error (.*) Cannot delete record type through API`

**Resolution tip**

```shell
You need to manually delete record type {1} in target org
- Edit record type {1}, uncheck "Active"
- Delete record type {1}
```

## Can not find folder

- `Error (.*) Cannot find folder:(.*)`

**Resolution tip**

```shell
Folder {2} is missing.
- If folder {2} is existing in sources, add it in related package.xml
- If folder {2} is not existing in DX sources, please use sfdx hardis:project:clean:retrievefolders to retrieve it
- If both previous solutions did not work, go create manually folder {2} in target org

```

## Can not find user

- `Error (.*) Cannot find a user that matches any of the following usernames`

**Resolution tip**

```shell
You made reference to username(s) in {1}, and those users probably do not exist in target org.
- Do not use named users, but user groups for assignments
- Remove the XML part referring to hardcoded usernames

Example of XML you have to remove in {1}:

<folderShares>
  <accessLevel>Manage</accessLevel>
  <sharedTo>nicolas.vuillamy@hardis-scratch-po-tgci-root-develop_20220412_0604.com</sharedTo>
  <sharedToType>User</sharedToType>
</folderShares>
```

## Cannot update a field to a Summary from something else

- `Error (.*) Cannot update a field to a (.*) from something else`

**Resolution tip**

```shell
You probably updated the type of field {1} to type {2}, and Salesforce does not allows that with deployments. You can:
- Try to manually change the type of {1} directly in target org, but it may not be technically possible
- Delete field {1} in target org: it will be recreated after deployment (but you will loose data on existing records, so be careful if your target is a production org)
- Create another field with desired type and manage data recovery if the target is a production org
```

## Custom object not found

- `Error (.*) In field: field - no CustomObject named (.*) found`

**Resolution tip**

```shell
A reference to a custom object {2} is not found in {1}:
- If you renamed the custom object, do a search/replace in sources with previous object name and new object name
- If you deleted the custom object, or if you don't want to deploy it, do a search on the custom object name, and remove XML elements referencing it
- If the object should exist, make sure it is in force-app/main/default/objects and that the object name is in manifest/package.xml in CustomObject section
You may also have a look to command sfdx hardis:project:clean:references

```

## Custom field not found

- `Error (.*) In field: (.*) - no CustomField named (.*)\.(.*) found`

**Resolution tip**

```shell
A reference to a custom field {3}.{4} is not found in {1}:
- If you renamed {3}.{4}, do a search/replace in {1} with previous field name and {4}
- If you deleted {3}.{4}, or if you don't want to deploy it, do a search on {4} in all sources, and remove all XML elements referring to {3}.{4} (except in destructiveChanges.xml)
- If {3}.{4} should exist, make sure it is in force-app/main/default/objects/{3}/fields and that {3}.{4} is in manifest/package.xml in CustomField section
- If {3}.{4} is standard, the error is because {3}.{4} is not available in the org you are trying to deploy to. You can:
  - Remove the reference to {4} in the XML of {1} ( maybe sfdx hardis:project:clean:references can clean automatically for you ! )
  - Activate the required features/license in the target org

```

## Mandatory custom field can not be in a profile/permission set

- `Error (.*) You cannot deploy to a required field: (.*)`

**Resolution tip**

```shell

- Search for {2} in source file XML of {1}, then remove the entries matching the results
Example of element to delete:
<fieldPermissions>
  <editable>true</editable>
  <field>{2}</field>
  <readable>true</readable>
</fieldPermissions>

```

## Custom metadata entry not found

- `Error (.*) In field: (.*) - no CustomMetadata named (.*) found`

**Resolution tip**

```shell
A reference to a custom metadata {3} of type {2} is not found in {1}:
- Are you sure you deployed {3} ?
- If you use a package.xml, is {3} present within type CustomMetadata ?

```

## Dependent class is invalid and needs recompilation

- `Error (.*) Dependent class is invalid and needs recompilation`

**Resolution tip**

```shell
Solve the other errors and this one will disappear !

```

## Duplicate value Platform Action Id List

- `duplicate value found: PlatformActionListId duplicates value on record with id`

**Resolution tip**

```shell
There are probably issue with conflict management. Open the XML of the source item, and replace all <sortOrder> numbers to make an ascending order, starting with 0
```

## Duplicate label

- `Error (.*) Duplicate label: (.*)`

**Resolution tip**

```shell
You probably renamed the picklist API name for {2}. Please update manually the picklist {1} in the target org to avoid to have a duplicate label
```

## Missing e-mail template

- `In field: template - no EmailTemplate named (.*) found`

**Resolution tip**

```shell
An email template should be present in the sources. To retrieve it, you can run:
sfdx force:source:retrieve -m EmailTemplate:{1} -u YOUR_ORG_USERNAME
```

## Empty source items

- `Required field is missing: sharingOwnerRules`
- `Required field is missing: standardValue`
- `Required field is missing: valueTranslation`

**Resolution tip**

```shell
You probably retrieved empty items, that must not be included within the SFDX project
To remove them, please run sfdx:hardis:project:clean:emptyitems
```

## Enable CRM Analytics

- `It should be created by enabling the CRM Analytics Cloud preference`

**Resolution tip**

```shell
You must enable CRM Analytics (ex Wave, Einstein Analytics & Tableau CRM) in the target org.
You probably also need to add CRM Analytics Admin Permission Set assignment to the deployment user
```

## Error parsing file

- `Error (.*) Error parsing file: (.*)`

**Resolution tip**

```shell
There has been an error parsing the XML file of {1}: {2}
- Open file {1} and look where the error can be ! (merge issue, typo, XML tag not closed...)
```

## Formula picklist field issue

- `Field:(.*) must not be Required`

**Resolution tip**

```shell
You probably made read only field {1} that was required before.
Find field {1} in the layout source XML, then replace Required by Readonly
```

## Field not available for element

- `Field (.*) is not available for`

**Resolution tip**

```shell
You probably changed the type of field {1}.
Find field {1} in the source XML, and remove the section using it
```

## Formula picklist field issue

- `Les champs de liste de sélection sont pris en charge uniquement dans certaines fonctions.`

**Resolution tip**

```shell
You probably changed the type of a field that is used in a formula.
Update the formula to use a field compliant with formulas.
More details at https://help.salesforce.com/articleView?id=sf.tips_on_building_formulas.htm&type=5
```

## Flow must be deleted manually

- `.flow (.*) insufficient access rights on cross-reference id`

**Resolution tip**

```shell
Flow {1} can not be deleted using deployments, please delete it manually in the target org using menu Setup -> Flows , context menu on {1} -> View details and versions -> Deactivate all versions -> Delete flow
```

## Insufficient access rights on cross-reference id

- `Error (.*) insufficient access rights on cross-reference id`

**Resolution tip**

```shell
If {1} is a Flow, it can not be deleted using deployments, please delete it manually in the target org using menu Setup -> Flows , context menu on {1} -> View details and versions -> Deactivate all versions -> Delete flow
```

## Invalid report type

- `Error (.*) invalid report type`

**Resolution tip**

```shell
Report type is missing for report {1}
- Open report {1} to se what report type is used
- Retrieve the report type from an org and add it to the sfdx sources
```

## Invalid scope:Mine, not allowed

- `Invalid scope:Mine, not allowed`

**Resolution tip**

```shell
Replace Mine by Everything in the list view SFDX source XML.
Have a look at this command to manage that automatically :)
https://sfdx-hardis.cloudity.com/hardis/org/fix/listviewmine/

```

## Invalid field in related list

- `Error (.*) Invalid field:(.*) in related list:(.*)`

**Resolution tip**

```shell
Field {2} is unknown. You can:
- Activate the related feature license or option to make {2} existing in target org
- Update XML of {1} to remove reference to field {2} in the related list {3}
- Update XML of {1} to remove the whole related list {3}
Example of XML to remove:
<relatedLists>
  <fields>SOLUTION.ISSUE</fields>
  <fields>SOLUTION.SOLUTION_NUMBER</fields>
  <fields>SOLUTION.STATUS</fields>
  <fields>CORE.USERS.ALIAS</fields>
  <relatedList>RelatedSolutionList</relatedList>
</relatedLists>

```

## Invalid field for upsert

- `Error (.*) Invalid field for upsert, must be an External Id custom or standard indexed field: (.*) \((.*)\)`

**Resolution tip**

```shell
You tried to use field {2} for an upsert call in {1}.
- Is it declared as externalId ?
- Is the customIndex source file present in the deployment ?
- If it is declared as externalId and customIndex is present, you may have to go manually define the field as externalId in the target org

```

## Invalid type

- `Error (.*) Invalid type: (.*) \((.*)\)`

**Resolution tip**

```shell
Apex error in {1} with unknown type {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !
```

## Campaign can not be updated

- `The object "Campaign" can't be updated`

**Resolution tip**

```shell
Add "MarketingUser" in project-scratch-def.json features
If it is already done, you may manually check "MarketingUser" field on the scratch org user
```

## Missing field MiddleName

- `field MiddleName`
- `Variable does not exist: MiddleName`

**Resolution tip**

```shell
MiddleNames must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableMiddleName": true
}
```

## Missing field Suffix

- `field Suffix`

**Resolution tip**

```shell
Suffix must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableNameSuffix": true
},
```

## Missing field SyncedQuoteId

- `field SyncedQuoteId`
- `Error  force-app/main/default/objects/Quote/Quote.object-meta.xml`
- `Error  force-app/main/default/objects/Opportunity/fields/SyncedQuoteId.field-meta.xml`

**Resolution tip**

```shell
Quotes must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.quotes_enable.htm&type=5
- Scratch org setting:
"quoteSettings": {
  "enableQuote": true
}
```

## Missing feature ContactToMultipleAccounts

- `no CustomObject named AccountContactRelation found`
- `Invalid field:ACCOUNT.NAME in related list:RelatedContactAccountRelationList`

**Resolution tip**

```shell
Contacts to multiple accounts be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.shared_contacts_set_up.htm&type=5
- Scratch org setting:
"features": ["ContactsToMultipleAccounts"]
```

## Missing feature Chatter Collaboration Group

- `CollaborationGroup`

**Resolution tip**

```shell
Quotes must be activated in the target org.
- Org: Setup -> Chatter settings -> Allow Records in Groups
- Scratch org setting:
"chatterSettings": {
  "allowRecordsInChatterGroup": true
},
```

## Missing feature Enhanced notes

- `FeedItem.ContentNote`

**Resolution tip**

```shell
Enhanced Notes must be activated in the target org.
- Org: Setup -> Notes settings -> Enable Notes
- Scratch org setting:
"enhancedNotesSettings": {
  "enableEnhancedNotes": true
},
```

## Missing feature Ideas notes

- `Idea.InternalIdeasIdeaRecordType`

**Resolution tip**

```shell
Ideas must be activated in the target org.
- Org: https://help.salesforce.com/articleView?id=networks_enable_ideas.htm&type=0
- Scratch org setting:
"ideasSettings": {
  "enableIdeas": true
}
```

## Missing feature Live Agent

- `FeedItem.ContentNote`

**Resolution tip**

```shell
Live Agent must be activated in the target org.
- Org: Setup -> Live Agent Settings -> Enable Live Agent
- Scratch org feature: LiveAgent
```

## Missing feature Product Request

- `ProductRequest`

**Resolution tip**

```shell
ProductRequest object is not available in the target org.
Maybe you would like to clean its references within Profiles / PS using the following command ?
sfdx hardis:project:clean:references , then select "ProductRequest references"
```

## Missing feature Social Customer Service

- `SocialPersona.AreWeFollowing`

**Resolution tip**

```shell
Social Custom Service must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.social_customer_service_setup_enable.htm&type=5
- Scratch org feature: SocialCustomerService
```

## Missing feature Translation Workbench

- `report-meta.xml(.*)filterlanguage`

**Resolution tip**

```shell
Translation workbench must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.customize_wbench.htm&type=5
- Scratch org:
"languageSettings": {
  "enableTranslationWorkbench":  true,
  "enableEndUserLanguages": true
}
```

## Missing feature Opportunity Teams

- `OpportunityTeam`

**Resolution tip**

```shell
Opportunity Teams must be activated in the target org.
- Org: Setup -> Opportunity Team Settings -> Enable Team Selling
- Scratch org:
"opportunitySettings": {
  "enableOpportunityTeam": true
}
```

## Missing Feature Work.Com

- `WorkBadgeDefinition`

**Resolution tip**

```shell
Work.com feature must be activated in the target org.
- Org & Scratch: https://developer.salesforce.com/docs/atlas.en-us.workdotcom_dev_guide.meta/workdotcom_dev_guide/wdc_cc_setup_dev_org.htm
```

## Missing multi-currency field

- `A reference to a custom field (.*)CurrencyIsoCode`

**Resolution tip**

```shell
You probably need to activate MultiCurrency (from Setup -> Company information)
```

## Missing object referenced in package.xml

- `An object (.*) of type (.*) was named in package.xml, but was not found in zipped directory`

**Resolution tip**

```shell
You can either:
- Update the package.xml to remove the reference to the missing {2} {1}
- Add the missing {2} {1} in your project source files
```

## Missing Quick Action

- `Error (.*) In field: QuickAction - no QuickAction named (.*) found`

**Resolution tip**

```shell
QuickAction {2} referred in {1} is unknown. You can either:
- Make sure your QuickAction {2} is present in source files and in package.xml
- If {2} is a standard QuickAction, activate related feature in target org
- Solve other errors that could impact QuickAction {2}
- Remove QuickAction {2} in the source XML of {1}. Example of XML to remove below:
<quickActionListItems>
  <quickActionName>FeedItem.RypplePost</quickActionName>
</quickActionListItems>
```

## Missing report

- `Error (.*) The (.*) report chart has a problem with the "reportName" field`

**Resolution tip**

```shell
{1} is referring to unknown report {2}. To retrieve it, you can run:
- sfdx force:source:retrieve -m Report:{2} -u YOUR_ORG_USERNAME
- If it fails, looks for the report folder and add it before report name to the retrieve command (ex: MYFOLDER/MYREPORTNAME)

```

## Missing Sales Team

- `related list:RelatedAccountSalesTeam`

**Resolution tip**

```shell
Account Teams must be activated in the target org.
- Org: Setup -> Account Teams -> Enable
- Scratch org setting:
"accountSettings": {
  "enableAccountTeams": true
}
}
```

## sharing operation already in progress

- `sharing operation already in progress`

**Resolution tip**

```shell
You can not deploy multiple SharingRules at the same time. You can either:
- Remove SharingOwnerRules and SharingRule from package.xml (so it becomes a manual operation)
- Use sfdx hardis:work:save to generate a deploymentPlan in .sfdx-hardis.json,
- If you are trying to create a scratch org, add DeferSharingCalc in features in project-scratch-def.json

```

## Not available for deploy for this organization

- `Error (.*) Not available for deploy for this organization`

**Resolution tip**

```shell
The user you use for deployments probably lacks of the rights (Profiles, Permission sets...) to manage {1}.
- Assign the deployment user to the good Permission Sets, or modify its profile rights, then try again
```

## Not valid sharing model

- `Error (.*) (.*) is not a valid sharing model for (.*) when (.*) sharing model is (.*)`

**Resolution tip**

```shell
It seems that Sharing Models of {1} and {4} are not compatible in target org.
- Use compatible sharing models between {1} and {4} by updating Sharing model of {1} or {4}
- Make sure that sfdx sources {1}.object-meta.xml and {4}.object-meta.xml and in the files, and that {1} and {4} are in package.xml in CustomObject block
- You may directly update sharingModel in XML. For example, replace <sharingModel>ReadWrite</sharingModel> by <sharingModel>Private</sharingModel> in {3}.object-meta.xml

```

## Picklist sharing is not supported

- `Picklist sharing is not supported`

**Resolution tip**

```shell
You probably changed the type of a field.
Go manually make the change in the target org, so the deployment will pass

```

## Picklist value not found

- `Picklist value: (.*) in picklist: (.*) not found`

**Resolution tip**

```shell
Sources have references to value {1} of picklist {2}
- If picklist {2} is standard, add the picklist to sfdx sources by using "sfdx force:source:retrieve -m StandardValueSet:{2}", then save again
- Else, perform a search in all code of {1}, then remove XML tags referring to {1} (for example in record types metadatas)

```

## Please choose a different name

- `Error (.*) This (.*) already exists or has been previously used(.*)Please choose a different name.`

**Resolution tip**

```shell
- Rename {1} in the target org, then try again the deployment. if it succeeds, delete the renamed item.
- or Delete {1} in the target org, then try again the deployment

```

## Missing profile default application

- `You can't remove the only default app from the profile.`

**Resolution tip**

```shell
You must have a default application for a profile. You can:
 - Update it in UI
 - Update the XML of the profile to set "true" in the <default> tag of one of the applicationVisibilities item.
 Ex:
 <applicationVisibilities>
    <application>standard__LightningSales</application>
    <default>true</default>
    <visible>true</visible>
</applicationVisibilities>
```

## CRM Analytics: A Recipe must specify a DataFlow

- `Error (.*) A Recipe must specify a Dataflow`

**Resolution tip**

```shell
You must include related WaveDataFlow {1} in sources (and probably in package.xml too).
To retrieve it, run: sfdx force:source:retrieve -m WaveDataFlow:{1} -u SOURCE_ORG_USERNAME
You can also retrieve all analytics sources in one shot using sfdx hardis:org:retrieve:source:analytics -u SOURCE_ORG_USERNAME
  - https://salesforce.stackexchange.com/a/365453/33522
  - https://help.salesforce.com/s/articleView?id=000319274&type=1
```

## Record Type not found

- `Error (.*) In field: recordType - no RecordType named (.*) found`

**Resolution tip**

```shell
An unknown record type {2} is referenced in {1}
- If record type {2} is not supposed to exist, perform a search in all files of {1}, then remove matching XML elements referring to this record type
- If record type {2} is supposed to exist, you may have to create it manually in the target org to make the deployment pass

```

## Objects rights on a role is below org default

- `access level below organization default`

**Resolution tip**

```shell
Your org wide settings default must be lower than the level defined in roles:
- If you are in a scratch org, it can be fixable using "objectProperties" in project-scratch-def.json (see "Set Object-Level Sharing Settings" paragraph in page https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm)
- If you are in a sandbox/dev/prod org, you need to update default org wide settings before deployment. See https://www.sfdcpoint.com/salesforce/organization-wide-defaults-owd-in-salesforce/
            
```

## Unsupported sharing configuration

- `not supported for (.*) since it's org wide default is`

**Resolution tip**

```shell
Consistency error between {1} sharing settings and {1} object configuration
Please check https://salesforce.stackexchange.com/questions/260923/sfdx-deploying-contact-sharing-rules-on-a-fresh-deployment
If you already did that, please try again to run the job
```

## A sharing rule may be useless

- `Required field is missing: sharingCriteriaRules`

**Resolution tip**

```shell
Are you sure you need this sharing rule ? You may remove it from the sfdx project
```

## Sharing recalculation lock

- `because it interferes with another operation already in progress`
- `Le calcul de partage demandé ne peut être traité maintenant car il interfère avec une autre opération en cours`

**Resolution tip**

```shell
If you changed a field from MasterDetail to Lookup, you must do it manually in the target org before being able to deploy
```

## Send email is disabled

- `Send Email is disabled or activities are not allowed`
- `Unknown user permission: SendExternalEmailAvailable`

**Resolution tip**

```shell
Go to Email -> Deliverability -> Select value "All emails"
```

## Sort order must be in sequential order

- `Error (.*) SortOrder must be in sequential order from`

**Resolution tip**

```shell
You probably have a default DuplicateRule in the target org. Retrieve it from target org, or delete it manually in target org, so you can deploy.
Ref: https://developer.salesforce.com/forums/?id=9060G000000I6SoQAK
```

## Async exception in test class

- `System.AsyncException: (.*) Apex`

**Resolution tip**

```shell
This may be a test class implementation issue in {1}.
Please check https://developer.salesforce.com/forums/?id=9060G0000005kVLQAY
```

## Test classes with 0% coverage

- `0%`

**Resolution tip**

```shell
Please make sure that none of the test classes are 0% covered
```

## Can not test item deployment in simulation mode

- `Test only deployment cannot update`

**Resolution tip**

```shell
THIS IS A FALSE POSITIVE
When effective deployment will happen, it should pass
```

## Unknown user permission: CreateAuditFields

- `Unknown user permission: CreateAuditFields`

**Resolution tip**

```shell
You need to enable the "Create audit field" permission in the target org
Please check https://help.salesforce.com/articleView?id=000334139&type=1&mode=1
```

## Unknown user permission: FieldServiceAccess

- `Unknown user permission: FieldServiceAccess`

**Resolution tip**

```shell
You need to enable the "Field Service Access" permission in the target org
Please check https://help.salesforce.com/articleView?id=sf.fs_enable.htm&type=5
```

## Unknown user permission

- `Unknown user permission:`

**Resolution tip**

```shell
You can:
- enable the related permission in the target org
- or remove references to the permission in source XML files (Probably a Profile or a Permission set)
```

## Variable does not exist

- `Error (.*) Variable does not exist: (.*) \((.*)\)`

**Resolution tip**

```shell
Apex error in {1} with unknown variable {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !
```

## Tableau CRM / Wave digest error

- `Fix the sfdcDigest node errors and then upload the file again`

**Resolution tip**

```shell
Go to the target org, open profile "Analytics Cloud Integration User" and add READ rights to the missing object fields 
```

## XML item appears more than once

- `Error (.*) Field:(.*), value:(.*) appears more than once`

**Resolution tip**

```shell
You probably made an error while merging conflicts
Look for {3} in the XML of {1}
If you see two {2} XML blocks with {3}, please decide which one you keep and remove the other one
```

