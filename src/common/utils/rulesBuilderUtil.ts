export class RulesBuilderUtil {

  public globalRuleTableLines: string[] = [];

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
      let orderNum: number = 1;
      for (const rule of ruleGlobal.ruleEntry) {
        const globalCriteria = rule?.criteriaItems ? this.formatCriteria(rule?.criteriaItems, rule?.booleanFilter) : rule?.formula ? JSON.stringify(rule.formula) : "None";
        this.globalRuleTableLines.push(`| ${orderNum} | ${globalCriteria} |  ${rule.assignedTo} | ${rule.assignedToType} | ${(!!rule.template)} |`);
        orderNum++;
      }
    }
  }

  public async buildInitialMarkDownLinesFoAutoResponseRules(autoresponseRule: any) {

    this.globalRuleTableLines = [
      `## ${autoresponseRule.fullName} Rules`,
      "| Order |  Criteria | Sender Email | Sender Name | Reply To |",
      "| :--: | :------------- | :--: | :--: | :--: |",
    ];

    if (autoresponseRule.ruleEntry) {
      if (!Array.isArray(autoresponseRule.ruleEntry)) {
        autoresponseRule.ruleEntry = [autoresponseRule.ruleEntry];
      }
      let order: number = 1;
      for (const rule of autoresponseRule.ruleEntry) {
        const autoResponseCriteria = rule?.criteriaItems ? this.formatCriteria(rule?.criteriaItems, rule?.booleanFilter) : rule?.formula ? JSON.stringify(rule.formula) : "None";
        this.globalRuleTableLines.push(`| ${order} | ${autoResponseCriteria} |  ${rule.senderEmail} | ${rule.senderName} | ${rule.replyTo || "None"} |`);
        order++;
      }
    }
  }

  public async buildInitialMarkDownLinesForEscalationRules(ruleGlobal: any) {

    this.globalRuleTableLines = [
      `## ${ruleGlobal.fullName} Rules`,
      "| Order |  Criteria | Actions |",
      "| :--: | :------------- | :------------- |",
    ];

    if (ruleGlobal.ruleEntry) {
      if (!Array.isArray(ruleGlobal.ruleEntry)) {
        ruleGlobal.ruleEntry = [ruleGlobal.ruleEntry];
      }
      let order: number = 1;
      for (const rule of ruleGlobal.ruleEntry) {
        const criteria = rule?.criteriaItems ? this.formatCriteria(rule?.criteriaItems, rule?.booleanFilter) : rule?.formula ? JSON.stringify(rule.formula) : "None";
        const actions = rule?.escalationAction ? this.formatActions(rule?.escalationAction) : "None";
        this.globalRuleTableLines.push(`| ${order} | ${criteria} | ${actions} |`);
        order++;
      }
    }
  }

  formatActions(actionItems: any[]): string {
    if (!actionItems || actionItems.length === 0) {
      return "None";
    } else {
      if (!Array.isArray(actionItems)) {
        actionItems = [actionItems];
      }
      return actionItems
        .map((x => this.formatActionItem(x)))
        .join('');
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
    return '(**'
      + ci.field.split('.')[0] + '**: '
      + ci.field.substring(ci.field.indexOf('.') + 1) + ' _'
      + ci.operation + '_ '
      + (ci.value ? String(ci.value).replaceAll(",", ", ") : "' '") + ')<br>';
  }

  formatActionItem(ai: any): string {
    return '<table> <tbody>  <tr>  <td>**Mins to escalations**:</td>  <td>' + ai.minutesToEscalation + '</td>  </tr>  <tr>  <td>**Assign To**:</td>  <td>' + ai.assignedTo + '</td>  </tr>  <tr>  <td>**Notify**:</td>  <td>' + (ai.notifyTo ?? 'None') + '</td>  </tr>  </tbody>  </table> ';
  }
}
