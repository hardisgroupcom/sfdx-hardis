import * as yaml from 'js-yaml';

export function simplifyNode(flowNode: any): any {
  const nodeCopy = Object.assign({}, flowNode);
  for (const nodeKey of Object.keys(nodeCopy)) {
    if (["locationX", "locationY"].includes(nodeKey)) {
      delete nodeCopy[nodeKey]
    }
    else if (nodeCopy[nodeKey] === null || nodeCopy[nodeKey] === undefined) {
      delete nodeCopy[nodeKey]
    }
  }
  return nodeCopy;
}

export function flowNodeToMarkdown(flowNodeIn: any): string {
  const flowNode = Object.assign({}, flowNodeIn);
  delete flowNode["name"];
  // Simple email action
  if (flowNode.actionType === "emailSimple") {
    const inputParameters = flowNode.inputParameters;
    for (const inputParam of inputParameters) {
      const inputParamName = inputParam.name;
      const inputParamValue = inputParam.value.elementReference;
      flowNode[inputParamName] = stringifyValue(inputParamValue);
    }
    delete flowNode.inputParameters
    return buildGenericMarkdownTable(flowNode, ["allFields"]);
  }
  // Assignment
  else if (flowNode.type === "assignment") {
    const assignmentItems = flowNode.assignmentItems;
    const assignmentItemsValues = assignmentItems.map((item: any) => {
      return {
        assignToReference: item.assignToReference,
        operator: item.operator,
        value: item.value.elementReference
      }
    });
    delete flowNode.assignmentItems;
    const genericTable = buildGenericMarkdownTable(flowNode, ["allFields"]);
    const assignmentsTable = buildCustomMarkdownTable(assignmentItemsValues, ["assignToReference", "operator", "value"]);
    return genericTable + assignmentsTable;
  }
  else {
    return buildGenericMarkdownTable(flowNode, ["allFields"]);
  }
}

export function buildGenericMarkdownTable(item: any, fields: string[]): string {
  if (fields[0] === "allFields") {
    fields = Object.keys(item);
    // Put label first
    const labelPos = fields.indexOf("label");
    if (labelPos !== -1) {
      fields.splice(labelPos, 1);
      fields.unshift("label");
    }
  }
  let table = `| Field | Value |\n| :--- | :--- |\n`;
  for (const field of fields) {
    if (item[field] !== undefined) {
      table += `| ${prettifyFieldName(field)} | ${stringifyValue(item[field])} |\n`
    }
  }
  return table + "\n";
}

export function buildCustomMarkdownTable(items: any, fields: string[]): string {
  let table = "| " + fields.map(field => prettifyFieldName(field)).join(" | ") + " |\n";
  table += "| " + fields.map(() => " :-- ").join(" | ") + " |\n";
  for (const item of items) {
    const fieldValues = fields.map(field => stringifyValue(item[field]));
    table += "| " + fieldValues.join(" | ") + " |\n";
  }
  return table + "\n";
}

export function stringifyValue(valueIn: any): string {
  const valueType = typeof valueIn;
  const valueStringified = valueType === "string" ?
    valueIn.split("\n").join("<br/>") :
    valueType === "object" ?
      yaml.dump(valueIn).replace(/"/gm, "").replace(/^(\s+)/gm, match => '&nbsp;'.repeat(match.length)).split("\n").join("<br/>") :
      valueIn;
  return valueStringified;
}

export function prettifyFieldName(field: string): string {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase());
}