import sortArray from "sort-array";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderPackage extends DocBuilderRoot {

  public docType = "Package";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PACKAGE";
  public placeholder = "<!-- Package description -->";
  public xmlRootKey = "json";

  public static buildIndexTable(prefix: string, packageDescriptions: any, filterObject: string | null = null) {
    const filteredPackages = filterObject ? packageDescriptions.filter(page => page.impactedObjects.includes(filterObject)) : packageDescriptions;
    if (filteredPackages.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      "## Installed packages",
      "",
      "| Name  | Namespace | Version | Version Name |",
      "| :---- | :-------- | :------ | :----------: | "
    ]);
    for (const pckg of sortArray(filteredPackages, { by: ['namespace', 'name'], order: ['asc', 'asc'] }) as any[]) {
      const packageNameCell = `[${pckg.name}](${prefix}${pckg.name}.md)`;
      lines.push(...[
        `| ${packageNameCell} | ${pckg.namespace || ""} | [${pckg.versionNumber}](https://test.salesforce.com/packaging/installPackage.apexp?p0=${pckg.versionId}) | ${pckg.versionName} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      '<!-- Package description -->',
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["SubscriberPackageName", "SubscriberPackageNamespace", "SubscriberPackageVersionNumber", "SubscriberPackageVersionId", "SubscriberPackageVersionName", "SubscriberPackageId"], "## Package attributes", []),
      '',
    ];
  }
}