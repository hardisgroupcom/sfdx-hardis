import {DocBuilderRoot} from "./docBuilderRoot.js";
import {XMLBuilder, XMLParser} from "fast-xml-parser";
import {PromptTemplate} from "../aiProvider/promptTemplates.js";
import {RulesBuilderUtil} from "../utils/rulesBuilderUtil.js";

export class DocBuilderAssignmentRules extends DocBuilderRoot {

  public docType = "AssignmentRules";
  public placeholder = "<!-- Assignment Rules description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_ASSIGNMENT_RULES";
  public xmlRootKey = "AssignmentRules";

  public static buildIndexTable(prefix: string, assignmentRulesDescriptions: any, filterObject: string | null = null) {
    const filteredAssignmentRules = filterObject ? assignmentRulesDescriptions.filter(assignmentRule => assignmentRule.impactedObjects.includes(filterObject)) : assignmentRulesDescriptions;
    if (filteredAssignmentRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Assignment Rules" : "## Assignment Rules",
      "",
      "| Assignment Rule | Count of Assignment Rules |",
      "|     :----       |  :--: | "
    ]);

    for (const assignmentRule of filteredAssignmentRules) {
      const assignmentRuleNameCell = `[${assignmentRule.name}](${prefix}${assignmentRule.name}.md)`;
      lines.push(...[
        `| ${assignmentRuleNameCell} | ${assignmentRule.count} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {

    let ruleBuilderUtil = new RulesBuilderUtil();
    await ruleBuilderUtil.buildInitialMarkDownLinesForRules(this.parsedXmlObject.assignmentRule, "Assignment");

    let assignmentRuleTableLines: string [] = [...ruleBuilderUtil.globalRuleTableLines];
    let assignmentRulesAndRuleEntries: string [] = [...ruleBuilderUtil.globalRulesAndRuleEntries];

    return [
      `## ${this.metadataName}`,
      '',
      '<!-- Assignment Rules description -->',
      '## Assignment Rules list',
      ...assignmentRuleTableLines,
      '',
      "## Assignment Rules - Rules Entries and their criteria",
      ...assignmentRulesAndRuleEntries,
      '',
    ];
  }

  public stripXmlForAi(): Promise<string> {
    const xmlObj = new XMLParser().parse(this.metadataXml);
    return new XMLBuilder().build(xmlObj);
  }
}
