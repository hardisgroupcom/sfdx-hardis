import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import { t } from '../utils/i18n.js';

export class DocBuilderPermissionSetGroup extends DocBuilderRoot {

  public docType = "PermissionSetGroup";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PERMISSION_SET_GROUP";
  public placeholder = "<!-- PermissionSetGroup description -->";
  public xmlRootKey = "PermissionSetGroup";
  public docsSection = "permissionsetgroups";

  public static buildIndexTable(prefix: string, permissionSetGroupDescriptions: any[], filterObject: string | null = null) {
    const filteredPsetGroups = filterObject ? permissionSetGroupDescriptions.filter(pSetGroup => pSetGroup.relatedPermissionSets.includes(filterObject)) : permissionSetGroupDescriptions;
    if (filteredPsetGroups.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? `## ${t('docMdRelatedPermissionSetGroups')}` : `## ${t('docMdPermissionSetGroups')}`,
      "",
      `| ${t('docMdColPermissionSetGroup')} | ${t('docMdColDescription')} |`,
      "| :----                | :---------- |"
    ]);
    for (const pSetGroup of filteredPsetGroups) {
      const pSetGroupNameCell = `[${pSetGroup.name}](${prefix}${encodeURIComponent(pSetGroup.name)}.md)`;
      lines.push(...[
        `| ${pSetGroupNameCell} | ${pSetGroup.description || t('docMdNone')} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    const permissionSetTableLines = [
      `| ${t('docMdColPermissionSet')} |`,
      "| :------------- |"
    ];
    if (this.parsedXmlObject.permissionSets) {
      if (!Array.isArray(this.parsedXmlObject.permissionSets)) {
        this.parsedXmlObject.permissionSets = [this.parsedXmlObject.permissionSets];
      }
      for (const permissionSet of this.parsedXmlObject.permissionSets) {
        const permissionSetNameCell = `[${permissionSet}](../permissionsets/${encodeURIComponent(permissionSet)}.md)`;
        permissionSetTableLines.push(`| ${permissionSetNameCell} |`);
      }
    } else {
      permissionSetTableLines.push(`| ${t('docMdNone')} |`);
    }

    return [
      `## ${this.metadataName}`,
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["label", "description", "status"], `## ${t('docMdPermissionSetGroupAttributes')}`, []),
      '',
      `## ${t('docMdPermissionSets')}`,
      ...permissionSetTableLines,
      '',
      '<!-- PermissionSetGroup description -->',
      '',
    ];
  }
}