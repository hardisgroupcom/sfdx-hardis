// Analyze deployment errors to provide tips to user :)
import * as c from "chalk";

export function analyzeDeployErrorLogs(log: string): any {
    const tips: any = [];
    for (const tipDefinition of getAllTips()) {
        if (tipDefinition.expressionString && log.includes(tipDefinition.expressionString)) {
            tips.push(tipDefinition);
        }
        else if (tipDefinition.expressionRegex && tipDefinition.expressionRegex.test(log)) {
            tips.push(tipDefinition);
        }
    }
    return { tips }
}

function getAllTips() {
    return [
        {
            name: 'multiple-sharing-rules',
            label: 'sharing operation already in progress',
            expressionString: 'sharing operation already in progress',
            tip: `You can not deploy multiple SharingRules at the same time. You can either:
- Remove SharingOwnerRules and SharingRule from package.xml (so it becomes a manual operation)
- Create a file manifest/deploymentPlan.json to deploy separately the sharing rules

{
    "packages": [
  {
    "label": "SharingRules for Account",
    "packageXmlFile": "splits/packageXmlSharingRulesAccount.xml",
    "order": 10,
    "waitAfter": 60
  },
  {
    "label": "SharingRules for Visit__c",
    "packageXmlFile": "splits/packageXmlSharingRulesVisit__c.xml",
    "order": 20
  }
}`
        },
        {
            name: 'role-below-org-default',
            label: 'Objects rights on a role is below org default',
            expressionString: 'access level below organization default',
            tip: `Your org wide settings default must be lower than the level defined in roles:
- If you are in a scratch org, it can be fixable using "objectProperties" in project-scratch-def.json (see "Set Object-Level Sharing Settings" paragraph in page https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm)
- If you are in a sandbox/dev/prod org, you need to update default org wide settings before deployment. See https://www.sfdcpoint.com/salesforce/organization-wide-defaults-owd-in-salesforce/
            `
        },
        {
            name: 'email-template-missing',
            label: 'Missing e-mail template',
            expressionRegex: /In field: template - no EmailTemplate named (.*) found/gm,
            tip: `Lightning EmailTemplates must also be imported with metadatas.
${c.cyan('If this type of error is displayed in a deployment with --check, you may ignore it and validate the PR anyway (it may not happen when the deployment will be really performed and split in steps, incuding the one importing EmailTemplate records)')}
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

- Create a file manifest/splits/packageXmlEmails.xml

<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>unfiled/$public</members>
    <members>unfiled/$public/ChantierJ14DateDemarrage</members>
    <members>unfiled/$public/ChantierReferenceMarketing</members>
    <members>unfiled/$public/LotChantierGagnePlanification</members>
    <name>EmailTemplate</name>
  </types>
  <version>51.0</version>
</Package>

- Update deploymentPlan.json to add:

{
    "packages": [
      {
        "label": "EmailTemplate records",
        "dataPath": "scripts/data/EmailTemplate",
        "order": -21
      },
      {
        "label": "Emails Templates",
        "packageXmlFile": "splits/packageXmlEmails.xml",
        "order": -20
      }
    ]
}`
        },
        {
          name: 'custom-object-not-found',
          label: 'Custom object not found',
          expressionRegex: /In field: field - no CustomObject named (.*) found/gm,
          tip: `A reference to a custom object is not found:
- If you renamed the custom object, do a search/replace in sources with previous object name and new object name
- If you deleted the custom object, or if you don't want to deploy it, do a search on the custom object name, and remove XML elements referencing it
- If the object should exist, make sure it is in force-app/main/default/objects and that the object name is in manifest/package.xml in CustomObject section
`
        },
        {
          name: 'custom-field-not-found',
          label: 'Custom field not found',
          expressionRegex: /In field: field - no CustomField named (.*) found/gm,
          tip: `A reference to a custom object is not found:
- If you renamed the custom field, do a search/replace in sources with previous field name and new field name
- If you deleted the custom field, or if you don't want to deploy it, do a search on the custom field name, and remove XML elements referencing it
- If the object should exist, make sure it is in force-app/main/default/objects/YOUROBJECT/fields and that the field name is in manifest/package.xml in CustomField section
`
        },
    ];
}
