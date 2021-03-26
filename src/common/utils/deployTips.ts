// Analyse deployment errors to provide tips to user :)

export function analyzeDeployErrorLogs(log: string): any {
    const tips: any = [];
    for (const tipDefinition of getAllTips()) {
        if (tipDefinition.expressionString && log.includes(tipDefinition.expressionString)) {
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
            `
        },
        {
            name: 'role-below-org-default',
            label: 'Objects rights on a role is below org default',
            expressionString: 'access level below organization default',
            tip: `Your org wide settings default must be lower than the level defined in roles:
- If you are in a scratch org, it can be fixable using "objectProperties" in project-scratch-def.json (see "Set Object-Level Sharing Settings" paragraph in page https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm)
- If you are in a sandbox/dev/prod org, you need to update default org wide settings before deployment. See https://www.sfdcpoint.com/salesforce/organization-wide-defaults-owd-in-salesforce/
            `
        }
    ]
}

