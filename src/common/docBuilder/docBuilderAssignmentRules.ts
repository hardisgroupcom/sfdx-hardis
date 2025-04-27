import {DocBuilderRoot} from "./docBuilderRoot.js";
import {XMLBuilder, XMLParser} from "fast-xml-parser";
import {PromptTemplate} from "../aiProvider/promptTemplates.js";

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

    let assignmentRulesAndRuleEntries: string [] = [];

    let assignmentRuleTableLines: string [] = [
      "| Assignment Rule | Is Active | Rule Entries Count |",
      "| :------------- | :--: | :--: |"
    ];

    if (this.parsedXmlObject.assignmentRule) {
      if (!Array.isArray(this.parsedXmlObject.assignmentRule)) {
        this.parsedXmlObject.assignmentRule = [this.parsedXmlObject.assignmentRule];
      }

      for (const assignmentRule of this.parsedXmlObject.assignmentRule) {
        let ruleEntries = assignmentRule.ruleEntry;
        if (!Array.isArray(ruleEntries)) {
          ruleEntries = [ruleEntries];
        }
        assignmentRuleTableLines.push(`| ${assignmentRule.fullName} |  ${assignmentRule.active} | ${ruleEntries.length} |`);
        assignmentRulesAndRuleEntries.push(`### ${assignmentRule.fullName}`);

        if (assignmentRule.ruleEntry === undefined) {
          assignmentRulesAndRuleEntries.push(`##### No criteria items found for this rule entry`);
          assignmentRulesAndRuleEntries.push("");
          continue;
        }
        let ruleCounter = 1;
        for (const singleRuleEntry of ruleEntries) {

          if (singleRuleEntry) {
            assignmentRulesAndRuleEntries.push(`#### Rule ${ruleCounter}`);
            assignmentRulesAndRuleEntries.push("| Field | Operation | Value|");
            assignmentRulesAndRuleEntries.push("| :---- | :--: | ----: |");

            if (singleRuleEntry) {
              let criteriaItems = singleRuleEntry.criteriaItems;
              if (!Array.isArray(criteriaItems)) {
                criteriaItems = Array.of(criteriaItems);
              }
              for (const criteria of criteriaItems) {
                assignmentRulesAndRuleEntries.push(`| ${criteria.field} | ${criteria.operation} | ${criteria.value.replace(/,/g, ', ')} |`);
              }

              assignmentRulesAndRuleEntries.push("");
            }
            ruleCounter++;
          }
        }
      }
    }

    return [
      '<!-- Assignment Rules description -->',
      '## Assignment Rules list',
      ...assignmentRuleTableLines,
      '',
      "## Assignment Rules - Rules Entries and their criteria",
      //'',
      ...assignmentRulesAndRuleEntries,
      '',
    ];
  }

  public stripXmlForAi(): Promise<string> {

    const xmlObj = new XMLParser().parse(this.metadataXml);

    // // Remove var that defines if Approval History is enabled: not relevant for prompt
    // if (xmlObj?.ApprovalProcess?.showApprovalHistory) {
    //   delete xmlObj.ApprovalProcess.showApprovalHistory;
    // }
    //
    // // Remove var that defines if user has access to AP on mobile devices: not relevant for prompt
    // if (xmlObj?.ApprovalProcess?.enableMobileDeviceAccess) {
    //   delete xmlObj.ApprovalProcess.enableMobileDeviceAccess;
    // }
    //
    // // Remove settings that define if the record is editable while locked: not relevant for prompt
    // if (xmlObj?.ApprovalProcess?.recordEditability) {
    //   delete xmlObj.ApprovalProcess.recordEditability;
    // }

    return new XMLBuilder().build(xmlObj);
  }
}
