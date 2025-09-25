---
title: Sfdx-hardis deployment assistant list of errors
description: List of errors that are handled by sfdx-hardis deployment assistant
---
<!-- markdownlint-disable MD013 -->

# Salesforce deployment assistant errors list

sfdx-hardis can help solve solve deployment errors using a predefined list of issues and associated solutions

See how to [setup sfdx-hardis deployment assistant](salesforce-deployment-assistant-setup.md)

If you see a deployment error which is not here yet, please [add it in this file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/deployTipsList.ts) :)

## [API Version error](sf-deployment-assistant/API-Version-error.md)

**Detection**

- RegExp: `Error (.*) The (.*) apiVersion can't be "([0-9]+)"`

**Resolution**

```shell
{1} metadata has probably been created/updated in a sandbox already upgraded to next platform version (ex: Sandbox in Summer'23 and Production in Spring'23)
- First, try to update the api version in the XML of {1} metadata file (decrement the number in <apiVersion>{3}.0</apiVersion>)
- If it still doesn't work because the metadata structure has changed between version, you may try a sf project:retrieve:start of the metadata by forcing --api-version at the end of the command.
      
```

---
## [Allow deployment with pending Apex Jobs](sf-deployment-assistant/Allow-deployment-with-pending-Apex-Jobs.md)

**Detection**

- String: `You can bypass this error by allowing deployments with Apex jobs in the Deployment Settings page in Setup.`

**Resolution**

```shell
Go to target org, in Setup -> Deployment Settings -> Activate option "Allow deployments of components when corresponding Apex jobs are pending or in progress."

```

---
## [Can not change field type to a formula field](sf-deployment-assistant/Can-not-change-field-type-to-a-formula-field.md)

**Detection**

- RegExp: `Error (.*) Cannot update a field from a Formula to something else`

**Resolution**

```shell
You need to manually delete or rename the field in the target org to allow the deployment to pass
- First, try to manually delete field {1} in the target org
- if you can't delete {1}, rename it into {1}_ToDel, then once the deployment done, delete {1}_ToDel
```

---
## [Can not change type due to existing data](sf-deployment-assistant/Can-not-change-type-due-to-existing-data.md)

**Detection**

- RegExp: `Error (.*) Cannot change type due to existing data`

**Resolution**

```shell
It is usually not recommended to change types of fields, but if it's really necessary you can:
- Manually change the type of {1} in the target org
- If you can't manually change the type:
  - you may modify the dependencies (Formulas, Flows...) using {1}, so they don't use this field
  - you can also delete dependencies (Formulas, Flows...) using {1}, but make sure they are deployed again later
- More help: https://help.salesforce.com/s/articleView?id=000327186&type=1
```

---
## [Can not change field type with picklist](sf-deployment-assistant/Can-not-change-field-type-with-picklist.md)

**Detection**

- RegExp: `Error (.*) Cannot change which global value set this picklist uses`

**Resolution**

```shell
You probably updated the type of field {1}, and Salesforce does not allows that with deployments. You can:
- Try to manually change the type of {1} directly in target org, but it may not be technically possible
- Delete field {1} in target org: it will be recreated after deployment (but you will loose data on existing records, so be careful if your target is a production org)
- Create another field with desired type and manage data recovery if the target is a production org
```

---
## [Can not delete custom field](sf-deployment-assistant/Can-not-delete-custom-field.md)

**Detection**

- RegExp: `This (.*) is referenced elsewhere in salesforce.com`
- RegExp: `Le champ personnalisé (.*) est utilisé dans (.*)`

**Resolution**

```shell
Custom field {1} can not be deleted because it is used elsewhere. Remove its references ans try again
THIS MAY BE A FALSE POSITIVE if you are just testing the deployment, as destructiveChanges are deployed separately from updated items deployment check
```

---
## [Can not delete record type](sf-deployment-assistant/Can-not-delete-record-type.md)

**Detection**

- RegExp: `Error (.*) Cannot delete record type through API`

**Resolution**

```shell
You need to manually delete record type {1} in target org
- Edit record type {1}, uncheck "Active"
- Delete record type {1}
```

---
## [Can not find folder](sf-deployment-assistant/Can-not-find-folder.md)

**Detection**

- RegExp: `Error (.*) Cannot find folder:(.*)`

**Resolution**

