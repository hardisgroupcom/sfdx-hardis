export class RulesBuilderUtil {

  public globalRulesAndRuleEntries: string [] = [];
  public globalRuleTableLines: string [] = [];

  public async buildInitialMarkDownLinesForRules(ruleGlobal: any) {

    this.globalRuleTableLines = [
      "| Assignment Rule | Is Active | Rule Entries Count |",
      "| :------------- | :--: | :--: |"
    ];

    if (ruleGlobal) {
      if (!Array.isArray(ruleGlobal)) {
        ruleGlobal = [ruleGlobal];
      }

      for (const assignmentRule of ruleGlobal) {
        let ruleEntries = assignmentRule.ruleEntry;
        if (!Array.isArray(ruleEntries)) {
          ruleEntries = [ruleEntries];
        }

        // adding object's global rules to the top table
        // the "global" means: "assignment" | "Auto Response" | "Escalation"
        this.globalRuleTableLines.push(`| ${assignmentRule.fullName} |  ${assignmentRule.active} | ${ruleEntries.length} |`);
        // listing each global rule under the top table
        this.globalRulesAndRuleEntries.push(`### ${assignmentRule.fullName}`);

        if (assignmentRule.ruleEntry === undefined) {
          this.globalRulesAndRuleEntries.push(`##### No criteria items found for this rule entry`);
          this.globalRulesAndRuleEntries.push("");
          continue;
        }
        let ruleCounter = 1;
        for (const singleRuleEntry of ruleEntries) {

          if (singleRuleEntry) {
            // listing rule entries and their details per each global rule
            this.globalRulesAndRuleEntries.push(`#### Rule #${ruleCounter}`);
            this.globalRulesAndRuleEntries.push("| Assigned To Type | Assigned To | Formula |");
            this.globalRulesAndRuleEntries.push("| :---- | :--: | :--: |");
            this.globalRulesAndRuleEntries.push(`| ${singleRuleEntry.assignedToType} | ${singleRuleEntry.assignedTo} | \`${singleRuleEntry.formula || 'None'}\` |`);
            this.globalRulesAndRuleEntries.push("");

            // listing criteria items for each rule entry in a separate table
            this.globalRulesAndRuleEntries.push(`#### Criteria Items for Rule #${ruleCounter}`);
            this.globalRulesAndRuleEntries.push("| Field | Operation | Value|");
            this.globalRulesAndRuleEntries.push("| :---- | :--: | :--: |");

            if (singleRuleEntry) {
              let criteriaItems = singleRuleEntry.criteriaItems;
              if (!Array.isArray(criteriaItems)) {
                criteriaItems = Array.of(criteriaItems);
              }
              for (const criteria of criteriaItems) {
                this.globalRulesAndRuleEntries.push(`| ${criteria.field} | ${criteria.operation} | ${criteria.value.replace(/,/g, ', ')} |`);
              }

              this.globalRulesAndRuleEntries.push("");
            }
            ruleCounter++;
          }
        }
      }
    }
  }
}
