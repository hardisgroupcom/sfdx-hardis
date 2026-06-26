import path from 'path';
import fs from 'fs-extra';
import Papa from 'papaparse';
import { Connection } from '@salesforce/core';
import c from 'chalk';
import { uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import {
  createXlsxFromCsvFiles,
  ExcelColumnStyle,
  generateReportPath,
} from './filesUtils.js';
import { t } from './i18n.js';

// Picklists with hundreds of values would produce unreadable cells: cap the listing and flag the overflow.
export const MAX_PICKLIST_VALUES_IN_CELL = 50;

export interface ObjectDataDictionary {
  apiName: string;
  label: string;
  custom: boolean;
  keyPrefix: string;
  fields: Record<string, string>[];
}

const NUMERIC_FIELD_TYPES = new Set(['currency', 'double', 'int', 'percent', 'long']);

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

export function formatPicklistValues(field: any): string {
  const values = Array.isArray(field?.picklistValues) ? field.picklistValues : [];
  const activeValues = values
    .filter((entry: any) => entry?.active !== false)
    .map((entry: any) => entry?.value)
    .filter((value: any) => typeof value === 'string' && value.length > 0);
  if (activeValues.length === 0) {
    return '';
  }
  if (activeValues.length > MAX_PICKLIST_VALUES_IN_CELL) {
    const shown = activeValues.slice(0, MAX_PICKLIST_VALUES_IN_CELL);
    const remaining = activeValues.length - MAX_PICKLIST_VALUES_IN_CELL;
    return `${shown.join('; ')} (+${remaining} more)`;
  }
  return activeValues.join('; ');
}

function formatLengthPrecision(field: any): string {
  const type = (field?.type || '').toLowerCase();
  if (NUMERIC_FIELD_TYPES.has(type)) {
    return `${field.precision ?? ''},${field.scale ?? ''}`;
  }
  return field?.length ? String(field.length) : '';
}

function formatReferenceTo(field: any): string {
  const references = Array.isArray(field?.referenceTo) ? field.referenceTo : [];
  if (references.length === 0) {
    return '';
  }
  const joined = references.join(', ');
  return field?.relationshipName ? `${joined} (${field.relationshipName})` : joined;
}

function formatDefaultValue(field: any): string {
  if (field?.defaultValueFormula) {
    return String(field.defaultValueFormula);
  }
  if (field?.defaultValue !== null && field?.defaultValue !== undefined && field?.defaultValue !== '') {
    return String(field.defaultValue);
  }
  return '';
}

function buildFieldRow(field: any): Record<string, string> {
  return {
    'API Name': field?.name || '',
    'Label': field?.label || '',
    'Type': field?.type || '',
    'Required': yesNo(field?.nillable === false),
    'Unique': yesNo(field?.unique === true),
    'External ID': yesNo(field?.externalId === true),
    'Length/Precision': formatLengthPrecision(field),
    'Reference To': formatReferenceTo(field),
    'Picklist Values': formatPicklistValues(field),
    'Default Value': formatDefaultValue(field),
    'Formula': field?.calculatedFormula || '',
    'Help Text': field?.inlineHelpText || '',
    'Description': field?.description || '',
    'Custom': yesNo(field?.custom === true),
  };
}

export async function collectObjectDictionary(
  conn: Connection,
  objectName: string,
  commandThis: any
): Promise<ObjectDataDictionary | null> {
  try {
    const describeResult: any = await conn.describe(objectName);
    const fields = (Array.isArray(describeResult?.fields) ? describeResult.fields : []).map((field: any) =>
      buildFieldRow(field)
    );
    return {
      apiName: describeResult?.name || objectName,
      label: describeResult?.label || objectName,
      custom: describeResult?.custom === true,
      keyPrefix: describeResult?.keyPrefix || '',
      fields,
    };
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(t('unableToDescribeObject', { sObjectName: objectName })));
    uxLog('other', commandThis, c.grey((e as Error).message));
    return null;
  }
}

export async function fetchValidationRules(
  conn: Connection,
  objectNames: string[],
  commandThis: any
): Promise<Record<string, string>[]> {
  if (objectNames.length === 0) {
    return [];
  }
  const objectSet = new Set(objectNames);
  try {
    const listResult = await conn.metadata.list([{ type: 'ValidationRule' }]);
    const fullNames = (Array.isArray(listResult) ? listResult : [])
      .map((item: any) => item?.fullName)
      .filter((fullName: any) => typeof fullName === 'string' && fullName.includes('.'))
      .filter((fullName: string) => objectSet.has(fullName.substring(0, fullName.indexOf('.'))));
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < fullNames.length; i += 10) {
      const batch = fullNames.slice(i, i + 10);
      const readResult = await conn.metadata.read('ValidationRule', batch);
      const rules = Array.isArray(readResult) ? readResult : [readResult];
      for (const rule of rules) {
        const fullName: string = (rule as any)?.fullName || '';
        if (!fullName.includes('.')) {
          continue;
        }
        rows.push({
          'Object': fullName.substring(0, fullName.indexOf('.')),
          'Name': fullName.substring(fullName.indexOf('.') + 1),
          'Active': yesNo((rule as any)?.active === true || (rule as any)?.active === 'true'),
          'Error Message': (rule as any)?.errorMessage || '',
          'Error Location': (rule as any)?.errorDisplayField || '',
          'Formula': (rule as any)?.errorConditionFormula || '',
          'Description': (rule as any)?.description || '',
        });
      }
    }
    return rows;
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(t('unableToRetrieveValidationRules', { error: (e as Error).message })));
    return [];
  }
}