```shell
Folder {2} is missing.
- If folder {2} is existing in sources, add it in related package.xml
- If folder {2} is not existing in DX sources, please use sf hardis:project:clean:retrievefolders to retrieve it
- If both previous solutions did not work, go create manually folder {2} in target org

```

---
## [Can not find user](sf-deployment-assistant/Can-not-find-user.md)

**Detection**

- RegExp: `Error (.*) Cannot find a user that matches any of the following usernames`

**Resolution**

```shell
You made reference to username(s) in {1}, and those users probably do not exist in target org.
- Do not use named users, but user public groups for assignments -> https://help.salesforce.com/s/articleView?id=sf.creating_and_editing_groups.htm&type=5
- or Create matching user(s) in the target deployment org
- or Remove the XML part referring to hardcoded usernames

Example of XML you have to remove in {1}:

<folderShares>
  <accessLevel>Manage</accessLevel>
  <sharedTo>nicolas.vuillamy@hardis-scratch-po-tgci-root-develop_20220412_0604.com</sharedTo>
  <sharedToType>User</sharedToType>
</folderShares>
```

---
## [Can not find user (2)](sf-deployment-assistant/Can-not-find-user--2-.md)

**Detection**

- RegExp: `Error (.*) In field: (.*) - no User named (.*) found`

**Resolution**

```shell
You made reference to username {3} in {1}, and it probably does not exist in the target org.
- Do not use named users, but user public groups for assignments -> https://help.salesforce.com/s/articleView?id=sf.creating_and_editing_groups.htm&type=5
- or Create matching user {3} in the target deployment org
- or open {1} metadata and remove the XML part referring to hardcoded username {3}
```

---
## [Cannot update a field to a Summary from something else](sf-deployment-assistant/Cannot-update-a-field-to-a-Summary-from-something-else.md)

**Detection**

- RegExp: `Error (.*) Cannot update a field to a (.*) from something else`

**Resolution**

```shell
You probably updated the type of field {1} to type {2}, and Salesforce does not allows that with deployments. You can:
- Try to manually change the type of {1} directly in target org, but it may not be technically possible
- Delete field {1} in target org: it will be recreated after deployment (but you will loose data on existing records, so be careful if your target is a production org)
- Create another field with desired type and manage data recovery if the target is a production org
```

---
## [Change Matching Rule](sf-deployment-assistant/Change-Matching-Rule.md)

**Detection**

- RegExp: `Error (.*) Before you change a matching rule, you must deactivate it`

**Resolution**

```shell
To be able to deploy, you must go in target org setup to manually deactivate matching rule {1}
```

---
## [Condition missing reference](sf-deployment-assistant/Condition-missing-reference.md)

**Detection**

- RegExp: `Error (.*) field integrity exception: unknown \(A condition has a reference to (.*), which doesn't exist.\)`

**Resolution**

```shell
There is a reference to {2} in {1}, and {2} is not found. You can either:
- Add {2} in your deployment sources and make sure it is named in package.xml
- Remove the reference to {2} in {1}

```

---
## [Custom object not found](sf-deployment-assistant/Custom-object-not-found.md)

**Detection**

- RegExp: `Error (.*) In field: field - no CustomObject named (.*) found`

**Resolution**

```shell
A reference to a custom object {2} is not found in {1}:
- If you renamed the custom object, do a search/replace in sources with previous object name and new object name
- If you deleted the custom object, or if you don't want to deploy it, do a search on the custom object name, and remove XML elements referencing it
- If the object should exist, make sure it is in force-app/main/default/objects and that the object name is in manifest/package.xml in CustomObject section
You may also have a look to command sf hardis:project:clean:references

```

---
## [Custom field not found](sf-deployment-assistant/Custom-field-not-found.md)

**Detection**

- RegExp: `Error (.*) In field: (.*) - no CustomField named (.*)\.(.*) found`

**Examples**

- `Error PS_Admin In field: field - no CustomField named User.expcloud__Portal_Username__c found`

**Resolution**

```shell
A reference to a custom field {3}.{4} is not found in {1}:
- If you renamed {3}.{4}, do a search/replace in {1} with previous field name and {4}
- If you deleted {3}.{4}, or if you don't want to deploy it, do a search on {4} in all sources, and remove all XML elements referring to {3}.{4} (except in destructiveChanges.xml)
- If {3}.{4} should exist, make sure it is in force-app/main/default/objects/{3}/fields and that {3}.{4} is in manifest/package.xml in CustomField section
- If {3}.{4} is standard, the error is because {3}.{4} is not available in the org you are trying to deploy to. You can:
  - Remove the reference to {4} in the XML of {1} ( maybe sf hardis:project:clean:references can clean automatically for you ! )
  - Activate the required features/license in the target org

```

