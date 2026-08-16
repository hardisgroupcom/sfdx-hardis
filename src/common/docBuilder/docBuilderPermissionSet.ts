import { XMLBuilder } from "fast-xml-parser";
import { getLargeXmlParser } from '../utils/xmlUtils.js';
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable, prettifyFieldName } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderProfile } from "./docBuilderProfile.js";
import { t } from '../utils/i18n.js';

export class DocBuilderPermissionSet extends DocBuilderProfile {

  public docType = "PermissionSet";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PERMISSION_SET";
  public placeholder = "<!-- PermissionSet description -->";
  public xmlRootKey = "PermissionSet";
  public docsSection = "permissionsets";

  public static buildIndexTable(prefix: string, permissionSetDescriptions: any[], filterObject: string | null = null) {
    const filteredPsets = filterObject ? permissionSetDescriptions.filter(pSet => pSet.impactedObjects.includes(filterObject)) : permissionSetDescriptions;
    if (filteredPsets.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? `## ${t('docMdRelatedPermissionSets')}` : `## ${t('docMdPermissionSets')}`,
      "",
      `| ${t('docMdColPermissionSet')} | ${t('docMdColUserLicense')} |`,
      "| :----      | :--: | "
    ]);
    for (const pSet of filteredPsets) {
      const pSetNameCell = `[${pSet.name}](${prefix}${encodeURIComponent(pSet.name)}.md)`;
      lines.push(...[
        `| ${pSetNameCell} | ${pSet.license || t('docMdNone')} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      '<div id="jstree-container"></div>',
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["label", "description", "license", "hasActivationRequired"], `## ${t('docMdPermissionSetAttributes')}`, []),
      '',
      '<!-- Permission Set Groups table -->',
      '',
      '<!-- PermissionSet description -->',
      '',
    ];
  }

  public async stripXmlForAi(): Promise<string> {
    const xmlObj = getLargeXmlParser().parse(this.metadataXml);
    // Remove class access: not relevant for prompt
    if (xmlObj?.PermissionSet?.classAccesses) {
      delete xmlObj.PermissionSet.classAccesses;
    }
    // Remove flowAccesses: not relevant for prompt
    if (xmlObj?.PermissionSet?.flowAccesses) {
      delete xmlObj.PermissionSet.flowAccesses;
    }
    const xmlStripped = new XMLBuilder().build(xmlObj);
    return xmlStripped;
  }

  // Generate json for display with jsTree npm library 
  public async generateJsonTree(): Promise<any> {
    const xmlObj = getLargeXmlParser().parse(this.metadataXml);
    const treeElements: any[] = [];
    for (const psRootAttribute of Object.keys(xmlObj?.PermissionSet || {})) {
      if (["label", "license", "hasActivationRequired", "description"].includes(psRootAttribute)) {
        continue;
      }
      let attributeValue = xmlObj.PermissionSet[psRootAttribute];
      if (!Array.isArray(attributeValue)) {
        attributeValue = [attributeValue]
      }
      const attributeTreeRoot: any = {
        text: prettifyFieldName(psRootAttribute),
        icon: "fa-solid fa-folder icon-blue",
        a_attr: { href: null },
        children: [],
      }
      if (psRootAttribute === "fieldPermissions") {
        // Sort custom fields by object name
        this.buildObjectFieldsTree(attributeValue, attributeTreeRoot);
      }
      else {
        for (const element of attributeValue) {
          if (!this.isAccessibleElement(element)) {
            continue;
          }
          const subElement: any = this.getSubElement(element);
          attributeTreeRoot.children.push(subElement);
        }
        attributeTreeRoot.text = attributeTreeRoot.text + " (" + attributeTreeRoot.children.length + ")";
      }
      if (attributeTreeRoot.children.length > 0) {
        treeElements.push(attributeTreeRoot);
      }
    }
    return treeElements;
  }

}