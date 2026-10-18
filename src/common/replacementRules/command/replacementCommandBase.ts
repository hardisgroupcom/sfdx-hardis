import { SfCommand } from '@salesforce/sf-plugins-core';
import { SfError } from '@salesforce/core';
import c from 'chalk';
import { uxLog } from '../../utils/index.js';
import { prompts } from '../../utils/prompts.js';
import { t } from '../../utils/i18n.js';
import { listMajorOrgs } from '../../utils/orgConfigUtils.js';
import { WebSocketClient } from '../../websocketClient.js';
import {
  readRulesFromFile,
  resolveBranchConfigFile,
  resolveProjectConfigFile,
  writeRulesToFile,
} from '../config/ruleConfig.js';
import { readIssueRules, writeIssueRules } from '../config/issueRulesStore.js';
import { DEFAULT_VALUE_KEY, REPLACEMENT_RULE_TYPES, ReplacementRule, ReplacementRuleLayer, RulePlace } from '../utils/types.js';
import { RULE_TYPE_LABEL_KEYS } from './ruleFlags.js';

/**
 * Base class of hardis:project:replacement:* commands: where a rule is stored, how the rules of a
 * place are read and written, and the prompts shared by create and update.
 */
export abstract class ReplacementCommandBase extends SfCommand<any> {
  protected requireFlag(value: any, flagName: string): string {
    if (value === undefined || value === null || value === '') {
      throw new SfError(t('missingRequiredFlag', { flag: flagName }));
    }
    return value;
  }

  /** The place from --layer / --branch, prompted when interactive */
  protected async resolvePlace(flags: any, headless: boolean): Promise<RulePlace> {
    const layer: ReplacementRuleLayer = headless
      ? (this.requireFlag(flags.layer, 'layer') as ReplacementRuleLayer)
      : flags.layer ||
      (await this.promptSelect(t('replacementRulesSelectLayer'), [
        { title: t('replacementRulesLayerProject'), value: 'project', description: resolveProjectConfigFile() },
        { title: t('replacementRulesLayerBranch'), value: 'branch', description: 'config/branches/' },
        { title: t('replacementRulesLayerIssue'), value: 'issue', description: t('replacementRulesLayerIssueDescription') },
      ]));
    if (layer !== 'branch') {
      return { layer };
    }
    const branch = headless
      ? this.requireFlag(flags.branch, 'branch')
      : flags.branch || (await this.promptSelect(t('replacementRulesSelectBranch'), (await listMajorOrgs()).map((org: any) => ({ title: org.branchName, value: org.branchName }))));
    return { layer, branch };
  }

  protected async readPlaceRules(place: RulePlace): Promise<ReplacementRule[]> {
    if (place.layer === 'issue') {
      const issue = await readIssueRules({ useCache: false });
      if (issue.error) {
        throw new SfError(t('replacementRulesIssueUnreadable', { message: issue.error }));
      }
      return issue.rules;
    }
    return readRulesFromFile(this.placeFile(place));
  }

  /** Write the rules of a place and report where. Returns the file or the issue URL. */
  protected async writePlaceRules(place: RulePlace, rules: ReplacementRule[]): Promise<string> {
    let location: string;
    if (place.layer === 'issue') {
      const issue = await writeIssueRules(rules);
      location = issue.url;
    } else {
      location = this.placeFile(place);
      await writeRulesToFile(location, rules);
    }
    WebSocketClient.sendRefreshPipelineMessage();
    return location;
  }

  protected placeLabel(place: RulePlace): string {
    if (place.layer === 'issue') {
      return t('replacementRulesLayerIssue');
    }
    return this.placeFile(place);
  }

  /** Prompt every field of a new rule */
  protected async promptNewRule(id: string | undefined): Promise<ReplacementRule> {
    const ruleId = id || (await this.promptText(t('replacementRulesEnterId'), '')).trim();
    const type = await this.promptSelect(
      t('replacementRulesSelectType'),
      REPLACEMENT_RULE_TYPES.map((ruleType) => ({ title: t(RULE_TYPE_LABEL_KEYS[ruleType]), value: ruleType }))
    );
    const rule: ReplacementRule = { id: ruleId, type };
    const description = (await this.promptText(t('replacementRulesEnterDescription'), '')).trim();
    if (description) {
      rule.description = description;
    }
    rule.files = (await this.promptText(t('replacementRulesEnterFiles'), '')).trim();
    if (type === 'text') {
      rule.find = await this.promptText(t('replacementRulesEnterFind'), '');
      rule.regex = await this.promptConfirm(t('replacementRulesFindIsRegex'), false);
    } else {
      rule.xmlPath = (await this.promptText(t('replacementRulesEnterXmlPath'), '')).trim();
    }
    if (type !== 'xml-remove') {
      await this.promptValueSource(rule);
    }
    rule.required = await this.promptConfirm(t('replacementRulesRequiredPrompt'), false);
    return rule;
  }

  /** Prompt the value of a rule: same for every org, one per major branch, or a secret */
  protected async promptValueSource(rule: ReplacementRule): Promise<void> {
    const source = await this.promptSelect(t('replacementRulesSelectValueSource'), [
      { title: t('replacementRulesValueSourceSingle'), value: 'value' },
      { title: t('replacementRulesValueSourcePerOrg'), value: 'values' },
      { title: t('replacementRulesValueSourceSecret'), value: 'secret' },
    ]);
    delete rule.value;
    delete rule.values;
    delete rule.secret;
    if (source === 'value') {
      rule.value = await this.promptText(t('replacementRulesEnterValue'), '');
    } else if (source === 'secret') {
      rule.secret = (await this.promptText(t('replacementRulesEnterSecret'), '')).trim();
    } else {
      const values: Record<string, string> = {};
      for (const org of await listMajorOrgs()) {
        const value = await this.promptText(t('replacementRulesEnterValueFor', { branch: org.branchName }), '');
        if (value !== '') {
          values[org.branchName] = value;
        }
      }
      const defaultValue = await this.promptText(t('replacementRulesEnterDefaultValue'), '');
      if (defaultValue !== '') {
        values[DEFAULT_VALUE_KEY] = defaultValue;
      }
      rule.values = values;
    }
  }

  protected logRuleSummary(rule: ReplacementRule): void {
    for (const [key, value] of Object.entries(rule)) {
      // A secret is a variable name, never a value: it can be shown
      uxLog('log', this, c.grey(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`));
    }
  }

  protected async promptText(message: string, initial: string): Promise<string> {
    const response = await prompts({ type: 'text', name: 'value', message: c.cyanBright(message), initial, description: message });
    return response.value || '';
  }

  protected async promptSelect(message: string, choices: any[]): Promise<any> {
    const response = await prompts({ type: 'select', name: 'value', message: c.cyanBright(message), choices, description: message });
    return response.value;
  }

  protected async promptConfirm(message: string, initial = false): Promise<boolean> {
    const response = await prompts({ type: 'confirm', name: 'value', message: c.cyanBright(message), initial, description: message });
    return response.value === true;
  }

  private placeFile(place: RulePlace): string {
    return place.layer === 'branch' ? resolveBranchConfigFile(place.branch as string) : resolveProjectConfigFile();
  }
}