---
## [Mandatory custom field can not be in a profile/permission set](sf-deployment-assistant/Mandatory-custom-field-can-not-be-in-a-profile-permission-set.md)

**Detection**

- RegExp: `Error (.*) You cannot deploy to a required field: (.*)`

**Resolution**

```shell

- Search for {2} in source file XML of {1}, then remove the entries matching the results
Example of element to delete:
<fieldPermissions>
  <editable>true</editable>
  <field>{2}</field>
  <readable>true</readable>
</fieldPermissions>

```

---
## [Custom metadata entry not found](sf-deployment-assistant/Custom-metadata-entry-not-found.md)

**Detection**

- RegExp: `Error (.*) In field: (.*) - no CustomMetadata named (.*) found`

**Resolution**

```shell
A reference to a custom metadata {3} of type {2} is not found in {1}:
- Are you sure you deployed {3} ?
- If you use a package.xml, is {3} present within type CustomMetadata ?

```

---
## [Expired Access / Refresh Token](sf-deployment-assistant/Expired-Access---Refresh-Token.md)

**Detection**

- String: `expired access/refresh token`

**Resolution**

```shell
Run command "Select another org" from Status panel (or sf hardis:org:select) to authenticate again to your org
```

---
## [Missing Data Category Group](sf-deployment-assistant/Missing-Data-Category-Group.md)

**Detection**

- RegExp: `Error (.*) In field: DeveloperName - no DataCategoryGroup named (.*) found`

**Resolution**

```shell
If Data Category Group {2} is not existing yet in target org, you might need to:
- create it manually in target org before deployment
- comment DataCategoryGroup in {1} XML

```

---
## [Dependent class is invalid and needs recompilation](sf-deployment-assistant/Dependent-class-is-invalid-and-needs-recompilation.md)

**Detection**

- RegExp: `Error (.*) Dependent class is invalid and needs recompilation`

**Resolution**

```shell
Solve the other errors and this one will disappear !

```

---
## [Duplicate value Platform Action Id List](sf-deployment-assistant/Duplicate-value-Platform-Action-Id-List.md)

**Detection**

- String: `duplicate value found: PlatformActionListId duplicates value on record with id`

**Resolution**

```shell
There are probably issue with conflict management. Open the XML of the source item, and replace all <sortOrder> numbers to make an ascending order, starting with 0
```

---
## [Duplicate label](sf-deployment-assistant/Duplicate-label.md)

**Detection**

- RegExp: `Error (.*) Duplicate label: (.*)`

**Resolution**

```shell
You probably renamed the picklist API name for {2}. Please update manually the picklist {1} in the target org to avoid to have a duplicate label
```

---
## [Missing e-mail template](sf-deployment-assistant/Missing-e-mail-template.md)

**Detection**

- RegExp: `In field: template - no EmailTemplate named (.*) found`

**Resolution**

```shell
An email template should be present in the sources. To retrieve it, you can run:
sf project retrieve start -m EmailTemplate:{1} -o YOUR_ORG_USERNAME
```

---
## [Empty source items](sf-deployment-assistant/Empty-source-items.md)

**Detection**

- String: `Required field is missing: sharingOwnerRules`
- String: `Required field is missing: standardValue`
- String: `Required field is missing: valueTranslation`

**Resolution**

```shell
You probably retrieved empty items, that must not be included within the SFDX project
To remove them, please run sfdx:hardis:project:clean:emptyitems
```

---
## [Enable CRM Analytics](sf-deployment-assistant/Enable-CRM-Analytics.md)

**Detection**

- String: `It should be created by enabling the CRM Analytics Cloud preference`

**Resolution**

```shell
You must enable CRM Analytics (ex Wave, Einstein Analytics & Tableau CRM) in the target org.
You probably also need to add CRM Analytics Admin Permission Set assignment to the deployment user
```

---
## [Error parsing file](sf-deployment-assistant/Error-parsing-file.md)

**Detection**

- RegExp: `Error (.*) Error parsing file: (.*)`

**Resolution**

