import {DocBuilderRoot} from "./docBuilderRoot.js";
import {XMLBuilder, XMLParser} from "fast-xml-parser";
import {PromptTemplate} from "../aiProvider/promptTemplates.js";
import {RulesBuilderUtil} from "../utils/rulesBuilderUtil.js";

export class DocBuilderAutoResponseRules extends DocBuilderRoot {

  public docType = "AutoResponseRules";
  public placeholder = "<!-- AutoResponse Rules description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_AUTORESPONSE_RULES";
  public xmlRootKey = "AutoResponseRules";

  public static buildIndexTable(prefix: string, autoResponseRulesDescriptions: any, filterObject: string | null = null) {
    const filteredAutoResponseRules = filterObject ? autoResponseRulesDescriptions.filter(autoResponseRule => autoResponseRule.impactedObjects.includes(filterObject)) : autoResponseRulesDescriptions;
    if (filteredAutoResponseRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related AutoResponse Rules" : "## AutoResponse Rules",
      "",
      "| AutoResponse Rule | Count of AutoResponse Rules |",
      "|     :----       |  :--: | "
    ]);

    for (const assignmentRule of filteredAutoResponseRules) {
      const assignmentRuleNameCell = `[${assignmentRule.name}](${prefix}${assignmentRule.name}.md)`;
      lines.push(...[
        `| ${assignmentRuleNameCell} | ${assignmentRule.count} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {

    let autoResponseRulesAndRuleEntries: string [] = [];

    let autoResponseRuleTableLines: string [] = [
      "| AutoResponse Rule | Is Active | Rule Entries Count |",
      "| :------------- | :--: | :--: |"
    ];

    let ruleBuilderUtil = new RulesBuilderUtil();
    await ruleBuilderUtil.buildInitialMarkDownLinesForRules(this.parsedXmlObject.autoResponseRule);

    autoResponseRuleTableLines = [...ruleBuilderUtil.globalRuleTableLines];
    autoResponseRulesAndRuleEntries = [...ruleBuilderUtil.globalRulesAndRuleEntries];

    return [
      `## ${this.metadataName}`,
      '',
      '<!-- Assignment Rules description -->',
      '## AutoResponse Rules list',
      ...autoResponseRuleTableLines,
      '',
      "## AutoResponse Rules - Rules Entries and their criteria",
      ...autoResponseRulesAndRuleEntries,
      '',
    ];
  }

  public stripXmlForAi(): Promise<string> {
    const xmlObj = new XMLParser().parse(this.metadataXml);
    return new XMLBuilder().build(xmlObj);
  }
}
