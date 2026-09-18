import { SfCommand } from '@salesforce/sf-plugins-core';
import { SfError } from '@salesforce/core';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  CUSTOM_FUNCTION_INPUT_TYPES,
  CUSTOM_FUNCTION_RUNTIMES,
  CustomFunctionDefinition,
  CustomFunctionInput,
  CustomFunctionOutput,
} from '../../../../common/utils/customFunctionUtils.js';
import { castInputDefault, parseCommaSeparated } from '../../../../common/utils/customFunctionFlagUtils.js';

/**
 * Base class for hardis:project:function:* commands.
 * Holds the interactive helpers shared by create and update.
 */
export abstract class FunctionCommandBase extends SfCommand<any> {

  protected requireFlag(value: any, flagName: string): string {
    if (!value) {
      throw new SfError(t('missingRequiredFlag', { flag: flagName }));
    }
    return value;
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

  protected async promptSelect(message: string, choices: any[], initial?: string): Promise<any> {
    const initialIndex = initial != null ? choices.findIndex((choice) => choice.value === initial) : 0;
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

  protected async promptRuntime(initial?: string): Promise<string> {
    return this.promptSelect(
      t('selectCustomFunctionRuntime'),
      CUSTOM_FUNCTION_RUNTIMES.map((runtime) => ({ title: runtime, value: runtime })),
      initial
    );
  }

  /**
   * Collect the input contract interactively, one input at a time.
   * `existingInputs` pre-fills the list when updating, so the loop adds to what is already there.
   */
  protected async promptInputs(existingInputs: CustomFunctionInput[] = []): Promise<CustomFunctionInput[]> {
    const inputs: CustomFunctionInput[] = [...existingInputs];
    for (; ;) {
      const summary = inputs.length > 0
        ? inputs.map((input) => `${input.name} (${input.type || 'string'})`).join(', ')
        : t('customFunctionNoInputYet');
      const addMore = await this.promptConfirm(t('customFunctionAddInput', { inputs: summary }));
      if (!addMore) {
        return inputs;
      }
      const name = (await this.promptText(t('enterCustomFunctionInputName'), '')).trim();
      if (!name) {
        continue;
      }
      const inputType = await this.promptSelect(
        t('selectCustomFunctionInputType'),
        CUSTOM_FUNCTION_INPUT_TYPES.map((type) => ({ title: type, value: type }))
      );
      const input: CustomFunctionInput = { name, type: inputType };
      const label = (await this.promptText(t('enterCustomFunctionInputLabel'), '')).trim();
      if (label) {
        input.label = label;
      }
      if (inputType === 'select') {
        input.options = parseCommaSeparated(await this.promptText(t('enterCustomFunctionInputOptions'), ''));
      }
      input.required = await this.promptConfirm(t('customFunctionInputRequired', { name }));
      // A secret input holds the NAME of a CI/CD variable, so a default value would be misleading
      if (inputType !== 'secret') {
        const defaultValue = (await this.promptText(t('enterCustomFunctionInputDefault'), '')).trim();
        if (defaultValue) {
          input.default = castInputDefault(defaultValue, inputType);
        }
      }
      inputs.push(input);
    }
  }

  protected async promptOutputs(existingOutputs: CustomFunctionOutput[] = []): Promise<CustomFunctionOutput[]> {
    const outputs: CustomFunctionOutput[] = [...existingOutputs];
    for (; ;) {
      const summary = outputs.length > 0
        ? outputs.map((output) => output.name).join(', ')
        : t('customFunctionNoOutputYet');
      const addMore = await this.promptConfirm(t('customFunctionAddOutput', { outputs: summary }));
      if (!addMore) {
        return outputs;
      }
      const name = (await this.promptText(t('enterCustomFunctionOutputName'), '')).trim();
      if (!name) {
        continue;
      }
      const output: CustomFunctionOutput = { name };
      const label = (await this.promptText(t('enterCustomFunctionOutputLabel'), '')).trim();
      if (label) {
        output.label = label;
      }
      outputs.push(output);
    }
  }

  /** Log a function definition, the way logActionSummary logs an action. */
  protected logFunctionSummary(definition: CustomFunctionDefinition): void {
    uxLog('log', this, c.grey(`  id: ${definition.id}`));
    uxLog('log', this, c.grey(`  label: ${definition.label || ''}`));
    uxLog('log', this, c.grey(`  runtime: ${definition.runtime}`));
    uxLog('log', this, c.grey(`  script: ${definition.script}`));
    if (definition.when) {
      uxLog('log', this, c.grey(`  when: ${definition.when}`));
    }
    if (definition.timeout) {
      uxLog('log', this, c.grey(`  timeout: ${definition.timeout}`));
    }
    for (const input of definition.inputs || []) {
      uxLog('log', this, c.grey(`  input: ${input.name} (${input.type || 'string'}${input.required ? ', required' : ''})`));
    }
    for (const output of definition.outputs || []) {
      uxLog('log', this, c.grey(`  output: ${output.name}`));
    }
  }
}