```shell
There has been an error parsing the XML file of {1}: {2}
- Open file {1} and look where the error can be ! (merge issue, typo, XML tag not closed...)
```

---
## [Formula picklist field issue](sf-deployment-assistant/Formula-picklist-field-issue.md)

**Detection**

- RegExp: `Field:(.*) must not be Required`

**Resolution**

```shell
You probably made read only field {1} that was required before.
Find field {1} in the layout source XML, then replace Required by Readonly
```

---
## [Field not available for element](sf-deployment-assistant/Field-not-available-for-element.md)

**Detection**

- RegExp: `Field (.*) is not available for`

**Resolution**

```shell
You probably changed the type of field {1}.
Find field {1} in the source XML, and remove the section using it
```

---
## [Formula picklist field issue](sf-deployment-assistant/Formula-picklist-field-issue.md)

**Detection**

- String: `Les champs de liste de sélection sont pris en charge uniquement dans certaines fonctions.`

**Resolution**

```shell
You probably changed the type of a field that is used in a formula.
Update the formula to use a field compliant with formulas.
More details at https://help.salesforce.com/articleView?id=sf.tips_on_building_formulas.htm&type=5
```

---
## [Flow must be deleted manually](sf-deployment-assistant/Flow-must-be-deleted-manually.md)

**Detection**

- RegExp: `.flow (.*) insufficient access rights on cross-reference id`

**Resolution**

```shell
Flow {1} can not be deleted using deployments, please delete it manually in the target org using menu Setup -> Flows , context menu on {1} -> View details and versions -> Deactivate all versions -> Delete flow
```

---
## [Insufficient access rights on cross-reference id](sf-deployment-assistant/Insufficient-access-rights-on-cross-reference-id.md)

**Detection**

- RegExp: `Error (.*) insufficient access rights on cross-reference id`

**Resolution**

```shell
- If {1} is a Flow, it can not be deleted using deployments, please delete it manually in the target org using menu Setup -> Flows , context menu on {1} -> View details and versions -> Deactivate all versions -> Delete flow
- If you changed a custom field from unique to not unique, you need to manually make the change in the target org
```

---
## [Invalid formula grouping context](sf-deployment-assistant/Invalid-formula-grouping-context.md)

**Detection**

- String: `Invalid custom summary formula definition: You must select a grouping context to use any report summary function`

**Resolution**

```shell
You need to update your Report definition. See workaround here -> https://salesforce.stackexchange.com/questions/294850/grouping-error-with-prevgroupval-function
```

---
## [Invalid report type](sf-deployment-assistant/Invalid-report-type.md)

**Detection**

- RegExp: `Error (.*) invalid report type`

**Resolution**

```shell
Report type is missing for report {1}
- Open report {1} to se what report type is used
- Retrieve the report type from an org and add it to the sfdx sources
```

---
## [Invalid scope:Mine, not allowed](sf-deployment-assistant/Invalid-scope-Mine--not-allowed.md)

**Detection**

- String: `Invalid scope:Mine, not allowed`

**Resolution**

```shell
Replace Mine by Everything in the list view SFDX source XML.
Have a look at this command to manage that automatically :)
https://sfdx-hardis.cloudity.com/hardis/org/fix/listviewmine/ 

```

---
## [Invalid field in related list](sf-deployment-assistant/Invalid-field-in-related-list.md)

**Detection**

- RegExp: `Error (.*) Invalid field:(.*) in related list:(.*)`

**Resolution**

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

---
## [Invalid field for upsert](sf-deployment-assistant/Invalid-field-for-upsert.md)

**Detection**

- RegExp: `Error (.*) Invalid field for upsert, must be an External Id custom or standard indexed field: (.*) \((.*)\)`

**Resolution**

```shell
You tried to use field {2} for an upsert call in {1}.
- Is it declared as externalId ?
- Is the customIndex source file present in the deployment ?
- If it is declared as externalId and customIndex is present, you may have to go manually define the field as externalId in the target org

```

---
## [Invalid type](sf-deployment-assistant/Invalid-type.md)

**Detection**

- RegExp: `Error (.*) Invalid type: (.*) \((.*)\)`

**Resolution**

```shell
Apex error in {1} with unknown type {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !
```

---
## [Campaign can not be updated](sf-deployment-assistant/Campaign-can-not-be-updated.md)

**Detection**

- String: `The object "Campaign" can't be updated`

