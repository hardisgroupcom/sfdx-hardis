import { NODE_CONFIG } from "./renderConfig.js";

import { XMLParser } from "fast-xml-parser";
import { CONSTANTS } from "../../../config/index.js";
import { getCurrentGitBranch } from "../index.js";
import farmhash from 'farmhash';
import { buildCustomMarkdownTable, buildGenericMarkdownTable, flowNodeToMarkdown, handleFilterItems, handleInputParameters, handleprocessMetadataValues, handleSchedule, handleScheduledPaths, mdEndSection, simplifyNode, stringifyValue } from "./nodeFormatUtils.js";

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

const FLOW_NODE_TYPES = [
    'actionCalls',
    'assignments',
    'customErrors',
    'collectionProcessors',
    'decisions',
    'loops',
    'recordCreates',
    'recordDeletes',
    'recordLookups',
    'recordUpdates',
    'screens',
    'subflows'
];

export async function parseFlow(xml: string, renderAs: "mermaid" | "plantuml" = "mermaid", options: any = {}): Promise<{ flowMap: FlowMap, uml: string }> {
    try {
        const parser = new XMLParser();
        const flowObj = parser.parse(xml).Flow;
        const flowMap = await createFlowMap(flowObj);
        if (Object.keys(flowMap).length === 0) {
            throw new Error("no-renderable-content-found");
        }
        if (renderAs === "mermaid") {
            return {
                flowMap: flowMap,
                uml: await generateMermaidContent(flowMap, flowObj, options)
            };
        }
        throw new Error("unknown-renderAs-" + renderAs);
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
        // Common first descriptive elements
        if (['description', 'environments', 'formulas', 'interviewLabel', 'label', 'processType', 'status', 'textTemplates'].includes(property)) {
            flowMap[property] = flowObj[property];
        }
        // Start element
        else if (property === 'start') {
            flowMap[property] = flowObj[property];
            flowMap[property].type = property;
            flowMap[property].nextNode = flowObj[property].connector?.targetReference;
            flowMap[property].scheduledPaths = (!flowMap[property].scheduledPaths) ? [] : (flowMap[property].scheduledPaths.length) ? flowMap[property].scheduledPaths : [flowMap[property].scheduledPaths];
            flowMap[property].flowNodeDescription = flowObj[property]
        }
        else {
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
                            actionType: el.actionType,
                            flowNodeDescription: el
                        }
                        flowMap[el.name] = mappedEl;
                        flowMap[el.name].flowNodeDescription.type = property;
                    } else if (property === 'variables') {
                        flowMap.variables = flowObj[property];
                    } else if (property === 'constants') {
                        flowMap.constants = flowObj[property];
                    }
                }
            }
        }
    }
    return (flowMap);
}

function getFlowType(flowMap: FlowMap): string {
    if (flowMap.processType === 'Flow') {
        return "Screen Flow";
    }
    // Avoid crash if flowMap.start is not set
    else if (!flowMap.start) {
        return flowMap.processType || "ERROR: no processType";
    }
    else {
        switch (flowMap.start.triggerType) {
            case "Scheduled":
                return "Scheduled Flow"
            case "RecordAfterSave":
                return "Record Triggered Flow: After Save (" + flowMap.start.object + ")";
            case "RecordBeforeSave":
                return "Record Triggered Flow: Before Save (" + flowMap.start.object + ")";
            case "PlatformEvent":
                return "Platform Event Triggered flow (" + flowMap.start.object + ")";
            default:
                return flowMap.processType || "ERROR: no processType";
        }
    }
}

/*===================================================================
 * M E R M A I D
 *=================================================================*/
