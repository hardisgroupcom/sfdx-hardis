import { DocBuilderRoot } from "./docBuilderRoot.js";
import { buildReferencesTable, MetadataReference } from "../utils/metadataReferenceUtils.js";

export interface ComponentIndexTableOptions {
  /** Prepended to the documentation links, so they resolve from the folder holding the generated file */
  prefix: string;
  descriptions: any[];
  /** When set, keeps only the components impacting that object */
  filterObject: string | null;
  title: string;
  relatedTitle: string;
  columnLabels: string[];
  columnAlignments: string[];
  /** Cells following the component name cell, in the order of the column labels */
  buildValueCells: (description: any) => string[];
}

/**
 * Shared behavior of the user interface components documented from their sources: Visualforce pages,
 * Visualforce components and Aura bundles. They all open with their name, an attributes table and the
 * AI description, they all list the metadata using them, and they are all listed in an index table
 * that can be narrowed down to one object.
 */
export abstract class DocBuilderComponentRoot extends DocBuilderRoot {

  /** Two-column table of the component attributes, shown right under its name */
  protected abstract buildAttributesTable(): string;

  protected buildComponentHeaderLines(): string[] {
    return [
      `# ${this.metadataName}`,
      '',
      this.buildAttributesTable(),
      '',
      this.placeholder,
      '',
    ];
  }

  /** "Where Used" table, built from the references collected once for the whole project */
  protected buildWhereUsedLines(): string[] {
    const references: MetadataReference[] = this.additionalVariables.REFERENCES || [];
    return buildReferencesTable(references, '../');
  }

  public static buildComponentIndexTable(options: ComponentIndexTableOptions): string[] {
    const filteredDescriptions = options.filterObject
      ? options.descriptions.filter(description => description.impactedObjects.includes(options.filterObject))
      : options.descriptions;

    if (filteredDescriptions.length === 0) {
      return [];
    }

    const lines: string[] = [
      `## ${options.filterObject ? options.relatedTitle : options.title}`,
      "",
      `| ${options.columnLabels.join(" | ")} |`,
      `| ${options.columnAlignments.join(" | ")} |`,
    ];
    for (const description of filteredDescriptions) {
      const nameCell = `[${description.name}](${options.prefix}${description.docPath})`;
      lines.push(`| ${[nameCell, ...options.buildValueCells(description)].join(" | ")} |`);
    }
    lines.push("");

    return lines;
  }
}
