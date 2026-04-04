import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { extract } from '@steedos/formula';
import c from 'chalk';
import fs from 'fs-extra';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { prompts } from '../../../common/utils/prompts.js';
import { isCI, uxLog, uxLogTable } from '../../../common/utils/index.js';
import {
  evaluateFormulaForRecords,
  formatEvaluationSummary,
  summaryToJson,
  buildModelJson,
  type FormulaVariableMap,
  type FormulaEvaluationSummary,
  type FormulaDataType,
  FormulaEvaluationResult,
  FormulaVariable,
} from '../../../common/utils/formulaUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FormulaEvaluate extends SfCommand<AnyJson> {
  public static title = 'Evaluate Salesforce Formula';

  public static description = `
## Command Behavior

**Evaluates a Salesforce formula against one or more records and returns the result for each.**

This command uses [Formulon](https://github.com/leifg/formulon) to parse and evaluate Salesforce formulas entirely offline, no org connection required.

Key features:

- **Multi-record evaluation:** Supply multiple records (each as a variable map) to evaluate the same formula against all of them in one shot.
- **Inline or file input:** Provide the formula and records directly as CLI flags, or point to a JSON file that contains both.
- **Structured JSON output:** Use \`--json\` to get machine-readable results, including per-record outcomes and any parser errors.
- **Error transparency:** Formulon errors (wrong argument count, type mismatches, etc.) are surfaced per record rather than aborting the whole run.

### Input JSON file format

When using \`--inputfile\`, the file must be a JSON object with the following shape:

\`\`\`json
{
  "formula": "IF(IsActive__c, Amount__c * 1.1, Amount__c)",
  "records": [
    {
      "IsActive__c": { "type": "literal", "dataType": "checkbox", "value": true },
      "Amount__c":   { "type": "literal", "dataType": "number",   "value": 200, "options": { "length": 6, "scale": 2 } }
    },
    {
      "IsActive__c": { "type": "literal", "dataType": "checkbox", "value": false },
      "Amount__c":   { "type": "literal", "dataType": "number",   "value": 150, "options": { "length": 6, "scale": 2 } }
    }
  ]
}
\`\`\`

Each entry in \`records\` is a map of **field API name → Formulon variable descriptor**.  
The variable descriptor shape is:

\`\`\`json
{
  "type": "literal",
  "dataType": "<text|number|checkbox|date|time|datetime|geolocation|null>",
  "value": <js-native-value>,
  "options": { }
}
\`\`\`
`;

  public static examples = [
    `$ sf hardis:formula:evaluate --formula 'IF(TRUE, "Yes", "No")'`,
    `$ sf hardis:formula:evaluate --inputfile ./my-formula.json`,
    `$ sf hardis:formula:evaluate --formula 'Amount__c * 2' --records '[{"Amount__c":{"type":"literal","dataType":"number","value":100,"options":{"length":6,"scale":2}}}]'`,
    `$ sf hardis:formula:evaluate --inputfile ./my-formula.json --json`,
  ];

  public static flags: any = {
    formula: Flags.string({
      char: 'f',
      description:
        'Salesforce formula to evaluate. Ignored when --inputfile is provided.',
    }),
    records: Flags.string({
      char: 'r',
      description:
        'JSON array of record variable maps. Each element represents one record. Ignored when --inputfile is provided.',
    }),
    inputfile: Flags.string({
      char: 'x',
      description:
        'Path to a JSON file containing "formula" and "records". When supplied, --formula and --records are ignored.',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  };

  public static requiresProject = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FormulaEvaluate);
    const debugMode: boolean = flags.debug ?? false;
    let formula: string;
    let records: FormulaVariableMap[] | null = null;
    let lastSummary: FormulaEvaluationSummary | null = null;

    if (flags.inputfile) {
      uxLog('log', this, c.grey(`Reading formula and records from ${flags.inputfile}…`));
      const raw = await fs.readJson(flags.inputfile);

      if (typeof raw?.formula !== 'string') {
        throw new Error(`"formula" key (string) is required in ${flags.inputfile}`);
      }
      if (!Array.isArray(raw?.records)) {
        throw new Error(`"records" key (array) is required in ${flags.inputfile}`);
      }

      formula = raw.formula as string;
      records = raw.records as FormulaVariableMap[];
      lastSummary = await this.evaluate(formula, records);
      this.display(lastSummary, debugMode);
      return summaryToJson(lastSummary) as AnyJson;
    }

    if (flags.formula) {
      formula = flags.formula;

      if (flags.records) {
        try {
          records = JSON.parse(flags.records) as FormulaVariableMap[];
          if (!Array.isArray(records)) throw new Error('--records must be a JSON array.');
        } catch (e: any) {
          throw new Error(`Failed to parse --records as JSON: ${e.message}`);
        }
      }

      records = records ?? [{}];
      lastSummary = await this.evaluate(formula, records);
      this.display(lastSummary, debugMode);
      return summaryToJson(lastSummary) as AnyJson;
    }

    if (isCI) {
      throw new Error('Either --formula or --inputfile must be provided in CI mode.');
    }

    const modeAnswer = await prompts({
      type: 'select',
      name: 'mode',
      message: 'How do you want to evaluate the formula?',
      description: 'Interactive mode lets you fill in values manually and repeat. JSON mode evaluates a set of records from a file.',
      choices: [
        { title: '✏️  [Interactive] fill in values manually (repeatable)', value: 'interactive' },
        { title: '📄  [JSON format] evaluate a set of records from a JSON file', value: 'json' },
      ],
    });

    if (modeAnswer.mode === 'json') {
      lastSummary = await this.runJsonContent(debugMode);
    } else {
      const formulaAnswer = await prompts({
        type: 'text',
        name: 'formula',
        message: 'Enter the Salesforce formula to evaluate',
        description: 'Example: IF(IsActive__c, Amount__c * 1.1, Amount__c)',
        placeholder: 'IF(Active__c, "Yes", "No")',
        validate: (v: string) => (v?.trim() ? true : 'Formula cannot be empty'),
      });

      formula = (formulaAnswer.formula as string).trim();
      const referencedVariables = await extract(formula);
      lastSummary = await this.runInteractiveLoop(formula, referencedVariables, debugMode);
    }

    return summaryToJson(lastSummary!) as AnyJson;
  }

  private async runInteractiveLoop(
    formula: string,
    referencedVariables: string[],
    debugMode: boolean,
  ): Promise<FormulaEvaluationSummary> {
    let summary: FormulaEvaluationSummary | null = null;
    let keepGoing = true;
    let iterationCount = 0;

    const evaluatedRecords: FormulaEvaluationResult[] = [];
    while (keepGoing) {
      iterationCount++;
      uxLog('log', this, c.cyan(`\n[Evaluation ${iterationCount}]`));

      const record: FormulaVariableMap = {};

      if (referencedVariables.length > 0) {
        for (const varName of referencedVariables) {
          const typeAnswer = await prompts({
            type: 'select',
            name: 'dataType',
            message: `Data type for "${varName}"`,
            description: `Select the Salesforce field type that matches ${varName}`,
            choices: [
              { title: 'Text',      value: 'text' },
              { title: 'Number',    value: 'number' },
              { title: 'Checkbox',  value: 'checkbox' },
              { title: 'Date',      value: 'date' },
              { title: 'Time',      value: 'time' },
              { title: 'Datetime',  value: 'datetime' },
              { title: 'Null',      value: 'null' },
            ],
          });

          const dataType = typeAnswer.dataType as FormulaDataType;
          const varQuestion = this.buildVariablePrompt(varName, dataType);
          const varAnswer = await prompts(varQuestion);
          const rawValue = varAnswer[varName];

          record[varName] = {
            type: 'literal',
            dataType,
            value: this.coerceValue(rawValue, dataType),
          };
        }
      } else {
        uxLog('log', this, c.grey('No field variables detected. Evaluating as a constant formula.'));
      }

      const iterationSummary = await this.evaluate(formula, [record]);
      evaluatedRecords.push(...iterationSummary.results);

      const mergedResults: FormulaEvaluationResult[] = evaluatedRecords.map((r, idx) => ({
        ...r,
        recordIndex: idx,
      }));

      summary = {
        ...iterationSummary,
        results:      mergedResults,
        successCount: mergedResults.filter((r) => !r.isError).length,
        errorCount:   mergedResults.filter((r) =>  r.isError).length,
      };

      this.display(summary, debugMode);

      const repeatAnswer = await prompts({
        type: 'confirm',
        name: 'repeat',
        message: 'Evaluate again with different values?',
        description: 'Select Yes to enter new variable values and re-evaluate the same formula.',
        initial: false,
      });

      keepGoing = repeatAnswer.repeat === true;
    }

    return summary!;
  }

  /** Handles the JSON-file input path: generate model if needed, then evaluate. */
  private async runJsonContent(
    debugMode: boolean,
  ): Promise<FormulaEvaluationSummary> {
    const modelContent = JSON.stringify(buildModelJson('IF(MyField__c, \'Yes\', \'No\')'), null, 2)

    const fileAnswer = await prompts({
      type: 'text',
      name: 'fileContent',
      message: 'JSON content for multi-evaluation',
      description: `Edit the "records" array. Each field key maps to a formula variable. Supported dataType values: text | number | checkbox | date | time | datetime | geolocation | null`,
      placeholder: modelContent,
      initial: modelContent,
      validate: async (v: string) => {
        try {
          const parsed = JSON.parse(v);
          if (typeof parsed?.formula !== 'string') return '"formula" key (string) is required';
          if (!Array.isArray(parsed?.records))      return '"records" key (array) is required';
          return true;
        } catch (_) {
          return 'Invalid JSON';
        }
      },
    });

    uxLog('log', this, c.grey(`Reading records from JSON…`));

    try {
      const raw = JSON.parse(fileAnswer.fileContent);
      const resolvedFormula: string = raw.formula;
      const fileRecords: FormulaVariableMap[] = Array.isArray(raw?.records)
        ? (raw.records as FormulaVariableMap[])
        : Array.isArray(raw)
          ? (raw as FormulaVariableMap[])
          : [];

      if (fileRecords.length === 0) {
        throw new Error(`No records found. Make sure the JSON has a "records" array with at least one entry.`);
      }

      const summary = await this.evaluate(resolvedFormula, fileRecords);
      this.display(summary, debugMode);
      return summary;
    } catch (_) {
      throw new Error(`The JSON provided is invalid.`);
    }
  }

  /** Evaluates the formula and pretty-prints per-record results. */
  private async evaluate(
    formula: string,
    records: FormulaVariableMap[]
  ): Promise<FormulaEvaluationSummary> {
    uxLog('log', this, c.grey(`\nEvaluating formula against ${records.length} record(s)…`));

    const normalizedRecords = records.map((record) =>
      Object.fromEntries(
        Object.entries(record).map(([key, descriptor]) => [
          key,
          { ...descriptor, type: descriptor.type ?? ('literal' as const) } as FormulaVariable,
        ])
      )
    );

    return await evaluateFormulaForRecords(formula, normalizedRecords);
  }

  private async display(
    summary: FormulaEvaluationSummary,
    debugMode: boolean
  ) {
    const variableColumns = [
      ...new Set(
        summary.results.flatMap((r) => Object.keys(r.variables))
      )
    ];
    const columns = [
      'record',
      ...variableColumns.map((v) => `${v}_type`),
      ...variableColumns.map((v) => `${v}_value`),
      'result_type',
      'result_value',
      'status',
    ];
 
    uxLog('success', this, c.green(`Formula evaluation results`));
    const tableRows = summary.results.map((r) => {
      const row: Record<string, string> = {
        record: `#${r.recordIndex + 1}`,
      };
 
      for (const varName of variableColumns) {
        const varDescriptor = r.variables[varName];
        row[`${varName}_type`]  = varDescriptor?.dataType ?? '—';
        row[`${varName}_value`] = varDescriptor !== undefined
          ? JSON.stringify(varDescriptor.value)
          : '-';
      }
 
      if (r.isError) {
        const err = r.result as any;
        row['result_type']  = err.errorType ?? 'error';
        row['result_value'] = err.message ?? '';
        row['status']       = 'ERROR';
      } else {
        const lit = r.result as any;
        row['result_type']  = lit.dataType ?? '';
        row['result_value'] = JSON.stringify(lit.value);
        row['status']       = 'OK';
      }
 
      return row;
    });
 
    uxLogTable(this, tableRows, columns);

    if (summary.errorCount === 0) {
      uxLog('action', this, c.green(`Formula evaluated successfully for all ${summary.successCount} record(s).`));
    } else {
      uxLog('warning', this, c.yellow(`Evaluation complete: ${summary.successCount} succeeded, ${summary.errorCount} failed.`));
    }

    if (debugMode) {
      uxLog('log', this, c.grey(formatEvaluationSummary(summary)));
    }
  }

  /** Builds a `PromptsQuestion` for a single formula variable, adapted to its dataType. */
  private buildVariablePrompt(varName: string, dataType: FormulaDataType) {
    const base = {
      name: varName,
      description: `Value for the "${varName}" field (${dataType})`,
      placeholder: '',
    };

    switch (dataType) {
      case 'checkbox':
        return {
          ...base,
          type: 'select' as const,
          message: `Value for "${varName}" (checkbox)`,
          choices: [
            { title: 'TRUE',  value: 'true' },
            { title: 'FALSE', value: 'false' },
          ],
        };

      case 'number':
        return {
          ...base,
          type: 'text' as const,
          message: `Value for "${varName}" (number)`,
          placeholder: '0',
          validate: (v: string) =>
            v?.trim() === '' || !isNaN(Number(v)) ? true : 'Please enter a valid number',
        };

      case 'date':
        return {
          ...base,
          type: 'text' as const,
          message: `Value for "${varName}" (date: YYYY-MM-DD)`,
          placeholder: new Date().toISOString().slice(0, 10),
          validate: (v: string) =>
            /^\d{4}-\d{2}-\d{2}$/.test(v?.trim()) ? true : 'Use YYYY-MM-DD format',
        };

      case 'datetime':
        return {
          ...base,
          type: 'text' as const,
          message: `Value for "${varName}" (datetime: ISO 8601)`,
          placeholder: new Date().toISOString(),
          validate: (v: string) =>
            !isNaN(Date.parse(v?.trim())) ? true : 'Enter a valid ISO 8601 datetime string',
        };

      case 'time':
        return {
          ...base,
          type: 'text' as const,
          message: `Value for "${varName}" (time: HH:MM:SS)`,
          placeholder: '09:00:00',
          validate: (v: string) =>
            /^\d{2}:\d{2}(:\d{2})?$/.test(v?.trim()) ? true : 'Use HH:MM or HH:MM:SS format',
        };

      case 'null':
        return {
          ...base,
          type: 'confirm' as const,
          message: `"${varName}" will be set to null. Confirm?`,
          initial: true,
        };

      default:
        return {
          ...base,
          type: 'text' as const,
          message: `Value for "${varName}" (text)`,
          placeholder: '',
        };
    }
  }

  /** Force the raw string/boolean answer from prompts into the right JS type. */
  private coerceValue(raw: unknown, dataType: FormulaDataType): unknown {
    switch (dataType) {
      case 'checkbox':
        return raw === 'true' || raw === true;
      case 'number':
        return raw === '' || raw === undefined ? 0 : Number(raw);
      case 'date':
      case 'datetime':
      case 'time':
        return new Date(raw as string);
      case 'null':
        return null;
      default:
        return raw ?? '';
    }
  }

}