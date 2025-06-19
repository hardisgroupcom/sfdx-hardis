import {DocBuilderRoot} from "./docBuilderRoot.js";
import {PromptTemplate} from "../aiProvider/promptTemplates.js";
import {RulesBuilderUtil} from "../utils/rulesBuilderUtil.js";

export class DocBuilderEscalationRules extends DocBuilderRoot {

  public docType = "EscalationRules";
  public placeholder = "<!-- Escalation Rule description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_ESCALATION_RULES";
  public xmlRootKey = "escalationRule";

  public static buildIndexTable(prefix: string, escalationRulesDescriptions: any, filterObject: string | null = null) {
    const filteredEscalationRules = filterObject ? escalationRulesDescriptions.filter(escalationRule => escalationRule.impactedObjects.includes(filterObject)) : escalationRulesDescriptions;
    if (filteredEscalationRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Escalation Rules" : "## Escalation Rules",
      "",
      "| Escalation Rule | Is Active |",
      "|     :----       |  :--: | "
    ]);

    for (const escalationRule of filteredEscalationRules) {
      const escalationRuleNameCell = `[${escalationRule.name}](${prefix}${escalationRule.name}.md)`;
      lines.push(...[
        `| ${escalationRuleNameCell} | ${escalationRule.active} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {

    const ruleBuilderUtil = new RulesBuilderUtil();

    await ruleBuilderUtil.buildInitialMarkDownLinesForEscalationRules(this.parsedXmlObject);

    const escalationRuleTableLines: string [] = [...ruleBuilderUtil.globalRuleTableLines];

    return [
      '<!-- Escalation Rule description -->',
      '## Escalation Rules list',
      ...escalationRuleTableLines,
      '',
    ];
  }
}
