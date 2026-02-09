import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

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
      filterObject ? "## Related Workflow Rules" : "## Workflow Rules",
      "",
      "| Workflow Rule | Is Active |",
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
      buildGenericMarkdownTable(this.parsedXmlObject, ["allFields"], "## Workflow Rule attributes", []),
      "",
      "<!-- Workflow Rule description -->",
      "",
    ];
  }
}
