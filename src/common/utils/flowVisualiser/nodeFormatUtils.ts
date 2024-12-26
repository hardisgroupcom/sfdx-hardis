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
  const additionalTables: any[] = [];

  // Properties that can be found on multiple flow node types
  handleprocessMetadataValues(flowNode, allProperties);
  handleInputParameters(flowNode, allProperties);
  const conditionsTable = handleConditions(flowNode, allProperties);
  additionalTables.push(conditionsTable);
  const inputAssignmentsTable = handleInputAssignments(flowNode, allProperties);
  additionalTables.push(inputAssignmentsTable);
  const assignmentItemsTable = handleAssignmentItems(flowNode, allProperties);
  additionalTables.push(assignmentItemsTable);
  const filterItemsTable = handleFilterItems(flowNode, allProperties);
  additionalTables.push(filterItemsTable);

  // Special case of decisions
  if (flowNode.type === "decisions") {
    const rules = Array.isArray(flowNode.rules) ? flowNode.rules : typeof flowNode.rules === "object" ? [flowNode.rules] : [];
    delete flowNode.rules;
    delete flowNode.rules2;
    for (const rule of rules) {
      const ruleNode = Object.assign({}, rule);
      delete ruleNode.name;
      delete ruleNode.label;
      const ruleConditionsTable = handleConditions(ruleNode, allProperties);
      const ruleTable = buildGenericMarkdownTable(ruleNode, ["allFields"], `#### Rule ${rule.name} (${rule.label})`, allProperties);
      additionalTables.push(...[ruleTable, mdEndSection(ruleConditionsTable)])
    }
  }
  else if (flowNode.type === "screens") {
    handleFields(flowNode, allProperties, "", additionalTables);
  }
  // Build final markdown for Node
  let table = buildGenericMarkdownTable(flowNode, ["allFields"], "", allProperties);
  for (const additionalTable of additionalTables) {
    if (additionalTable !== "") {
      table += additionalTable + "\n\n";
    }
  }
  return mdEndSection(table);
}

function handleFields(flowNode: any, allProperties: string[], parentField: string = "", additionalTables: any[]) {
  const fields = Array.isArray(flowNode.fields) ? flowNode.fields : typeof flowNode.fields === "object" ? [flowNode.fields] : [];
  delete flowNode.fields;
  for (const field of fields) {
    const fieldNode = Object.assign({}, field);
    const fieldName = "" + (field.name || field.objectFieldReference);
    delete fieldNode.name;
    if (parentField) {
      fieldNode.parentField = parentField;
      allProperties.push(parentField);
    }
    handleInputParameters(fieldNode, allProperties);
    const fieldsBefore = Array.isArray(fieldNode.fields) ? fieldNode.fields : typeof fieldNode.fields === "object" ? [fieldNode.fields] : [];
    delete fieldNode.fields;
    const fieldTable = buildGenericMarkdownTable(fieldNode, ["allFields"], `#### ${fieldName}`, allProperties);
    // Handle recursive loop
    if (fieldsBefore) {
      fieldNode.name = fieldName;
      fieldNode.fields = fieldsBefore;
      handleFields(fieldNode, allProperties, fieldName, additionalTables);
      additionalTables.push(...[mdEndSection(fieldTable)]);
    }
  }
}

function handleConditions(ruleNode: any, allProperties: string[]) {
  const conditions = Array.isArray(ruleNode.conditions) ? ruleNode.conditions : typeof ruleNode.conditions === "object" ? [ruleNode.conditions] : [];
  if (conditions.length === 0) {
    return ""
  }
  const conditionsValues = conditions.map((item: any) => {
    return {
      leftValueReference: item.leftValueReference,
      operator: stringifyOperator(item.operator),
      rightValue: stringifyValue(item.rightValue, "", allProperties)
    };
  });
  delete ruleNode.conditions;
  return buildCustomMarkdownTable(conditionsValues, ["leftValueReference", "operator", "rightValue"], "", allProperties);
}

function handleInputAssignments(flowNode: any, allProperties: string[]): string {
  const inputAssignmentsItems = Array.isArray(flowNode.inputAssignments) ? flowNode.inputAssignments : typeof flowNode.inputAssignments === "object" ? [flowNode.inputAssignments] : [];
  if (inputAssignmentsItems.length === 0) {
    return ""
  }
  const inputAssignmentsItemsValues = inputAssignmentsItems.map((item: any) => {
    return {
      field: item.field,
      value: stringifyValue(item.value, item.field, allProperties)
    };
  });
  delete flowNode.inputAssignments;
  return buildCustomMarkdownTable(inputAssignmentsItemsValues, ["field", "value"], "#### Input Assignments", allProperties);
}

function handleFilterItems(flowNode: any, allProperties: string[]): string {
  const filterItems = Array.isArray(flowNode.filters) ? flowNode.filters : typeof flowNode.filters === "object" ? [flowNode.filters] : [];
  if (filterItems.length === 0) {
    return ""
  }
  const filterItemsValues = filterItems.map((item: any) => {
    return {
      field: item.field,
      operator: stringifyOperator(item.operator),
      value: stringifyValue(item.value, item.field, allProperties)
    };
  });
  delete flowNode.filters;
  return buildCustomMarkdownTable(filterItemsValues, ["field", "operator", "value"], "#### Filters", allProperties);
}

