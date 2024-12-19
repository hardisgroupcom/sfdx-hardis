/**
 * index.ts
 * TODO
 * - Move FlowMap to a class
 * - Move each language to their own file
 * - Handle options
 */

import { NODE_CONFIG } from "./renderConfig.js";

import { XMLParser } from "fast-xml-parser";

interface FlowMap {
    "description"?: string;
    "label"?: string;
    "processType"?: string; // TODO
    "start"?: any;
    "status"?: "Active" | "Draft";
    [propName: string]: any;
}

/*
// TODO FILL OUT
interface FlowObj {
    "description"?: string;
    "label"?: string;
    "processType"?: string; // TODO
    "start"?: {
        "connector": string;
        "scheduledPaths": any;
    };
    "status"?: "Active" | "Draft";
    "subflows"?: any | any[];
    "actionCalls"?: any | any[];
    "assignments"?: any | any[];
    "decisions"?: any | any[];
}
    */


/*===================================================================
 * E X P O R T E D
 *=================================================================*/

export async function parseFlow(xml: string, renderAs: "plantuml" | "mermaid" = "mermaid", options: any = {}): Promise<{ flowMap: FlowMap, uml: string }> {
    try {
        const parser = new XMLParser();
        const flowObj = parser.parse(xml).Flow;
        const flowMap = await createFlowMap(flowObj);
        // console.log("flowMap", flowMap);
        if (Object.keys(flowMap).length === 0) {
            throw new Error("no-renderable-content-found");
        }

        switch (renderAs) {
            case 'mermaid':
                return {
                    flowMap: flowMap,
                    uml: await generateMermaidContent(flowMap, options)
                };
            case 'plantuml':
                return {
                    flowMap: flowMap,
                    uml: await generatePlantUMLContent(flowMap)
                };
            default:
                throw new Error("unknown-renderAs-" + renderAs);
        }
    } catch (error) {
        console.error("salesforce-flow-visualiser", error);
        throw (error);
    }
}



/*===================================================================
 * P R I V A T E
 *=================================================================*/
async function createFlowMap(flowObj: any): Promise<FlowMap> {
    const flowMap: FlowMap = {};
    for (const property in flowObj) {
        switch (property) {
            case 'constants':
            case 'description':
            case 'formulas':
            case 'label':
            case 'processType':
            case 'status':
            case 'textTemplates':
                flowMap[property] = flowObj[property];
                break;
            case 'start':
                flowMap[property] = flowObj[property];
                flowMap[property].type = property;
                flowMap[property].nextNode = flowObj[property].connector?.targetReference;
                flowMap[property].scheduledPaths = (!flowMap[property].scheduledPaths) ? [] : (flowMap[property].scheduledPaths.length) ? flowMap[property].scheduledPaths : [flowMap[property].scheduledPaths];
                break;
            default:
                // If only one entry (e.g one loop) then it will be an object, not an Array, so make it an Array of one
                if (!flowObj[property].length) {
                    flowObj[property] = [flowObj[property]]
                }
                // Loop through array and create an mapped entry for each
                for (const el of flowObj[property]) {
                    if (el.name) {
                        let nextNode;
                        let tmpRules;
                        switch (property) {
                            case 'decisions':
                                nextNode = (el.defaultConnector) ? el.defaultConnector.targetReference : "END";
                                tmpRules = (el.rules.length) ? el.rules : [el.rules];
                                el.rules2 = tmpRules.map((ruleEl: any) => {
                                    return {
                                        name: ruleEl.name,
                                        label: ruleEl.label,
                                        nextNode: ruleEl.connector,
                                        nextNodeLabel: el.defaultConnectorLabel,
                                    }
                                });
                                break;
                            case 'loops':
                                nextNode = (el.noMoreValuesConnector) ? el.noMoreValuesConnector.targetReference : "END";
                                break;
                            default:
                                if (el.connector) {
                                    nextNode = el.connector.targetReference;
                                }
                                break;
                        }

                        if ((<any>NODE_CONFIG)[property]) {
                            const mappedEl = {
                                name: el.name,
                                label: el.label,
                                type: property,
                                nextNode: nextNode,
                                faultPath: el.faultConnector?.targetReference,
                                nextNodeLabel: el.defaultConnectorLabel,
                                nextValueConnector: (el.nextValueConnector) ?
                                    el.nextValueConnector.targetReference : null,
                                rules: el.rules2,
                                elementSubtype: el.elementSubtype,
                                actionType: el.actionType
                            }
                            flowMap[el.name] = mappedEl;
                        } else if (property === 'variables') {
                            flowMap.variables = flowObj[property];
                        }
                    }
                }
                break;
        }

    }
    return (flowMap);
}