**Resolution**

```shell
Add "MarketingUser" in project-scratch-def.json features
If it is already done, you may manually check "MarketingUser" field on the scratch org user
```

---
## [Missing field MiddleName](sf-deployment-assistant/Missing-field-MiddleName.md)

**Detection**

- String: `field MiddleName`
- String: `Variable does not exist: MiddleName`

**Resolution**

```shell
MiddleNames must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableMiddleName": true
}
```

---
## [Missing field Suffix](sf-deployment-assistant/Missing-field-Suffix.md)

**Detection**

- String: `field Suffix`

**Resolution**

```shell
Suffix must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableNameSuffix": true
},
```

---
## [Missing field SyncedQuoteId](sf-deployment-assistant/Missing-field-SyncedQuoteId.md)

**Detection**

- String: `field SyncedQuoteId`
- String: `Error  force-app/main/default/objects/Quote/Quote.object-meta.xml`
- String: `Error  force-app/main/default/objects/Opportunity/fields/SyncedQuoteId.field-meta.xml`

**Resolution**

```shell
Quotes must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.quotes_enable.htm&type=5
- Scratch org setting:
"quoteSettings": {
  "enableQuote": true
}
```

---
## [Missing feature ContactToMultipleAccounts](sf-deployment-assistant/Missing-feature-ContactToMultipleAccounts.md)

**Detection**

- String: `no CustomObject named AccountContactRelation found`
- String: `Invalid field:ACCOUNT.NAME in related list:RelatedContactAccountRelationList`

**Resolution**

```shell
Contacts to multiple accounts be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.shared_contacts_set_up.htm&type=5
- Scratch org setting:
"features": ["ContactsToMultipleAccounts"]
```

---
## [Missing feature Chatter Collaboration Group](sf-deployment-assistant/Missing-feature-Chatter-Collaboration-Group.md)

**Detection**

- String: `CollaborationGroup`

**Resolution**

```shell
Quotes must be activated in the target org.
- Org: Setup -> Chatter settings -> Allow Records in Groups
- Scratch org setting:
"chatterSettings": {
  "allowRecordsInChatterGroup": true
},
```

---
## [Missing feature Enhanced notes](sf-deployment-assistant/Missing-feature-Enhanced-notes.md)

**Detection**

- String: `FeedItem.ContentNote`

**Resolution**

```shell
Enhanced Notes must be activated in the target org.
- Org: Setup -> Notes settings -> Enable Notes
- Scratch org setting:
"enhancedNotesSettings": {
  "enableEnhancedNotes": true
},
```

---
## [Missing feature Ideas notes](sf-deployment-assistant/Missing-feature-Ideas-notes.md)

**Detection**

- String: `Idea.InternalIdeasIdeaRecordType`

**Resolution**

```shell
Ideas must be activated in the target org.
- Org: https://help.salesforce.com/articleView?id=networks_enable_ideas.htm&type=0
- Scratch org setting:
"ideasSettings": {
  "enableIdeas": true
}
```

---
## [Missing feature Live Agent](sf-deployment-assistant/Missing-feature-Live-Agent.md)

**Detection**

- String: `FeedItem.ContentNote`

**Resolution**

```shell
Live Agent must be activated in the target org.
- Org: Setup -> Live Agent Settings -> Enable Live Agent
- Scratch org feature: LiveAgent
```

---
## [Missing feature Product Request](sf-deployment-assistant/Missing-feature-Product-Request.md)

**Detection**

- String: `ProductRequest`

**Resolution**

```shell
ProductRequest object is not available in the target org.
Maybe you would like to clean its references within Profiles / PS using the following command ?
sf hardis:project:clean:references , then select "ProductRequest references"
```

---
## [Missing feature Social Customer Service](sf-deployment-assistant/Missing-feature-Social-Customer-Service.md)

**Detection**

- String: `SocialPersona.AreWeFollowing`

**Resolution**

```shell
Social Custom Service must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.social_customer_service_setup_enable.htm&type=5
- Scratch org feature: SocialCustomerService
```

---
## [Missing feature Translation Workbench](sf-deployment-assistant/Missing-feature-Translation-Workbench.md)

**Detection**

- RegExp: `report-meta.xml(.*)filterlanguage`

**Resolution**

```shell
Translation workbench must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.customize_wbench.htm&type=5
- Scratch org:
"languageSettings": {
  "enableTranslationWorkbench":  true,
  "enableEndUserLanguages": true
}
```

