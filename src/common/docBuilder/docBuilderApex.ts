import * as fs from "fs";
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
    lines.push("graph TD");
    lines.push(`  ${className}["${className}"]:::mainApexClass`);
    if (fs.existsSync(`docs/apex/${className}.md`)) {
      lines.push(`  click ${className} "/objects/${className}/"`);
    }

    // Declare all classes related to the className
    for (const relatedClassName of allRelatedClasses) {
      const relatedClassDescription = apexDescriptions.find(apex => apex.name === relatedClassName);
      if (relatedClassDescription?.type.includes("Test")) {
        lines.push(`  ${relatedClassName}["${relatedClassName}"]:::apexTestClass`);
      }
      else {
        lines.push(`  ${relatedClassName}["${relatedClassName}"]:::apexClass`);
      }
      if (fs.existsSync(`docs/apex/${relatedClassName}.md`)) {
        lines.push(`  click ${relatedClassName} "/apex/${relatedClassName}/"`);
      }
    }
    lines.push("");
    let pos = 0;
    const directLinksPos: number[] = [];
    const reverseLinksPos: number[] = [];
    const transverseLinksPos: number[] = [];
    // Add relationships
    for (const relatedClassName of relatedClasses) {
      if (relatedClassName !== className) {
        lines.push(`  ${className} --> ${relatedClassName}`);
        directLinksPos.push(pos);
        pos++;
      }
    }
    lines.push("");
    // Add reverse relationships
    for (const relatedClassName of reverseRelatedClasses) {
      if (relatedClassName !== className) {
        lines.push(`  ${relatedClassName} --> ${className}`);
        reverseLinksPos.push(pos);
        pos++;
      }
    }
    lines.push("");

    // If the number of lines is not too big, calculate relations between related classes using allRelatedClasses and apexDescriptions
    // This is to avoid too many links in the diagram
    if (allRelatedClasses.length > 10) {
      lines.push("  %% Too many related classes, skipping transverse links");
      lines.push("");
    }
    else {
      for (const relatedClassName of allRelatedClasses) {
        const relatedClassDescription = apexDescriptions.find(apex => apex.name === relatedClassName);
        if (relatedClassDescription) {
          const relatedRelatedClasses = relatedClassDescription.relatedClasses || [];
          for (const otherRelatedClassName of relatedRelatedClasses) {
            if (otherRelatedClassName !== className && allRelatedClasses.includes(otherRelatedClassName) && otherRelatedClassName !== relatedClassName) {
              lines.push(`  ${relatedClassName} --> ${otherRelatedClassName}`);
              transverseLinksPos.push(pos);
              pos++;
            }
          }
        }
      }
    }

    // Add styles for classes
    lines.push("");
    lines.push(`classDef apexClass fill:#FFF4C2,stroke:#CCAA00,stroke-width:3px,rx:12px,ry:12px,shadow:drop,color:#333;`);
    lines.push(`classDef apexTestClass fill:#F5F5F5,stroke:#999999,stroke-width:3px,rx:12px,ry:12px,shadow:drop,color:#333;`);
    lines.push(`classDef mainApexClass fill:#FFB3B3,stroke:#A94442,stroke-width:4px,rx:14px,ry:14px,shadow:drop,color:#333,font-weight:bold;`);
    lines.push("");
    // Add classes to links
    if (directLinksPos.length > 0) {
      lines.push("linkStyle " + directLinksPos.join(",") + " stroke:#4C9F70,stroke-width:4px;");
    }
    if (reverseLinksPos.length > 0) {
      lines.push("linkStyle " + reverseLinksPos.join(",") + " stroke:#FF8C00,stroke-width:2px;");
    }
    if (transverseLinksPos.length > 0) {
      lines.push("linkStyle " + transverseLinksPos.join(",") + " stroke:#A6A6A6,stroke-width:2px;");
    }
    lines.push("```");

    // Use Graph LR if there are too many lines for a nice mermaid display
    if (lines.length > 50) {
      lines[3] = "graph LR";
    }

    return lines.join("\n");
  }

}