function getFlowType(flowMap: FlowMap): string {
    if (flowMap.processType === 'Flow') {
        return "Screen flow";
    }
    // Avoid crash if flowMap.start is not set
    else if (!flowMap.start) {
        return `Unknown (processType: ${flowMap.processType})`;
    }
    else {
        switch (flowMap.start.triggerType) {
            case "Scheduled":
                return "Scheduled flow;"
            case "RecordAfterSave":
                return "Record triggered flow: After Save (" + flowMap.start.object + ")";
            case "RecordBeforeSave":
                return "Record triggered flow: Before Save (" + flowMap.start.object + ")";
            case "PlatformEvent":
                return "PlatformEvent triggered flow (" + flowMap.start.object + ")";
            default:
                return "Autolanuched flow - No trigger";
        }
    }
}

/*===================================================================
 * M E R M A I D
 *=================================================================*/
async function generateMermaidContent(flowMap: FlowMap, options: any): Promise<string> {
    console.log("options", options)
    const title = `# ${flowMap['label']}

Type: **${getFlowType(flowMap)}**

Status: **${flowMap['status']}**

`;
    const variables = getVariablesMd(flowMap.variables) + "\n";
    const textTemplates = getTemplatesMd(flowMap.textTemplates || []) + "\n";
    const mdStart = "## Flow\n\n```mermaid\n";
    const nodeDefStr = await getNodeDefStr(flowMap) + "\n\n";
    const mdClasses = getMermaidClasses() + "\n\n";
    const mdBody = await getMermaidBody(flowMap) + "\n\n";
    const mdEnd = "```\n\n";
    const mdDiagram = "flowchart TB\n" + nodeDefStr + mdBody + mdClasses
    if (options.wrapInMarkdown === false) {
        return (mdDiagram);
    } else {
        return (title + mdStart + mdDiagram + mdEnd + variables + textTemplates);
    }
}

async function getMermaidBody(flowMap: FlowMap): Promise<string> {
    let bodyStr = "";
    for (const property in flowMap) {
        const node = flowMap[property];
        const type = node.type;
        const nextNode = (node.nextNode) ? node.nextNode : "END"
        const faultNode = (node.faultPath) ? node.faultPath : "END"
        let loopNextNode;
        switch (type) {
            case 'actionCalls':
            case 'assignments':
            case 'collectionProcessors':
            case 'customErrors':
            case 'recordCreates':
            case 'recordDeletes':
            case 'recordLookups':
            case 'recordUpdates':
            case 'screens':
                bodyStr += node.name + " --> " + nextNode + "\n";
                if (node.faultPath) {
                    bodyStr += node.name + " -. Fault .->" + faultNode + "\n";
                }
                break;
            case 'start':
                if (nextNode !== "END") {
                    // 'start' may not have a default path 
                    const defaultPathLabel = (node.scheduledPaths.length > 0) ? "|Run Immediately|" : "";
                    bodyStr += "START(( START )) --> " + defaultPathLabel + nextNode + "\n";
                }
                // scheduled paths
                for (const path of node.scheduledPaths) {
                    path.label = (path.label) ? path.label : 'Run Immediately';
                    bodyStr += "START(( START )) --> |" + path.label + "| " + path.connector.targetReference + "\n";
                    // bodyStr += "START(( START )) --> |" + (path.label) ?  path.label : 'Run Immediately' + "| " + path.connector.targetReference + "\n";
                }

                break;
            case 'decisions':
                // rules
                for (const rule of node.rules) {
                    if (rule.nextNode?.targetReference) {
                        bodyStr += node.name + " --> |" + rule.label + "| " + rule.nextNode.targetReference + "\n";
                    }
                }

                // default
                bodyStr += node.name + " --> |" + node.nextNodeLabel + "| " + nextNode + "\n";
                break;
            case 'loops':
                loopNextNode = node.nextValueConnector;
                bodyStr += node.name + " --> " + loopNextNode + "\n";
                bodyStr += node.name + " ---> " + node.nextNode + "\n";
                break;
            case 'subflows':
                bodyStr += node.name + " --> " + nextNode + "\n";
                break;
            default:
                // do nothing
                break;
        }
    }
    return (bodyStr);
}