---
## [Missing feature Opportunity Teams](sf-deployment-assistant/Missing-feature-Opportunity-Teams.md)

**Detection**

- String: `OpportunityTeam`

**Resolution**

```shell
Opportunity Teams must be activated in the target org.
- Org: Setup -> Opportunity Team Settings -> Enable Team Selling
- Scratch org:
"opportunitySettings": {
  "enableOpportunityTeam": true
}
```

---
## [Missing Feature Work.Com](sf-deployment-assistant/Missing-Feature-Work-Com.md)

**Detection**

- String: `WorkBadgeDefinition`

**Resolution**

```shell
Work.com feature must be activated in the target org.
- Org & Scratch: https://developer.salesforce.com/docs/atlas.en-us.workdotcom_dev_guide.meta/workdotcom_dev_guide/wdc_cc_setup_dev_org.htm
```

---
## [Missing multi-currency field](sf-deployment-assistant/Missing-multi-currency-field.md)

**Detection**

- RegExp: `A reference to a custom field (.*)CurrencyIsoCode`

**Resolution**

```shell
You probably need to activate MultiCurrency (from Setup -> Company information)
```

---
## [Missing object referenced in package.xml](sf-deployment-assistant/Missing-object-referenced-in-package-xml.md)

**Detection**

- RegExp: `An object (.*) of type (.*) was named in package.xml, but was not found in zipped directory`

**Resolution**

```shell
You can either:
- Update the package.xml to remove the reference to the missing {2} {1}
- Add the missing {2} {1} in your project source files
```

---
## [Missing Quick Action](sf-deployment-assistant/Missing-Quick-Action.md)

**Detection**

- RegExp: `Error (.*) In field: QuickAction - no QuickAction named (.*) found`

**Resolution**

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

---
## [Missing report](sf-deployment-assistant/Missing-report.md)

**Detection**

- RegExp: `Error (.*) The (.*) report chart has a problem with the "reportName" field`

**Resolution**

```shell
{1} is referring to unknown report {2}. To retrieve it, you can run:
- sf project retrieve start -m Report:{2} -o YOUR_ORG_USERNAME
- If it fails, looks for the report folder and add it before report name to the retrieve command (ex: MYFOLDER/MYREPORTNAME)

```

---
## [Missing Sales Team](sf-deployment-assistant/Missing-Sales-Team.md)

**Detection**

- String: `related list:RelatedAccountSalesTeam`

**Resolution**

```shell
Account Teams must be activated in the target org.
- Org: Setup -> Account Teams -> Enable
- Scratch org setting:
"accountSettings": {
  "enableAccountTeams": true
}
}
```

---
## [sharing operation already in progress](sf-deployment-assistant/sharing-operation-already-in-progress.md)

**Detection**

- String: `sharing operation already in progress`

**Resolution**

```shell
You can not deploy multiple SharingRules at the same time. You can either:
- Remove SharingOwnerRules and SharingRule from package.xml (so it becomes a manual operation)
- Use sf hardis:work:save to generate a deploymentPlan in .sfdx-hardis.json,
- If you are trying to create a scratch org, add DeferSharingCalc in features in project-scratch-def.json

```

---
## [Network issue](sf-deployment-assistant/Network-issue.md)

**Detection**

- String: `ECONNABORTED`
- String: `ECONNRESET`

**Resolution**

```shell
The network connection has been aborted, this is a purely technical issue.
Try again, and if you still see errors, check the status of Salesforce instance on https://status.salesforce.com
```

---
## [Not available for deploy for this organization](sf-deployment-assistant/Not-available-for-deploy-for-this-organization.md)

**Detection**

- RegExp: `Error (.*) Not available for deploy for this organization`

**Resolution**

```shell
The user you use for deployments probably lacks of the rights (Profiles, Permission sets...) to manage {1}.
- Assign the deployment user to the good Permission Sets, or modify its profile rights, then try again
```

---
## [Not valid sharing model](sf-deployment-assistant/Not-valid-sharing-model.md)

**Detection**

- RegExp: `Error (.*) (.*) is not a valid sharing model for (.*) when (.*) sharing model is (.*)`

**Resolution**

