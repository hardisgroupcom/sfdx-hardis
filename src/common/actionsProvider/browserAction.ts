import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs';
import { ActionsProvider, ActionParameterDescription, ActionResult, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import type { BrowserforceApplyOptions, BrowserforceApplyOutcome } from './browserforce/browserforceRunner.js';

const BROWSER_FLAGS = ['browser-setting', 'browser-config'];

/**
 * Applies one Browserforce setting (sfdx-browserforce-plugin) to the org: a Setup setting the
 * Metadata API cannot deploy, changed by driving the Setup pages in a headless browser.
 * In a deployment check nothing is changed: Browserforce reads the org and reports what would change.
 */
export class BrowserAction extends ActionsProvider {
  public getLabel(): string {
    return 'BrowserAction';
  }

  public getFlagNames(): string[] {
    return BROWSER_FLAGS;
  }

  // The deployment check runs it as a dry run, which shows in the Pull Request what will change
  public getDefaultContext(): PrePostCommand['context'] {
    return 'all';
  }

  public getParameterDescriptions(): ActionParameterDescription[] {
    return [
      {
        name: 'setting',
        path: 'parameters.setting',
        flag: 'browser-setting',
        type: 'string',
        required: true,
        description: 'Key of the Browserforce setting to apply (densitySettings, companyInformation...). List them with sf hardis:project:action:types --type browser',
      },
      {
        name: 'config',
        path: 'parameters.config',
        flag: 'browser-config',
        type: 'json',
        required: true,
        description: 'Value of the setting, as JSON (or the path of a .json file for the flag). Its format: sf hardis:project:action:types --type browser --browser-setting <key>. Write "${VARIABLE}" for a secret or a value that differs per org',
      },
    ];
  }

  public async describeTypeDetails(flags: any): Promise<Record<string, any>> {
    const { getBrowserforceCatalog, findBrowserforceSetting, findDeprecatedBrowserforceSetting } = await import('./browserforce/browserforceCatalog.js');
    const { describeSecretsLookup } = await import('./browserforce/browserforceVariables.js');
    const catalog = await getBrowserforceCatalog();
    const secretsLookup = await describeSecretsLookup();
    const settingKey = flags?.['browser-setting'];
    if (!settingKey) {
      return {
        browserforceVersion: catalog.browserforceVersion,
        settings: catalog.plugins.map((setting) => ({
          key: setting.key,
          title: setting.title,
          description: setting.description,
          warnings: setting.warnings,
        })),
        deprecatedSettings: catalog.deprecatedSettings,
        secretsLookup,
      };
    }
    const setting = findBrowserforceSetting(catalog, settingKey);
    if (!setting) {
      const deprecated = findDeprecatedBrowserforceSetting(catalog, settingKey);
      throw new SfError(deprecated
        ? t('actionValidationBrowserDeprecatedSetting', { setting: settingKey, message: deprecated.message })
        : t('actionValidationBrowserUnknownSetting', { setting: settingKey, version: catalog.browserforceVersion }));
    }
    return { browserforceVersion: catalog.browserforceVersion, setting, secretsLookup };
  }

  // The settings Browserforce can apply, or the example of the setting described
  public async logTypeDetails(details: Record<string, any>, commandThis: any): Promise<void> {
    if (Array.isArray(details.settings)) {
      const { uxLogTableWithReport } = await import('../utils/filesUtils.js');
      uxLog('action', commandThis, c.cyan(t('browserforceSettingsTitle')));
      await uxLogTableWithReport(commandThis, details.settings.map((setting: any) => ({ key: setting.key, title: setting.title || '' })), ['key', 'title'], {
        fileNamePrefix: 'browserforce-settings',
        fileTitle: t('browserforceSettingsTitle'),
      });
    } else if (details.setting) {
      uxLog('action', commandThis, c.cyan(`${details.setting.title || details.setting.key} (${details.setting.key})`));
      for (const warning of (await import('./browserforce/browserforceCatalog.js')).describeSettingWarnings(details.setting)) {
        uxLog('warning', commandThis, c.yellow(warning));
      }
      uxLog('log', commandThis, c.grey(JSON.stringify(details.setting.examples?.[0] ?? {}, null, 2)));
    }
  }

  public async collectParameters(flags: any, headless: boolean, current: PrePostCommand['parameters'] = {}): Promise<Record<string, any>> {
    const collected: Record<string, any> = this.applyFlags({ ...(current || {}) }, flags);
    if (headless) {
      if (!collected.setting) {
        throw new SfError(t('missingRequiredFlag', { flag: 'browser-setting' }));
      }
      if (collected.config === undefined) {
        throw new SfError(t('missingRequiredFlag', { flag: 'browser-config' }));
      }
      return collected;
    }
    return await this.promptParameters(flags, collected);
  }

  public applyFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
    const updated: Record<string, any> = { ...(parameters || {}) };
    if (flags['browser-setting'] !== undefined && flags['browser-setting'] !== updated.setting) {
      updated.setting = flags['browser-setting'];
      // The value of another setting has no meaning for this one
      if (flags['browser-config'] === undefined) {
        delete updated.config;
      }
    }
    if (flags['browser-config'] !== undefined) {
      updated.config = parseConfigFlag(flags['browser-config'], updated.setting);
    }
    return orderParameters(updated);
  }

  public async getDefinitionErrors(action: Partial<PrePostCommand>): Promise<string[]> {
    const errors = listShapeErrors(action.parameters);
    if (errors.length > 0) {
      return errors;
    }
    const setting = String(action.parameters!.setting);
    const { getBrowserforceCatalog, findBrowserforceSetting, findDeprecatedBrowserforceSetting, validateBrowserforceConfig } = await import('./browserforce/browserforceCatalog.js');
    const catalog = await getBrowserforceCatalog();
    if (!findBrowserforceSetting(catalog, setting)) {
      const deprecated = findDeprecatedBrowserforceSetting(catalog, setting);
      return [deprecated
        ? t('actionValidationBrowserDeprecatedSetting', { setting, message: deprecated.message })
        : t('actionValidationBrowserUnknownSetting', { setting, version: catalog.browserforceVersion })];
    }
    const validation = await validateBrowserforceConfig(setting, action.parameters!.config);
    return validation.errors.map((error) => `${error.path}: ${error.message}`);
  }

  public async getDefinitionHelp(action: Partial<PrePostCommand>): Promise<Record<string, any> | null> {
    const settingKey = action.parameters?.setting;
    const { getBrowserforceCatalog, findBrowserforceSetting } = await import('./browserforce/browserforceCatalog.js');
    const catalog = await getBrowserforceCatalog();
    const setting = settingKey ? findBrowserforceSetting(catalog, settingKey) : null;
    if (!setting) {
      return { availableSettings: catalog.plugins.map((plugin) => plugin.key) };
    }
    return {
      setting: {
        key: setting.key,
        title: setting.title,
        fields: setting.fields,
        groups: setting.groups,
        example: setting.examples[0],
        warnings: setting.warnings,
      },
    };
  }

  public async getSaveDetails(action: Partial<PrePostCommand>): Promise<Record<string, any> | null> {
    const { describeVariableLookups } = await import('./browserforce/browserforceVariables.js');
    const environmentVariables = await describeVariableLookups(action.parameters?.config);
    if (environmentVariables.length === 0) {
      return null;
    }
    const names = [...new Set(environmentVariables.flatMap((variable) => variable.lookupByBranch.flatMap((branch) => branch.names)))];
    uxLog('warning', this, c.yellow(t('browserVariablesToDeclare', { variables: names.join(', ') })));
    uxLog('warning', this, c.yellow(t('browserVariablesWorkflowEnv')));
    return { environmentVariables };
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const errors = listShapeErrors(cmd.parameters);
    if (errors.length > 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${errors.join('\n')}`));
      return { statusCode: 'failed', skippedReason: errors.join('\n') };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    // Without an org, sf browserforce apply would get --target-org "" and fail with an unrelated message
    const username: string | undefined = this.customUsernameToUse || globalThis.jsForceConn?.getUsername();
    if (!username) {
      const message = t('browserforceNoTargetOrg');
      uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
      return { statusCode: 'failed', output: message };
    }
    const outcome = await this.applyWithBrowserforce({
      setting: String(cmd.parameters!.setting),
      config: cmd.parameters!.config,
      username,
      dryRun: cmd.pipelineContext?.checkOnly === 'true',
      targetBranch: cmd.pipelineContext?.targetBranch || null,
    });
    return { statusCode: outcome.success ? 'success' : 'failed', output: outcome.outputLines.join('\n') };
  }

  // Overridden by the tests, which cannot start a browser
  protected async applyWithBrowserforce(options: BrowserforceApplyOptions): Promise<BrowserforceApplyOutcome> {
    const { runBrowserforceApply } = await import('./browserforce/browserforceRunner.js');
    return runBrowserforceApply(options);
  }

  private async promptParameters(flags: any, collected: Record<string, any>): Promise<Record<string, any>> {
    // Loaded only when prompting, so running the action never loads the prompt dependencies
    const { promptActionSelect, promptActionText } = await import('../utils/actionPromptUtils.js');
    const { getBrowserforceCatalog, findBrowserforceSetting, describeSettingWarnings, validateBrowserforceConfig } = await import('./browserforce/browserforceCatalog.js');
    const catalog = await getBrowserforceCatalog();
    if (flags['browser-setting'] === undefined) {
      const choices = catalog.plugins.map((setting) => ({
        title: setting.title ? `${setting.title} (${setting.key})` : setting.key,
        value: setting.key,
        description: [setting.description, ...describeSettingWarnings(setting)].filter(Boolean).join('\n'),
      }));
      const selected = await promptActionSelect(t('selectBrowserforceSetting'), choices, collected.setting);
      if (!selected) {
        throw new SfError(t('browserforceSettingNotSelected'));
      }
      if (selected !== collected.setting) {
        delete collected.config;
      }
      collected.setting = selected;
    }
    const setting = findBrowserforceSetting(catalog, collected.setting);
    // An unknown key from --browser-setting would make every value invalid: the loop below would never end
    if (!setting) {
      throw new SfError(t('actionValidationBrowserUnknownSetting', { setting: collected.setting, version: catalog.browserforceVersion }));
    }
    uxLog('action', this, c.cyan(t('browserforceSettingSelected', { setting: collected.setting })));
    for (const warning of describeSettingWarnings(setting)) {
      uxLog('warning', this, c.yellow(warning));
    }
    if (flags['browser-config'] !== undefined) {
      return orderParameters(collected);
    }
    let initial = JSON.stringify(collected.config ?? setting.examples?.[0] ?? {});
    // Asked again until the value is valid JSON that Browserforce accepts: nothing typed is lost
    for (;;) {
      const answer = await promptActionText(t('enterBrowserforceConfig', { setting: collected.setting }), initial);
      // A cancelled prompt answers nothing: stop instead of asking forever
      if (answer.trim() === '') {
        throw new SfError(t('browserforceConfigNotEntered', { setting: collected.setting }));
      }
      initial = answer;
      let config: any;
      try {
        config = JSON.parse(answer);
      } catch (e) {
        uxLog('action', this, c.red(t('browserforceConfigInvalidJson', { setting: collected.setting, message: (e as Error).message })));
        continue;
      }
      const validation = await validateBrowserforceConfig(collected.setting, config);
      if (validation.valid) {
        collected.config = config;
        return orderParameters(collected);
      }
      uxLog('action', this, c.red(t('browserforceConfigErrors', {
        setting: collected.setting,
        errors: validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
      })));
    }
  }
}

// --browser-config takes JSON, or the path of a .json file: JSON on a command line does not survive
// the quoting of every shell
function parseConfigFlag(value: any, setting: string | undefined): any {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  const text = /\.json$/i.test(trimmed) && fs.existsSync(trimmed) ? fs.readFileSync(trimmed, 'utf8') : trimmed;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SfError(t('browserforceConfigInvalidJson', { setting: setting || '?', message: (e as Error).message }));
  }
}

// The setting first, then its value, so the YAML reads in that order
function orderParameters(parameters: Record<string, any>): Record<string, any> {
  const { setting, config, ...otherParameters } = parameters;
  return {
    ...(setting !== undefined ? { setting } : {}),
    ...(config !== undefined ? { config } : {}),
    ...otherParameters,
  };
}

function listShapeErrors(parameters: PrePostCommand['parameters']): string[] {
  const errors: string[] = [];
  if (!parameters?.setting || typeof parameters.setting !== 'string') {
    errors.push(t('actionValidationBrowserNoSetting'));
  }
  const config = parameters?.config;
  if (config === undefined || config === null || typeof config !== 'object') {
    errors.push(t('actionValidationBrowserNoConfig'));
  }
  return errors;
}
