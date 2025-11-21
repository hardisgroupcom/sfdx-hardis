import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import { mdTableCell } from "../gitProvider/utilsMarkdown.js";

export class DocBuilderObject extends DocBuilderRoot {

  public docType = "Object";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_OBJECT";
  public placeholder = "<!-- Object description -->";
  public xmlRootKey = "CustomObject";

  public static buildIndexTable(prefix: string, objectDescriptions: any[]) {
    const lines: string[] = [];
    lines.push(...[
      "## Objects",
      "",
      "| Name      | Label | Description |",
      "| :-------- | :---- | :---------- | "
    ]);
    for (const objectDescription of objectDescriptions) {
      const objectNameCell = `[${objectDescription.name}](${prefix}${objectDescription.name}.md)`;
      lines.push(...[
        `| ${objectNameCell} | ${objectDescription.label || ""} | ${mdTableCell(objectDescription.description)} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public static buildCustomFieldsTable(fields: any[]) {
    if (!Array.isArray(fields)) {
      fields = [fields];
    }
    if (fields.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      "## Fields",
      "",
      "| Name      | Label | Type | Description |",
      "| :-------- | :---- | :--: | :---------- | "
    ]);
    for (const field of fields) {
      lines.push(...[
        `| ${field.fullName} | ${field.label || ""} | ${field.type || ""} | ${mdTableCell(String(field.description))} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public static buildValidationRulesTable(validationRules: any[]) {
    if (!Array.isArray(validationRules)) {
      validationRules = [validationRules];
    }
    if (validationRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      "## Validation Rules",
      "",
      "| Rule      | Active | Description | Formula |",
      "| :-------- | :---- | :---------- | :------ |"
    ]);
    for (const rule of validationRules) {
      lines.push(...[
        `| ${rule.fullName} | ${rule.active ? "Yes" : "No ⚠️"} | ${rule.description || ""} | ${mdTableCell(rule.errorConditionFormula)} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      '',
      '<!-- Mermaid schema -->',
      '',
      '<!-- Object description -->',
      '',
      '<!-- Attributes tables -->',
      '',
      '<!-- Flows table -->',
      '',
      '<!-- Apex table -->',
      '',
      '<!-- Pages table -->',
      '',
      '<!-- Profiles table -->',
      '',
      '<!-- PermissionSets table -->',
    ];
  }

  public stripXmlForAi(): Promise<string> {
    const xmlObj = new XMLParser().parse(this.metadataXml);
    // Remove record types picklist values
    if (xmlObj?.CustomObject?.recordTypes) {
      if (!Array.isArray(xmlObj.CustomObject.recordTypes)) {
        xmlObj.CustomObject.recordTypes = [xmlObj.CustomObject.recordTypes];
      }
      for (const recordType of xmlObj?.CustomObject?.recordTypes || []) {
        delete recordType.picklistValues;
      }
    }
    // Remove actionOverrides with formFactors as they already exist in default
    if (xmlObj?.CustomObject?.actionOverrides) {
      if (!Array.isArray(xmlObj.CustomObject.actionOverrides)) {
        xmlObj.CustomObject.actionOverrides = [xmlObj.CustomObject.actionOverrides];
      }
      xmlObj.CustomObject.actionOverrides = xmlObj.CustomObject.actionOverrides.filter(actionOverride => !actionOverride.formFactor);
    }
    // Remove compact layouts
    if (xmlObj?.CustomObject?.compactLayouts) {
      delete xmlObj.CustomObject.compactLayouts;
    }
    // Remove compact layouts
    if (xmlObj?.CustomObject?.listViews) {
      delete xmlObj.CustomObject.listViews;
    }
    const xmlStripped = new XMLBuilder().build(xmlObj);
    return xmlStripped
  }

}
