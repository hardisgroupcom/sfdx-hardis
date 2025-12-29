import { Flags, SfCommand, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import path from 'path';
import sortArray from 'sort-array';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { createXlsxFromCsvFiles, generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';

export default class FieldStorageUsage extends SfCommand<any> {
  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    sobjects: Flags.string({
      char: 's',
      description: 'Comma-separated list of SObjects to analyze',
    }),
  };

  public static description = `
## Command Behavior

**Counts how many records contain a value for each field across selected objects and highlights which fields are actually used.**

The command discovers relevant objects (excluding managed package and technical objects), prompts you to pick which ones to analyze (if none are provided through the \`--sobjects\` flag), and then:

- **Measures usage**: Counts how many records have a value for every supported field.
- **Reporting**: Produces one summary CSV plus one CSV per object, and a consolidated XLSX with a summary sheet and one sheet per object showing only fields that contain data.

<details markdown="1">
<summary>Technical explanations</summary>

- **Object discovery**: Uses \`describeGlobal\` combined with metadata filters to keep only queryable, layoutable objects, excluding technical/managed-package ones and change/event/feed/history objects.
- **Interactive selection**: When \`--sobjects\` is omitted, a multiselect prompt lets you pick the objects to scan.
- **Per-field metrics**: Runs aggregate SOQL such as \`COUNT(Field__c)\` to derive fill rate (records with a value). No storage estimation is performed.
- **Outputs**:
  - Summary CSV with totals per object (records and fields that have at least one value).
  - One CSV per object listing only fields that have at least one non-null value, with counts and fill rate.
  - A single XLSX combining all CSVs into individual tabs (summary + one tab per object).
</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:field-storage-usage',
    '$ sf hardis:org:diagnose:field-storage-usage --sobjects Account,Contact',
  ];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FieldStorageUsage);
    const conn: Connection = flags['target-org'].getConnection();
    const sObjectsFlag = flags.sobjects ? flags.sobjects.split(',').map((s: string) => s.trim()).filter(Boolean) : null;

    const candidates = await this.getCandidateObjects(conn, sObjectsFlag);
    const selectedObjects = await this.promptObjectsIfNeeded(candidates, sObjectsFlag);
    if (!selectedObjects || selectedObjects.length === 0) {
      uxLog("warning", this, c.yellow('No SObjects selected for analysis.'));
      return {
        summaryFile: null,
        objectFiles: [],
        xlsxFile: null,
      };
    }

    const summaryFile = await generateReportPath('field-storage-usage-summary', '', { withDate: true });
    const reportDir = path.dirname(summaryFile);

    const summaryRows: any[] = [];
    const objectCsvFiles: string[] = [];

    for (const obj of selectedObjects) {
      const stats = await this.analyzeObject(conn, obj);
      if (!stats || stats.fieldsWithData.length === 0) {
        uxLog("warning", this, c.yellow(`No fields with data found for ${c.cyan(obj.name)}; skipping report generation for this object.`));
        continue;
      }

      summaryRows.push({
        Object: obj.name,
        Label: obj.label,
        TotalRecords: stats.totalRecords,
        FieldsWithData: stats.fieldsWithData.length,
        TotalFilledRecords: stats.fieldsWithData.reduce((acc, f) => acc + f.filledRecords, 0),
      });

      const objectRows = stats.fieldsWithData.map((field) => ({
        Object: obj.name,
        FieldApiName: field.apiName,
        FieldLabel: field.label,
        Type: field.type,
        TotalRecords: stats.totalRecords,
        FilledRecords: field.filledRecords,
        FillRate: stats.totalRecords > 0 ? `${((field.filledRecords / stats.totalRecords) * 100).toFixed(2)}%` : '0%',
      }));

      const sanitizedName = obj.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'object';
      const objectCsvPath = await this.buildObjectCsv(objectRows, sanitizedName, reportDir);
      objectCsvFiles.push(objectCsvPath);
    }

    sortArray(summaryRows, { by: 'TotalFilledRecords', order: 'desc' });
    await generateCsvFile(summaryRows, summaryFile, { fileTitle: 'Field usage summary', noExcel: true });

    if (summaryRows.length > 0) {
      uxLog("action", this, `Field usage summary (top 10 by filled records)`);
      uxLogTable(this, summaryRows.slice(0, 10));
    }

    const xlsx = await this.generateConsolidatedXlsx(summaryFile, objectCsvFiles);

    return {
      summaryFile,
      objectFiles: objectCsvFiles,
      xlsxFile: xlsx,
    };
  }

  private async getCandidateObjects(conn: Connection, sObjectsFilter: string[] | null) {
    const describe = await conn.describeGlobal();
    const customObjects = await conn.metadata.list([{ type: 'CustomObject' }]);
    const customNames = Array.isArray(customObjects) ? customObjects.map((o: any) => o.fullName) : [];

    const filtered = describe.sobjects.filter((obj: any) => {
      if (!obj.queryable || !obj.retrieveable || !obj.layoutable) {
        return false;
      }
      const excludedSuffixes = ['__mdt', '__tag', '__feed', '__history'];
      if (excludedSuffixes.some((suffix) => obj.name.endsWith(suffix))) {
        return false;
      }
      if (obj.name.endsWith('ChangeEvent')) {
        return false;
      }
      if (/^.+__.+__c$/i.test(obj.name)) {
        return false; // Exclude managed package objects
      }
      if (sObjectsFilter && sObjectsFilter.length > 0) {
        return sObjectsFilter.includes(obj.name);
      }
      if (obj.custom && !customNames.includes(obj.name)) {
        return false;
      }
      return true;
    });

    sortArray(filtered, { by: 'name' });
    return filtered;
  }

  private async promptObjectsIfNeeded(candidates: any[], sObjectsFilter: string[] | null) {
    if (sObjectsFilter && sObjectsFilter.length > 0) {
      return candidates;
    }

    const choices = candidates.map((obj: any) => ({
      title: obj.label ? `${obj.label} (${obj.name})` : obj.name,
      value: obj.name,
    }));

    const promptObjectsRes = await prompts({
      type: 'multiselect',
      message: 'Select the SObjects to analyze for field storage usage:',
      description: "Exclude objects you don't want to analyze.",
      choices,
      initial: choices.map((choice: any) => choice.value),
    });

    const selectedNames: string[] = promptObjectsRes.value || [];
    return candidates.filter((obj: any) => selectedNames.includes(obj.name));
  }

  private async analyzeObject(conn: Connection, obj: any) {
    uxLog("action", this, `Analyzing ${c.cyan(obj.name)} ...`);
    let describe;
    try {
      describe = await conn.sobject(obj.name).describe();
    } catch (error: any) {
      uxLog("warning", this, c.yellow(`Skipping object ${c.cyan(obj.name)} (describe failed: ${error.message})`));
      return null;
    }
    let totalRecords = 0;
    try {
      const totalRecordsRes = await soqlQuery(`SELECT COUNT() FROM ${obj.name}`, conn);
      totalRecords = totalRecordsRes.totalSize;
    } catch (error: any) {
      uxLog("warning", this, c.yellow(`Skipping object ${c.cyan(obj.name)} (count query failed: ${error.message})`));
      return null;
    }

    const fields = describe.fields.filter((field: any) => {
      if (!field.queryable || field.calculated === true || field.type === 'address') {
        return false;
      }
      if (field.autoNumber === true) {
        return false;
      }
      return true;
    });

    const fieldsWithData: any[] = [];

    for (const field of fields) {
      const fieldStats = await this.analyzeField(conn, obj.name, field, totalRecords);
      if (fieldStats && fieldStats.filledRecords > 0) {
        fieldsWithData.push(fieldStats);
      }
    }

    sortArray(fieldsWithData, { by: 'filledRecords', order: 'desc' });

    return {
      name: obj.name,
      label: obj.label,
      totalRecords,
      fieldsWithData,
    };
  }

  private async analyzeField(conn: Connection, objectName: string, field: any, totalRecords: number) {
    const selectParts = [`COUNT(${field.name}) filledRecords`];
    const query = `SELECT ${selectParts.join(', ')} FROM ${objectName}`;

    let queryRes;
    try {
      queryRes = await soqlQuery(query, conn);
    } catch (error: any) {
      uxLog("warning", this, c.yellow(`Skipping field ${c.cyan(field.name)} on ${c.cyan(objectName)} (query error: ${error.message})`));
      return null;
    }

    if (!queryRes.records || queryRes.records.length === 0) {
      uxLog("warning", this, c.yellow(`Skipping field ${c.cyan(field.name)} on ${c.cyan(objectName)} (no aggregate result returned)`));
      return null;
    }

    const record = queryRes.records[0] || {};
    const filledRecords = this.getAggregateValue(record, 'filledRecords');
    if (filledRecords === 0) {
      return null;
    }

    return {
      apiName: field.name,
      label: field.label,
      type: field.type,
      filledRecords,
      totalRecords,
    };
  }

  private getAggregateValue(record: any, key: string): number {
    if (record[key] !== undefined) {
      return Number(record[key]) || 0;
    }
    const entry = Object.entries(record).find(([k]) => k.toLowerCase() === key.toLowerCase());
    return entry ? Number(entry[1]) || 0 : 0;
  }

  private async buildObjectCsv(rows: any[], sanitizedName: string, reportDir: string) {
    const objectPath = path.join(reportDir, `field-storage-usage-${sanitizedName}.csv`);
    await generateCsvFile(rows, objectPath, { fileTitle: `Field storage usage for ${sanitizedName}`, noExcel: true });
    return objectPath;
  }

  private async generateConsolidatedXlsx(summaryFile: string, objectCsvFiles: string[]) {
    const csvFiles = [summaryFile, ...objectCsvFiles];
    await createXlsxFromCsvFiles(csvFiles, summaryFile, { fileTitle: 'Field storage usage' });
    const xlsxPath = path.join(path.dirname(summaryFile), 'xls', path.basename(summaryFile).replace('.csv', '.xlsx'));
    return xlsxPath;
  }
}