export async function fetchRecordTypes(
  conn: Connection,
  objectNames: string[],
  commandThis: any
): Promise<Record<string, string>[]> {
  if (objectNames.length === 0) {
    return [];
  }
  const inClause = objectNames.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(',');
  const query = `SELECT DeveloperName, Name, IsActive, Description, SobjectType FROM RecordType WHERE SobjectType IN (${inClause}) ORDER BY SobjectType, DeveloperName`;
  try {
    const result = await soqlQuery(query, conn);
    return (result?.records || []).map((record: any) => ({
      'Object': record?.SobjectType || '',
      'Developer Name': record?.DeveloperName || '',
      'Label': record?.Name || '',
      'Active': yesNo(record?.IsActive === true),
      'Description': record?.Description || '',
    }));
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(t('unableToRetrieveRecordTypes', { error: (e as Error).message })));
    return [];
  }
}

export async function writeDataDictionaryReports(
  commandThis: any,
  objectDicts: ObjectDataDictionary[],
  validationRules: Record<string, string>[],
  recordTypes: Record<string, string>[],
  outputFile: string | null
): Promise<any[]> {
  const reportFiles: any[] = [];
  const csvFiles: string[] = [];
  const worksheetNames: Record<string, string> = {};

  const validationRulesByObject = countByObject(validationRules);
  const recordTypesByObject = countByObject(recordTypes);

  // Index sheet
  const indexRows = objectDicts.map((dict) => ({
    'API Name': dict.apiName,
    'Label': dict.label,
    'Custom': yesNo(dict.custom),
    'Key Prefix': dict.keyPrefix,
    'Fields': String(dict.fields.length),
    'Validation Rules': String(validationRulesByObject[dict.apiName] || 0),
    'Record Types': String(recordTypesByObject[dict.apiName] || 0),
  }));
  const indexPath = await generateReportPath('data-dictionary-index', '', { withDate: true });
  await writeSheetCsv(indexRows, indexPath);
  worksheetNames[indexPath] = 'Index';
  csvFiles.push(indexPath);
  reportFiles.push({ type: 'csv', file: indexPath });

  // One fields sheet per object
  for (const dict of objectDicts) {
    if (dict.fields.length === 0) {
      continue;
    }
    const fieldsPath = await generateReportPath(`data-dictionary-${dict.apiName}`, '', { withDate: true });
    await writeSheetCsv(dict.fields, fieldsPath);
    worksheetNames[fieldsPath] = dict.apiName;
    csvFiles.push(fieldsPath);
    reportFiles.push({ type: 'csv', file: fieldsPath });
  }

  // Consolidated Validation Rules sheet
  if (validationRules.length > 0) {
    const vrPath = await generateReportPath('data-dictionary-validation-rules', '', { withDate: true });
    await writeSheetCsv(validationRules, vrPath);
    worksheetNames[vrPath] = 'Validation Rules';
    csvFiles.push(vrPath);
    reportFiles.push({ type: 'csv', file: vrPath });
  }

  // Consolidated Record Types sheet
  if (recordTypes.length > 0) {
    const rtPath = await generateReportPath('data-dictionary-record-types', '', { withDate: true });
    await writeSheetCsv(recordTypes, rtPath);
    worksheetNames[rtPath] = 'Record Types';
    csvFiles.push(rtPath);
    reportFiles.push({ type: 'csv', file: rtPath });
  }

  const consolidatedBase =
    outputFile || (await generateReportPath('data-dictionary', '', { withDate: true }));
  const columnsCustomStyles: Record<string, ExcelColumnStyle> = {
    'picklist values': { wrap: true, width: 45, maxHeight: 150 },
    'formula': { wrap: true, width: 45, maxHeight: 150 },
    'description': { wrap: true, width: 45, maxHeight: 150 },
    'help text': { wrap: true, width: 35, maxHeight: 120 },
    'error message': { wrap: true, width: 45, maxHeight: 120 },
    'reference to': { wrap: true, width: 25 },
  };
  await createXlsxFromCsvFiles(csvFiles, consolidatedBase, {
    fileTitle: 'Data dictionary',
    worksheetNames,
    columnsCustomStyles,
    // The Index "Key Prefix" column holds leading-zero identifiers (e.g. "001") that must not be auto-typed.
    forceTextColumns: ['Key Prefix'],
  });
  const consolidatedXlsx = path.join(
    path.dirname(consolidatedBase),
    'xls',
    path.basename(consolidatedBase).replace('.csv', '.xlsx')
  );
  reportFiles.push({ type: 'xlsx', file: consolidatedXlsx });

  return reportFiles;
}

// Write an intermediate CSV directly; these files are only consumed by createXlsxFromCsvFiles,
// so we skip generateCsvFile (which would log a misleading "no XLS generated" line per file).
async function writeSheetCsv(rows: Record<string, string>[], outputPath: string): Promise<void> {
  const csvContent = Papa.unparse(rows);
  await fs.writeFile(outputPath, csvContent, 'utf8');
}

function countByObject(rows: Record<string, string>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const objectName = row['Object'];
    if (!objectName) {
      continue;
    }
    counts[objectName] = (counts[objectName] || 0) + 1;
  }
  return counts;
}
