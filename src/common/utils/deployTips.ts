// Analyse deployment errors to provide tips to user :)

export function analyzeDeployErrorLogs(log: string): any {
    const tips: any = [];
    for (const tipDefinition of getAllTips()) {
        if (tipDefinition.expressionString && log.includes(tipDefinition.expressionString)) {
            tips.push(tipDefinition);
        }
        else if (tipDefinition.expressionRegex && tipDefinition.expressionRegex.test(tipDefinition.expressionString)) {
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
    "label": "Emails Templates",
    "packageXmlFile": "splits/packageXmlEmails.xml",
    "order": -20
  },
  {
    "label": "EmailTemplate records",
    "dataPath": "scripts/data/EmailTemplate",
    "order": -19
  },`
        },
        
    ]
}