function handleAssignmentItems(flowNode: any, allProperties: string[]) {
  const assignmentItems = Array.isArray(flowNode.assignmentItems) ? flowNode.assignmentItems : typeof flowNode.assignmentItems === "object" ? [flowNode.assignmentItems] : [];
  if (assignmentItems.length === 0) {
    return "";
  }
  const assignmentItemsValues = assignmentItems.map((item: any) => {
    const value = item?.value?.elementReference || stringifyValue(item.value, "", allProperties);
    return {
      assignToReference: item.assignToReference,
      operator: stringifyOperator(item.operator),
      value: stringifyValue(value, "", allProperties)
    };
  });
  delete flowNode.assignmentItems;
  return buildCustomMarkdownTable(assignmentItemsValues, ["assignToReference", "operator", "value"], "#### Assignments", allProperties);
}

export function handleInputParameters(flowNode: any, allProperties: string[]) {
  const inputParameters = Array.isArray(flowNode.inputParameters) ? flowNode.inputParameters : typeof flowNode.inputParameters === "object" ? [flowNode.inputParameters] : [];
  for (const inputParam of inputParameters) {
    const inputParamName = `${inputParam.name} (input)`;
    flowNode[inputParamName] = stringifyValue(inputParam.value, inputParam.name, allProperties);
  }
  delete flowNode.inputParameters;
}

export function handleprocessMetadataValues(flowNode: any, allProperties: string[]) {
  const processMetadataValues = Array.isArray(flowNode.processMetadataValues) ? flowNode.processMetadataValues : typeof flowNode.processMetadataValues === "object" ? [flowNode.processMetadataValues] : [];
  for (const processMetadataValue of processMetadataValues) {
    const inputParamName = `${processMetadataValue.name} (PM)`;
    flowNode[inputParamName] = stringifyValue(processMetadataValue.value, processMetadataValue.name, allProperties);
  }
  delete flowNode.processMetadataValues;
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
  let table = title ? `${title}\n\n` : ''
  table += `|<!-- -->|<!-- -->|\n|:---|:---|\n`;
  for (const field of fields) {
    if (item[field] !== undefined) {
      table += `|${prettifyFieldName(field)}|${stringifyValue(item[field], field, allProperties)}|\n`
    }
  }
  return table + "\n\n";
}

export function buildCustomMarkdownTable(items: any, fields: string[], title: string = "", allProperties: string[]): string {
  let table = title ? `${title}\n\n` : ''
  table += "|" + fields.map(field => prettifyFieldName(field)).join("|") + "|\n";
  table += "|" + fields.map(field => ["operator"].includes(field) ? ":--:" : ":-- ").join("|") + " |\n";
  for (const item of items) {
    const fieldValues = fields.map(field => stringifyValue(item[field], field, allProperties));
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

export function stringifyValue(valueIn: any, field: string, allProperties: string[]): string {
  const valueType = typeof valueIn;
  // String
  let valueStringified = valueType === "string" ?
    valueIn.split("\n").join("<br/>") :
    // String value
    (valueType === "object" && valueIn.stringValue && Object.keys(valueIn).length === 1) ?
      valueIn.stringValue :
      // Boolean value
      (valueType === "object" && (valueIn.booleanValue !== undefined) && Object.keys(valueIn).length === 1) ?
        valueIn.booleanValue :
        // Number value
        (valueType === "object" && valueIn.numberValue && Object.keys(valueIn).length === 1) ?
          valueIn.numberValue :
          // Target reference
          (valueType === "object" && valueIn.targetReference && Object.keys(valueIn).length === 1) ?
            valueIn.targetReference :
            // Element reference
            (valueType === "object" && valueIn.elementReference && Object.keys(valueIn).length === 1) ?
              valueIn.elementReference :
              (valueType === "undefined") ?
                '<!-- -->' :
                // Default YAML for array & object
                (Array.isArray(valueIn) || valueType === "object") ?
                  yaml.dump(valueIn).replace(/"/gm, "").replace(/^(\s+)/gm, match => '&nbsp;'.repeat(match.length)).split("\n").join("<br/>") :
                  // Default
                  String(valueIn).split("\n").join("<br/>");
  // Final updates if necessary
  if (allProperties.includes(valueStringified)) {
    valueStringified = `[${valueStringified}](#${valueStringified.toLowerCase()})`
  }
  else if (["fieldType", "inputsOnNextNavToAssocScrn", "regionContainerType", "runInMode", "type"].includes(field)) {
    valueStringified = prettifyFieldName(valueStringified);
    if (field === "type" && valueStringified.endsWith("s")) {
      valueStringified = valueStringified.slice(0, -1);
    }
  }
  else {
    valueStringified = valueStringified === "true" ? "✅" : valueStringified === "false" ? "⬜" : valueStringified;
  }
  return valueStringified;
}

export function prettifyFieldName(field: string): string {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase()).replace("( P M)", "(PM)").replace("S Object", "SObject");
}

export function mdEndSection(sectionString: string) {
  if (!sectionString)
    return sectionString + "\n\n___\n\n";
  return sectionString;
}