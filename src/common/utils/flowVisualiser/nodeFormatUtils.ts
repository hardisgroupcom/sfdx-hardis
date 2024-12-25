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

export function flowNodeToMarkdown(flowNodeIn: any, allProperties: string[]): string {
  const flowNode = Object.assign({}, flowNodeIn);
  delete flowNode["name"];
  // Simple email action
  if (flowNode.actionType === "emailSimple") {
    const inputParameters = flowNode.inputParameters;
    for (const inputParam of inputParameters) {
      const inputParamName = inputParam.name;
      const inputParamValue = inputParam.value.elementReference;
      flowNode[inputParamName] = stringifyValue(inputParamValue, allProperties);
    }
    delete flowNode.inputParameters
    return buildGenericMarkdownTable(flowNode, ["allFields"], "", allProperties);
  }
  // Assignment
  else if (flowNode.type === "assignments") {
    const assignmentItems = Array.isArray(flowNode.assignmentItems) ? flowNode.assignmentItems : typeof flowNode.assignmentItems === "object" ? [flowNode.assignmentItems] : [];
    const assignmentItemsValues = assignmentItems.map((item: any) => {
      const value = item?.value?.elementReference || stringifyValue(item.value, allProperties);
      return {
        assignToReference: item.assignToReference,
        operator: stringifyOperator(item.operator),
        value: stringifyValue(value, allProperties)
      }
    });
    delete flowNode.assignmentItems;
    let table = buildGenericMarkdownTable(flowNode, ["allFields"], "", allProperties);
    table += buildCustomMarkdownTable(assignmentItemsValues, ["assignToReference", "operator", "value"], "Assignments", allProperties);
    return table;
  }
  // Decisions
  else if (flowNode.type === "decisions") {
    const rules = Array.isArray(flowNode.rules) ? flowNode.rules : typeof flowNode.rules === "object" ? [flowNode.rules] : [];
    delete flowNode.rules;
    delete flowNode.rules2;
    let table = buildGenericMarkdownTable(flowNode, ["allFields"], "", allProperties);
    for (const rule of rules) {
      const ruleNode = Object.assign({}, rule);
      delete ruleNode.name;
      delete ruleNode.label;
      const conditions = Array.isArray(ruleNode.conditions) ? rule.conditions : typeof ruleNode.conditions === "object" ? [ruleNode.conditions] : [];
      const conditionsValues = conditions.map((item: any) => {
        return {
          leftValueReference: item.leftValueReference,
          operator: stringifyOperator(item.operator),
          rightValue: stringifyValue(item.rightValue, allProperties)
        }
      });
      delete ruleNode.conditions;
      table += buildGenericMarkdownTable(ruleNode, ["allFields"], `Rule ${rule.name} (${rule.label})`, allProperties);
      table += buildCustomMarkdownTable(conditionsValues, ["leftValueReference", "operator", "rightValue"], "", allProperties);
    }
    return table;
  }
  // Record Lookups
  else if (["recordLookups", "recordDeletes", "recordUpdates"].includes(flowNode.type)) {
    // Filters
    const filterItems = Array.isArray(flowNode.filters) ? flowNode.filters : typeof flowNode.filters === "object" ? [flowNode.filters] : [];
    const filterItemsValues = filterItems.map((item: any) => {
      return {
        field: item.field,
        operator: stringifyOperator(item.operator),
        value: stringifyValue(item.value, allProperties)
      }
    });
    delete flowNode.filters;
    // Input Assignments
    const inputAssignmentsItems = Array.isArray(flowNode.inputAssignments) ? flowNode.inputAssignments : typeof flowNode.inputAssignments === "object" ? [flowNode.inputAssignments] : [];
    const inputAssignmentsItemsValues = inputAssignmentsItems.map((item: any) => {
      return {
        field: item.field,
        value: stringifyValue(item.value, allProperties)
      }
    });
    delete flowNode.inputAssignments;
    // Result
    let table = buildGenericMarkdownTable(flowNode, ["allFields"], "", allProperties);
    if (filterItemsValues.length > 0) {
      table += buildCustomMarkdownTable(filterItemsValues, ["field", "operator", "value"], "Filters", allProperties);
    }
    if (inputAssignmentsItemsValues.length > 0) {
      table += buildCustomMarkdownTable(inputAssignmentsItemsValues, ["field", "value"], "Input Assignments", allProperties);
    }
    return table;
  }
  else {
    return buildGenericMarkdownTable(flowNode, ["allFields"], "", allProperties);
  }
}

export function buildGenericMarkdownTable(item: any, fields: string[], title: string = "", allProperties: string[]): string {
  if (fields[0] === "allFields") {
    fields = Object.keys(item);
    // Put label second
    const labelPos = fields.indexOf("label");
    if (labelPos !== -1) {
      fields.splice(labelPos, 1);
      fields.unshift("label");
    }
    // Put type first
    const typePos = fields.indexOf("type");
    if (typePos !== -1) {
      fields.splice(typePos, 1);
      fields.unshift("type");
    }

  }
  let table = title ? `#### ${title}\n\n` : ''
  table += `|<!-- -->|<!-- -->|\n|:---|:---|\n`;
  for (const field of fields) {
    if (item[field] !== undefined) {
      table += `|${prettifyFieldName(field)}|${stringifyValue(item[field], allProperties)}|\n`
    }
  }
  return table + "\n\n";
}

export function buildCustomMarkdownTable(items: any, fields: string[], title: string = "", allProperties: string[]): string {
  let table = title ? `#### ${title}\n\n` : ''
  table += "|" + fields.map(field => prettifyFieldName(field)).join("|") + "|\n";
  table += "|" + fields.map(field => ["operator"].includes(field) ? ":--:" : ":-- ").join("|") + " |\n";
  for (const item of items) {
    const fieldValues = fields.map(field => stringifyValue(item[field], allProperties));
    table += "|" + fieldValues.join("|") + "|\n";
  }
  return table + "\n\n";
}

export function stringifyOperator(operatorIn): string {
  return operatorIn == "Assign" ? "=" :
    operatorIn == "EqualTo" ? "==" :
      operatorIn == "NotEqualTo" ? "!=" :
        operatorIn
}

export function stringifyValue(valueIn: any, allProperties: string[]): string {
  const valueType = typeof valueIn;
  // String
  let valueStringified = valueType === "string" ?
    valueIn.split("\n").join("<br/>") :
    // String value
    (valueType === "object" && valueIn.stringValue && Object.keys(valueIn).length === 1) ?
      valueIn.stringValue :
      // Target reference
      (valueType === "object" && valueIn.targetReference && Object.keys(valueIn).length === 1) ?
        valueIn.targetReference :
        // Element reference
        (valueType === "object" && valueIn.elementReference && Object.keys(valueIn).length === 1) ?
          valueIn.elementReference :
          // Default YAML for array & object
          (Array.isArray(valueIn) || valueType === "object") ?
            yaml.dump(valueIn).replace(/"/gm, "").replace(/^(\s+)/gm, match => '&nbsp;'.repeat(match.length)).split("\n").join("<br/>") :
            // Default
            valueIn;
  if (allProperties.includes(valueStringified)) {
    valueStringified = `[${valueStringified}](#${valueStringified.toLowerCase()})`
  }
  return valueStringified;
}

export function prettifyFieldName(field: string): string {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase());
}