import { SfCommand } from '@salesforce/sf-plugins-core';
import { SfError } from '@salesforce/core';
import c from 'chalk';
import { isCI } from '../../../../common/utils/index.js';
import { ActionScope, ActionWhen } from '../../../../common/utils/actionUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';

/**
 * Base class for hardis:project:action:* commands.
 * Provides shared interactive/headless helpers used across list, create, update, delete, and reorder.
 */
export abstract class ActionCommandBase extends SfCommand<any> {

  /** Throw if a required flag is missing in agent/CI mode. */
  protected requireFlag(value: any, flagName: string): string {
    if (!value) {
      throw new SfError(t('missingRequiredFlag', { flag: flagName }));
    }
    return value;
  }

  /**
   * Collect --scope and --when: uses flag values in agent/CI mode,
   * falls back to interactive prompts in interactive mode.
   */
  protected async collectScopeAndWhen(flags: any, agentMode: boolean): Promise<{ scope: ActionScope; when: ActionWhen }> {
    const scope: ActionScope = agentMode || isCI
      ? this.requireFlag(flags.scope, 'scope') as ActionScope
      : flags.scope || await this.promptSelect(t('selectActionScope'), [
        { title: t('actionScopeProject'), value: 'project' },
        { title: t('actionScopeBranch'), value: 'branch' },
        { title: t('actionScopePr'), value: 'pr' },
      ]);

    const when: ActionWhen = agentMode || isCI
      ? this.requireFlag(flags.when, 'when') as ActionWhen
      : flags.when || await this.promptSelect(t('selectActionWhen'), [
        { title: t('actionWhenPreDeploy'), value: 'pre-deploy' },
        { title: t('actionWhenPostDeploy'), value: 'post-deploy' },
      ]);

    return { scope, when };
  }

  protected async promptSelect(message: string, choices: any[], initial?: string): Promise<any> {
    const initialIndex = initial != null ? choices.findIndex(c2 => c2.value === initial) : 0;
    const response = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(message),
      choices,
      initial: initialIndex >= 0 ? initialIndex : 0,
      description: message,
    });
    return response.value;
  }

  protected async promptText(message: string, initial: string): Promise<string> {
    const response = await prompts({
      type: 'text',
      name: 'value',
      message: c.cyanBright(message),
      initial,
      description: message,
    });
    return response.value || '';
  }

  /**
   * Resolve action ID: use flag in agent/CI mode, flag value if provided, or prompt interactively.
   * `promptMessage` is the i18n key for the interactive select prompt.
   */
  protected async resolveActionId(flags: any, agentMode: boolean, actions: any[], promptMessage: string): Promise<string> {
    if (agentMode || isCI) {
      return this.requireFlag(flags['action-id'], 'action-id');
    }
    if (flags['action-id']) {
      return flags['action-id'];
    }
    return this.promptSelect(promptMessage, actions.map(a => ({
      title: `${a.label} (${a.type})`,
      value: a.id,
      description: a.id,
    })));
  }

  protected async promptConfirm(message: string, initial = false): Promise<boolean> {
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message: c.cyanBright(message),
      default: initial,
      initial,
      description: message,
    });
    return response.value === true;
  }
}
