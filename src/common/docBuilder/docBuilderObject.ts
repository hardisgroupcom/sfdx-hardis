import { XMLBuilder } from "fast-xml-parser";
import { getLargeXmlParser } from '../utils/xmlUtils.js';
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import { mdTableCell, mdTableCellHtml } from "../gitProvider/utilsMarkdown.js";
import { t } from '../utils/i18n.js';

export class DocBuilderObject extends DocBuilderRoot {

  public docType = "Object";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_OBJECT";
  public placeholder = "<!-- Object description -->";
  public xmlRootKey = "CustomObject";

  public static buildIndexTable(prefix: string, objectDescriptions: any[]) {
    const lines: string[] = [];
    lines.push(...[
      `## ${t('docMdObjects')}`,
      "",
      `| ${t('docMdColName')} | ${t('docMdColLabel')} | ${t('docMdColDescription')} |`,
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
      `## ${t('docMdFields')}`,
      "",
      `| ${t('docMdColName')} | ${t('docMdColLabel')} | ${t('docMdColType')} | ${t('docMdColDescription')} |`,
      "| :-------- | :---- | :--: | :---------- | "
    ]);
    for (const field of fields) {
      lines.push(...[
        // A field without a description used to be stringified into the literal "undefined":
        // 389 of them on a single Account page. mdTableCell already renders an empty cell.
        `| ${field.fullName} | ${field.label || ""} | ${field.type || ""} | ${mdTableCell(field.description)} |`
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
      `## ${t('docMdValidationRules')}`,
      "",
      `| ${t('docMdColRule')} | ${t('docMdColActive')} | ${t('docMdColDescription')} | ${t('docMdColFormula')} |`,
      "| :-------- | :---- | :---------- | :------ |"
    ]);
    for (const rule of validationRules) {
      // A rule description is free text an admin typed in Salesforce, and it regularly holds line
      // breaks: written straight into the row they closed the table, and everything below it came
      // out as a paragraph of pipes. Both columns now go through the same escaping.
      const descriptionCell = mdTableCellHtml(rule.description);
      const formulaCell = mdTableCellHtml(rule.errorConditionFormula);
      lines.push(...[
        `| ${rule.fullName} | ${rule.active ? t('docMdYes') : t('docMdNo')} | ${descriptionCell} | ${rule.errorConditionFormula ? `<code>${formulaCell}</code>` : formulaCell} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `# ${this.metadataName}`,
      '',
      '<!-- Mermaid schema -->',
      '',
      '<!-- Object description -->',
      '',
      '<!-- Attributes tables -->',
      '',
      // What runs on the object
      '<!-- Flows table -->',
      '',
      '<!-- Process Builders table -->',
      '',
      '<!-- Workflow Rules table -->',
      '',
      // These four were filled in by the object documentation, but the page never declared them,
      // so the rules that act on an object were nowhere to be seen on its page.
      '<!-- ApprovalProcess table -->',
      '',
      '<!-- AssignmentRules table -->',
      '',
      '<!-- AutoResponseRules table -->',
      '',
      '<!-- EscalationRules table -->',
      '',
      // What is built on top of the object
      '<!-- Apex table -->',
      '',
      '<!-- Lwc table -->',
      '',
      '<!-- Visualforce table -->',
      '',
      '<!-- Aura table -->',
      '',
      '<!-- Pages table -->',
      '',
      // Who can reach the object
      '<!-- Profiles table -->',
      '',
      '<!-- PermissionSets table -->',
    ];
  }

  public async stripXmlForAi(): Promise<string> {
    const xmlObj = getLargeXmlParser().parse(this.metadataXml);
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
    return xmlStripped;
  }

}