async function generateMermaidContent(flowMap: FlowMap, flowObj: any, options: any): Promise<string> {
    // console.log("options", options)
    const flowType = getFlowType(flowMap);
    const title = `# ${flowMap['label']}\n\n`;
    const { generalInfoMd, startFingerPrint, startNodeLabel, startElementReference } = getGeneralInfoMd(flowObj, flowMap);
    const variables = getVariablesMd(flowMap.variables || []);
    const constants = getConstantsMd(flowMap.constants || []);
    const formulas = getFormulasMd(flowMap.formulas || []);
    const textTemplates = getTemplatesMd(flowMap.textTemplates || []);
    const mdStart = "## Flow Diagram\n\n```mermaid\n";
    const { nodeDefStr, nodeDetailMd } = await getNodeDefStr(flowMap, flowType, startFingerPrint, startNodeLabel, startElementReference, options);
    const mdClasses = getMermaidClasses() + "\n\n";
    const mdBody = await getMermaidBody(flowMap) + "\n\n";
    const mdEnd = "```\n\n";
    const currentBranch = await getCurrentGitBranch();
    const footer = `\n\n___\n\n_Documentation generated from branch ${currentBranch} by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}), featuring [salesforce-flow-visualiser](https://github.com/toddhalfpenny/salesforce-flow-visualiser)_`;
    const mdDiagram =
        "%% If you read this, your Markdown visualizer does not handle MermaidJS syntax. If you are using sfdx-hardis, try to define env variable `MERMAID_MODES=cli,docker` ,then run again the command to regenerate markdown with SVG images.\n" +
        "flowchart TB\n" +
        nodeDefStr +
        mdBody +
        mdClasses
    if (options.wrapInMarkdown === false) {
        return (mdDiagram);
    } else {
        return (title + mdStart + mdDiagram + mdEnd + generalInfoMd + variables + formulas + constants + textTemplates + nodeDetailMd + footer);
    }
}

async function getMermaidBody(flowMap: FlowMap): Promise<string> {
    let bodyStr = "";
    const endNodeIds: string[] = [];
    for (const property in flowMap) {
        const node = flowMap[property];
        const type = node.type;
        let nextNode = node.nextNode ? node.nextNode : "END"
        if (nextNode === "END") {
            nextNode = "END_" + node.name;
        }
        let faultNode = node.faultPath ? node.faultPath : "END"
        if (faultNode === "END") {
            faultNode = "END_" + node.name;
        }
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
                manageAddEndNode(nextNode, endNodeIds);
                if (node.faultPath) {
                    bodyStr += node.name + " -. Fault .->" + faultNode + "\n";
                    manageAddEndNode(faultNode, endNodeIds);
                }
                break;
            case 'start':
                if (!nextNode.startsWith("END")) {
                    // 'start' may not have a default path 
                    const defaultPathLabel = (node.scheduledPaths.length > 0) ? '|"Run Immediately"|' : "";
                    bodyStr += "START --> " + defaultPathLabel + nextNode + "\n";
                }
                // scheduled paths
                for (const path of node.scheduledPaths) {
                    path.label = (path.label) ? path.label : 'Run Immediately';
                    bodyStr += 'START --> |"' + path.label + '"| ' + path.connector.targetReference + "\n";
                    // bodyStr += "START(( START )) --> |" + (path.label) ?  path.label : 'Run Immediately' + "| " + path.connector.targetReference + "\n";
                }

                break;
            case 'decisions':
                // rules
                for (const rule of node.rules) {
                    if (rule.nextNode?.targetReference) {
                        bodyStr += node.name + ' --> |"' + rule.label + '"| ' + rule.nextNode.targetReference + "\n";
                    }
                }

                // default
                bodyStr += node.name + ' --> |"' + node.nextNodeLabel + '"| ' + nextNode + "\n";
                manageAddEndNode(nextNode, endNodeIds);
                break;
            case 'loops':
                loopNextNode = node.nextValueConnector;
                bodyStr += node.name + ' --> |"For Each"|' + loopNextNode + "\n";
                bodyStr += node.name + ' ---> |"After Last"|' + node.nextNode + "\n";
                break;
            case 'subflows':
                bodyStr += node.name + " --> " + nextNode + "\n";
                manageAddEndNode(nextNode, endNodeIds);
        }
    }
    for (const endNodeId of [...new Set(endNodeIds)]) {
        bodyStr += `${endNodeId}(( END )):::endClass\n`;
    }
    return (bodyStr);
}