```shell
It seems that Sharing Models of {1} and {4} are not compatible in target org.
- Use compatible sharing models between {1} and {4} by updating Sharing model of {1} or {4}
- Make sure that sfdx sources {1}.object-meta.xml and {4}.object-meta.xml and in the files, and that {1} and {4} are in package.xml in CustomObject block
- You may directly update sharingModel in XML. For example, replace <sharingModel>ReadWrite</sharingModel> by <sharingModel>Private</sharingModel> in {3}.object-meta.xml

```

---
## [Picklist sharing is not supported](sf-deployment-assistant/Picklist-sharing-is-not-supported.md)

**Detection**

- String: `Picklist sharing is not supported`

**Resolution**

```shell
You probably changed the type of a field.
Go manually make the change in the target org, so the deployment will pass

```

---
## [Picklist value not found](sf-deployment-assistant/Picklist-value-not-found.md)

**Detection**

- RegExp: `Picklist value: (.*) in picklist: (.*) not found`

**Resolution**

```shell
Sources have references to value {1} of picklist {2}
- If picklist {2} is standard, add the picklist to sfdx sources by using "sf project retrieve start -m StandardValueSet:{2}", then save again
- Else, perform a search in all code of {1}, then remove XML tags referring to {1} (for example in record types metadatas)

```

---
## [Please choose a different name](sf-deployment-assistant/Please-choose-a-different-name.md)

**Detection**

- RegExp: `Error (.*) This (.*) already exists or has been previously used(.*)Please choose a different name.`

**Resolution**

```shell
- Rename {1} in the target org, then try again the deployment. if it succeeds, delete the renamed item.
- or Delete {1} in the target org, then try again the deployment

```

---
## [Missing profile default application](sf-deployment-assistant/Missing-profile-default-application.md)

**Detection**

- String: `You can't remove the only default app from the profile.`

**Resolution**

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

---
## [CRM Analytics: A Recipe must specify a DataFlow](sf-deployment-assistant/CRM-Analytics--A-Recipe-must-specify-a-DataFlow.md)

**Detection**

- RegExp: `Error (.*) A Recipe must specify a Dataflow`

**Resolution**

```shell
You must include related WaveDataFlow {1} in sources (and probably in package.xml too).
To retrieve it, run: sf project retrieve start -m WaveDataFlow:{1} -u SOURCE_ORG_USERNAME
You can also retrieve all analytics sources in one shot using sf hardis:org:retrieve:source:analytics -u SOURCE_ORG_USERNAME
  - https://salesforce.stackexchange.com/a/365453/33522
  - https://help.salesforce.com/s/articleView?id=000319274&type=1
```

---
## [Record Type not found](sf-deployment-assistant/Record-Type-not-found.md)

**Detection**

- RegExp: `Error (.*) In field: recordType - no RecordType named (.*) found`

**Resolution**

```shell
An unknown record type {2} is referenced in {1}
- If record type {2} is not supposed to exist, perform a search in all files of {1}, then remove matching XML elements referring to this record type
- If record type {2} is supposed to exist, you may have to create it manually in the target org to make the deployment pass

```

---
## [Objects rights on a role is below org default](sf-deployment-assistant/Objects-rights-on-a-role-is-below-org-default.md)

**Detection**

- String: `access level below organization default`

**Resolution**

```shell
Your org wide settings default must be lower than the level defined in roles:
- If you are in a scratch org, it can be fixable using "objectProperties" in project-scratch-def.json (see "Set Object-Level Sharing Settings" paragraph in page https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm)
- If you are in a sandbox/dev/prod org, you need to update default org wide settings before deployment. See https://www.sfdcpoint.com/salesforce/organization-wide-defaults-owd-in-salesforce/
            
```

---
## [Unsupported sharing configuration](sf-deployment-assistant/Unsupported-sharing-configuration.md)

**Detection**

- RegExp: `not supported for (.*) since it's org wide default is`

**Resolution**

```shell
Consistency error between {1} sharing settings and {1} object configuration
Please check https://salesforce.stackexchange.com/questions/260923/sfdx-deploying-contact-sharing-rules-on-a-fresh-deployment
If you already did that, please try again to run the job
```

---
## [A sharing rule may be useless](sf-deployment-assistant/A-sharing-rule-may-be-useless.md)

**Detection**

- String: `Required field is missing: sharingCriteriaRules`

**Resolution**

```shell
Are you sure you need this sharing rule ? You may remove it from the sfdx project
```