async function getNodeDefStr(flowMap: FlowMap): Promise<string> {
    let nodeDefStr = "START(( START ))\n";
    for (const property in flowMap) {
        const type = flowMap[property].type;
        let label: string = ((<any>NODE_CONFIG)[type]) ? (<any>NODE_CONFIG)[type].label : "";
        let icon: string = ((<any>NODE_CONFIG)[type]) ? (<any>NODE_CONFIG)[type].mermaidIcon : null;
        let nodeCopy;
        let nodeText;
        let tooltipClassMermaid;
        if (type === 'actionCalls') {
            icon = ((<any>NODE_CONFIG)[type].mermaidIcon[flowMap[property].actionType]) ?
                (<any>NODE_CONFIG)[type].mermaidIcon[flowMap[property].actionType] :
                (<any>NODE_CONFIG)[type].mermaidIcon.submit;
        }
        else if (type === 'collectionProcessors') {
            icon = ((<any>NODE_CONFIG)[type].mermaidIcon[flowMap[property].elementSubtype]) ?
                (<any>NODE_CONFIG)[type].mermaidIcon[flowMap[property].elementSubtype] :
                (<any>NODE_CONFIG)[type].mermaidIcon.submit;

            label = ((<any>NODE_CONFIG)[type].label[flowMap[property].elementSubtype]) ?
                (<any>NODE_CONFIG)[type].label[flowMap[property].elementSubtype] :
                (<any>NODE_CONFIG)[type].label;
        }
        // Create Mermaid Lines
        if (['actionCalls', 'assignments', 'customErrors', 'collectionProcessors', 'decisions', 'loops', 'recordCreates', 'recordDeletes', 'recordLookups', 'recordUpdates', 'screens', 'subflows'].includes(type)) {
            nodeDefStr += property + (<any>NODE_CONFIG)[type].mermaidOpen + '"' + icon + " <em>" + label + "</em><br/>" + flowMap[property].label + '"' + (<any>NODE_CONFIG)[type].mermaidClose + ':::' + type + "\n"
            // Remove not relevant properties from node display
            nodeCopy = Object.assign({}, flowMap[property]);
            for (const nodeKey of Object.keys(nodeCopy)) {
                if (["locationX", "locationY", "targetReference"].includes(nodeKey)) {
                    delete nodeCopy[nodeKey]
                }
                else if (nodeCopy[nodeKey] === null || nodeCopy[nodeKey] === undefined) {
                    delete nodeCopy[nodeKey]
                }
            }
            nodeText = JSON.stringify(nodeCopy, null, 2);
            tooltipClassMermaid = `click ${property} "#" "${nodeText.replace(/"/gm, "").split("\n").join("<br/>")}"`;
            nodeDefStr += tooltipClassMermaid + "\n\n"
        }
    }
    return (nodeDefStr + "END(( END ))\n");
}