function manageAddEndNode(nextOrFaultNode: string, endNodeIds: string[]) {
    if (nextOrFaultNode.startsWith("END")) {
        endNodeIds.push(nextOrFaultNode);
    }
}

async function getNodeDefStr(flowMap: FlowMap, flowType: string, startFingerPrint: number, startNodeLabel: string, startElementReference: string, options: any): Promise<any> {
    let nodeDetailMd = "## Flow Nodes Details\n\n"
    if (options?.collapsedDetails) {
        nodeDetailMd += "<details><summary>NODES CONTENT (expand to view)</summary>\n\n"
    }
    let nodeDefStr = "";
    if (!["InvocableProcess", "Workflow"].includes(flowType) || (startNodeLabel !== 'START')) {
        nodeDefStr += `START(["${startNodeLabel}"]):::startClass\n`
        nodeDefStr += `click START "#general-information" "${startFingerPrint}"\n\n`;
        if (startElementReference) {
            nodeDefStr += `START --> ${startElementReference}\n`
        }
    }
    const allproperties = Object.keys(flowMap);
    for (const property of allproperties) {
        const type = flowMap?.[property]?.type;
        let label: string = ((<any>NODE_CONFIG)[type]) ? (<any>NODE_CONFIG)[type].label : "";
        let icon: string = ((<any>NODE_CONFIG)[type]) ? (<any>NODE_CONFIG)[type].mermaidIcon : null;
        let nodeSimplified;
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
        if (FLOW_NODE_TYPES.includes(type)) {
            // Mermaid node
            nodeDefStr += property + (<any>NODE_CONFIG)[type].mermaidOpen + '"' + icon + " <em>" + label + "</em><br/>" + flowMap[property].label + '"' + (<any>NODE_CONFIG)[type].mermaidClose + ':::' + type + "\n"
            // Remove not relevant properties from node display
            nodeSimplified = simplifyNode(flowMap[property]?.flowNodeDescription || flowMap[property]);
            // Mermaid compare node
            tooltipClassMermaid = `click ${property} "#${property.toLowerCase()}" "${farmhash.fingerprint32(JSON.stringify(nodeSimplified))}"`;
            nodeDefStr += tooltipClassMermaid + "\n\n"
            // Markdown details
            nodeDetailMd += `### ${property}\n\n` + flowNodeToMarkdown(nodeSimplified, allproperties);
        }
    }
    if (options?.collapsedDetails) {
        nodeDetailMd += "</details>\n\n"
    }
    return {
        nodeDefStr: nodeDefStr,
        nodeDetailMd: nodeDetailMd + "\n\n"
    };
}

