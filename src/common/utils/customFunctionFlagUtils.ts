import { CustomFunctionInput, CustomFunctionOutput } from './customFunctionUtils.js';

/**
 * Parsers for the compact flag syntax that lets an agent declare a whole custom function contract
 * on a single command line, without writing YAML.
 */

/**
 * Parse an input declaration.
 * Format: "name[:type][:required][|option1,option2][=default]", entries separated by ";".
 *
 * Examples:
 *   channel:string:required
 *   severity:select|info,warning,critical=info
 *   retries:number=3
 *   webhookToken:secret:required
 */
export function parseInputsFlag(rawValue: string): CustomFunctionInput[] {
  return splitEntries(rawValue).map((entry) => {
    let remainder = entry;

    // The default comes last, so it is peeled off first: a default value may itself contain
    // a ":" or a "|" (a URL, a cron expression) and must not be parsed as type or options.
    let defaultValue: string | undefined;
    const equalsIndex = remainder.indexOf('=');
    if (equalsIndex > -1) {
      defaultValue = remainder.slice(equalsIndex + 1).trim();
      remainder = remainder.slice(0, equalsIndex);
    }

    let options: string[] | undefined;
    const pipeIndex = remainder.indexOf('|');
    if (pipeIndex > -1) {
      options = parseCommaSeparated(remainder.slice(pipeIndex + 1));
      remainder = remainder.slice(0, pipeIndex);
    }

    const parts = remainder.split(':').map((part) => part.trim());
    const input: CustomFunctionInput = { name: parts[0] };
    if (parts[1]) {
      input.type = parts[1] as CustomFunctionInput['type'];
    }
    if (parts.slice(2).includes('required')) {
      input.required = true;
    }
    if (options) {
      input.options = options;
    }
    if (defaultValue !== undefined && defaultValue !== '') {
      input.default = castInputDefault(defaultValue, input.type || 'string');
    }
    return input;
  });
}

/** Parse an output declaration: "name[:type]" entries separated by ";". */
export function parseOutputsFlag(rawValue: string): CustomFunctionOutput[] {
  return splitEntries(rawValue).map((entry) => {
    const parts = entry.split(':').map((part) => part.trim());
    const output: CustomFunctionOutput = { name: parts[0] };
    if (parts[1]) {
      output.type = parts[1];
    }
    return output;
  });
}

/**
 * Parse the repeatable --function-input flag of the action commands: one "name=value" per
 * occurrence. The value may contain "=" (a query string, a ${{ }} reference), so only the first
 * one separates the name from the value.
 */
export function parseFunctionInputFlags(rawValues: string[] = []): Record<string, string> {
  const parameters: Record<string, string> = {};
  for (const rawValue of rawValues) {
    const equalsIndex = String(rawValue).indexOf('=');
    if (equalsIndex < 1) {
      continue;
    }
    const name = String(rawValue).slice(0, equalsIndex).trim();
    if (name) {
      parameters[name] = String(rawValue).slice(equalsIndex + 1);
    }
  }
  return parameters;
}

/**
 * Give the values collected from --function-input the type their input declares.
 *
 * A flag value is always a string, while the interactive prompts already produce real numbers and
 * booleans. Without this, the same action written the two ways would store `retries: "3"` in one
 * case and `retries: 3` in the other, and the JSON schema declares these inputs typed.
 * A value carrying a ${{ }} reference is left alone: its type is only known at run time.
 */
export function castFunctionInputValues(
  values: Record<string, string>,
  definition: { inputs?: CustomFunctionInput[] }
): Record<string, any> {
  const typedValues: Record<string, any> = {};
  for (const [name, rawValue] of Object.entries(values)) {
    const input = (definition.inputs || []).find((declared) => declared.name === name);
    if (!input || typeof rawValue !== 'string' || rawValue.includes('${{')) {
      typedValues[name] = rawValue;
      continue;
    }
    typedValues[name] = castInputDefault(rawValue, input.type || 'string');
  }
  return typedValues;
}

function splitEntries(rawValue: string): string[] {
  return String(rawValue || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseCommaSeparated(rawValue: string): string[] {
  return String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/** A default declared as text becomes the type the input declares, so the YAML stays typed. */
export function castInputDefault(rawValue: string, inputType: string): any {
  if (inputType === 'number') {
    const numberValue = Number(rawValue);
    return Number.isFinite(numberValue) ? numberValue : rawValue;
  }
  if (inputType === 'boolean') {
    return ['true', '1', 'yes'].includes(rawValue.toLowerCase());
  }
  return rawValue;
}