---
## [Sharing recalculation lock](sf-deployment-assistant/Sharing-recalculation-lock.md)

**Detection**

- String: `because it interferes with another operation already in progress`
- String: `Le calcul de partage demandé ne peut être traité maintenant car il interfère avec une autre opération en cours`

**Resolution**

```shell
If you changed a field from MasterDetail to Lookup, you must do it manually in the target org before being able to deploy
```

---
## [Send email is disabled](sf-deployment-assistant/Send-email-is-disabled.md)

**Detection**

- String: `Send Email is disabled or activities are not allowed`
- String: `Unknown user permission: SendExternalEmailAvailable`

**Resolution**

```shell
Go to Email -> Deliverability -> Select value "All emails"
```

---
## [Sort order must be in sequential order](sf-deployment-assistant/Sort-order-must-be-in-sequential-order.md)

**Detection**

- RegExp: `Error (.*) SortOrder must be in sequential order from`

**Resolution**

```shell
You probably have a default DuplicateRule in the target org. Retrieve it from target org, or delete it manually in target org, so you can deploy.
Ref: https://developer.salesforce.com/forums/?id=9060G000000I6SoQAK
```

---
## [Async exception in test class](sf-deployment-assistant/Async-exception-in-test-class.md)

**Detection**

- RegExp: `System.AsyncException: (.*) Apex`

**Resolution**

```shell
This may be a test class implementation issue in {1}.
Please check https://developer.salesforce.com/forums/?id=9060G0000005kVLQAY
```

---
## [Test classes with 0% coverage](sf-deployment-assistant/Test-classes-with-0--coverage.md)

**Detection**

- RegExp: `0%`

**Resolution**

```shell
Please make sure that none of the test classes are 0% covered
```

---
## [Can not test item deployment in simulation mode](sf-deployment-assistant/Can-not-test-item-deployment-in-simulation-mode.md)

**Detection**

- RegExp: `Test only deployment cannot update`

**Resolution**

```shell
THIS IS A FALSE POSITIVE
When effective deployment will happen, it should pass
```

---
## [Unknown user permission: CreateAuditFields](sf-deployment-assistant/Unknown-user-permission--CreateAuditFields.md)

**Detection**

- String: `Unknown user permission: CreateAuditFields`

**Resolution**

```shell
You need to enable the "Create audit field" permission in the target org
Please check https://help.salesforce.com/articleView?id=000334139&type=1&mode=1
```

---
## [Unknown user permission: FieldServiceAccess](sf-deployment-assistant/Unknown-user-permission--FieldServiceAccess.md)

**Detection**

- String: `Unknown user permission: FieldServiceAccess`

**Resolution**

```shell
You need to enable the "Field Service Access" permission in the target org
Please check https://help.salesforce.com/articleView?id=sf.fs_enable.htm&type=5
```

---
## [Unknown user permission](sf-deployment-assistant/Unknown-user-permission.md)

**Detection**

- String: `Unknown user permission:`

**Resolution**

```shell
You can:
- enable the related permission in the target org
- or remove references to the permission in source XML files (Probably a Profile or a Permission set)
```

---
## [Variable does not exist](sf-deployment-assistant/Variable-does-not-exist.md)

**Detection**

- RegExp: `Error (.*) Variable does not exist: (.*) \((.*)\)`

**Resolution**

```shell
Apex error in {1} with unknown variable {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !
```

---
## [Visibility is not allowed for type](sf-deployment-assistant/Visibility-is-not-allowed-for-type.md)

**Detection**

- RegExp: `Error (.*) set the visibility for a (.*) to Protected unless you are in a developer`

**Resolution**

```shell
Update the visibility of {1} to "Public"
```

---
## [Tableau CRM / Wave digest error](sf-deployment-assistant/Tableau-CRM---Wave-digest-error.md)

**Detection**

- String: `Fix the sfdcDigest node errors and then upload the file again`

**Resolution**

```shell
Go to the target org, open profile "Analytics Cloud Integration User" and add READ rights to the missing object fields 
```

---
## [XML item appears more than once](sf-deployment-assistant/XML-item-appears-more-than-once.md)

**Detection**

- RegExp: `Error (.*) Field:(.*), value:(.*) appears more than once`

**Resolution**

```shell
You probably made an error while merging conflicts
Look for {3} in the XML of {1}
If you see two {2} XML blocks with {3}, please decide which one you keep and remove the other one
```

---
