// Analyze deployment errors to provide tips to user :)
import * as c from "chalk";

export function analyzeDeployErrorLogs(log: string): any {
  const tips: any = [];
  for (const tipDefinition of getAllTips()) {
    if (matchesTip(tipDefinition, log)) {
      tips.push(tipDefinition);
    }
  }
  return { tips };
}

function matchesTip(tipDefinition: any, log: string) {
  if (
    tipDefinition.expressionString &&
    tipDefinition.expressionString.filter((expressionString: any) => {
      return log.includes(expressionString);
    }).length > 0
  ) {
    return true;
  }
  if (
    tipDefinition.expressionRegex &&
    tipDefinition.expressionRegex.filter((expressionRegex: any) => {
      return expressionRegex.test(log);
    }).length > 0
  ) {
    return true;
  }
  return false;
}

function getAllTips() {
  return [
    {
      name: "can-not-change-to-formula-field",
      label: "Can not change field type to a formula field",
      expressionRegex: [/Cannot update a field to a Formula from something else/gm],
      tip: `You need to manually delete or rename the field in the target org to allow the deployment to pass
- first try to delete the field in the target org
- if you can't delete it, rename it, then once the deployment done, delete the legacy renamed field it`,
    },
    {
      name: "can-not-delete-custom-field",
      label: "Can not delete custom field",
      context: "destructiveChange",
      expressionRegex: [/Le champ personnalisé (.*) est utilisé dans (.*)/gm],
      tip: `A custom field can not be deleted because it is used elsewhere. Remove its references ans try again
THIS MAY BE A FALSE POSITIVE if you are just testing the deployment, as destructiveChanges are deployed before updated items deployment`,
    },
    {
      name: "can-not-delete-record-type",
      label: "Can not delete record type",
      context: "destructiveChange",
      expressionString: ["Cannot delete record type through API"],
      tip: `You need to manually delete record type in target org
- Edit record type, uncheck "Active"
- Delete record type`,
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
    {},
    {
      name: "custom-object-not-found",
      label: "Custom object not found",
      expressionRegex: [/In field: field - no CustomObject named (.*) found/gm],
      tip: `A reference to a custom object is not found:
- If you renamed the custom object, do a search/replace in sources with previous object name and new object name
- If you deleted the custom object, or if you don't want to deploy it, do a search on the custom object name, and remove XML elements referencing it
- If the object should exist, make sure it is in force-app/main/default/objects and that the object name is in manifest/package.xml in CustomObject section
You may also have a look to command sfdx hardis:project:clean:references
`,
    },
    {
      name: "custom-field-not-found",
      label: "Custom field not found",
      expressionRegex: [/In field: field - no CustomField named (.*) found/gm],
      tip: `A reference to a custom field is not found:
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
      name: "duplicate-label",
      label: "Duplicate label",
      expressionString: ["Duplicate label:"],
      tip: `You probably renamed a picklist API name. Please update manually the picklist in the target ogr to avoid to have a duplicate label`,
    },
    {
      name: "email-template-missing",
      label: "Missing e-mail template",
      expressionRegex: [/In field: template - no EmailTemplate named (.*) found/gm],
      tip: `Lightning EmailTemplates must also be imported with metadatas.
${c.cyan(
  "If this type of error is displayed in a deployment with --check, you may ignore it and validate the PR anyway (it may not happen when the deployment will be really performed and split in steps, including the one importing EmailTemplate records)"
)}
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
      tip: `You probably made read only a field that was required before.
Find the field in the layout source XML, then replace Required by Readonly`,
    },
    {
      name: "field-not-available-for-element",
      label: "Field not available for element",
      expressionRegex: [/Field (.*) is not available for/gm],
      tip: `You probably changed the type of a field.
Find the field in the source XML, and remove the section using it`,
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
      name: "invalid-scope-mine",
      label: "Invalid scope:Mine, not allowed",
      expressionString: ["Invalid scope:Mine, not allowed"],
      tip: `Replace Mine by Everything in the list view SFDX source XML`,
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
sfdx hardis:project:clean:references , then select "ProductRequest references"`
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
      name: "picklist-value-not-found",
      label: "Picklist value not found",
      expressionRegex: [/Picklist value: (.*) in picklist: (.*) not found/gm],
      tip: `Some element have references to missing picklist value(e)
- Perform a search in all code of the picklist value name
- Remove XML tags referring to unknown picklist value (for example in record types metadatas)
`,
    },
    {
      name: "record-type-not-found",
      label: "Record Type not found",
      expressionRegex: [/In field: recordType - no RecordType named (.*) found/gm],
      tip: `Some element have references to missing record type
- If the record type is not supposed to exist, perform a search in all files and remove XML elements referring to this record type
- If the record type is supposed to exist, you may have to create it manually in the target org to make the deployment pass
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
      tip: `Consistency error between sharing settings and object configuration
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
      tip: `This may be a test class implementation issue.
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
- or remove references to permission in source XML files`,
    },
  ];
}
