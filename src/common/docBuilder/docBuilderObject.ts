import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderObject extends DocBuilderRoot {

  public docType = "Object";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_OBJECT";
  public placeholder = "<!-- Object description -->";
  public xmlRootKey = "CustomObject";

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
      '<!-- Pages table -->'
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