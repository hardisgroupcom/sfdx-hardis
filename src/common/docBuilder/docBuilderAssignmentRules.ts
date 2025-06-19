import {DocBuilderRoot} from "./docBuilderRoot.js";
import {PromptTemplate} from "../aiProvider/promptTemplates.js";
import {RulesBuilderUtil} from "../utils/rulesBuilderUtil.js";

export class DocBuilderAssignmentRules extends DocBuilderRoot {

  public docType = "AssignmentRules";
  public placeholder = "<!-- Assignment Rule description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_ASSIGNMENT_RULES";
  public xmlRootKey = "assignmentRule";

  public static buildIndexTable(prefix: string, assignmentRulesDescriptions: any, filterObject: string | null = null) {
    const filteredAssignmentRules = filterObject ? assignmentRulesDescriptions.filter(assignmentRule => assignmentRule.impactedObjects.includes(filterObject)) : assignmentRulesDescriptions;
    if (filteredAssignmentRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Assignment Rules" : "## Assignment Rules",
      "",
      "| Assignment Rule | Is Active |",
      "|     :----       |  :--: | "
    ]);

    for (const assignmentRule of filteredAssignmentRules) {
      const assignmentRuleNameCell = `[${assignmentRule.name}](${prefix}${assignmentRule.name}.md)`;
      lines.push(...[
        `| ${assignmentRuleNameCell} | ${assignmentRule.active} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {

    const ruleBuilderUtil = new RulesBuilderUtil();

    await ruleBuilderUtil.buildInitialMarkDownLinesForRules(this.parsedXmlObject);

    const assignmentRuleTableLines: string [] = [...ruleBuilderUtil.globalRuleTableLines];

    return [
      '<!-- Assignment Rule description -->',
      '## Assignment Rules list',
      ...assignmentRuleTableLines,
      '',
    ];
  }
}
