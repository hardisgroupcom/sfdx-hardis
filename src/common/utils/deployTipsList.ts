export function getAllTips() {
  return [
    {
      name: "can-not-change-to-formula-field",
      label: "Can not change field type to a formula field",
      expressionRegex: [/Error (.*) Cannot update a field from a Formula to something else/gm],
      tip: `You need to manually delete or rename the field in the target org to allow the deployment to pass
- First, try to manually delete field {1} in the target org
- if you can't delete {1}, rename it into {1}_ToDel, then once the deployment done, delete {1}_ToDel`,
    },
    {
      name: "can-not-delete-custom-field",
      label: "Can not delete custom field",
      context: "destructiveChange",
      expressionRegex: [/This (.*) is referenced elsewhere in salesforce.com/gm, /Le champ personnalisé (.*) est utilisé dans (.*)/gm],
      tip: `Custom field {1} can not be deleted because it is used elsewhere. Remove its references ans try again
THIS MAY BE A FALSE POSITIVE if you are just testing the deployment, as destructiveChanges are deployed separately from updated items deployment check`,
    },
    {
      name: "can-not-delete-record-type",
      label: "Can not delete record type",
      context: "destructiveChange",
      expressionRegex: [/Error (.*) Cannot delete record type through API/gm],
      tip: `You need to manually delete record type {1} in target org
- Edit record type {1}, uncheck "Active"
- Delete record type {1}`,
    },
    {
      name: "can-not-find-folder",
      label: "Can not find folder",
      context: "destructiveChange",
      expressionString: ["Cannot find folder"],
      tip: `A folder is probably missing from project.
- If the folder is existing in sources, add it in related package.xml
- If the folder is not existing in DX sources, please use sfdx hardis:project:clean:retrievefolders -u YOURSOURCEORG`,
    },
    {
      name: "custom-object-not-found",
      label: "Custom object not found",
      expressionRegex: [/Error (.*) In field: field - no CustomObject named (.*) found/gm],
      tip: `A reference to a custom object {2} is not found in {1}:
- If you renamed the custom object, do a search/replace in sources with previous object name and new object name
- If you deleted the custom object, or if you don't want to deploy it, do a search on the custom object name, and remove XML elements referencing it
- If the object should exist, make sure it is in force-app/main/default/objects and that the object name is in manifest/package.xml in CustomObject section
You may also have a look to command sfdx hardis:project:clean:references
`,
    },
    {
      name: "custom-field-not-found",
      label: "Custom field not found",
      expressionRegex: [/Error (.*) In field: field - no CustomField named (.*) found/gm],
      tip: `A reference to a custom field {2} is not found in {1}:
- If you renamed the custom field, do a search/replace in sources with previous field name and new field name
- If you deleted the custom field, or if you don't want to deploy it, do a search on the custom field name, and remove XML elements referencing it
- If the custom field should exist, make sure it is in force-app/main/default/objects/YOUROBJECT/fields and that the field name is in manifest/package.xml in CustomField section
- If the field is standard, the error is because the field not available in the org you are trying to deploy to. You can:
  - Remove the reference to the standard field ( maybe sfdx hardis:project:clean:references can clean automatically for you ! )
  - Activate the required features/license in the target org
`,
    },
    {
      name: "custom-field-rights-mandatory",
      label: "Mandatory custom field can not be in a profile/permission set",
      expressionString: ["You cannot deploy to a required field", "Impossible de déployer vers un champ obligatoire"],
      tip: `A custom field declared as mandatory can not have rights defined in Profiles and Permission Sets
- Search the name of the Object.Field in sfdx folders permissionsets / profiles and remove the entries matching the results
Example of element to delete:
<fieldPermissions>
  <editable>true</editable>
  <field>MyObject.MyField__c</field>
  <readable>true</readable>
</fieldPermissions>
`,
    },
    {
      name: "custom-metadata-not-found",
      label: "Custom metadata entry not found",
      expressionRegex: [/Error (.*) In field: (.*) - no CustomMetadata named (.*) found/gm],
      tip: `A reference to a custom metadata {3} of type {2} is not found in {1}:
- Are you sure you deployed {3} ?
- If you use a package.xml, is {3} present within type CustomMetadata ?
`,
    },
    {
      name: "duplicate-value-platform-action-id-list",
      label: "Duplicate value Platform Action Id List",
      expressionString: ["duplicate value found: PlatformActionListId duplicates value on record with id"],
      tip: `There are probably issue with conflict management. Open the XML of the source item, and replace all <sortOrder> numbers to make an ascending order, starting with 0`,
    },
    {
      name: "duplicate-label",
      label: "Duplicate label",
      expressionRegex: [/Error (.*) Duplicate label: (.*)/gm],
      tip: `You probably renamed the picklist API name for {2}. Please update manually the picklist {1} in the target org to avoid to have a duplicate label`,
    },
    {
      name: "email-template-missing",
      label: "Missing e-mail template",
      expressionRegex: [/In field: template - no EmailTemplate named (.*) found/gm],
      tip: `Lightning EmailTemplates records must also be imported with metadatas.
If this type of error is displayed in a deployment with --check, you may ignore it and validate the PR anyway (it may not happen when the deployment will be really performed and split in steps, including the one importing EmailTemplate records)
- Create a file scripts/data/EmailTemplates/export.json:
{
    "objects": [
        {
            "query": "SELECT id,name,developername,namespaceprefix,foldername,templatestyle,isactive,templatetype,encoding,description,subject,htmlvalue,body,apiversion,markup,uitype,relatedentitytype,isbuildercontent FROM EmailTemplate",
            "operation": "Upsert",
            "externalId": "Name"
        }
    ]
}
- Run sfdx hardis:work:save`,
    },
    {
      name: "empty-item",
      label: "Empty source items",
      expressionString: [
        "Required field is missing: sharingOwnerRules",
        "Required field is missing: standardValue",
        "Required field is missing: valueTranslation",
      ],
      tip: `You probably retrieved empty items, that must not be included within the SFDX project
To remove them, please run sfdx:hardis:project:clean:emptyitems`,
    },
    {
      name: "field-must-not-be-required",
      label: "Formula picklist field issue",
      expressionRegex: [/Field:(.*) must not be Required/gm],
      tip: `You probably made read only field {1} that was required before.
Find field {1} in the layout source XML, then replace Required by Readonly`,
    },
    {
      name: "field-not-available-for-element",
      label: "Field not available for element",
      expressionRegex: [/Field (.*) is not available for/gm],
      tip: `You probably changed the type of field {1}.
Find field {1} in the source XML, and remove the section using it`,
    },
    {
      name: "formula-picklist-issue",
      label: "Formula picklist field issue",
      expressionString: ["Les champs de liste de sélection sont pris en charge uniquement dans certaines fonctions."],
      tip: `You probably changed the type of a field that is used in a formula.
Update the formula to use a field compliant with formulas.
More details at https://help.salesforce.com/articleView?id=sf.tips_on_building_formulas.htm&type=5`,
    },
    {
      name: "flow-must-be-deleted-manually",
      label: "Flow must be deleted manually",
      expressionRegex: [/.flow (.*) insufficient access rights on cross-reference id/gm],
      tip: `Flow {1} can not be deleted using deployments, please delete it manually in the target org using menu Setup -> Flows`,
    },
    {
      name: "invalid-scope-mine",
      label: "Invalid scope:Mine, not allowed",
      expressionString: ["Invalid scope:Mine, not allowed"],
      tip: `Replace Mine by Everything in the list view SFDX source XML`,
    },
    {
      name: "invalid-type",
      label: "Invalid type",
      expressionRegex: [/Error (.*) Invalid type: (.*) \((.*)\)/gm],
      tip: `Apex error in {1} with unknown type {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !`,
    },
    {
      name: "marketing-user-issue",
      label: "Campaign can not be updated",
      expressionString: [`The object "Campaign" can't be updated`],
      tip: `Add "MarketingUser" in project-scratch-def.json features
If it is already done, you may manually check "MarketingUser" field on the scratch org user`,
    },
    {
      name: "missing-field-middle-name",
      label: "Missing field MiddleName",
      expressionString: ["field MiddleName", "Variable does not exist: MiddleName"],
      tip: `MiddleNames must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableMiddleName": true
}`,
    },
    {
      name: "missing-field-suffix",
      label: "Missing field Suffix",
      expressionString: ["field Suffix"],
      tip: `Suffix must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableNameSuffix": true
},`,
    },
    {
      name: "missing-field-synced-quote-id",
      label: "Missing field SyncedQuoteId",
      expressionString: [
        "field SyncedQuoteId",
        "Error  force-app/main/default/objects/Quote/Quote.object-meta.xml",
        "Error  force-app/main/default/objects/Opportunity/fields/SyncedQuoteId.field-meta.xml",
      ],
      tip: `Quotes must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.quotes_enable.htm&type=5
- Scratch org setting:
"quoteSettings": {
  "enableQuote": true
}`,
    },
    {
      name: "missing-feature-account-contact-relation",
      label: "Missing feature ContactToMultipleAccounts",
      expressionString: ["no CustomObject named AccountContactRelation found"],
      tip: `Contacts to multiple accounts be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.shared_contacts_set_up.htm&type=5
- Scratch org setting:
"features": ["ContactsToMultipleAccounts"]`,
    },
    {
      name: "missing-feature-chatter-collaboration-groups",
      label: "Missing feature Chatter Collaboration Group",
      expressionString: ["CollaborationGroup"],
      tip: `Quotes must be activated in the target org.
- Org: Setup -> Chatter settings -> Allow Records in Groups
- Scratch org setting:
"chatterSettings": {
  "allowRecordsInChatterGroup": true
},`,
    },
    {
      name: "missing-feature-enhanced-notes",
      label: "Missing feature Enhanced notes",
      expressionString: ["FeedItem.ContentNote"],
      tip: `Enhanced Notes must be activated in the target org.
- Org: Setup -> Notes settings -> Enable Notes
- Scratch org setting:
"enhancedNotesSettings": {
  "enableEnhancedNotes": true
},`,
    },
    {
      name: "missing-feature-ideas",
      label: "Missing feature Ideas notes",
      expressionString: ["Idea.InternalIdeasIdeaRecordType"],
      tip: `Ideas must be activated in the target org.
- Org: https://help.salesforce.com/articleView?id=networks_enable_ideas.htm&type=0
- Scratch org setting:
"ideasSettings": {
  "enableIdeas": true
}`,
    },
    {
      name: "missing-feature-live-agent",
      label: "Missing feature Live Agent",
      expressionString: ["FeedItem.ContentNote"],
      tip: `Live Agent must be activated in the target org.
- Org: Setup -> Live Agent Settings -> Enable Live Agent
- Scratch org feature: LiveAgent`,
    },
    {
      name: "missing-feature-product-request",
      label: "Missing feature Product Request",
      expressionString: ["ProductRequest"],
      tip: `ProductRequest object is not available in the target org.
Maybe you would like to clean its references within Profiles / PS using the following command ?
sfdx hardis:project:clean:references , then select "ProductRequest references"`,
    },
    {
      name: "missing-feature-social-customer-service",
      label: "Missing feature Social Customer Service",
      expressionString: ["SocialPersona.AreWeFollowing"],
      tip: `Social Custom Service must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.social_customer_service_setup_enable.htm&type=5
- Scratch org feature: SocialCustomerService`,
    },
    {
      name: "missing-feature-translation-workbench",
      label: "Missing feature Translation Workbench",
      expressionRegex: [/report-meta.xml(.*)filterlanguage/gm],
      tip: `Translation workbench must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.customize_wbench.htm&type=5
- Scratch org:
"languageSettings": {
  "enableTranslationWorkbench":  true,
  "enableEndUserLanguages": true
}`,
    },
    {
      name: "missing-feature-opportunity",
      label: "Missing feature Opportunity Teams",
      expressionString: ["OpportunityTeam"],
      tip: `Opportunity Teams must be activated in the target org.
- Org: Setup -> Opportunity Team Settings -> Enable Team Selling
- Scratch org:
"opportunitySettings": {
  "enableOpportunityTeam": true
}`,
    },
    {
      name: "missing-feature-workdotcom",
      label: "Missing Feature Work.Com",
      expressionString: ["WorkBadgeDefinition"],
      tip: `Work.com feature must be activated in the target org.
- Org & Scratch: https://developer.salesforce.com/docs/atlas.en-us.workdotcom_dev_guide.meta/workdotcom_dev_guide/wdc_cc_setup_dev_org.htm`,
    },
    {
      name: "missing-object-package-xml",
      label: "Missing object referenced in package.xml",
      expressionRegex: [/An object (.*) of type (.*) was named in package.xml, but was not found in zipped directory/gm],
      tip: `You can either:
- Update the package.xml to remove the reference to the missing {2} {1}
- Add the missing {2} {1} in your project source files`,
    },
    {
      name: "missing-sales-team",
      label: "Missing Sales Team",
      expressionString: ["related list:RelatedAccountSalesTeam"],
      tip: `Account Teams must be activated in the target org.
- Org: Setup -> Account Teams -> Enable
- Scratch org setting:
"accountSettings": {
  "enableAccountTeams": true
}
}`,
    },
    {
      name: "multiple-sharing-rules",
      label: "sharing operation already in progress",
      expressionString: ["sharing operation already in progress"],
      tip: `You can not deploy multiple SharingRules at the same time. You can either:
- Remove SharingOwnerRules and SharingRule from package.xml (so it becomes a manual operation)
- Use sfdx hardis:work:save to generate a deploymentPlan in .sfdx-hardis.json,
- If you are trying to create a scratch org, add DeferSharingCalc in features in project-scratch-def.json
`,
    },
    {
      name: "picklist-sharing-not-supported",
      label: "Picklist sharing is not supported",
      expressionString: ["Picklist sharing is not supported"],
      tip: `You probably changed the type of a field.
Go manually make the change in the target org, so the deployment will pass
`,
    },
    {
      name: "picklist-value-not-found",
      label: "Picklist value not found",
      expressionRegex: [/Picklist value: (.*) in picklist: (.*) not found/gm],
      tip: `Sources have references to value {1} of picklist {2}
- If picklist {2} is standard, add the picklist to sfdx sources by using "sfdx force:source:retrieve -m StandardValueSet:{2}", then save again
- Else, perform a search in all code of {1}, then remove XML tags referring to {1} (for example in record types metadatas)
`,
    },
    {
      name: "please-choose-a-different-name",
      label: "Please choose a different name",
      expressionRegex: [/Error (.*) This (.*) already exists or has been previously used(.*)Please choose a different name./gm],
      tip: `- Rename {1} in the target org, then try again the deployment. if it succeeds, delete the renamed item.
- or Delete {1} in the target org, then try again the deployment
`,
    },
    {
      name: "profile-default-app",
      label: "Missing profile default application",
      expressionString: ["You can't remove the only default app from the profile."],
      tip: `You must have a default application for a profile. You can:
 - Update it in UI
 - Update the XML of the profile to set "true" in the <default> tag of one of the applicationVisibilities item.
 Ex:
 <applicationVisibilities>
    <application>standard__LightningSales</application>
    <default>true</default>
    <visible>true</visible>
</applicationVisibilities>`,
    },
    {
      name: "record-type-not-found",
      label: "Record Type not found",
      expressionRegex: [/Error (.*) In field: recordType - no RecordType named (.*) found/gm],
      tip: `An unknown record type {2} is referenced in {1}
- If record type {2} is not supposed to exist, perform a search in all files of {1}, then remove matching XML elements referring to this record type
- If record type {2} is supposed to exist, you may have to create it manually in the target org to make the deployment pass
`,
    },
    {
      name: "role-below-org-default",
      label: "Objects rights on a role is below org default",
      expressionString: ["access level below organization default"],
      tip: `Your org wide settings default must be lower than the level defined in roles:
- If you are in a scratch org, it can be fixable using "objectProperties" in project-scratch-def.json (see "Set Object-Level Sharing Settings" paragraph in page https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm)
- If you are in a sandbox/dev/prod org, you need to update default org wide settings before deployment. See https://www.sfdcpoint.com/salesforce/organization-wide-defaults-owd-in-salesforce/
            `,
    },
    {
      name: "sharing-not-supported",
      label: "Unsupported sharing configuration",
      expressionRegex: [/not supported for (.*) since it's org wide default is/gm],
      tip: `Consistency error between {1} sharing settings and {1} object configuration
Please check https://salesforce.stackexchange.com/questions/260923/sfdx-deploying-contact-sharing-rules-on-a-fresh-deployment
If you already did that, please try again to run the job`,
    },
    {
      name: "sharing-may-be-useless",
      label: "A sharing rule may be useless",
      expressionString: ["Required field is missing: sharingCriteriaRules"],
      tip: `Are you sure you need this sharing rule ? You may remove it from the sfdx project`,
    },
    {
      name: "sharing-recalc-lock",
      label: "Sharing recalculation lock",
      expressionString: [
        "because it interferes with another operation already in progress",
        "Le calcul de partage demandé ne peut être traité maintenant car il interfère avec une autre opération en cours",
      ],
      tip: `If you changed a field from MasterDetail to Lookup, you must do it manually in the target org before being able to deploy`,
    },
    {
      name: "test-case-async-exception",
      label: "Async exception in test class",
      expressionRegex: [/System.AsyncException: (.*) Apex/gm],
      tip: `This may be a test class implementation issue in {1}.
Please check https://developer.salesforce.com/forums/?id=9060G0000005kVLQAY`,
    },
    {
      name: "test-coverage-0-percent",
      label: "Test classes with 0% coverage",
      expressionRegex: [/ 0%/gm],
      tip: `Please make sure that none of the test classes are 0% covered`,
    },
    {
      name: "test-deployment-issue",
      label: "Can not test item deployment in simulation mode",
      expressionRegex: [/Test only deployment cannot update/gm],
      tip: `THIS IS A FALSE POSITIVE
When effective deployment will happen, it should pass`,
    },
    {
      name: "unknown-perm-create-audit-fields",
      label: "Unknown user permission: CreateAuditFields",
      expressionString: ["Unknown user permission: CreateAuditFields"],
      tip: `You need to enable the "Create audit field" permission in the target org
Please check https://help.salesforce.com/articleView?id=000334139&type=1&mode=1`,
    },
    {
      name: "unknown-perm-field-service-access",
      label: "Unknown user permission: FieldServiceAccess",
      expressionString: ["Unknown user permission: FieldServiceAccess"],
      tip: `You need to enable the "Field Service Access" permission in the target org
Please check https://help.salesforce.com/articleView?id=sf.fs_enable.htm&type=5`,
    },
    {
      name: "unknown-user-permission",
      label: "Unknown user permission",
      expressionString: ["Unknown user permission:"],
      tip: `You can:
- enable the related permission in the target org
- or remove references to the permission in source XML files (Probably a Profile or a Permission set)`,
    },
    {
      name: "variable-does-not-exist",
      label: "Variable does not exist",
      expressionRegex: [/Error (.*) Variable does not exist: (.*) \((.*)\)/gm],
      tip: `Apex error in {1} with unknown variable {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !`,
    },
    {
      name: "wave-digest-error",
      label: "Tableau CRM / Wave digest error",
      expressionString: ["Fix the sfdcDigest node errors and then upload the file again"],
      tip: `Go to the target org, open profile "Analytics Cloud Integration User" and add READ rights to the missing object fields `,
    },
    {
      name: "XML item appears more than once",
      label: "XML item appears more than once",
      expressionRegex: [/Error (.*) Field:(.*), value:(.*) appears more than once/gm],
      tip: `You probably made an error while merging conflicts
Look for {3} in the XML of {1}
If you see two {2} XML blocks with {3}, please decide which one you keep and remove the other one`,
    },
  ];
}
