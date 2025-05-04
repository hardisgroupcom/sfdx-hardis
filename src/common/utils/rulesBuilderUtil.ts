export class RulesBuilderUtil {

  public globalRuleTableLines: string [] = [];

  public async buildInitialMarkDownLinesForRules(ruleGlobal: any) {

    this.globalRuleTableLines = [
      `## ${ruleGlobal.fullName} Rules`,
      "| Order |  Criteria | Assigned To | Assigned To Type | Email |",
      "| :--: | :------------- | :--: | :--: | :--: |",
    ];

    if (ruleGlobal.ruleEntry) {
      if (!Array.isArray(ruleGlobal.ruleEntry)) {
        ruleGlobal.ruleEntry = [ruleGlobal.ruleEntry];
      }
      let order: number = 1;
      for (const rule of ruleGlobal.ruleEntry) {
        const criteria = rule?.criteriaItems ? this.formatCriteria(rule?.criteriaItems, rule?.booleanFilter) : rule?.formula ? JSON.stringify(rule.formula) : "None";
        this.globalRuleTableLines.push(`| ${order} | ${criteria} |  ${rule.assignedTo} | ${rule.assignedToType} | ${(!!rule.template)} |`);
        order++;
      }
    }
  }

  public async buildInitialMarkDownLinesFoAutoResponseRules(ruleGlobal: any) {

    this.globalRuleTableLines = [
      `## ${ruleGlobal.fullName} Rules`,
      "| Order |  Criteria | Sender Email | Sender Name |",
      "| :--: | :------------- | :--: | :--: |",
    ];

    if (ruleGlobal.ruleEntry) {
      if (!Array.isArray(ruleGlobal.ruleEntry)) {
        ruleGlobal.ruleEntry = [ruleGlobal.ruleEntry];
      }
      let order: number = 1;
      for (const rule of ruleGlobal.ruleEntry) {
        const criteria = rule?.criteriaItems ? this.formatCriteria(rule?.criteriaItems, rule?.booleanFilter) : rule?.formula ? JSON.stringify(rule.formula) : "None";
        this.globalRuleTableLines.push(`| ${order} | ${criteria} |  ${rule.senderEmail} | ${rule.senderName} |`);
        order++;
      }
    }
  }

  formatCriteria(criteriaItems: any[], booleanFilter: string): string {
    if (!criteriaItems || criteriaItems.length === 0) {
      return 'None';
    } else {
      if (!booleanFilter) {
        if (!Array.isArray(criteriaItems)) {
          criteriaItems = [criteriaItems];
        }
        return criteriaItems
          .map((x => this.formatCriteriaItem(x)))
          .join(' AND ');
      } else {

        let booleanResult: string = booleanFilter;
        for (let i = 1; i <= criteriaItems.length; i++) {
          booleanResult = booleanResult.replace(i.toString(), this.formatCriteriaItem(criteriaItems[i - 1]));
        }
        return booleanResult;
      }

    }
  }

  formatCriteriaItem(ci: any): string {
    return '(' + ci.field.split('.')[0] + ': ' + ci.field.substring(ci.field.indexOf('.') + 1) + ' ' + ci.operation + ' ' + ci.value + ')';
  }
}
