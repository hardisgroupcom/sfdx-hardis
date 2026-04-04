import { parse, extract } from '@steedos/formula';

/**
 * Supported Salesforce field data types as recognised by Formulon.
 */
export type FormulaDataType =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'time'
  | 'datetime'
  | 'geolocation'
  | 'null';

/**
 * A single Formulon-compatible variable descriptor.
 * Mirrors the shape Formulon expects as the second argument to `parse()`.
 */
export interface FormulaVariable {
  type: 'literal';
  dataType: FormulaDataType;
  value: unknown;
  options?: Record<string, unknown>;
}

/**
 * A map of field API names → their Formulon variable descriptor,
 * representing the field values of one record.
 */
export type FormulaVariableMap = Record<string, FormulaVariable>;

/**
 * The outcome of evaluating a formula against one record.
 */
export interface FormulaEvaluationResult {
  /** 0-based index of the record in the input array */
  recordIndex: number;
  /** The original variable map that was passed in */
  variables: FormulaVariableMap;
  /** Raw result returned by Formulon */
  result: FormulaParseResult;
  /** true when Formulon returned a result of type 'error' */
  isError: boolean;
}

/**
 * Union of the two shapes Formulon can return from `parse()`.
 */
export type FormulaParseResult = FormulaLiteralResult | FormulaErrorResult;

export interface FormulaLiteralResult {
  type: 'literal';
  value: unknown;
  dataType: FormulaDataType;
  options?: Record<string, unknown>;
}

export interface FormulaErrorResult {
  type: 'error';
  errorType: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Aggregated output of `evaluateFormulaForRecords`.
 */
export interface FormulaEvaluationSummary {
  formula: string;
  /** Field API names referenced in the formula (via Formulon `extract`) */
  referencedVariables: string[];
  results: FormulaEvaluationResult[];
  /** How many records evaluated without error */
  successCount: number;
  /** How many records had a formula error */
  errorCount: number;
}

/**
 * Evaluates a Salesforce formula against one or more records.
 *
 * Each entry in `records` represents one record and must be a map of
 * field API name → Formulon variable descriptor (see `FormulaVariableMap`).
 *
 * @example
 * ```ts
 * const summary = await evaluateFormulaForRecords(
 *   'IF(IsActive__c, "Active", "Inactive")',
 *   [
 *     { IsActive__c: { type: 'literal', dataType: 'checkbox', value: true } },
 *     { IsActive__c: { type: 'literal', dataType: 'checkbox', value: false } },
 *   ]
 * );
 * ```
 */
export async function evaluateFormulaForRecords(
  formula: string,
  records: FormulaVariableMap[],
): Promise<FormulaEvaluationSummary> {
  let referencedVariables: string[] = [];
  try {
    referencedVariables = extract(formula);
  } catch (_) {
    // even if not parseable, we still want to return a structured error
  }

  const results: FormulaEvaluationResult[] = records.map((variables, recordIndex) => {
    let isError = false;
    let rawResult: FormulaParseResult;
    try {
      rawResult = parse(formula, variables) as FormulaParseResult;
      isError = rawResult.type === 'error';
    } catch (_) {
      rawResult = { errorType: 'Unparsable formula', message: 'The formula couldn\'t be parsed.' } as FormulaErrorResult;
      isError = true;
    }
    return { recordIndex, variables, result: rawResult, isError };
  });

  const errorCount = results.filter((r) => r.isError)?.length;

  return {
    formula,
    referencedVariables,
    results,
    successCount: results?.length ? results.length - errorCount : 0,
    errorCount,
  };
}

/**
 * Formats a `FormulaEvaluationSummary` into a human-readable string
 * suitable for CLI output via `uxLog`.
 */
export function formatEvaluationSummary(summary: FormulaEvaluationSummary): string {
  const lines: string[] = [];

  lines.push(`Formula : ${summary.formula}`);

  if (summary.referencedVariables.length > 0) {
    lines.push(`Variables referenced: ${summary.referencedVariables.join(', ')}`);
  }

  lines.push(`Records evaluated : ${summary.results.length} (${summary.successCount} ok, ${summary.errorCount} errors)`);
  lines.push('');

  for (const r of summary.results) {
    const prefix = `  [Record ${r.recordIndex + 1}]`;
    if (r.isError) {
      const err = r.result as FormulaErrorResult;
      lines.push(`${prefix} ERROR:  ${err.errorType}: ${err.message}`);
    } else {
      const lit = r.result as FormulaLiteralResult;
      lines.push(`${prefix} ${lit.dataType} → ${JSON.stringify(lit.value)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Converts the summary into a plain JSON-serializable object,
 * ready to be returned from a SfCommand's `run()` for `--json` output.
 */
export function summaryToJson(summary: FormulaEvaluationSummary): Record<string, unknown> {
  return {
    formula: summary.formula,
    referencedVariables: summary.referencedVariables,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    results: summary.results.map((r) => ({
      recordIndex: r.recordIndex,
      variables: r.variables,
      isError: r.isError,
      result: r.result,
    })),
  };
}

/**
 * Builds a model JSON object that the user can fill in and pass back via --inputfile.
 */
export function buildModelJson(
  formula: string
): Record<string, unknown> {
  const placeholderRecord: FormulaVariableMap = {};
  const referencedVariables = extract(formula);
  for (const varName of referencedVariables) {
    placeholderRecord[varName] = {
      type: 'literal',
      dataType: 'text',
      value: '',
      options: {},
    };
  }
 
  return {
    formula,
    records: [
      placeholderRecord,
    ]
  };
}