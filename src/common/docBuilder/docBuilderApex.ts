import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderApex extends DocBuilderRoot {

  public docType = "APEX";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_APEX";
  public placeholder = "<!-- Apex description -->";

  public static buildIndexTable(prefix: string, apexDescriptions: any[], filterObject: string | null = null): string[] {
    const filteredApex = filterObject ? apexDescriptions.filter(apex => apex.impactedObjects.includes(filterObject)) : apexDescriptions;
    if (filteredApex.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Apex Classes" : "## Apex Classes",
      "",
      "| Apex Class | Type |",
      "| :----      | :--: | "
    ]);
    for (const apex of filteredApex) {
      const flowNameCell = `[${apex.name}](${prefix}${apex.name}.md)`;
      lines.push(...[
        `| ${flowNameCell} | ${apex.type} |`
      ]);
    }
    lines.push("");
    return lines;
  }

}