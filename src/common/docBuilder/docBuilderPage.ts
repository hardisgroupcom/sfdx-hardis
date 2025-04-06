import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderPage extends DocBuilderRoot {

  public docType = "Page";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PAGE";
  public placeholder = "<!-- Page description -->";
  public xmlRootKey = "FlexiPage";


  public static buildIndexTable(prefix: string, pageDescriptions: any, filterObject: string | null = null) {
    const filteredPages = filterObject ? pageDescriptions.filter(page => page.impactedObjects.includes(filterObject)) : pageDescriptions;
    if (filteredPages.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Lightning Pages" : "## Lightning Pages",
      "",
      "| Lightning Page | Type |",
      "| :----      | :--: | "
    ]);
    for (const page of filteredPages) {
      const pageNameCell = `[${page.name}](${prefix}${page.name}.md)`;
      lines.push(...[
        `| ${pageNameCell} | ${page.type} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["sobjectType", "type", "masterLabel", "template"], "## Lightning Page attributes", []),
      '',
      '<!-- Page description -->',
      '',
    ];
  }

}