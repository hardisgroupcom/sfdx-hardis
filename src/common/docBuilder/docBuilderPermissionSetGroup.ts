import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

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
      filterObject ? "## Related Permission Set Groups" : "## Permission Set Groups",
      "",
      "| Permission Set Group | Description |",
      "| :----                | :---------- |"
    ]);
    for (const pSetGroup of filteredPsetGroups) {
      const pSetGroupNameCell = `[${pSetGroup.name}](${prefix}${encodeURIComponent(pSetGroup.name)}.md)`;
      lines.push(...[
        `| ${pSetGroupNameCell} | ${pSetGroup.description || "None"} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    const permissionSetTableLines = [
      "| Permission Set |",
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
      permissionSetTableLines.push("| None |");
    }

    return [
      `## ${this.metadataName}`,
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["label", "description", "status"], "## Permission Set Group attributes", []),
      '',
      '## Permission Sets',
      ...permissionSetTableLines,
      '',
      '<!-- PermissionSetGroup description -->',
      '',
    ];
  }
}