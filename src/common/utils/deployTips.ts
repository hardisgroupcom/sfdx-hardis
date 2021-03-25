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
            name: 'unknown-field',
            label: 'Unknown field',
            expressionString: '',
            tip: 'Do something !'
        }
    ]
}