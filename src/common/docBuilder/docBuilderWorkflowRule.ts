import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import { t } from '../utils/i18n.js';

export class DocBuilderWorkflowRule extends DocBuilderRoot {

  public docType = "WorkflowRule";
  public placeholder = "<!-- Workflow Rule description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_WORKFLOW_RULE";
  public xmlRootKey = "workflowRule";

  public static buildIndexTable(prefix: string, workflowRulesDescriptions: any[], filterObject: string | null = null) {
    const filteredWorkflowRules = filterObject ?
      workflowRulesDescriptions.filter(rule => (rule.object === filterObject) || rule.impactedObjects?.includes(filterObject)) :
      workflowRulesDescriptions;
    if (filteredWorkflowRules.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? `## ${t('docMdRelatedWorkflowRules')}` : `## ${t('docMdWorkflowRules')}`,
      "",
      `| ${t('docMdColWorkflowRule')} | ${t('docMdColIsActive')} |`,
      "| :---- | :--: |"
    ]);

    for (const workflowRule of filteredWorkflowRules) {
      const fileName = workflowRule.fileName || workflowRule.name;
      const workflowRuleNameCell = `[${workflowRule.name}](${prefix}${fileName}.md)`;
      lines.push(`| ${workflowRuleNameCell} | ${workflowRule.active} |`);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      "",
      buildGenericMarkdownTable(this.parsedXmlObject, ["allFields"], `## ${t('docMdWorkflowRuleAttributes')}`, []),
      "",
      "<!-- Workflow Rule description -->",
      "",
    ];
  }
}
