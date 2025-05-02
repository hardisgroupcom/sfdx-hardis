import {DocBuilderRoot} from "./docBuilderRoot.js";
import {PromptTemplate} from "../aiProvider/promptTemplates.js";
import {buildGenericMarkdownTable} from "../utils/flowVisualiser/nodeFormatUtils.js";

export class DocBuilderForecastingTypes extends DocBuilderRoot {

  public docType = "ForecastingTypes";
  public placeholder = "<!-- Forecasting Types description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_FORECAST_TYPES";
  public xmlRootKey = "ForecastingType";

  public static buildIndexTable(prefix: string, forecastingTypesDescriptions: any, filterObject: string | null = null) {
    const filteredForecastingTypes = filterObject ? forecastingTypesDescriptions.filter(forecastingType => forecastingType.impactedObjects.includes(filterObject)) : forecastingTypesDescriptions;
    if (filteredForecastingTypes.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Forecasting Types" : "## Forecasting Types",
      "",
      "| Forecasting Type | Active |",
      "|     :----        |  :--: | "
    ]);

    for (const forecastingType of filteredForecastingTypes) {
      const forecastingTypeNameCell = `[${forecastingType.name}](${prefix}${forecastingType.name}.md)`;
      lines.push(...[
        `| ${forecastingTypeNameCell} | ${forecastingType.active} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      buildGenericMarkdownTable(this.parsedXmlObject, [
        "masterLabel",
        "amount",
        "dateType",
        "roleType",
      ], "## Forecast Types attributes", []),
      '',
      '<!-- Forecasting Types description -->',
      '',
    ];
  }
}