function getVariablesMd(vars: any[]): string {
    let vStr = "## Variables\n\n|Name|Datatype|Collection|Input|Output|objectType|\n|:-|:-:|:-:|:-:|:-:|:-|\n";
    if (!vars) vars = [];
    for (const v of vars) {
        vStr += "|" + v.name + "|" + v.dataType + "|" + v.isCollection + "|" + v.isInput + "|" + v.isOutput + "|" + ((v.objectType) ? v.objectType : "") + "\n";
    }
    return vStr;
}

function getTemplatesMd(textTemplates: any[]): string {
    if (textTemplates.length === 0) {
        return "";
    }
    let vStr = "## Text Templates\n\n|Name|Text|\n|:-|:-|\n";
    for (const v of textTemplates) {
        vStr += "|" + v.name + "|" + v.text + "|\n";
    }
    return vStr;
}

function getMermaidClasses(): string {
    let classStr = "";
    for (const property in NODE_CONFIG) {
        classStr += "classDef " + property + " fill:" + (<any>NODE_CONFIG)[property].background + ",color:" + (<any>NODE_CONFIG)[property].color + "\n";
    }
    return classStr;
}


/*===================================================================
 * P L A N T U M L
 *=================================================================*/
async function generatePlantUMLContent(flowMap: FlowMap): Promise<string> {
    const START_STR = "' THIS IS A TEMPORARY FILE\n@startuml " + flowMap['label'] + "\nstart\n";
    const TITLE_STR = "title " + flowMap['label'] + "\n";
    let nextNode = flowMap[flowMap['start'].connector.targetReference];
    let end = false;
    let bodyStr = '';
    while (!end) {
        bodyStr += getPlantUMLNodeStr(nextNode, flowMap);
        if (!nextNode.nextNode || nextNode.nextNode === "END") {
            end = true;
        } else {
            nextNode = flowMap[nextNode.nextNode]
        }
    }
    const END_STR = "stop\n@enduml";
    return (START_STR + TITLE_STR + bodyStr + END_STR);
}


function getPlantUMLNodeStr(node: any, flowMap: FlowMap) {
    let nextNode;
    let end;
    let loopName;
    let bodyStr;
    switch (node.type) {
        case 'decisions':
            return processDecisions(node, flowMap);
        case 'loops':
            loopName = node.name;
            nextNode = flowMap[node.nextValueConnector];
            bodyStr = "floating note left: " + loopName + "\n repeat :<size:30><&loop-circular></size>;\n";
            end = false;
            while (!end) {
                bodyStr += getPlantUMLNodeStr(nextNode, flowMap);
                if (!nextNode.nextNode || nextNode.nextNode === loopName) {
                    end = true;
                } else {
                    nextNode = flowMap[nextNode.nextNode]
                }
            }
            return bodyStr + "repeat while (more data?)\n";
        default:
            if ((<any>NODE_CONFIG)[node.type]) {
                const cnf = (<any>NODE_CONFIG)[node.type];
                return cnf.background + ":<color:" + cnf.color + "><size:30>" + cnf.icon + "</size>;\nfloating note left\n**" + node.label + "**\n" + cnf.label + "\nend note\n";
            } else {
                return "' " + node.name + " NOT IMPLEMENTED \n";
            }
    }
}

function processDecisions(node: any, flowMap: FlowMap) {
    const START_STR = "switch (" + node.label + ")\n"
    const DEFATAULT_STR = "\ncase (" + node.nextNodeLabel + ")\n";

    let nextNode;
    let end;
    let rulesStr = "";
    for (const rule of node.rules) {
        rulesStr += "case (" + rule.label + ")\n";

        nextNode = nextNode = flowMap[rule.nextNode.targetReference];
        end = false;
        while (!end) {
            rulesStr += getPlantUMLNodeStr(nextNode, flowMap);
            if (!nextNode.nextNode || nextNode.nextNode === node.nextNode) {
                end = true;
            } else {
                nextNode = flowMap[nextNode.nextNode]
            }
        }
    }
    const END_STR = "endswitch\n";
    return START_STR + rulesStr + DEFATAULT_STR + END_STR;
}