function getGeneralInfoMd(flowObj: any, flowMap: FlowMap) {
    let flowObjCopy = Object.assign({}, flowObj);
    // Remove sections that are somewhere else
    for (const nodeKey of [...["constants", "formulas", "variables"], ...FLOW_NODE_TYPES]) {
        delete flowObjCopy[nodeKey];
    }
    const metadataValue = handleprocessMetadataValues(flowObjCopy, Object.keys(flowMap));
    // Remove nodes that will be processed after
    for (const nodeKey of Object.keys(flowObjCopy)) {
        if (typeof flowObjCopy?.[nodeKey] === "object" && flowObjCopy?.[nodeKey]?.name !== 'null') {
            delete flowObjCopy[nodeKey];
        }
    }
    const startFingerPrint = farmhash.fingerprint32(JSON.stringify(flowObjCopy));
    handleInputParameters(flowObjCopy, Object.keys(flowMap));
    let startNodeLabel = "START";
    let detailTablesMd = ""
    let startElementReference = ""
    if (flowObj.start) {
        const startObjCopy = simplifyNode(Object.assign({}, flowObj.start.flowNodeDescription || flowObj.start));
        delete startObjCopy.flowNodeDescription;
        flowObjCopy = Object.assign({}, startObjCopy, flowObjCopy);
        delete flowObjCopy.start
        delete flowObjCopy.type
        detailTablesMd += handleSchedule(flowObjCopy, Object.keys(flowMap));
        detailTablesMd += handleScheduledPaths(flowObjCopy, Object.keys(flowMap));
        detailTablesMd += handleFilterItems(flowObjCopy, Object.keys(flowMap));
        if (flowObjCopy.processType === "Flow") {
            startNodeLabel = "START<br/>" + "<b>Screen Flow</b>"
        }
        else if (flowObjCopy.processType === "AutoLaunchedFlow") {
            startNodeLabel = "START<br/>" + "<b>AutoLaunched Flow</b></br>" +
                (flowObjCopy.triggerType ? "Type: <b>" + stringifyValue(flowObjCopy.triggerType, "triggerType", Object.keys(flowObjCopy)) + "</b><br/>" : '')
        }
        else {
            startNodeLabel = "START<br/>" +
                (flowObjCopy.object ? "<b>" + stringifyValue(flowObjCopy.object, "object", Object.keys(flowObjCopy)) + "</b><br/>" : '') +
                (flowObjCopy.triggerType ? "Type: <b>" + stringifyValue(flowObjCopy.triggerType, "triggerType", Object.keys(flowObjCopy)) + "</b><br/>" : '') +
                (flowObjCopy.recordTriggerType ? "On: <b>" + stringifyValue(flowObjCopy.recordTriggerType, "recordTriggerType", Object.keys(flowObjCopy)) + "</b><br/>" : '');
        }
    }
    else if (metadataValue && metadataValue.TriggerType && metadataValue.ObjectType) {
        startNodeLabel = "START<br/>" + "<b>" + metadataValue.ObjectType + "</b></br>" +
            (metadataValue.TriggerType ? "Type: <b>" + stringifyValue(metadataValue.TriggerType, "triggerType", Object.keys(flowObjCopy)) + "</b><br/>" : '')
        startElementReference = flowObj.startElementReference;
    }
    const generalInfoMd = mdEndSection(buildGenericMarkdownTable(flowObjCopy, ["allFields"], "## General Information", Object.keys(flowMap)) + detailTablesMd);
    if (startNodeLabel.endsWith("<br/>")) {
        startNodeLabel = startNodeLabel.slice(0, -5);
    }
    return {
        generalInfoMd: generalInfoMd,
        startNodeLabel: startNodeLabel,
        startFingerPrint: startFingerPrint,
        startElementReference: startElementReference
    }
}

function getVariablesMd(vars: any[]): string {
    if (vars && vars.length > 0) {
        return mdEndSection(buildCustomMarkdownTable(vars, ["name", "dataType", "isCollection", "isInput", "isOutput", "objectType"], "## Variables", []));
    }
    return "";
}

function getConstantsMd(constants: any[]): string {
    if (constants && constants.length > 0) {
        return mdEndSection(buildCustomMarkdownTable(constants, ["name", "dataType", "value"], "## Constants", []));
    }
    return "";
}

function getFormulasMd(formulas: any[]): string {
    if (formulas && formulas.length > 0) {
        return mdEndSection(buildCustomMarkdownTable(formulas, ["name", "dataType", "expression"], "## Formulas", []));
    }
    return "";
}

function getTemplatesMd(textTemplates: any[]): string {
    if (textTemplates && textTemplates.length > 0) {
        return mdEndSection(buildCustomMarkdownTable(textTemplates, ["name", "text"], "## Text Templates", []));
    }
    return "";
}

function getMermaidClasses(): string {
    let classStr = "";
    for (const property in NODE_CONFIG) {
        classStr += "classDef " + property + " fill:" + (<any>NODE_CONFIG)[property].background + ",color:" + (<any>NODE_CONFIG)[property].color + ",max-height:100px\n";
    }
    return classStr;
}
