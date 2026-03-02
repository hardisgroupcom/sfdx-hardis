import {DocBuilderRoot} from "./docBuilderRoot.js";
import {PromptTemplate} from "../aiProvider/promptTemplates.js";
import {RulesBuilderUtil} from "../utils/rulesBuilderUtil.js";
import { t } from '../utils/i18n.js';

export class DocBuilderAutoResponseRules extends DocBuilderRoot {

  public docType = "AutoResponseRules";
  public placeholder = "<!-- AutoResponse Rules description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_AUTORESPONSE_RULES";
  public xmlRootKey = "autoResponseRule";

  public static buildIndexTable(prefix: string, autoResponseRulesDescriptions: any, filterObject: string | null = null) {
    const filteredAutoResponseRules = filterObject ? autoResponseRulesDescriptions.filter(autoResponseRule => autoResponseRule.impactedObjects.includes(filterObject)) : autoResponseRulesDescriptions;
    if (filteredAutoResponseRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? `## ${t('docMdRelatedAutoResponseRules')}` : `## ${t('docMdAutoResponseRules')}`,
      "",
      `| ${t('docMdColAutoResponseRule')} | ${t('docMdColIsActive')} |`,
      "|     :----       |  :--: | "
    ]);

    for (const autoResponseRule of filteredAutoResponseRules) {
      const autoResponseRuleNameCell = `[${autoResponseRule.name}](${prefix}${autoResponseRule.name}.md)`;
      lines.push(...[
        `| ${autoResponseRuleNameCell} | ${autoResponseRule.active} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {

    const ruleBuilderUtil = new RulesBuilderUtil();
    await ruleBuilderUtil.buildInitialMarkDownLinesFoAutoResponseRules(this.parsedXmlObject);
    const autoResponseRuleTableLines: string [] = [...ruleBuilderUtil.globalRuleTableLines];

    return [
      `## ${this.metadataName}`,
      '',
      '<!-- AutoResponse Rules description -->',
      `## ${t('docMdAutoResponseRulesList')}`,
      ...autoResponseRuleTableLines
    ];
  }
}
