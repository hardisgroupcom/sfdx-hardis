import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import * as path from "path";
import { prettifyFieldName } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { mdTableCell } from "../gitProvider/utilsMarkdown.js";
import fs from "fs";

export class DocBuilderFlow extends DocBuilderRoot {

  public docType = "Flow";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_FLOW";
  public placeholder = "<!-- Flow description -->";
  public xmlRootKey = "Flow";

  public static buildIndexTable(prefix: string, flowDescriptions: any[], outputMarkdownRoot: string, filterObject: string | null = null): string[] {
    const filteredFlows = filterObject ? flowDescriptions.filter(flow => flow.object === filterObject || flow.impactedObjects.includes(filterObject)) : flowDescriptions;
    if (filteredFlows.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Flows" : "## Flows",
      "",
      "| Object | Name      | Type | Description |",
      "| :----  | :-------- | :--: | :---------- | "
    ]);
    for (const flow of filteredFlows) {
      const outputFlowHistoryMdFile = path.join(outputMarkdownRoot, "flows", flow.name + "-history.md");
      const flowNameCell = fs.existsSync(outputFlowHistoryMdFile) ?
        `[${flow.name}](${prefix}${flow.name}.md) [🕒](${prefix}${flow.name}-history.md)` :
        `[${flow.name}](${prefix}${flow.name}.md)`;
      lines.push(...[
        `| ${flow.object || "💻"} | ${flowNameCell} | ${prettifyFieldName(flow.type)} | ${mdTableCell(flow.description)} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async stripXmlForAi(): Promise<string> {
    const xmlStringStripped = this.metadataXml.replace(/<locationX>.*?<\/locationX>\s*|<locationY>.*?<\/locationY>\s*/g, '');
    const xmlObj = new XMLParser().parse(xmlStringStripped);
    const xmlStripped = new XMLBuilder().build(xmlObj);
    return xmlStripped;
  }

}