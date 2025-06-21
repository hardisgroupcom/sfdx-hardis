import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { sortCrossPlatform } from "../utils/index.js";
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

  // Build Mermaid class diagram with all direct and reverse relationships with className
  public static buildMermaidClassDiagram(className: string, apexDescriptions: any[]): string {
    const classNameDescription = apexDescriptions.find(apex => apex.name === className);
    if (!classNameDescription) {
      return "";
    }
    const relatedClasses: string[] = sortCrossPlatform(classNameDescription.relatedClasses || []);
    const reverseRelatedClasses: string[] = sortCrossPlatform(
      apexDescriptions.map(apex => ({
        name: apex.name,
        relatedClasses: apex.relatedClasses || []
      })).filter(apex => apex.relatedClasses.includes(className)).map(apex => apex.name));
    const allRelatedClasses = [...new Set([...relatedClasses, ...reverseRelatedClasses])];

    const lines: string[] = ["## Class Diagram"];
    lines.push("");
    lines.push("```mermaid");
    lines.push("classDiagram");
    lines.push(`  class ${className} {`);
    lines.push("  }");

    // Declare all classes related to the className
    for (const relatedClassName of allRelatedClasses) {
      lines.push(`  class ${relatedClassName} {`);
      lines.push("  }");
    }

    // Add relationships
    for (const relatedClassName of relatedClasses) {
      if (relatedClassName !== className) {
        lines.push(`  ${className} --|> ${relatedClassName}`);
      }
    }
    // Add reverse relationships
    for (const relatedClassName of reverseRelatedClasses) {
      if (relatedClassName !== className) {
        lines.push(`  ${relatedClassName} --|> ${className}`);
      }
    }

    // Calculate relations between related classes using allRelatedClasses and apexdDescriptions
    for (const relatedClassName of allRelatedClasses) {
      const relatedClassDescription = apexDescriptions.find(apex => apex.name === relatedClassName);
      if (relatedClassDescription) {
        const relatedRelatedClasses = relatedClassDescription.relatedClasses || [];
        for (const otherRelatedClassName of relatedRelatedClasses) {
          if (otherRelatedClassName !== className && allRelatedClasses.includes(otherRelatedClassName) && otherRelatedClassName !== relatedClassName) {
            lines.push(`  ${relatedClassName} --|> ${otherRelatedClassName}`);
          }
        }
      }
    }
    lines.push("```");

    return lines.join("\n");
  }

}