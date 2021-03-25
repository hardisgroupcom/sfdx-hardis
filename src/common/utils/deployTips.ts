// Analyse deployment errors to provide tips to user :)

export function analyzeDeployErrorLogs(log: string): any {
    const tips: any = [];
    for (const tipDefinition of getAllTips()) {
        if (tipDefinition.expressionString && log.includes(tipDefinition.expressionString)) {
            tips.add(tipDefinition);
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
            tip: `You can not deploy multiple SharingRules at the same time. You can:
- Remove SharingOwnerRules and SharingRule from package.xml (so it becomes a manual operation)
- Create a file manifest/deploymentPlan.json to deploy separately the sharing rules
            `
        }
    ]
}